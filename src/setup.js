import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const SKILLS_DIR = join(ROOT_DIR, 'skills');

const TOTAL_STEPS = 7;

function ask(rl, question, defaultVal) {
  return new Promise(res => {
    const suffix = defaultVal ? ` (${defaultVal})` : '';
    rl.question(`  ${question}${suffix}: `, answer => {
      res(answer.trim() || defaultVal || '');
    });
  });
}

function cliExists(cmd) {
  try {
    execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function printStep(num, title) {
  console.log(`\n  ── Paso ${num}/${TOTAL_STEPS}: ${title} ──\n`);
}

function validateServiceAccountKey(filePath) {
  const trimmed = filePath.trim().replace(/^["']|["']$/g, '');
  if (!trimmed || !existsSync(trimmed)) return null;

  try {
    const parsed = JSON.parse(readFileSync(trimmed, 'utf-8'));
    if (parsed.type !== 'service_account') return null;
    return { path: resolve(trimmed), projectId: parsed.project_id };
  } catch { return null; }
}

function autoDetectDbUrl(projectId) {
  if (!projectId) return '';
  return `https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app`;
}

function getMcpClients() {
  const isWin = process.platform === 'win32';
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');

  return [
    { name: 'Claude Code', path: join(homedir(), '.mcp.json'), format: 'mcpServers' },
    {
      name: 'Claude Desktop',
      path: isWin
        ? join(appData, 'Claude', 'claude_desktop_config.json')
        : join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      format: 'mcpServers',
    },
    { name: 'Cursor', path: join(homedir(), '.cursor', 'mcp.json'), format: 'mcpServers' },
    { name: 'VS Code (Copilot)', path: join(homedir(), '.vscode', 'mcp.json'), format: 'servers' },
  ];
}

function registerMcpInClients(servers) {
  const clients = getMcpClients();
  const configured = [];

  for (const client of clients) {
    const dirPath = dirname(client.path);
    if (!existsSync(dirPath)) {
      if (!existsSync(dirname(dirPath))) continue;
      mkdirSync(dirPath, { recursive: true });
    }

    let existing = {};
    if (existsSync(client.path)) {
      try { existing = JSON.parse(readFileSync(client.path, 'utf-8')); } catch {}
    }

    const key = client.format;
    const merged = {
      ...existing,
      [key]: { ...(existing[key] || {}), ...servers },
    };

    writeFileSync(client.path, JSON.stringify(merged, null, 2) + '\n');
    console.log(`  ✓ ${client.name}`);
    configured.push(client.name);
  }

  return configured;
}

function configurePermissions() {
  const permissions = [
    'mcp__remoduler-mcp__*',
    'mcp__planning-task-mcp__*',
    'mcp__github-mcp__*',
    'mcp__memory-mcp__*',
  ];

  const claudeSettings = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(join(homedir(), '.claude'))) return;

  let settings = {};
  if (existsSync(claudeSettings)) {
    try { settings = JSON.parse(readFileSync(claudeSettings, 'utf-8')); } catch {}
  }

  if (!settings.permissions) settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

  for (const perm of permissions) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
    }
  }

  writeFileSync(claudeSettings, JSON.stringify(settings, null, 2) + '\n');
  console.log('  ✓ Claude Code permissions configured');
}

function installDeps(dir, name) {
  if (existsSync(join(dir, 'node_modules'))) {
    console.log(`  ✓ ${name} — deps already installed`);
    return;
  }
  console.log(`  Installing ${name}...`);
  try {
    execSync('npm install', { cwd: dir, stdio: 'pipe' });
    console.log(`  ✓ ${name} — installed`);
  } catch (err) {
    console.log(`  ✗ ${name} — failed: ${err.message}`);
  }
}

export async function runSetup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║        REMODULER — Instalador             ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  Configura Remoduler y registra los MCPs');
  console.log('  en todos tus clientes (Claude Code, Cursor, etc).');
  console.log('');

  // === STEP 1: Prerequisites ===
  printStep(1, 'Verificar prerequisitos');
  const checks = [
    ['node', cliExists('node')],
    ['git', cliExists('git')],
    ['gh (GitHub CLI)', cliExists('gh')],
    ['claude (Claude Code)', cliExists('claude')],
  ];

  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }

  const missing = checks.filter(([, ok]) => !ok);
  if (missing.length > 0) {
    console.log(`\n  ⚠ Missing: ${missing.map(([n]) => n).join(', ')}`);
  }

  // === STEP 2: Dependencies ===
  printStep(2, 'Instalar dependencias');
  installDeps(ROOT_DIR, 'remoduler');
  installDeps(join(SKILLS_DIR, 'remoduler-mcp'), 'remoduler-mcp');
  installDeps(join(SKILLS_DIR, 'planning-task-mcp'), 'planning-task-mcp');
  installDeps(join(SKILLS_DIR, 'github-mcp'), 'github-mcp');
  installDeps(join(SKILLS_DIR, 'memory-mcp'), 'memory-mcp');

  // === STEP 3: Firebase ===
  printStep(3, 'Firebase');

  // Auto-detect serviceAccountKey
  const defaultSaPath = join(ROOT_DIR, 'serviceAccountKey.json');
  const planningTaskSaPath = join(SKILLS_DIR, 'planning-task-mcp', 'serviceAccountKey.json');
  let saInfo = null;

  if (existsSync(defaultSaPath)) {
    saInfo = validateServiceAccountKey(defaultSaPath);
    if (saInfo) console.log(`  ⚡ Detectada: ${defaultSaPath}`);
  } else if (existsSync(planningTaskSaPath)) {
    saInfo = validateServiceAccountKey(planningTaskSaPath);
    if (saInfo) console.log(`  ⚡ Detectada: ${planningTaskSaPath}`);
  }

  if (!saInfo) {
    console.log('  No se encontró serviceAccountKey.json');
    console.log('  Descárgalo desde Firebase Console → Cuentas de servicio\n');
    const path = await ask(rl, 'Ruta al archivo');
    saInfo = validateServiceAccountKey(path);
    if (!saInfo) {
      console.log('  ✗ Archivo no válido');
      rl.close();
      return;
    }
  }

  const saKeyPath = saInfo.path.replace(/\\/g, '/');
  console.log(`  ✓ Service Account: ${saInfo.projectId}`);

  const autoUrl = autoDetectDbUrl(saInfo.projectId);
  let firebaseUrl = autoUrl;
  if (autoUrl) {
    console.log(`  DB URL detectada: ${autoUrl}`);
    const custom = await ask(rl, 'Enter para usar esta, o escribe otra', '');
    if (custom) firebaseUrl = custom;
  } else {
    firebaseUrl = await ask(rl, 'Firebase Database URL');
  }

  // === STEP 4: User ===
  printStep(4, 'Usuario');
  const userId = await ask(rl, 'Firebase User ID (DEFAULT_USER_ID)');
  const userName = await ask(rl, 'Tu nombre');

  // === STEP 5: Project + Config ===
  printStep(5, 'Configuración');
  const projectId = await ask(rl, 'Default Project ID');
  const dailyBudget = await ask(rl, 'Presupuesto diario USD', '10');
  const maxCycles = await ask(rl, 'Máx ciclos de review', '3');
  const autoMerge = await ask(rl, 'Auto-merge PRs aprobadas (true/false)', 'true');

  rl.close();

  // Generate .env
  const env = `# REMODULER CONFIG — Generated by remoduler install
GOOGLE_APPLICATION_CREDENTIALS=${saKeyPath}
FIREBASE_DATABASE_URL=${firebaseUrl}
DEFAULT_USER_ID=${userId}
DEFAULT_USER_NAME=${userName}
DEFAULT_PROJECT_ID=${projectId}

CLI_PLANNER=claude
CLI_CODER=claude
CLI_REVIEWER=claude
CLI_ARCHITECT=claude

WS_PORT=3001
API_PORT=3002

MAX_REVIEW_CYCLES=${maxCycles}
AUTO_MERGE=${autoMerge}
DAILY_BUDGET_USD=${dailyBudget}
WEEKLY_BUDGET_USD=50
BUDGET_WARNING_THRESHOLD=0.8

RATE_LIMIT_FALLBACK=true
FALLBACK_CLI_ORDER=claude,codex,gemini
RATE_LIMIT_COOLDOWN_MINUTES=15
`;

  const envPath = join(ROOT_DIR, '.env');
  if (existsSync(envPath)) {
    console.log('\n  .env ya existe, guardando como .env.generated');
    writeFileSync(join(ROOT_DIR, '.env.generated'), env);
  } else {
    writeFileSync(envPath, env);
    console.log('\n  ✓ .env creado');
  }

  // === STEP 6: Register MCPs ===
  printStep(6, 'Registrar MCPs en clientes');

  const envVars = {
    GOOGLE_APPLICATION_CREDENTIALS: saKeyPath,
    FIREBASE_DATABASE_URL: firebaseUrl,
    DEFAULT_USER_ID: userId,
    DEFAULT_USER_NAME: userName,
    REMODULER_ROOT: ROOT_DIR.replace(/\\/g, '/'),
  };

  const mcpServers = {
    'remoduler-mcp': {
      command: 'node',
      args: [join(SKILLS_DIR, 'remoduler-mcp', 'src', 'index.js').replace(/\\/g, '/')],
      env: { REMODULER_ROOT: ROOT_DIR.replace(/\\/g, '/') },
    },
    'planning-task-mcp': {
      command: 'node',
      args: [join(SKILLS_DIR, 'planning-task-mcp', 'src', 'index.js').replace(/\\/g, '/')],
      env: envVars,
    },
    'github-mcp': {
      command: 'node',
      args: [join(SKILLS_DIR, 'github-mcp', 'src', 'index.js').replace(/\\/g, '/')],
    },
    'memory-mcp': {
      command: 'node',
      args: [join(SKILLS_DIR, 'memory-mcp', 'src', 'index.js').replace(/\\/g, '/')],
      env: { REMODULER_ROOT: ROOT_DIR.replace(/\\/g, '/') },
    },
  };

  const configured = registerMcpInClients(mcpServers);

  // === STEP 7: Permissions ===
  printStep(7, 'Configurar permisos');
  configurePermissions();

  // === SUMMARY ===
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║        Instalación completada             ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Firebase         ✓  ${saInfo.projectId}`);
  console.log(`  Database URL     ✓  ${firebaseUrl}`);
  console.log(`  User             ${userId ? '✓' : '⚠'}  ${userName || '(no configurado)'} (${userId || 'sin ID'})`);
  console.log(`  Project          ${projectId ? '✓' : '⚠'}  ${projectId || '(no configurado)'}`);
  console.log(`  MCPs registrados ✓  remoduler-mcp, planning-task-mcp, github-mcp, memory-mcp`);
  console.log(`  Clientes         ✓  ${configured.join(', ') || 'ninguno'}`);
  console.log(`  Budget           ✓  $${dailyBudget}/día`);
  console.log('');
  console.log('  Reinicia tu terminal/IDE y prueba:');
  console.log('    "remoduler plan" o usa remoduler_plan desde Claude Code');
  console.log('');
}
