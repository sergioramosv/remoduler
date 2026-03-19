#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const TOTAL_STEPS = 6;

// ─── CLI argument parsing ───

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sa-key':    parsed.saKey = args[++i]; break;
      case '--db-url':    parsed.dbUrl = args[++i]; break;
      case '--user-id':   parsed.userId = args[++i]; break;
      case '--user-name': parsed.userName = args[++i]; break;
      case '--no-register': parsed.noRegister = true; break;
      case '--help': case '-h':
        printHelp();
        process.exit(0);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`
  Planning Task MCP - Instalador

  Uso:
    npm run setup                         # Modo interactivo
    npm run setup -- [opciones]           # Modo CLI

  Opciones:
    --sa-key <ruta>      Ruta al archivo serviceAccountKey.json
    --db-url <url>       URL de Firebase Realtime Database
    --user-id <uid>      UID de Firebase Auth
    --user-name <nombre> Nombre del usuario
    --no-register        No registrar en clientes MCP
    -h, --help           Mostrar esta ayuda

  Las credenciales se guardan directamente en el config de cada
  cliente MCP (env block). No se crea ninguna carpeta externa.
  `);
}

// ─── Helpers ───

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function printBanner() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   Planning Task MCP - Instalador         ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  Configura el MCP en todos tus clientes.');
  console.log('  No arranca ningún servidor, solo configura.');
  console.log('');
}

function printStep(num, title) {
  console.log(`\n  ── Paso ${num}/${TOTAL_STEPS}: ${title} ──\n`);
}

function ensureDependencies() {
  const sdkPath = join(PROJECT_ROOT, 'node_modules', '@modelcontextprotocol', 'sdk');
  const firebasePath = join(PROJECT_ROOT, 'node_modules', 'firebase-admin');

  if (existsSync(sdkPath) && existsSync(firebasePath)) {
    console.log('  ✓ Dependencias ya instaladas');
    return;
  }

  // When installed globally via npm, deps are in the global node_modules tree
  // Check by trying to resolve from the package's own directory
  try {
    const result = execSync('node -e "require.resolve(\'firebase-admin\')"', {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
    });
    console.log('  ✓ Dependencias disponibles (instalación global)');
    return;
  } catch {
    // Not available — install locally
  }

  console.log('  Instalando dependencias (npm install)...');
  try {
    execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'pipe' });
    console.log('  ✓ Dependencias instaladas correctamente');
  } catch (err) {
    console.error(`  ✗ ERROR al instalar dependencias: ${err.message}`);
    console.error('  Intenta manualmente: cd ' + PROJECT_ROOT + ' && npm install');
    process.exit(1);
  }
}

function validateServiceAccountKey(filePath) {
  const trimmed = filePath.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) {
    console.error('  ✗ ERROR: Se requiere el archivo serviceAccountKey.json');
    process.exit(1);
  }

  if (!existsSync(trimmed)) {
    console.error(`  ✗ ERROR: No se encontró: ${trimmed}`);
    process.exit(1);
  }

  try {
    const parsed = JSON.parse(readFileSync(trimmed, 'utf-8'));
    if (parsed.type !== 'service_account') {
      console.error('  ✗ ERROR: El archivo no es un Service Account Key válido.');
      process.exit(1);
    }
    console.log(`  ✓ Service Account Key válida (proyecto: ${parsed.project_id})`);
    return { path: resolve(trimmed), projectId: parsed.project_id };
  } catch {
    console.error('  ✗ ERROR: El archivo no es JSON válido.');
    process.exit(1);
  }
}

function autoDetectDbUrl(projectId) {
  if (!projectId) return '';
  return `https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app`;
}

function getMcpClients() {
  const isWin = process.platform === 'win32';
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');

  return [
    {
      name: 'Claude Code',
      path: join(homedir(), '.mcp.json'),
      format: 'mcpServers',
    },
    {
      name: 'Claude Desktop',
      path: isWin
        ? join(appData, 'Claude', 'claude_desktop_config.json')
        : join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      format: 'mcpServers',
    },
    {
      name: 'Cursor',
      path: join(homedir(), '.cursor', 'mcp.json'),
      format: 'mcpServers',
    },
    {
      name: 'Windsurf',
      path: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
      format: 'mcpServers',
    },
    {
      name: 'VS Code (Copilot)',
      path: join(homedir(), '.vscode', 'mcp.json'),
      format: 'servers',
    },
    {
      name: 'Gemini CLI',
      path: join(homedir(), '.gemini', 'settings.json'),
      format: 'mcpServers',
    },
    {
      name: 'Codex (OpenAI)',
      path: join(homedir(), '.codex', 'config.toml'),
      format: 'toml',
    },
  ];
}

function detectInstallMode() {
  // Check if running from a global npm install (bin is in PATH)
  const binName = 'planning-task-mcp';
  try {
    const globalBin = execSync('npm bin -g', { encoding: 'utf-8' }).trim();
    const isWin = process.platform === 'win32';
    const binPath = join(globalBin, isWin ? `${binName}.cmd` : binName);
    if (existsSync(binPath)) return 'global';
  } catch { /* */ }
  // Fallback: use node + absolute path (local dev)
  return 'local';
}

function buildMcpCommand() {
  const mode = detectInstallMode();
  if (mode === 'global') {
    return { command: 'planning-task-mcp', args: [] };
  }
  const indexPath = join(PROJECT_ROOT, 'src', 'index.js').replace(/\\/g, '/');
  return { command: 'node', args: [indexPath] };
}

function buildTomlBlock(envVars) {
  const { command, args } = buildMcpCommand();
  const argsStr = args.length > 0 ? `[${args.map(a => `"${a}"`).join(', ')}]` : '[]';
  let block = `[mcp_servers.planning-task-mcp]\ncommand = "${command}"\nargs = ${argsStr}\n`;
  block += `\n[mcp_servers.planning-task-mcp.env]\n`;
  for (const [k, v] of Object.entries(envVars)) {
    block += `${k} = "${v}"\n`;
  }
  return block;
}

function registerInClients(envVars) {
  const { command, args } = buildMcpCommand();
  const mcpServerEntry = {
    command,
    args,
    env: envVars,
  };

  const clients = getMcpClients();
  const configured = [];

  for (const client of clients) {
    const dirPath = dirname(client.path);
    if (!existsSync(dirPath)) {
      if (!existsSync(dirname(dirPath))) {
        console.log(`  ⊘ ${client.name} - no instalado, omitido`);
        continue;
      }
      mkdirSync(dirPath, { recursive: true });
    }

    if (client.format === 'toml') {
      // Codex uses TOML format
      let existing = existsSync(client.path) ? readFileSync(client.path, 'utf-8') : '';
      // Remove old planning-mcp and planning-task-mcp blocks if present
      existing = existing.replace(/\[mcp_servers\.planning-mcp\][\s\S]*?(?=\[|$)/g, '');
      existing = existing.replace(/\[mcp_servers\.planning-task-mcp\][\s\S]*?(?=\[|$)/g, '');
      const tomlBlock = buildTomlBlock(envVars);
      writeFileSync(client.path, existing.trimEnd() + '\n\n' + tomlBlock);
    } else {
      // JSON format (Claude, Cursor, Windsurf, VS Code, Gemini)
      let existing = {};
      if (existsSync(client.path)) {
        try { existing = JSON.parse(readFileSync(client.path, 'utf-8')); } catch { /* */ }
      }

      const key = client.format;
      const entries = { ...(existing[key] || {}) };
      delete entries['planning-mcp']; // limpiar nombre viejo
      const merged = {
        ...existing,
        [key]: { ...entries, 'planning-task-mcp': mcpServerEntry },
      };

      writeFileSync(client.path, JSON.stringify(merged, null, 2) + '\n');
    }

    console.log(`  ✓ ${client.name}`);
    configured.push(client.name);
  }

  return configured;
}

function configureAutoPermissions() {
  const MCP_PERMISSION = 'mcp__planning-task-mcp__*';
  const configured = [];

  // Claude Code: ~/.claude/settings.json → permissions.allow
  const claudeCodeSettings = join(homedir(), '.claude', 'settings.json');
  if (existsSync(join(homedir(), '.claude'))) {
    let settings = {};
    if (existsSync(claudeCodeSettings)) {
      try { settings = JSON.parse(readFileSync(claudeCodeSettings, 'utf-8')); } catch { /* */ }
    }
    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
    settings.permissions.allow = settings.permissions.allow.filter(
      p => p !== 'mcp__planning-mcp__*'
    );
    if (!settings.permissions.allow.includes(MCP_PERMISSION)) {
      settings.permissions.allow.push(MCP_PERMISSION);
    }
    writeFileSync(claudeCodeSettings, JSON.stringify(settings, null, 2) + '\n');
    console.log('  ✓ Claude Code - permissions.allow');
    configured.push('Claude Code');
  }

  // Cursor: autoApprove in mcp.json
  addAutoApproveToJsonConfig(
    join(homedir(), '.cursor', 'mcp.json'), 'mcpServers', 'Cursor', configured
  );

  // Windsurf: autoApprove in mcp_config.json
  addAutoApproveToJsonConfig(
    join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers', 'Windsurf', configured
  );

  // Gemini CLI: trust: true in settings.json
  const geminiSettings = join(homedir(), '.gemini', 'settings.json');
  if (existsSync(geminiSettings)) {
    try {
      const config = JSON.parse(readFileSync(geminiSettings, 'utf-8'));
      const entry = config?.mcpServers?.['planning-task-mcp'];
      if (entry) {
        if (!entry.trust) {
          entry.trust = true;
          writeFileSync(geminiSettings, JSON.stringify(config, null, 2) + '\n');
          console.log('  ✓ Gemini CLI - trust: true');
        } else {
          console.log('  ✓ Gemini CLI - ya configurado');
        }
        configured.push('Gemini CLI');
      }
    } catch { /* */ }
  }

  // VS Code (Copilot): chat.tools.autoApprove in settings.json
  const vscodeDirs = [
    join(homedir(), '.vscode'),
    join(homedir(), 'AppData', 'Roaming', 'Code', 'User'),
  ];
  for (const dir of vscodeDirs) {
    const settingsPath = join(dir, 'settings.json');
    if (existsSync(settingsPath)) {
      try {
        let vsSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        if (vsSettings['chat.tools.autoApprove'] !== true) {
          vsSettings['chat.tools.autoApprove'] = true;
          writeFileSync(settingsPath, JSON.stringify(vsSettings, null, 2) + '\n');
          console.log('  ✓ VS Code - chat.tools.autoApprove');
        } else {
          console.log('  ✓ VS Code - ya configurado');
        }
        configured.push('VS Code');
      } catch { /* */ }
      break;
    }
  }

  // Codex (OpenAI): no per-server auto-approve, only global approval_policy
  const codexConfig = join(homedir(), '.codex', 'config.toml');
  if (existsSync(codexConfig)) {
    console.log('  ⚠ Codex - no soporta auto-approve por servidor');
    console.log('    Para auto-aprobar: añade approval_policy = "never" en ~/.codex/config.toml');
  }

  // Claude Desktop: no file-based permission system (UI only)

  if (configured.length === 0) {
    console.log('  ⚠ No se encontraron CLIs con sistema de permisos configurable');
  }

  return configured;
}

function addAutoApproveToJsonConfig(filePath, serverKey, clientName, configured) {
  if (!existsSync(filePath)) return;
  try {
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    const entry = config?.[serverKey]?.['planning-task-mcp'];
    if (entry) {
      if (!entry.autoApprove) {
        entry.autoApprove = ['*'];
        writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
        console.log(`  ✓ ${clientName} - autoApprove: ["*"]`);
      } else {
        console.log(`  ✓ ${clientName} - ya configurado`);
      }
      configured.push(clientName);
    }
  } catch { /* */ }
}

// ─── Main setup ───

async function setup() {
  const cliArgs = parseArgs();
  const hasCLIArgs = cliArgs.saKey || cliArgs.dbUrl || cliArgs.userId;

  printBanner();

  // ═══ STEP 1: Dependencies ═══
  printStep(1, 'Verificar dependencias');
  ensureDependencies();

  // ═══ STEP 2: Service Account Key ═══
  printStep(2, 'Service Account Key de Firebase');

  const defaultSaKeyPath = join(PROJECT_ROOT, 'serviceAccountKey.json');
  let saInfo;

  if (cliArgs.saKey) {
    // CLI arg provided
    saInfo = validateServiceAccountKey(cliArgs.saKey);
  } else if (existsSync(defaultSaKeyPath)) {
    // Auto-detected in project root
    console.log(`  ⚡ Detectada en la raíz del proyecto`);
    saInfo = validateServiceAccountKey(defaultSaKeyPath);
  } else {
    // Ask interactively
    console.log('  No se encontró serviceAccountKey.json en el proyecto.');
    console.log('  Descárgalo desde:');
    console.log('  Firebase Console → Configuración del proyecto');
    console.log('  → Cuentas de servicio → Generar nueva clave privada\n');
    console.log('  Opciones:');
    console.log('  1. Copia el archivo a la raíz del proyecto como serviceAccountKey.json');
    console.log('  2. O arrastra el archivo aquí para indicar la ruta\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const path = await ask(rl, '  Ruta al archivo:\n  > ');
    saInfo = validateServiceAccountKey(path);
    rl.close();
  }

  // Normalize path with forward slashes for cross-platform compat
  const saKeyPath = saInfo.path.replace(/\\/g, '/');

  // ═══ STEP 3: Firebase config ═══
  printStep(3, 'Configuración de Firebase');

  const autoUrl = autoDetectDbUrl(saInfo.projectId);
  let finalDbUrl, finalUserId, finalUserName;

  if (!hasCLIArgs) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    if (autoUrl) {
      console.log(`  DB URL detectada: ${autoUrl}`);
      const input = await ask(rl, '  Pulsa Enter para usar esta, o escribe otra:\n  > ');
      finalDbUrl = input.trim() || autoUrl;
    } else {
      console.log('  Encuéntrala en: Firebase Console → Realtime Database\n');
      finalDbUrl = (await ask(rl, '  URL:\n  > ')).trim();
    }

    finalUserId = (await ask(rl, '  UID de Firebase Auth:\n  > ')).trim();
    finalUserName = (await ask(rl, '  Tu nombre:\n  > ')).trim();

    rl.close();
  } else {
    finalDbUrl = cliArgs.dbUrl || autoUrl;
    finalUserId = cliArgs.userId || '';
    finalUserName = cliArgs.userName || '';
  }

  if (!finalDbUrl) {
    console.error('\n  ✗ ERROR: Se requiere FIREBASE_DATABASE_URL (usa --db-url <url>)');
    process.exit(1);
  }

  console.log(`  ✓ Database URL: ${finalDbUrl}`);
  if (finalUserId) console.log(`  ✓ User ID: ${finalUserId}`);
  if (finalUserName) console.log(`  ✓ User Name: ${finalUserName}`);

  // Build env vars block (standard MCP approach)
  const envVars = {
    GOOGLE_APPLICATION_CREDENTIALS: saKeyPath,
    FIREBASE_DATABASE_URL: finalDbUrl,
  };
  if (finalUserId) envVars.DEFAULT_USER_ID = finalUserId;
  if (finalUserName) envVars.DEFAULT_USER_NAME = finalUserName;

  // ═══ STEP 4: Register MCP in clients ═══
  printStep(4, 'Registrar en clientes MCP');

  let configuredClients = [];
  if (cliArgs.noRegister) {
    console.log('  → Omitido (--no-register)');
  } else if (!hasCLIArgs) {
    const clients = getMcpClients();
    console.log('  Clientes detectados:\n');
    for (const c of clients) {
      const exists = existsSync(c.path);
      const dirExists = existsSync(dirname(c.path));
      const marker = exists ? '(config existente)' : dirExists ? '(dir existe)' : '(no encontrado)';
      console.log(`  ${exists || dirExists ? '●' : '○'} ${c.name} ${marker}`);
    }
    console.log('');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirm = await ask(rl, '  ¿Registrar en todos los clientes encontrados? (S/n): ');
    rl.close();
    if (confirm.toLowerCase() !== 'n') {
      configuredClients = registerInClients(envVars);
    }
  } else {
    configuredClients = registerInClients(envVars);
  }

  // ═══ STEP 5: Auto-approve permissions ═══
  printStep(5, 'Configurar permisos automáticos');

  const permissionClients = configureAutoPermissions();

  // ═══ STEP 6: Verification ═══
  printStep(6, 'Verificación');

  let depsOk = existsSync(join(PROJECT_ROOT, 'node_modules', '@modelcontextprotocol', 'sdk'));
  if (!depsOk) {
    try {
      execSync('node -e "require.resolve(\'@modelcontextprotocol/sdk\')"', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      depsOk = true;
    } catch { /* */ }
  }
  const saKeyOk = existsSync(saInfo.path);

  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║         Instalación completada            ║');
  console.log('  ╚══════════════════════════════════════════╝\n');
  console.log(`  Dependencias          ${depsOk ? '✓' : '✗'}  ${depsOk ? 'OK' : 'FALTAN'}`);
  console.log(`  Service Account Key   ${saKeyOk ? '✓' : '✗'}  ${saKeyPath}`);
  console.log(`  Database URL          ${finalDbUrl ? '✓' : '✗'}  ${finalDbUrl}`);
  console.log(`  User ID               ${finalUserId ? '✓' : '⚠'}  ${finalUserId || '(no configurado)'}`);
  console.log(`  User Name             ${finalUserName ? '✓' : '⚠'}  ${finalUserName || '(no configurado)'}`);
  if (configuredClients.length > 0) {
    console.log(`  Clientes MCP          ✓  ${configuredClients.join(', ')}`);
  }
  if (permissionClients.length > 0) {
    console.log(`  Permisos auto         ✓  ${permissionClients.join(', ')}`);
  }

  const critical = [];
  if (!depsOk) critical.push('dependencias');
  if (!saKeyOk) critical.push('serviceAccountKey.json');
  if (!finalDbUrl) critical.push('FIREBASE_DATABASE_URL');

  if (critical.length > 0) {
    console.log(`\n  ✗ ERRORES: Faltan ${critical.join(', ')}`);
    process.exit(1);
  }

  console.log('\n  Las credenciales se guardan en el config de cada cliente');
  console.log('  (env block estándar MCP). No se crea ninguna carpeta extra.');
  console.log('');
  console.log('  Reinicia tu terminal/IDE y prueba:');
  console.log('    "Lista mis proyectos"');
  console.log('');
}

setup().catch(err => {
  console.error('Error en setup:', err.message);
  process.exit(1);
});
