# CLAUDE.md

This file provides guidance to Claude Code when working with the Craft Agents codebase.

## Overview

Craft Agents is an Electron desktop application for working with AI agents. It provides a multi-session inbox interface, MCP server connections, source management, and customizable workflows. Built on the Claude Agent SDK.

## Quick Reference

```bash
# Development
bun run electron:dev          # Hot reload development
bun run electron:start        # Build and run

# Type checking
bun run typecheck             # Check packages/shared
bun run typecheck:all         # Check all packages

# Testing
bun test                      # Run tests
```

## Project Structure

```
craft-agents-oss/
├── apps/
│   ├── electron/             # Desktop app (primary)
│   │   └── src/
│   │       ├── main/         # Electron main process
│   │       ├── preload/      # Context bridge (IPC)
│   │       ├── renderer/     # React UI (Vite + shadcn)
│   │       └── shared/       # Shared types/routes between processes
│   └── viewer/               # Web viewer app
├── packages/
│   ├── core/                 # Shared TypeScript types
│   ├── shared/               # Business logic (agent, auth, config, MCP)
│   ├── mermaid/              # Mermaid diagram support
│   └── ui/                   # UI components
└── scripts/                  # Build and dev scripts
```

## Key Packages

### `@craft-agent/shared` (packages/shared)
Core business logic. See `packages/shared/CLAUDE.md` for details.

- **CraftAgent** (`src/agent/`): Wraps Claude Agent SDK, handles MCP connections, tool permissions
- **Permission Modes**: `safe` (read-only), `ask` (prompt for approval), `allow-all` (auto-approve)
- **Config** (`src/config/`): Storage, preferences, themes at `~/.craft-agent/`
- **Credentials** (`src/credentials/`): AES-256-GCM encrypted storage
- **Sessions** (`src/sessions/`): Persistence with debounced writes
- **Sources** (`src/sources/`): MCP servers, REST APIs, local filesystems

### `@craft-agent/core` (packages/core)
Type definitions only. See `packages/core/CLAUDE.md` for details.

- `Workspace`, `Session`, `Message`, `AgentEvent` types
- Session is the primary isolation boundary, not workspace

## Electron App Architecture

### Main Process (`apps/electron/src/main/`)
- `index.ts`: App entry, window creation, IPC setup
- `ipc.ts`: IPC handlers for renderer communication
- `sessions.ts`: Session management
- `window-manager.ts`: Window lifecycle
- `deep-link.ts`: `craftagents://` URL handling

### Renderer (`apps/electron/src/renderer/`)
- **Atoms** (`atoms/`): Jotai state management
- **Components** (`components/`): React components with shadcn/ui
- **Hooks** (`hooks/`): React hooks for sessions, themes, keyboard
- **Event Processor** (`event-processor/`): Handles agent events from SDK

## Important Patterns

### Import Paths
```typescript
// Use subpath exports from shared package
import { CraftAgent } from '@craft-agent/shared/agent';
import { loadStoredConfig } from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';

// Types from core
import type { Session, Message } from '@craft-agent/core';
```

### Configuration Storage
All config at `~/.craft-agent/`:
- `config.json` - Main config (workspaces, auth)
- `credentials.enc` - Encrypted credentials
- `workspaces/{id}/` - Per-workspace data (sessions, sources, skills, statuses)

### MCP Auth Separation
**Critical**: Craft OAuth (`craft_oauth::global`) is ONLY for Craft API. Each MCP server has its own OAuth via `workspace_oauth::{workspaceId}`.

### Session-Scoped State
- Permission modes are per-session, not global
- Each session has unique ID and maps 1:1 with SDK session

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun |
| AI | @anthropic-ai/claude-agent-sdk |
| Desktop | Electron + React |
| UI | shadcn/ui + Tailwind CSS v4 |
| State | Jotai |
| Build | esbuild (main) + Vite (renderer) |

## Common Tasks

### Adding a New Feature
1. Business logic goes in `packages/shared/src/`
2. Types go in `packages/core/src/types/`
3. UI components in `apps/electron/src/renderer/components/`
4. IPC handlers in `apps/electron/src/main/ipc.ts`

### Debugging
- Logs at `~/Library/Logs/Craft Agents/` (macOS)
- Debug logging enabled automatically in development
- Use `debug()` from `@craft-agent/shared/utils`

### Environment Variables
Create `.env` for OAuth integrations:
```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
SLACK_OAUTH_CLIENT_ID=...
SLACK_OAUTH_CLIENT_SECRET=...
MICROSOFT_OAUTH_CLIENT_ID=...
```

## Guidelines

- Keep package CLAUDE.md files updated when functionality changes
- Session is the primary boundary, not workspace
- Prefer editing existing files over creating new ones
- Use subpath imports from packages
- Run `bun run typecheck:all` before committing
