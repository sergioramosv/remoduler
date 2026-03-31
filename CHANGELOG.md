# Changelog

## [1.0.0] - 2026-03-31

### Breaking Changes
- Primera release estable — versión 1.0.0

### Features
- Sistema completo de módulos 10.x: CI/CD, canary merge, SonarQube, versioning, tech debt, multi-project, integrations, plugins, observability

## [0.6.0] - 2026-03-31

### Features
- HeartbeatMonitor: ping CLIs rate-limited cada 5 min y emite CLI_RECOVERED
- CiMonitor: polling de GitHub Actions con auto-revert si CI falla (AUTO_REVERT=true)
- CanaryMerge: merge por etapas source→staging→main con validacion CI
- ConflictDetector: deteccion de conflictos pre-merge via git merge-tree
- SonarQube Analyzer: quality gate automatico, bloquea merge si status=ERROR
- PrePrTests: auto-deteccion de test command (npm/vitest/jest/cargo) y ejecucion pre-PR
- CoverageAnalyzer: delta de cobertura vs baseline, bloquea si cae mas de MIN_COVERAGE_DELTA
- VersionBumper: bump patch/minor/major en package.json
- ChangelogGenerator: genera entradas CHANGELOG.md por tipo (features/fixes/breaking)
- ReleaseManager: crea GitHub Releases via gh CLI con tagging automatico
- ReleaseGate: bloquea release si hay bugs criticos/blocker abiertos
- TechDebtTracker: crea tareas de deuda tecnica desde minor review issues
- CodebaseAnalyzer: detecta unused imports y dead code exports
- DependencyChecker: npm audit + npm outdated periodico cada 24h
- AutoImprove: genera hasta 5 propuestas cuando el backlog esta vacio
- MultiProjectRunner: 3 estrategias (round-robin, priority, backlog-size)
- ProjectLoader: carga configuracion de proyectos desde PROJECTS env
- GitHubIssueSync: sincroniza issues con label configurable cada 5 min
- PrCommentBugs: detecta @komodo bug: en comentarios de PR cada 3 min
- WebhookOutgoing: forwarding de eventos con backoff exponencial (max 3 retries)
- PluginSystem: carga plugins desde PLUGINS_DIR con hooks before-review/after-code
- AnomalyDetector: detecta token spikes, review regression y model degradation
- TaskTimeline: registra fases, duraciones y costos por tarea en Firebase
- ExplainDecision: explica seleccion de tarea, rechazo de PR y seleccion de modelo
- MetricsRecorder: recordTaskMetrics, recordModelPerformance, recordRoutingOutcome

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
