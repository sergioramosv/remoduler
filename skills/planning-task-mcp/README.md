# planning-task-mcp

MCP Server for full autonomous project management. Manage projects, sprints, tasks, bugs, proposals, and more — all from your AI coding assistant.

Works with **Claude Code**, **Claude Desktop**, **Codex (OpenAI)**, **Gemini CLI**, **Cursor**, **Windsurf**, and **VS Code Copilot**.

## Features

- Projects, sprints, and task management with User Stories
- Bug tracking and proposals
- Team collaboration (members, invitations, comments, notifications)
- Sprint planning from natural language documents
- Analytics dashboards and burndown charts
- Achievements and gamification
- Workflow automation rules
- Time tracking and retrospectives

## Prerequisites

- Node.js >= 18
- A Firebase project with **Realtime Database** enabled
- A Firebase **Service Account Key** (JSON file)

## Install

```bash
npm install -g planning-task-mcp
```

## Setup

After installing, run the interactive setup:

```bash
planning-task-mcp-setup
```

This will:
1. Ask for your Firebase Service Account Key path
2. Configure your Firebase Database URL
3. Set your default user ID and name
4. Auto-register the MCP in all detected AI clients (Claude Code, Codex, Gemini, Cursor, etc.)
5. Configure auto-approve permissions where supported

### CLI mode (non-interactive)

```bash
planning-task-mcp-setup \
  --sa-key /path/to/serviceAccountKey.json \
  --db-url https://your-project-default-rtdb.firebaseio.com \
  --user-id your-firebase-uid \
  --user-name "Your Name"
```

### Manual configuration

If you prefer to configure manually, add this to your MCP client config:

**Claude Code** (`~/.mcp.json`):
```json
{
  "mcpServers": {
    "planning-task-mcp": {
      "command": "planning-task-mcp",
      "args": [],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/serviceAccountKey.json",
        "FIREBASE_DATABASE_URL": "https://your-project-default-rtdb.firebaseio.com",
        "DEFAULT_USER_ID": "your-uid",
        "DEFAULT_USER_NAME": "Your Name"
      }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):
```toml
[mcp_servers.planning-task-mcp]
command = "planning-task-mcp"
args = []

[mcp_servers.planning-task-mcp.env]
GOOGLE_APPLICATION_CREDENTIALS = "/path/to/serviceAccountKey.json"
FIREBASE_DATABASE_URL = "https://your-project-default-rtdb.firebaseio.com"
DEFAULT_USER_ID = "your-uid"
DEFAULT_USER_NAME = "Your Name"
```

**Gemini CLI** (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "planning-task-mcp": {
      "command": "planning-task-mcp",
      "args": [],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/serviceAccountKey.json",
        "FIREBASE_DATABASE_URL": "https://your-project-default-rtdb.firebaseio.com",
        "DEFAULT_USER_ID": "your-uid",
        "DEFAULT_USER_NAME": "Your Name"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | Path to Firebase Service Account Key JSON |
| `FIREBASE_DATABASE_URL` | Yes | Firebase Realtime Database URL |
| `DEFAULT_USER_ID` | No | Default Firebase Auth UID for operations |
| `DEFAULT_USER_NAME` | No | Default user display name |

## Available Tools (70+)

| Category | Tools |
|----------|-------|
| Projects | create, list, get, update, delete, dashboard, summary |
| Sprints | create, list, get, update, delete, burndown, retrospective |
| Tasks | create, list, get, update, delete, search, assign, change status |
| Bugs | create, list, get, update, delete |
| Epics | create, list, get, update, delete, add/remove tasks |
| Proposals | create, list, get, update, delete, approve/reject |
| Comments | create, list, delete |
| Notifications | list, send, mark read, clear |
| Members | add, list, remove, change role |
| Invitations | send, list, accept, reject |
| Users | list, get, search |
| Analytics | project dashboard, developer workload, leaderboard |
| Planning | create full plan from document, create sprint plan |
| Templates | create, list, delete task templates |
| Workflows | create, list, update, delete, toggle automation rules |
| Time Tracking | create, list, delete time entries |
| Saved Views | create, list, delete custom views |
| Achievements | list, evaluate user achievements |
| Standup | get daily standup data |

## Usage

Once configured, just talk to your AI assistant:

- "Create a new project called MyApp"
- "Plan a sprint from this requirements document"
- "Show me the burndown chart for the current sprint"
- "Assign task T-123 to user X"
- "What's the developer workload for this sprint?"

## License

MIT
