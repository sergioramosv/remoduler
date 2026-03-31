# Changelog

## [0.2.0] - 2026-03-31

### Added
- **Resilience module** (`src/resilience/`): circuit-breaker (CLOSED/OPEN/HALF_OPEN), error-budget (30min window, 30% max), dead-letter-queue (exponential backoff), resilience-manager
- **Daemon mode** (`src/daemon/daemon.js`): polling continuo con schedule, budget tracking, max tasks
- **Scheduler** (`src/scheduler/scheduler.js`): ventanas horarias HH:MM-HH:MM con timezone

## [0.1.0] - 2026-03-27

### Added
- Initial release: orchestrator, agents, triage, knowledge graph, Firebase integration, dashboard
