# Changelog

All notable changes to Remoduler are documented in this file.

## [0.5.0] - 2026-03-31

### Added
- **Resilience module** (`src/resilience/`): circuit-breaker (CLOSED/OPEN/HALF_OPEN, thresholds por servicio), error-budget (ventana 30min, max 30%, auto-pause), dead-letter-queue (retry exponencial), resilience-manager
- **Daemon mode** (`src/daemon/daemon.js`): polling continuo con schedule, budget tracking, max tasks
- **Scheduler** (`src/scheduler/scheduler.js`): ventanas horarias HH:MM-HH:MM con timezone

## [0.4.0] - 2026-03-19

### Added
- **Settings page** en dashboard con controles start/stop desde UI
- **Lifetime analytics** persistentes entre sesiones
- **Auto-merge PR** con `--delete-branch` tras aprobacion del reviewer

### Fixed
- Deteccion falso-positivo de rate limit desde contenido de respuesta de agentes
- Dashboard: boton start se oculta inmediatamente al hacer click

## [0.3.0] - 2026-03-19

### Added
- **Planner focus mode**: seleccion de tareas ordenada por fase
- **Triage module** (`src/triage/`): complexity-classifier, model-selector, smart-model-router (epsilon-greedy con Firebase), task-decomposer
- **Knowledge Graph** (`src/knowledge/`): almacenamiento dual (JSON local + Firebase), scoped por modulo, integracion con task-runner
- **Heartbeat** auto-resume y tracking de duracion por agente
- **Dashboard**: sidebar, analytics page, history page con lazy loading (50 por pagina), animacion fill-sweep en pipeline

### Fixed
- Dashboard: animacion pipeline con translateX y colores hex

## [0.2.0] - 2026-03-19

### Added
- **MCP skills**: remoduler-mcp y memory-mcp
- **CLI install** command (`remoduler install`)
- **Real-time dashboard** con Firebase sync
- **CLI dashboard** command (`remoduler d`)
- Installer: global npm link y dependencias de dashboard

## [0.1.0] - 2026-03-19

### Added
- **Initial release**: orquestador autonomo de agentes IA
- **CLI completo**: run, resume, plan, architect, doctor, setup
- **BudgetManager**: tracking diario/semanal con tokens reales, costes en EUR, breakdown por agente
- **Firebase integration**: estado, sincronizacion, tracking
- Version management guide

### Fixed
- Task status update en planning-task al completar tarea
