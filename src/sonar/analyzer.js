import { execSync, spawnSync } from 'node:child_process';
import { logger } from '../utils/logger.js';

const SONAR_URL = process.env.SONAR_URL || 'http://localhost:9000';
const SONAR_TOKEN = process.env.SONAR_TOKEN || '';
const SONAR_WAIT_MS = parseInt(process.env.SONAR_WAIT_MS || '30000');

/**
 * Runs SonarQube scanner and waits for quality gate result.
 * @param {string} cwd - Project directory
 * @param {string} branchName - Branch being analyzed
 * @returns {{ qualityGate: string, bugs: number, vulnerabilities: number, codeSmells: number, coverage: number, issues: object[] }}
 */
export async function analyzeSonar(cwd, branchName) {
  if (!SONAR_TOKEN) {
    logger.warn('SONAR_TOKEN not set — skipping SonarQube analysis', 'SONAR');
    return { qualityGate: 'SKIPPED', bugs: 0, vulnerabilities: 0, codeSmells: 0, coverage: 0, issues: [] };
  }

  logger.info(`Running SonarQube scanner on branch ${branchName}...`, 'SONAR');

  const result = spawnSync(
    'sonar-scanner',
    [
      `-Dsonar.branch.name=${branchName}`,
      `-Dsonar.host.url=${SONAR_URL}`,
      `-Dsonar.login=${SONAR_TOKEN}`,
    ],
    { cwd, stdio: 'pipe', shell: process.platform === 'win32' }
  );

  if (result.status !== 0) {
    const err = result.stderr?.toString() || 'unknown error';
    logger.error(`SonarQube scanner failed: ${err}`, 'SONAR');
    throw new Error(`SonarQube scanner failed: ${err}`);
  }

  logger.info(`Scanner done. Waiting ${SONAR_WAIT_MS}ms for results...`, 'SONAR');
  await new Promise(r => setTimeout(r, SONAR_WAIT_MS));

  const projectKey = getProjectKey(cwd);
  const headers = { Authorization: `Bearer ${SONAR_TOKEN}`, 'Content-Type': 'application/json' };

  const gateRes = await fetch(
    `${SONAR_URL}/api/qualitygates/project_status?projectKey=${projectKey}&branch=${branchName}`,
    { headers }
  );
  const gateData = await gateRes.json();
  const qualityGate = gateData.projectStatus?.status || 'ERROR';

  const metricsRes = await fetch(
    `${SONAR_URL}/api/measures/component?component=${projectKey}&branch=${branchName}&metricKeys=bugs,vulnerabilities,code_smells,coverage`,
    { headers }
  );
  const metricsData = await metricsRes.json();
  const measures = metricsData.component?.measures || [];

  const get = key => {
    const m = measures.find(m => m.metric === key);
    return m ? parseFloat(m.value) : 0;
  };

  const issuesRes = await fetch(
    `${SONAR_URL}/api/issues/search?componentKeys=${projectKey}&branch=${branchName}&resolved=false&ps=50`,
    { headers }
  );
  const issuesData = await issuesRes.json();
  const issues = issuesData.issues || [];

  const report = {
    qualityGate,
    bugs: get('bugs'),
    vulnerabilities: get('vulnerabilities'),
    codeSmells: get('code_smells'),
    coverage: get('coverage'),
    issues,
  };

  if (qualityGate === 'ERROR') {
    logger.warn(`Quality gate FAILED — merge blocked. Bugs: ${report.bugs}, Vulnerabilities: ${report.vulnerabilities}`, 'SONAR');
  } else {
    logger.success(`Quality gate PASSED (${qualityGate})`, 'SONAR');
  }

  return report;
}

function getProjectKey(cwd) {
  try {
    const props = execSync('cat sonar-project.properties', { cwd, stdio: 'pipe' }).toString();
    const match = props.match(/sonar\.projectKey\s*=\s*(.+)/);
    if (match) return match[1].trim();
  } catch { /* no sonar-project.properties */ }

  const pkgPath = `${cwd}/package.json`;
  try {
    const pkg = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf8'));
    return pkg.name || 'remoduler';
  } catch {
    return 'remoduler';
  }
}
