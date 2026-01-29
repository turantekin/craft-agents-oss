# Craft Agents - Code Review Report

**Project:** Craft Agents OSS
**Version:** 0.3.0
**License:** Apache 2.0
**Report Date:** 2026-01-29

---

## Executive Summary

Craft Agents is an open-source desktop application that provides an intuitive, AI-native interface for working with Claude through the Claude Agent SDK. Built by the team at Craft.do, it offers an improved alternative to CLI-based agent workflows with features like multi-session management, customizable permissions, and extensive extensibility through Skills and Sources.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Core Components](#4-core-components)
5. [Data Flow](#5-data-flow)
6. [Security Features](#6-security-features)
7. [Extensibility](#7-extensibility)
8. [Key Files Reference](#8-key-files-reference)

---

## 1. Architecture Overview

The project follows a **monorepo structure** with clean separation of concerns:

```
craft-agents-oss/
├── packages/                    # Reusable libraries
│   ├── core/                   # Shared TypeScript types
│   ├── shared/                 # Core business logic
│   ├── ui/                     # Shared React UI components
│   └── mermaid/                # Diagram renderer
├── apps/
│   ├── electron/               # Primary desktop application
│   └── viewer/                 # Web viewer for sharing sessions
└── scripts/                    # Build automation
```

### Electron 3-Process Model

The desktop application uses Electron's standard 3-process architecture:

| Process | Purpose | Key Files |
|---------|---------|-----------|
| **Main** | Window management, agent lifecycle, IPC | `apps/electron/src/main/` |
| **Preload** | Secure context bridge | `apps/electron/src/preload/` |
| **Renderer** | React UI, state management | `apps/electron/src/renderer/` |

---

## 2. Technology Stack

| Category | Technology |
|----------|------------|
| **Runtime** | Bun (TypeScript execution) |
| **AI** | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Anthropic SDK |
| **Desktop** | Electron + React 18 + Vite |
| **UI Components** | shadcn/ui + Radix UI + Tailwind CSS v4 |
| **State Management** | Jotai (atoms) |
| **Build Tools** | esbuild (main), Vite (renderer), TypeScript |
| **Security** | AES-256-GCM encryption |
| **Protocols** | MCP (Model Context Protocol), OAuth |

---

## 3. Project Structure

### packages/core (`@craft-agent/core`)

**Purpose:** Shared TypeScript types (types-only layer)

**Key Exports:**
- `Workspace`, `McpAuthType`, `AuthType`, `OAuthCredentials`
- `Session`, `StoredSession`, `SessionMetadata`
- `Message`, `StoredMessage`, `MessageRole`, `TokenUsage`, `AgentEvent`
- Utilities: `generateMessageId()`, `debug()`

### packages/shared (`@craft-agent/shared`)

**Purpose:** Core business logic - the heart of the application

**Major Modules:**

| Module | Purpose |
|--------|---------|
| `agent/` | CraftAgent wrapper, permission modes, tool validation |
| `config/` | Multi-workspace configuration, file watching |
| `credentials/` | Encrypted credential storage (AES-256-GCM) |
| `sessions/` | Session CRUD, JSONL persistence |
| `sources/` | MCP/API server integration |
| `mcp/` | Model Context Protocol client |
| `auth/` | OAuth flows (Google, Slack, Microsoft, Claude) |
| `statuses/` | Customizable workflow states |

### packages/ui (`@craft-agent/ui`)

**Purpose:** Shared React components for chat rendering

**Main Components:**
- `SessionViewer.tsx` - Full session display
- `TurnCard.tsx` - Individual message rendering
- Markdown components with Shiki syntax highlighting

### packages/mermaid

**Purpose:** Mermaid diagram to styled SVG renderer for visualizing plans

### apps/electron

**Purpose:** Primary desktop application

**Structure:**
```
apps/electron/
├── src/main/           # Main process
│   ├── index.ts       # App entry, window creation
│   ├── sessions.ts    # SessionManager, CraftAgent integration
│   ├── ipc.ts         # IPC channel handlers
│   ├── menu.ts        # Application menu
│   └── sources-service.ts
├── src/preload/        # Context bridge
└── src/renderer/       # React UI
    ├── App.tsx        # Root component
    ├── components/    # UI components
    ├── hooks/         # Custom React hooks
    ├── contexts/      # React contexts
    └── atoms/         # Jotai state atoms
```

### apps/viewer

**Purpose:** Web viewer for sharing session transcripts publicly

---

## 4. Core Components

### 4.1 CraftAgent (`packages/shared/src/agent/craft-agent.ts`)

The main wrapper around the Claude Agent SDK. Key responsibilities:

- **Agent Lifecycle:** Creation, configuration, message handling
- **Permission Hooks:** PreToolUse validation, PostToolUse result summarization
- **Error Handling:** Graceful error recovery and reporting
- **Source Integration:** MCP server and API endpoint management

### 4.2 Permission System (`packages/shared/src/agent/mode-manager.ts`)

Three-level permission system:

| Mode | Name | Behavior |
|------|------|----------|
| `safe` | Explore | Read-only operations only |
| `ask` | Ask to Edit | Prompts user before modifications |
| `allow-all` | Auto | Allows all operations |

**Mode Cycling:** Users can switch modes via `SHIFT+TAB` keyboard shortcut

### 4.3 Session Manager (`apps/electron/src/main/sessions.ts`)

Manages the lifecycle of agent sessions:

- Creates and destroys CraftAgent instances
- Streams events to renderer via IPC
- Handles source loading and authentication
- Manages background tasks

### 4.4 Configuration System (`packages/shared/src/config/`)

**Storage Location:** `~/.craft-agent/`

```
~/.craft-agent/
├── config.json              # Main app config
├── credentials.enc          # Encrypted credentials
├── theme.json               # App theme
└── workspaces/{id}/
    ├── config.json          # Workspace settings
    ├── sessions/            # Session JSONL files
    └── sources/{slug}/      # Source configurations
```

**Features:**
- File watcher for live configuration updates
- Cascading theme system (app → workspace → agent)
- Zod schema validation

### 4.5 Sources System (`packages/shared/src/sources/`)

Sources are external data connections that extend agent capabilities:

| Type | Description |
|------|-------------|
| **MCP Servers** | Model Context Protocol servers (stdio subprocess) |
| **REST APIs** | Dynamic API endpoint tools |
| **Local** | Local filesystem access |

**Built-in Sources:** Craft API (always available)

### 4.6 Credential Manager (`packages/shared/src/credentials/`)

- AES-256-GCM encryption for all stored credentials
- Auto-initialization on first use
- Backend support for file storage and OS keychain
- Separate credential storage from configuration

---

## 5. Data Flow

### 5.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   ELECTRON MAIN PROCESS                      │
│                                                              │
│  SessionManager                                              │
│  ├── Loads workspace config via @craft-agent/shared         │
│  ├── Creates CraftAgent (wrapper around SDK)                │
│  ├── Manages permission modes, sources                      │
│  └── Emits events to renderer via IPC                       │
│                                                              │
│  Config Watcher          Credential Manager                  │
│  (watches ~/.craft-agent/)  (AES-256-GCM encrypted)         │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC Channels
┌──────────────────────────▼──────────────────────────────────┐
│                   ELECTRON RENDERER PROCESS                  │
│                                                              │
│  App.tsx (React root)                                        │
│  ├── Loads sessions, sources, skills via Jotai atoms        │
│  ├── Manages UI state (navigation, theme, modals)           │
│  ├── Routes: chat, settings, workspace, sources             │
│  └── Receives agent events → processes → updates UI         │
│                                                              │
│  ChatDisplay              SessionList                        │
│  (turns, messages)        (sidebar)                         │
│                                                              │
│  Event Processor                                             │
│  (Processes AgentEvents into UI effects)                    │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Message Flow

1. **User Input:** User types message in ChatInput component
2. **IPC Send:** Renderer sends message to main process via IPC
3. **Agent Processing:** SessionManager passes to `CraftAgent.say()`
4. **Permission Check:** PreToolUse hook validates tool permissions
5. **Tool Execution:** Agent executes tools with permission mode rules
6. **Result Processing:** PostToolUse hook summarizes large results
7. **Event Streaming:** Events streamed back to renderer via IPC
8. **UI Update:** Event processor updates messages, tools, status

### 5.3 Session Persistence

- **Format:** JSONL (Header line + one message per line)
- **Location:** `~/.craft-agent/workspaces/{id}/sessions/`
- **Write Strategy:** Debounced async writes (500ms) via persistence-queue
- **Features:** Flagging, todo states, metadata tracking

---

## 6. Security Features

| Feature | Implementation |
|---------|----------------|
| **Credential Encryption** | AES-256-GCM encrypted file |
| **Permission Modes** | Three-level system (safe/ask/allow-all) |
| **Bash Validation** | Regex patterns for read-only commands |
| **OAuth Security** | PKCE-protected flows, workspace-scoped tokens |
| **MCP Isolation** | Sensitive env vars filtered from subprocesses |
| **Error Tracking** | Sentry scrubbing of credentials and API keys |
| **Process Isolation** | Preload context bridge limits main access |

---

## 7. Extensibility

### 7.1 Skills

Custom agent instructions that can be configured per workspace to customize agent behavior and capabilities.

### 7.2 Sources

Add external data connections:
- MCP servers (stdio-based)
- REST APIs with dynamic endpoint tools
- Local filesystem access

### 7.3 Permissions

Customizable rules at both workspace and source levels for fine-grained access control.

### 7.4 Statuses

Dynamic workflow states per workspace:
- Default: Todo, In Progress, Needs Review, Done, Cancelled
- Per-status: color, icon, keyboard shortcut, category

### 7.5 Themes

App and workspace-level theme customization with cascading overrides.

### 7.6 Session Tools

Register callbacks for custom session-scoped tool handling via `SessionScopedToolCallbacks`.

---

## 8. Key Files Reference

### Core Logic Files

| File | Lines | Purpose |
|------|-------|---------|
| `apps/electron/src/main/sessions.ts` | 3,734 | SessionManager, agent events |
| `packages/shared/src/agent/craft-agent.ts` | 3,053 | CraftAgent SDK wrapper |
| `apps/electron/src/main/ipc.ts` | 2,416 | IPC handlers |
| `packages/shared/src/agent/session-scoped-tools.ts` | 2,085 | Session tools |
| `packages/shared/src/config/validators.ts` | 1,770 | Config schema validation |
| `packages/shared/src/agent/mode-manager.ts` | 1,485 | Permission mode management |
| `packages/shared/src/config/storage.ts` | 1,154 | Config CRUD |
| `apps/electron/src/shared/types.ts` | 1,282 | Shared IPC and UI types |
| `packages/ui/src/components/chat/turn-utils.ts` | 1,168 | Message formatting |

### Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Monorepo workspace definition |
| `~/.craft-agent/config.json` | User configuration |
| `~/.craft-agent/credentials.enc` | Encrypted credentials |
| `~/.craft-agent/theme.json` | App theme |
| `~/.craft-agent/workspaces/{id}/config.json` | Workspace settings |

### Type Definitions

| Type | Location | Purpose |
|------|----------|---------|
| `Workspace` | `packages/core/src/types/workspace.ts` | Workspace config |
| `Session` | `packages/core/src/types/session.ts` | Conversation scope |
| `Message` | `packages/core/src/types/message.ts` | Message structure |
| `AgentEvent` | `packages/core/src/types/message.ts` | Agent events |
| `PermissionMode` | `packages/shared/src/agent/mode-types.ts` | Permission levels |
| `Source` | `packages/shared/src/sources/types.ts` | Source definition |

---

## Development Commands

```bash
# Development with hot reload
bun run electron:dev

# Build and run
bun run electron:start

# TypeScript validation
bun run typecheck:all

# Run tests
bun test
```

---

## Conclusion

Craft Agents is a well-architected, production-grade desktop application with:

- **Clean Separation of Concerns:** Monorepo with distinct packages for core types, shared logic, and UI
- **Strong Security:** AES-256-GCM encryption, permission modes, OAuth with PKCE
- **Extensive Extensibility:** Skills, Sources, custom permissions, themes, and statuses
- **Modern Stack:** Electron + React 18 + TypeScript + Jotai for state management
- **Good Developer Experience:** File watchers, hot reload, comprehensive type definitions

The codebase demonstrates professional software engineering practices with careful attention to security, user control, and extensibility.
