# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# Linting
bun run lint:electron         # Lint electron app

# Testing
bun test                      # Run all tests
bun test path/to/file.test.ts # Run a single test file
bun test --watch              # Run tests in watch mode

# Utilities
bun run fresh-start           # Reset to fresh state (clears ~/.craft-agent/)
bun run print:system-prompt   # Print the agent system prompt
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
- **Credentials** (`src/credentials/`): AES-256-GCM encrypted storage for API keys (Anthropic, OpenAI, Perplexity, Gemini, fal.ai)
- **Sessions** (`src/sessions/`): Persistence with debounced writes
- **Sources** (`src/sources/`): MCP servers, REST APIs, local filesystems
- **Labels** (`src/labels/`): Session tagging with regex auto-rules and AI classification
- **Skills** (`src/skills/`): Markdown-based workflows with metadata, preferences, required permission modes, knowledge sources, and inter-skill handoffs
- **Delegation Tools** (`src/agent/delegation-tools.ts`): Global MCP tools to delegate tasks to Perplexity (web search), Gemini (large context), and OpenAI (reasoning)
- **Image Generation** (`src/agent/image-models.ts`, `src/agent/session-scoped-tools.ts`): Multi-model image generation via fal.ai and Google direct APIs
- **Schedules** (`src/schedules/`): Scheduled session execution with once/daily/weekly/monthly/cron frequencies, timezone support, retry with backoff, groups, templates, and auto-pause on failure

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
- `scheduler-service.ts`: Schedule timer management and execution

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
- `credentials.enc` - Encrypted credentials (API keys for Anthropic, OpenAI, Perplexity, Gemini, fal.ai)
- `workspaces/{id}/` - Per-workspace data:
  - `sessions/` - Session files
  - `sources/` - MCP server configs
  - `skills/` - Skill markdown files
  - `skill-preferences.json` - Per-skill user preferences (e.g., autoSwitchMode)
  - `knowledge/` - Shared knowledge files for skills (markdown)
  - `handoffs/` - Temporary inter-skill handoff files (auto-cleaned after 24h)
  - `styles/` - Visual style libraries (e.g., `image-styles.json`)
  - `statuses/` - Status definitions
  - `labels/config.json` - Label tree with auto-rules and AI classification
  - `schedules/config.json` - Schedule definitions and execution history

### MCP Auth Separation
**Critical**: Craft OAuth (`craft_oauth::global`) is ONLY for Craft API. Each MCP server has its own OAuth via `workspace_oauth::{workspaceId}`.

### Large Response Handling
Tool responses exceeding ~60KB are automatically summarized using Claude Haiku with intent-aware context. The `_intent` field is injected into MCP tool schemas to preserve summarization focus.

### Session-Scoped State
- Permission modes are per-session, not global
- Each session has unique ID and maps 1:1 with SDK session

### Deep Linking
External apps can navigate using `craftagents://` URLs:
- `craftagents://allChats` - All chats view
- `craftagents://allChats/chat/{sessionId}` - Specific chat
- `craftagents://settings` - Settings
- `craftagents://action/new-chat` - Create new chat
- `craftagents://action/new-chat?skill={skillId}` - New chat with skill
- `craftagents://action/new-chat?skill={skillId}&handoff={handoffId}` - New chat with skill and handoff context
- `craftagents://action/new-schedule` - Open schedule creator
- `craftagents://action/new-schedule?skill={skillId}` - Schedule creator pre-filled with skill
- `craftagents://schedules` - Schedules list
- `craftagents://schedules/schedule/{scheduleId}` - Specific schedule

### Local MCP Server Security
When spawning local MCP servers (stdio transport), sensitive env vars are filtered out:
`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `AWS_*`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, etc.
To explicitly pass an env var to a specific MCP server, use the `env` field in source config.

### Labels and Auto-Labeling
Labels are hierarchical tags applied to sessions. Two auto-labeling mechanisms:

1. **Regex Rules** (`autoRules`): Pattern-based matching with regex on user messages
   - Supports value extraction with capture groups
   - Immediate application on match

2. **AI Classification** (`aiClassification`): Semantic matching using Claude Haiku
   - `description`: Human-readable criteria for when label applies
   - `mode`: `'suggest'` (pending user acceptance) or `'auto'` (immediate)
   - `valueHint`: Guidance for extracting values on typed labels
   - Single API call evaluates all AI-enabled labels together

```typescript
// Label with both regex and AI classification
{
  id: 'bug',
  name: 'Bug Report',
  autoRules: [{ pattern: '\\b(bug|error|crash)\\b', flags: 'i' }],
  aiClassification: {
    description: 'Conversations about debugging or fixing code errors',
    mode: 'suggest'
  }
}
```

### Delegation Tools
Global MCP tools that delegate to external AI services:

| Tool | Service | Use Case |
|------|---------|----------|
| `perplexity_search` | Perplexity AI | Real-time web search with citations |
| `gemini_analyze` | Google Gemini | Large context analysis (1M+ tokens) |
| `openai_analyze` | OpenAI | Advanced reasoning (o3, o4-mini, gpt-4.1) |

API keys configured in Settings > App > Integrations.

### Image Generation
Unified image generation via fal.ai and Google direct APIs (`packages/shared/src/agent/image-models.ts`):

| Model ID | Provider | Cost | Best For |
|----------|----------|------|----------|
| `ideogram-v3-turbo` | fal.ai | $0.03 | Fast text-heavy posts |
| `ideogram-v3-balanced` | fal.ai | $0.06 | Text-heavy posts (DEFAULT) |
| `ideogram-v3-quality` | fal.ai | $0.09 | Premium text rendering |
| `imagen-4-standard` | fal.ai | $0.04 | Visual posts, products |
| `imagen-4-ultra` | fal.ai | $0.06 | Premium visuals |
| `reve` | fal.ai | $0.04 | Quick drafts, iterations |
| `gemini-fal` | fal.ai | $0.15 | Complex scenes (via fal) |
| `gemini-direct` | Google | ~$0.13 | Complex scenes (direct API) |

**Tools:**
- `generate_image` - Unified tool with model selection parameter
- `gemini_generate_image` - Legacy tool for backwards compatibility
- `open_images_folder` - Opens session images folder in file manager

**Key Implementation Notes:**
- fal.ai uses `Authorization: Key {apiKey}` header
- Ideogram models use `rendering_speed` parameter (TURBO/BALANCED/QUALITY)
- `expand_prompt` is set to `false` to avoid double billing (MagicPrompt charges separately)
- Images saved to `~/.craft-agent/workspaces/{id}/sessions/{sessionId}/images/`

**Advanced Features:**
- **Style Reference Images**: `style_reference_image` parameter on `generate_image` tool. Supported by Ideogram V3, Reve (up to 6 refs), Gemini. NOT supported by Imagen 4. Local files converted to data URIs for API.
- **Platform Optimization**: `platform` parameter (linkedin, instagram, twitter, tiktok, facebook). Auto-enhances prompts with platform-specific mood, color, composition, and typography guidelines.
- **Text Analysis**: `analyzePromptForText()` auto-detects text density (text-free/minimal/moderate/heavy/complex), recommends appropriate model, and warns on model mismatch. `checkModelForText()` validates model suitability.

### File Operations
Session files panel (right sidebar) supports:
- **Save As**: Native save dialog to copy generated files to user-chosen location (`SAVE_FILE_DIALOG` IPC)
- **Upload to Google Drive**: Multipart upload via connected Google Drive source with token refresh (`UPLOAD_TO_GOOGLE_DRIVE` IPC)

### Schedules
Automated session execution on a schedule. Config stored at `{workspace}/schedules/config.json`.

**Frequencies**: `once`, `daily`, `weekly`, `monthly`, `cron` (5-field POSIX)

**Architecture**:
- `packages/shared/src/schedules/` — Types, storage CRUD, next-run calculator (browser-safe via `browser.ts`)
- `apps/electron/src/main/scheduler-service.ts` — Main process timer service using `setTimeout` chains, retry logic
- `apps/electron/src/renderer/components/schedules/` — Creator/editor dialog, template definitions, list panel, info page
- `apps/electron/src/renderer/atoms/schedules.ts` — Jotai atoms for schedule state

**Key behaviors**:
- Timezone-aware scheduling via `Intl.DateTimeFormat` offset calculation, with UI timezone picker (23 IANA zones)
- Monthly day overflow clamps to last day of month (e.g., day 31 in Feb → 28th)
- Cron uses POSIX day matching: OR when both day-of-month and day-of-week are restricted, single-field when one is `*`
- Auto-pauses after 3 consecutive failures (`maxConsecutiveFailures`)
- Missed schedule detection on app startup
- Long delays (>24h) use intermediate timer chains to avoid `setTimeout` drift
- `ConfigWatcher` monitors `schedules/config.json` for external changes
- IPC broadcasts `SCHEDULE_EXECUTED` and `SCHEDULES_CHANGED` events to renderer
- Toast notifications on execution (success with "View Session" action, error with schedule name)

**Edit support**: `ScheduleCreator` doubles as editor via `editSchedule` prop. `formDataFromSchedule()` maps a `ScheduleConfig` back to form state. Edit is accessible from the schedule menu, info page quick actions, and list panel.

**Dry run preview**: `getNextNRuns(timing, n, after?)` iteratively calls `calculateNextRun` to produce the next N run dates. Shown in the creator's Step 2 (When) and in the schedule info page "Upcoming" row for active schedules.

**Templates**: Pre-built schedule configs in `schedule-templates.ts` (Daily Morning Briefing, Weekday Standup Prep, Weekly Report, Monthly Review, End of Day Summary). Displayed as a 2-column grid in Step 1 when creating (not editing).

**Groups**: Optional `group` string on `ScheduleConfig`. `SchedulesListPanel` groups schedules into collapsible sections with folder icons. `ScheduleCreator` offers existing group names via `<datalist>` autocomplete.

**Retry with backoff**: When `retryOnFailure` is enabled, failed executions retry up to `maxRetries` (default 3) times with delays from `retryDelayMinutes` (default [5, 15, 60]). `SchedulerService` tracks retry state via `retryTimers` and `retryAttempts` maps. History entries include `isRetry` and `retryAttempt` fields.

**Deep link**: `craftagents://action/new-schedule[?skill=X&name=Y]` navigates to schedules view and opens the creator dialog. `NavigationContext` dispatches a `craft:open-schedule-creator` custom event that `AppShell` listens for.

### Skills with Required Modes
Skills can specify a `requiredMode` in their frontmatter:
```yaml
---
name: Deploy to Production
requiredMode: allow-all
---
```
When invoked, the session's permission mode switches to the required mode.
Users can enable/disable auto-switching per skill via `skill-preferences.json`.

### Skill Knowledge Sources
Skills can link to markdown knowledge files that provide context:

```yaml
---
name: Trend to Post
knowledge:
  - path: knowledge/audience-profile.md
    label: Audience Profile
    description: Target personas and brand voice
  - path: knowledge/competitor-accounts.md
    label: Competitor Directory
---
```

Knowledge sources are displayed in the Skill Info page with existence checks and preview. Files are relative to workspace root.

### Skill Handoff System
Skills can pass context to other skills via file-based handoffs (`packages/shared/src/skills/handoff.ts`):

```typescript
// Source skill creates handoff
const handoffId = await createHandoff(
  workspaceRootPath,
  'trend-to-post',      // source skill
  sessionId,
  'image-creator',      // target skill
  { platform: 'Instagram', topic: 'AI trends', ... }
);

// Generate deep link
const deepLink = buildSkillDeepLink('image-creator', handoffId);
// → craftagents://action/new-chat?skill=image-creator&handoff=abc123

// Target skill reads handoff (auto-deletes after read)
const handoff = await readHandoff(workspaceRootPath, handoffId);
```

Handoff flow:
1. Source skill creates handoff with `createHandoff()`
2. Deep link opens new chat with target skill and handoff ID
3. Target skill reads handoff via `readHandoff()` (one-time use, auto-deleted)
4. Orphaned handoffs cleaned up after 24 hours via `cleanupOldHandoffs()`

### Quick Choice Blocks
Skills can present interactive choices using `choices` code blocks in markdown:

````markdown
```choices
1. Generate all images at once
2. Create one by one with review
3. View/edit prompts first
4. Change visual style
```
````

The `QuickChoiceBlock` component (`packages/ui/src/components/markdown/QuickChoiceBlock.tsx`) renders these as clickable pill buttons. Supports numbered lists (`1.`, `2.`) and bullet lists (`-`, `*`). When clicked, sends the selection as a user message.

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

### Keyboard Shortcuts (in app)
| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New chat |
| `Cmd+1/2/3` | Focus sidebar/list/chat |
| `SHIFT+TAB` | Cycle permission modes |

### Environment Variables
Create `.env` for OAuth integrations:
```bash
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
SLACK_OAUTH_CLIENT_ID=...
SLACK_OAUTH_CLIENT_SECRET=...
MICROSOFT_OAUTH_CLIENT_ID=...
```

### API Keys (User-configured in Settings)
These are stored encrypted in `credentials.enc`, not in `.env`:
- **Anthropic API Key**: Primary Claude access (or OAuth for Max subscribers)
- **OpenAI API Key**: Whisper voice transcription + delegation tool
- **Perplexity API Key**: Web search delegation
- **Gemini API Key**: Large context analysis delegation + direct image generation
- **fal.ai API Key**: Multi-model image generation (Ideogram, Imagen, Reve, Gemini via fal)

## Guidelines

- Keep package CLAUDE.md files updated when functionality changes
- Session is the primary boundary, not workspace
- Prefer editing existing files over creating new ones
- Use subpath imports from packages
- Run `bun run typecheck:all` before committing
