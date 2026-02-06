/**
 * Session-Scoped Tools
 *
 * Tools that are scoped to a specific session. Each session gets its own
 * instance of these tools with session-specific callbacks and state.
 *
 * Tools included:
 * - SubmitPlan: Submit a plan file for user review/display
 * - config_validate: Validate configuration files
 * - skill_validate: Validate skill SKILL.md files
 * - source_test: Validate schema, download icons, test connections
 * - source_oauth_trigger: Start OAuth authentication for MCP sources
 * - source_google_oauth_trigger: Start Google OAuth authentication (Gmail, Calendar, Drive)
 * - source_credential_prompt: Prompt user for API credentials
 * - gemini_generate_image: Generate images using Gemini AI (saves to session folder)
 *
 * Source and Skill CRUD is done via standard file editing tools (Read/Write/Edit).
 * See ~/.craft-agent/docs/ for config format documentation.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { basename, join } from 'path';
import { getSessionPath } from '../sessions/storage.ts';
import { getSessionPlansPath } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
import { getCredentialManager } from '../credentials/index.ts';
import {
  validateConfig,
  validateSource,
  validateAllSources,
  validateStatuses,
  validatePreferences,
  validateAll,
  validateSkill,
  validateAllSkills,
  validateWorkspacePermissions,
  validateSourcePermissions,
  validateAllPermissions,
  validateToolIcons,
  formatValidationResult,
} from '../config/validators.ts';
import { PERMISSION_MODE_CONFIG } from './mode-types.ts';
import {
  validateMcpConnection,
  validateStdioMcpConnection,
  getValidationErrorMessage,
} from '../mcp/validation.ts';
import {
  getAnthropicApiKey,
  getClaudeOAuthToken,
} from '../config/storage.ts';
import {
  loadSourceConfig,
  saveSourceConfig,
  getSourcePath,
} from '../sources/storage.ts';
import type { FolderSourceConfig, LoadedSource } from '../sources/types.ts';
import { getSourceCredentialManager } from '../sources/index.ts';
import { inferGoogleServiceFromUrl, inferSlackServiceFromUrl, inferMicrosoftServiceFromUrl, isApiOAuthProvider, type GoogleService, type SlackService, type MicrosoftService } from '../sources/types.ts';
import { buildAuthorizationHeader } from '../sources/api-tools.ts';
import { DOC_REFS } from '../docs/index.ts';
import { renderMermaid } from '@craft-agent/mermaid';
import {
  IMAGE_MODELS,
  IMAGE_MODEL_IDS,
  DEFAULT_MODEL,
  getImageModel,
  formatModelList,
  formatModelsByUseCase,
  formatReferenceCapabilities,
  mapAspectRatioToIdeogram,
  analyzePromptForText,
  checkModelForText,
  enhancePromptForPlatform,
  getPlatformGuidelines,
  addTextInstructions,
  getAspectRatioPrefix,
  modelSupportsReference,
  getModelsWithStyleReference,
  getModelsWithRemix,
  getModelsWithEdit,
  type ImageModel,
  type ImageModelId,
  type TextAnalysisResult,
  type Platform,
} from './image-models.ts';
import { createLLMTool } from './llm-tool.ts';
import { isGoogleOAuthConfigured } from '../auth/google-oauth.ts';

// ============================================================
// Session-Scoped Tool Callbacks
// ============================================================

/**
 * Credential input modes for different auth types
 */
export type CredentialInputMode = 'bearer' | 'basic' | 'header' | 'query' | 'multi-header';

/**
 * Auth request types
 */
export type AuthRequestType =
  | 'credential'
  | 'oauth'
  | 'oauth-google'
  | 'oauth-slack'
  | 'oauth-microsoft';

/**
 * Base auth request fields
 */
interface BaseAuthRequest {
  requestId: string;
  sessionId: string;
  sourceSlug: string;
  sourceName: string;
}

/**
 * Credential auth request - prompts for API key, bearer token, etc.
 */
export interface CredentialAuthRequest extends BaseAuthRequest {
  type: 'credential';
  mode: CredentialInputMode;
  labels?: {
    credential?: string;
    username?: string;
    password?: string;
  };
  description?: string;
  hint?: string;
  headerName?: string;
  /** Header names for multi-header auth (e.g., ["DD-API-KEY", "DD-APPLICATION-KEY"]) */
  headerNames?: string[];
  /** Source URL/domain for password manager credential matching (1Password, etc.) */
  sourceUrl?: string;
  /** For basic auth: whether password is required. Default true for backward compatibility. */
  passwordRequired?: boolean;
}

/**
 * MCP OAuth auth request - standard OAuth 2.0 + PKCE
 */
export interface McpOAuthAuthRequest extends BaseAuthRequest {
  type: 'oauth';
}

/**
 * Google OAuth auth request - Google-specific OAuth
 */
export interface GoogleOAuthAuthRequest extends BaseAuthRequest {
  type: 'oauth-google';
  service?: GoogleService;
}

/**
 * Slack OAuth auth request - Slack-specific OAuth
 */
export interface SlackOAuthAuthRequest extends BaseAuthRequest {
  type: 'oauth-slack';
  service?: SlackService;
}

/**
 * Microsoft OAuth auth request - Microsoft-specific OAuth
 */
export interface MicrosoftOAuthAuthRequest extends BaseAuthRequest {
  type: 'oauth-microsoft';
  service?: MicrosoftService;
}

/**
 * Union of all auth request types
 */
export type AuthRequest =
  | CredentialAuthRequest
  | McpOAuthAuthRequest
  | GoogleOAuthAuthRequest
  | SlackOAuthAuthRequest
  | MicrosoftOAuthAuthRequest;

/**
 * Auth result - sent back to agent after auth completes
 */
export interface AuthResult {
  requestId: string;
  sourceSlug: string;
  success: boolean;
  cancelled?: boolean;
  error?: string;
  // Additional info for successful auth
  email?: string;      // For Google/Microsoft OAuth
  workspace?: string;  // For Slack OAuth
}

// ============================================================
// Helper Functions (exported for testing)
// ============================================================

/**
 * Detect the effective credential input mode based on source config and requested mode.
 *
 * Auto-upgrades to 'multi-header' when source has headerNames array, regardless of
 * what mode was explicitly requested. This ensures Datadog-like sources (with
 * headerNames: ["DD-API-KEY", "DD-APPLICATION-KEY"]) always use multi-header UI.
 *
 * @param source - Source configuration (may be null if source not found)
 * @param requestedMode - Mode explicitly requested in tool call
 * @param requestedHeaderNames - Header names explicitly provided in tool call
 * @returns Effective mode to use
 */
export function detectCredentialMode(
  source: { api?: { headerNames?: string[] } } | null,
  requestedMode: CredentialInputMode,
  requestedHeaderNames?: string[]
): CredentialInputMode {
  // Use provided headerNames or fall back to source config
  const effectiveHeaderNames = requestedHeaderNames || source?.api?.headerNames;

  // If we have headerNames, always use multi-header mode
  if (effectiveHeaderNames && effectiveHeaderNames.length > 0) {
    return 'multi-header';
  }

  return requestedMode;
}

/**
 * Get effective header names from request args or source config.
 *
 * @param source - Source configuration
 * @param requestedHeaderNames - Header names explicitly provided in tool call
 * @returns Array of header names or undefined
 */
export function getEffectiveHeaderNames(
  source: { api?: { headerNames?: string[] } } | null,
  requestedHeaderNames?: string[]
): string[] | undefined {
  return requestedHeaderNames || source?.api?.headerNames;
}

/**
 * Callbacks for session-scoped tool operations.
 * These are registered per-session and invoked by tools.
 */
export interface SessionScopedToolCallbacks {
  /** Called when a plan is submitted - triggers plan message display in UI */
  onPlanSubmitted?: (planPath: string) => void;
  /**
   * Called when authentication is requested - triggers auth UI and forceAbort.
   * This follows the SubmitPlan pattern:
   * 1. Tool calls onAuthRequest
   * 2. Session manager creates auth-request message and calls forceAbort
   * 3. User completes auth in UI
   * 4. Auth result is sent as a "faked user message"
   * 5. Agent resumes and processes the result
   */
  onAuthRequest?: (request: AuthRequest) => void;
}

/**
 * Registry mapping session IDs to their callbacks.
 */
const sessionScopedToolCallbackRegistry = new Map<string, SessionScopedToolCallbacks>();

/**
 * Register callbacks for a session's tools.
 * Called by CraftAgent when initializing.
 */
export function registerSessionScopedToolCallbacks(
  sessionId: string,
  callbacks: SessionScopedToolCallbacks
): void {
  sessionScopedToolCallbackRegistry.set(sessionId, callbacks);
  debug(`[SessionScopedTools] Registered callbacks for session ${sessionId}`);
}

/**
 * Unregister callbacks for a session.
 * Called by CraftAgent on dispose.
 */
export function unregisterSessionScopedToolCallbacks(sessionId: string): void {
  sessionScopedToolCallbackRegistry.delete(sessionId);
  debug(`[SessionScopedTools] Unregistered callbacks for session ${sessionId}`);
}

/**
 * Get callbacks for a session.
 */
function getSessionScopedToolCallbacks(sessionId: string): SessionScopedToolCallbacks | undefined {
  return sessionScopedToolCallbackRegistry.get(sessionId);
}

// ============================================================
// Plan File State (per session)
// ============================================================

/**
 * Track the last submitted plan file per session
 */
const sessionPlanFiles = new Map<string, string>();

/**
 * Get the last submitted plan file path for a session
 */
export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFiles.get(sessionId) ?? null;
}

/**
 * Set the last submitted plan file path for a session
 */
function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFiles.set(sessionId, path);
}

/**
 * Clear plan file state for a session
 */
export function clearPlanFileState(sessionId: string): void {
  sessionPlanFiles.delete(sessionId);
}

// ============================================================
// Tool Factories
// ============================================================

/**
 * Create a session-scoped SubmitPlan tool.
 * The sessionId is captured at creation time.
 *
 * This is a UNIVERSAL tool - the agent can use it anytime to submit
 * a plan for user review, regardless of Safe Mode status.
 */
export function createSubmitPlanTool(sessionId: string) {
  const exploreName = PERMISSION_MODE_CONFIG['safe'].displayName;

  return tool(
    'SubmitPlan',
    `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

This tool can be used anytime - it's not restricted to any particular mode.
Use it whenever you want to present a structured plan to the user.

**${exploreName} Mode Workflow:** When you are in ${exploreName} mode and have completed your research/exploration,
use this tool to present your implementation plan. The plan UI includes an "Accept Plan" button
that exits ${exploreName} mode and allows you to begin implementation immediately.

**Format your plan as markdown:**
\`\`\`markdown
# Plan Title

## Summary
Brief description of what this plan accomplishes.

## Steps
1. **Step description** - Details and approach
2. **Another step** - More details
3. ...
\`\`\`

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to present the plan to the user
- No further tool calls or text output will be processed after this tool returns
- The conversation will resume when the user responds (accept, modify, or reject the plan)
- Do NOT include any text or tool calls after SubmitPlan - they will not be executed`,
    {
      planPath: z.string().describe('Absolute path to the plan markdown file you wrote'),
    },
    async (args) => {
      debug('[SubmitPlan] Called with planPath:', args.planPath);
      debug('[SubmitPlan] sessionId (from closure):', sessionId);

      // Verify the file exists
      if (!existsSync(args.planPath)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Plan file not found at ${args.planPath}. Please write the plan file first using the Write tool.`,
          }],
        };
      }

      // Read the plan content to verify it's valid
      let planContent: string;
      try {
        planContent = readFileSync(args.planPath, 'utf-8');
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading plan file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }

      // Store the plan file path
      setLastPlanFilePath(sessionId, args.planPath);

      // Get callbacks and notify UI
      const callbacks = getSessionScopedToolCallbacks(sessionId);
      debug('[SubmitPlan] Registry callbacks found:', !!callbacks);

      if (callbacks?.onPlanSubmitted) {
        callbacks.onPlanSubmitted(args.planPath);
        debug('[SubmitPlan] Callback completed');
      } else {
        debug('[SubmitPlan] No callback registered for session');
      }

      return {
        content: [{
          type: 'text' as const,
          text: 'Plan submitted for review. Waiting for user feedback.',
        }],
        isError: false,
      };
    }
  );
}

// ============================================================
// Config Validation Tool
// ============================================================

/**
 * Create a session-scoped config_validate tool.
 * Validates configuration files and returns structured error reports.
 */
export function createConfigValidateTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'config_validate',
    `Validate Craft Agent configuration files.

Use this after editing configuration files to check for errors before they take effect.
Returns structured validation results with errors, warnings, and suggestions.

**Targets:**
- \`config\`: Validates ~/.craft-agent/config.json (workspaces, model, settings)
- \`sources\`: Validates all sources in ~/.craft-agent/workspaces/{workspace}/sources/*/config.json
- \`statuses\`: Validates ~/.craft-agent/workspaces/{workspace}/statuses/config.json (workflow states)
- \`preferences\`: Validates ~/.craft-agent/preferences.json (user preferences)
- \`permissions\`: Validates permissions.json files (workspace, source, and app-level default)
- \`tool-icons\`: Validates ~/.craft-agent/tool-icons/tool-icons.json (CLI tool icon mappings)
- \`all\`: Validates all configuration files

**For specific source validation:** Use target='sources' with sourceSlug parameter.
**For specific source permissions:** Use target='permissions' with sourceSlug parameter.

**Example workflow:**
1. Edit a config file using Write/Edit tools
2. Call config_validate to check for errors
3. If errors found, fix them and re-validate
4. Once valid, changes take effect on next reload`,
    {
      target: z.enum(['config', 'sources', 'statuses', 'preferences', 'permissions', 'tool-icons', 'all']).describe(
        'Which config file(s) to validate'
      ),
      sourceSlug: z.string().optional().describe(
        'Validate a specific source by slug (used with target "sources" or "permissions")'
      ),
    },
    async (args) => {
      debug('[config_validate] Validating:', args.target, 'sourceSlug:', args.sourceSlug);

      try {
        let result;

        switch (args.target) {
          case 'config':
            result = validateConfig();
            break;
          case 'sources':
            if (args.sourceSlug) {
              result = validateSource(workspaceRootPath, args.sourceSlug);
            } else {
              result = validateAllSources(workspaceRootPath);
            }
            break;
          case 'statuses':
            result = validateStatuses(workspaceRootPath);
            break;
          case 'preferences':
            result = validatePreferences();
            break;
          case 'permissions':
            if (args.sourceSlug) {
              result = validateSourcePermissions(workspaceRootPath, args.sourceSlug);
            } else {
              result = validateAllPermissions(workspaceRootPath);
            }
            break;
          case 'tool-icons':
            result = validateToolIcons();
            break;
          case 'all':
            result = validateAll(workspaceRootPath);
            break;
        }

        const formatted = formatValidationResult(result);

        return {
          content: [{
            type: 'text' as const,
            text: formatted,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[config_validate] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error validating config: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Skill Validation Tool
// ============================================================

/**
 * Create a session-scoped skill_validate tool.
 * Validates skill SKILL.md files and returns structured error reports.
 */
export function createSkillValidateTool(sessionId: string, workspaceRoot: string) {
  return tool(
    'skill_validate',
    `Validate a skill's SKILL.md file.

Checks:
- Slug format (lowercase alphanumeric with hyphens)
- SKILL.md exists and is readable
- YAML frontmatter is valid with required fields (name, description)
- Content is non-empty after frontmatter
- Icon format if present (svg/png/jpg)

**Usage:** Call after creating or editing a skill to verify it's valid.

**Returns:** Validation status with specific errors and warnings.`,
    {
      skillSlug: z.string().describe('The slug of the skill to validate'),
    },
    async (args) => {
      debug('[skill_validate] Validating skill:', args.skillSlug);

      try {
        const result = validateSkill(workspaceRoot, args.skillSlug);
        const formatted = formatValidationResult(result);

        return {
          content: [{
            type: 'text' as const,
            text: formatted,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[skill_validate] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error validating skill: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Source Test Tool
// ============================================================

/**
 * Test Google API source (Gmail, Calendar, Drive) by validating OAuth token exists and is not expired.
 * Google APIs use OAuth tokens that can be refreshed automatically.
 */
async function testGoogleSource(
  source: FolderSourceConfig,
  workspaceRootPath: string
): Promise<{ success: boolean; status?: number; error?: string; credentialType?: string }> {
  const credManager = getSourceCredentialManager();
  const workspaceId = basename(workspaceRootPath);

  // Build LoadedSource from config for credential manager
  const loadedSource: LoadedSource = {
    config: source,
    guide: null,
    folderPath: '',
    workspaceRootPath,
    workspaceId,
  };

  // Check if we have valid credentials using getToken (handles expiry)
  const token = await credManager.getToken(loadedSource);

  if (token) {
    // Token is valid (not expired)
    return { success: true, credentialType: 'source_oauth' };
  }

  // No valid token - check if we have a refresh token
  const cred = await credManager.load(loadedSource);
  if (cred?.refreshToken) {
    // Try to refresh the token
    const refreshed = await credManager.refresh(loadedSource);
    if (refreshed) {
      return { success: true, credentialType: 'source_oauth' };
    }
  }

  // No valid token and refresh failed or not available
  const serviceName = source.api?.googleService || 'Google';
  return {
    success: false,
    error: `${serviceName} OAuth token missing or expired. Use source_google_oauth_trigger to re-authenticate.`,
    credentialType: 'source_oauth',
  };
}

/**
 * Test an API source by making a simple HEAD/GET request.
 */
async function testApiSource(
  source: FolderSourceConfig,
  workspaceRootPath: string
): Promise<{ success: boolean; status?: number; error?: string; credentialType?: string }> {
  // Google APIs (Gmail, Calendar, Drive) - use Google-specific test
  if (source.provider === 'google') {
    return testGoogleSource(source, workspaceRootPath);
  }

  if (!source.api?.baseUrl) {
    return { success: false, error: 'No API URL configured' };
  }

  const requiresAuth = source.api.authType && source.api.authType !== 'none';

  // Require testEndpoint for authenticated APIs - without it we can't validate credentials
  if (requiresAuth && !source.api.testEndpoint) {
    return {
      success: false,
      error: `Authenticated API sources require a \`testEndpoint\` configuration to validate credentials. Add \`testEndpoint\` to config.json. See \`${DOC_REFS.sources}\` for format.`,
    };
  }

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    let credentialType: string | undefined;
    let credValue: string | undefined;

    // Get credentials if needed
    if (requiresAuth) {
      const workspaceId = basename(workspaceRootPath);
      const sourceCredManager = getSourceCredentialManager();
      const loadedSource: LoadedSource = {
        config: source,
        guide: null,
        folderPath: '',
        workspaceRootPath,
        workspaceId,
      };

      if (isApiOAuthProvider(source.provider)) {
        // Use SourceCredentialManager for OAuth providers - handles expiry checking and refresh
        // getToken() returns null if expired
        let token = await sourceCredManager.getToken(loadedSource);

        if (!token) {
          // Try refresh if token is expired/missing
          debug(`[testApiSource] OAuth token expired or missing for ${source.slug}, attempting refresh`);
          token = await sourceCredManager.refresh(loadedSource);
        }

        if (token) {
          credValue = token;
          credentialType = 'source_oauth';
          debug(`[testApiSource] Found valid OAuth token for ${source.slug}`);
        } else {
          debug(`[testApiSource] No valid OAuth token for ${source.slug}`);
        }
      } else {
        // For non-OAuth auth types, use getApiCredential which handles basic auth JSON parsing
        debug(`[testApiSource] Looking up credentials for source=${source.slug}, authType=${source.api.authType}`);
        const apiCred = await sourceCredManager.getApiCredential(loadedSource);
        if (apiCred) {
          // Determine credential type for reporting
          if (source.api.authType === 'bearer') {
            credentialType = 'source_bearer';
          } else if (source.api.authType === 'basic') {
            credentialType = 'source_basic';
          } else {
            credentialType = 'source_apikey';
          }

          // Apply credential based on authType config
          if (source.api.authType === 'bearer') {
            credValue = typeof apiCred === 'string' ? apiCred : '';
            headers['Authorization'] = buildAuthorizationHeader(source.api.authScheme, credValue);
          } else if (source.api.authType === 'header' && source.api.headerName) {
            credValue = typeof apiCred === 'string' ? apiCred : '';
            headers[source.api.headerName] = credValue;
          } else if (source.api.authType === 'basic') {
            // getApiCredential returns BasicAuthCredential {username, password} for basic auth
            if (typeof apiCred === 'object' && 'username' in apiCred && 'password' in apiCred) {
              const basicAuth = Buffer.from(`${apiCred.username}:${apiCred.password}`).toString('base64');
              headers['Authorization'] = `Basic ${basicAuth}`;
              credValue = '[basic-auth]'; // Don't expose actual credentials in logs
            }
          }
          debug(`[testApiSource] Found credential for ${source.slug}`);
        } else {
          debug(`[testApiSource] No credential found for ${source.slug}`);
        }
      }
    }

    let response: Response;

    // Use testEndpoint if configured (required for authenticated APIs, optional for public)
    if (source.api.testEndpoint) {
      const testUrl = new URL(source.api.testEndpoint.path, source.api.baseUrl).toString();
      const fetchOptions: RequestInit = {
        method: source.api.testEndpoint.method,
        headers,
      };

      // Apply custom test endpoint headers if specified
      if (source.api.testEndpoint.headers) {
        Object.assign(headers, source.api.testEndpoint.headers);
      }

      if (source.api.testEndpoint.method === 'POST' && source.api.testEndpoint.body) {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(source.api.testEndpoint.body);
      }

      debug(`[testApiSource] Testing URL: ${testUrl}, method: ${fetchOptions.method}`);
      response = await fetch(testUrl, fetchOptions);
      debug(`[testApiSource] Response: ${response.status} ${response.statusText}`);
    } else {
      // Fallback for public APIs only (authType: 'none')
      response = await fetch(source.api.baseUrl, { method: 'HEAD', headers });

      // Some APIs don't support HEAD, try GET
      if (response.status === 405) {
        response = await fetch(source.api.baseUrl, { method: 'GET', headers });
      }
    }

    if (response.ok) {
      return {
        success: true,
        status: response.status,
        credentialType,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status} - Authentication failed. Check your credentials. If credentials are correct, use WebSearch to verify the API endpoint URL is current.`,
        credentialType,
      };
    }

    // 404 often indicates wrong endpoint URL - suggest web search for current endpoint
    if (response.status === 404) {
      return {
        success: false,
        status: response.status,
        error: `HTTP 404 - Endpoint not found. The URL may be incorrect or outdated. Use WebSearch to find the current API endpoint.`,
        credentialType,
      };
    }

    return {
      success: false,
      status: response.status,
      error: `HTTP ${response.status}. If unexpected, use WebSearch to verify the API URL is correct.`,
      credentialType
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Create a session-scoped source_test tool.
 * Validates config, downloads icons, and tests connections.
 */
export function createSourceTestTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_test',
    `Validate and test a source configuration.

**This tool performs four checks:**
1. **Schema validation**: Validates config.json against the schema
2. **Icon caching**: Downloads and caches icon if not already local
3. **Connection test**: Tests if the source is reachable
4. **Completeness check**: Checks for missing description and icon

**Supports:**
- **MCP sources**: Validates server URL, authentication, tool availability
- **API sources**: Tests endpoint reachability and authentication
- **Local sources**: Validates path exists

**Usage:**
After creating or editing a source's config.json, run this tool to:
- Catch config errors before they cause issues
- Auto-download icons from service URLs
- Verify the connection works

**Note:** Returns all errors and warnings at once (doesn't stop on first error).

**Reference:** See \`${DOC_REFS.sources}\` for config format.

**Returns:**
- Validation status with specific errors if invalid
- Icon status (cached, downloaded, or failed)
- Connection status with server info (MCP) or HTTP status (API)
- Completeness suggestions for missing description/icon`,
    {
      sourceSlug: z.string().describe('The slug of the source to test'),
    },
    async (args) => {
      debug('[source_test] Testing source:', args.sourceSlug);

      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found.\n\nCreate the source folder at:\n\`~/.craft-agent/workspaces/{workspace}/sources/${args.sourceSlug}/config.json\`\n\nSee \`${DOC_REFS.sources}\` for config format.`,
            }],
            isError: true,
          };
        }
        
        const results: string[] = [];
        const warnings: string[] = [];
        let hasErrors = false;

        // ============================================================
        // Step 1: Schema Validation
        // ============================================================
        const validationResult = validateSource(workspaceRootPath, args.sourceSlug);
        // Collect schema errors but continue to show all issues at once
        if (!validationResult.valid) {
          hasErrors = true;
          results.push('**❌ Schema Validation Failed**\n');
          for (const error of validationResult.errors) {
            results.push(`- \`${error.path}\`: ${error.message}`);
            if (error.suggestion) {
              results.push(`  → ${error.suggestion}`);
            }
          }
          results.push('');
          results.push(`See \`${DOC_REFS.sources}\` for config format.`);
        } else {
          results.push('**✓ Schema Valid**');
        }

        // ============================================================
        // Step 2: Icon Handling
        // Uses unified icon system: local file > URL (downloaded) > emoji
        // ============================================================
        const { getSourcePath, findSourceIcon, downloadSourceIcon, isIconUrl } = await import('../sources/storage.ts');
        const sourcePath = getSourcePath(workspaceRootPath, args.sourceSlug);

        // Check for local icon file first (auto-discovered)
        const localIcon = findSourceIcon(workspaceRootPath, args.sourceSlug);
        if (localIcon) {
          results.push(`**✓ Icon Found** (${localIcon.split('/').pop()})`);
        } else if (source.icon && isIconUrl(source.icon)) {
          // URL icon - download it
          const iconPath = await downloadSourceIcon(workspaceRootPath, args.sourceSlug, source.icon);
          if (iconPath) {
            results.push(`**✓ Icon Downloaded** (${iconPath.split('/').pop()})`);
          } else {
            results.push('**⚠ Icon Download Failed**');
          }
        } else if (source.icon) {
          // Emoji icon
          results.push(`**✓ Icon** (emoji: ${source.icon})`);
        } else {
          // No icon set - try to auto-fetch from service URL
          const { deriveServiceUrl, getHighQualityLogoUrl } = await import('../utils/logo.ts');
          const { downloadIcon } = await import('../utils/icon.ts');
          const serviceUrl = deriveServiceUrl(source);

          if (serviceUrl) {
            const logoUrl = await getHighQualityLogoUrl(serviceUrl, source.slug)
              || await getHighQualityLogoUrl(serviceUrl, source.provider);
            if (logoUrl) {
              const iconPath = await downloadIcon(sourcePath, logoUrl, `source_test:${source.slug}`);
              if (iconPath) {
                // Store the URL for future reference
                source.icon = logoUrl;
                saveSourceConfig(workspaceRootPath, source);
                results.push(`**✓ Icon Auto-fetched**`);
              } else {
                results.push('**○ No Icon** (auto-fetch failed)');
              }
            } else {
              results.push('**○ No Icon** (no favicon found)');
            }
          } else {
            results.push('**○ No Icon**');
          }
        }

        // ============================================================
        // Step 2b: Completeness Checks (warnings, not errors)
        // These help the agent understand when/how to use this source
        // ============================================================

        // Cast to check for common misnamed fields (description vs tagline)
        // TypeScript types don't prevent extra properties at runtime, so we cast
        // through unknown to access potential untyped fields in the JSON
        const rawConfig = source as unknown as Record<string, unknown>;

        // Check for tagline - the description shown in the UI
        if (!source.tagline) {
          // Check if user mistakenly used 'description' instead of 'tagline'
          if (rawConfig['description'] && typeof rawConfig['description'] === 'string') {
            warnings.push('**⚠ Wrong Field Name: "description" → "tagline"**');
            warnings.push(`  Found: \`"description": "${rawConfig['description']}"\``);
            warnings.push('  The UI displays the \`tagline\` field, not \`description\`.');
            warnings.push('  Rename the field in config.json:');
            warnings.push(`  \`"tagline": "${rawConfig['description']}"\``);
          } else {
            warnings.push('**⚠ Missing Tagline**');
            warnings.push('  Add a \`tagline\` field to describe this source\'s purpose.');
            warnings.push('  This is displayed in the UI and helps Claude understand the source.');
            warnings.push('  Example: \`"tagline": "Issue tracking for the iOS team"\`');
          }
        } else {
          // Tagline exists - report it for visibility
          results.push(`**✓ Tagline** "${source.tagline}"`);
        }

        // Check for icon (supports .svg, .png, .jpg, .jpeg)
        // Only warn if no icon was found/downloaded in the previous step
        if (!localIcon && !source.icon) {
          warnings.push('**⚠ Missing Icon**');
          warnings.push('  No icon file found in source folder (icon.svg, icon.png, icon.jpg).');
          warnings.push('  Options to add an icon:');
          warnings.push('  1. Place an icon file directly in the source folder');
          warnings.push('  2. Add \`"icon": "<url>"\` to config.json (will be auto-downloaded)');
          warnings.push('  3. Add \`"icon": "📋"\` to use an emoji');
          warnings.push('');
          warnings.push('  To find an icon, use WebSearch:');
          warnings.push(`  WebSearch({ query: "${source.provider || source.name} logo svg" })`);
        }

        // Check for guide.md - essential for Claude to understand how to use the source
        const guidePath = join(sourcePath, 'guide.md');
        const hasGuide = existsSync(guidePath);
        if (!hasGuide) {
          warnings.push('**⚠ Missing guide.md**');
          warnings.push('  Create a guide.md file to help Claude use this source effectively.');
          warnings.push('  Include: available endpoints, authentication details, usage examples.');
          warnings.push(`  Path: ${sourcePath}/guide.md`);
        } else {
          const guideStats = statSync(guidePath);
          const guideSizeKB = (guideStats.size / 1024).toFixed(1);
          results.push(`**✓ Guide** (guide.md, ${guideSizeKB} KB)`);
        }

        // ============================================================
        // Step 3: Connection Test
        // ============================================================
        results.push('');

        // Handle API sources
        if (source.type === 'api') {
          const result = await testApiSource(source, workspaceRootPath);

          // Update the source's status and timestamp
          source.lastTestedAt = Date.now();
          if (result.success) {
            source.connectionStatus = 'connected';
            source.connectionError = undefined;
            // Set isAuthenticated for sources that don't require auth
            if (source.api?.authType === 'none') {
              source.isAuthenticated = true;
            }
          } else {
            source.connectionStatus = 'failed';
            source.connectionError = result.error;
          }
          saveSourceConfig(workspaceRootPath, source);

          if (result.success) {
            results.push(`**✓ API Connected** (${result.status})`);
            results.push(`  URL: ${source.api?.baseUrl}`);

            if (result.credentialType) {
              results.push(`  Credential: ${result.credentialType}`);
            }

            // Verify the source has valid credentials for session use
            const workspaceId = basename(workspaceRootPath);
            const loadedSource: LoadedSource = {
              config: source,
              guide: null,
              folderPath: sourcePath,
              workspaceRootPath,
              workspaceId,
            };
            const credManager = getSourceCredentialManager();
            const hasCredentials = await credManager.hasValidCredentials(loadedSource);

            if (!hasCredentials && source.api?.authType !== 'none') {
              results.push('');
              results.push('**⚠ Credentials Missing**');
              results.push(`Auth type: ${source.api?.authType}`);
              results.push('Use `source_credential_prompt` to add credentials.');
            }
          } else {
            hasErrors = true;
            results.push(`**❌ API Connection Failed**`);
            results.push(`  URL: ${source.api?.baseUrl}`);
            results.push(`  Error: ${result.error}`);

            // Add domain validation hint for common errors
            if (result.status === 401 || result.status === 403 || result.status === 404) {
              results.push('');
              results.push('💡 **Tip:** API endpoints change frequently. Use `WebSearch` to verify the current URL:');
              results.push(`   WebSearch({ query: "${source.provider || source.name} API endpoint" })`);
            }
          }
        }

        // Handle local sources
        else if (source.type === 'local') {
          const localPath = source.local?.path;
          if (localPath && existsSync(localPath)) {
            source.lastTestedAt = Date.now();
            source.connectionStatus = 'connected';
            source.connectionError = undefined;
            source.isAuthenticated = true; // Local sources don't require auth
            saveSourceConfig(workspaceRootPath, source);
            results.push(`**✓ Local Path Exists** (${localPath})`);
          } else {
            hasErrors = true;
            source.connectionStatus = 'failed';
            source.connectionError = 'Path not found';
            saveSourceConfig(workspaceRootPath, source);
            results.push(`**❌ Local Path Not Found** (${localPath || 'not configured'})`);
          }
        }

        // Handle MCP sources
        else if (source.type === 'mcp') {
          // Handle stdio transport (local MCP servers)
          if (source.mcp?.transport === 'stdio') {
            if (!source.mcp.command) {
              hasErrors = true;
              results.push('**❌ No command configured for stdio MCP source**');
            } else {
              // Actually spawn and test the stdio MCP server
              results.push(`Testing stdio server: ${source.mcp.command} ${(source.mcp.args || []).join(' ')}`);
              results.push('');

              const stdioResult = await validateStdioMcpConnection({
                command: source.mcp.command,
                args: source.mcp.args,
                env: source.mcp.env,
                timeout: 30000, // 30 second timeout for spawn + connect
              });

              source.lastTestedAt = Date.now();

              if (stdioResult.success) {
                source.connectionStatus = 'connected';
                source.connectionError = undefined;
                source.isAuthenticated = true; // Stdio sources don't need auth
                saveSourceConfig(workspaceRootPath, source);

                results.push('**✓ Stdio MCP Server Connected**');
                results.push(`  Command: ${source.mcp.command}`);
                if (source.mcp.args?.length) {
                  results.push(`  Args: ${source.mcp.args.join(' ')}`);
                }
                if (stdioResult.tools && stdioResult.tools.length > 0) {
                  results.push(`  Tools: ${stdioResult.tools.length} available`);
                  // Show first few tool names
                  const toolPreview = stdioResult.tools.slice(0, 5).join(', ');
                  const more = stdioResult.tools.length > 5 ? `, +${stdioResult.tools.length - 5} more` : '';
                  results.push(`  Available: ${toolPreview}${more}`);
                }
              } else {
                hasErrors = true;
                source.connectionStatus = 'failed';
                source.connectionError = stdioResult.error || 'Unknown error';
                saveSourceConfig(workspaceRootPath, source);

                results.push('**❌ Stdio MCP Server Failed**');
                results.push(`  Command: ${source.mcp.command}`);
                results.push(`  Error: ${stdioResult.error}`);

                // Show schema validation errors if present
                if (stdioResult.errorType === 'invalid-schema' && stdioResult.invalidProperties) {
                  results.push('  Invalid tool properties:');
                  for (const prop of stdioResult.invalidProperties.slice(0, 5)) {
                    results.push(`    - ${prop.toolName}: ${prop.propertyPath}`);
                  }
                  if (stdioResult.invalidProperties.length > 5) {
                    results.push(`    ... and ${stdioResult.invalidProperties.length - 5} more`);
                  }
                }
              }
            }
          }
          // Handle HTTP/SSE transport (remote MCP servers)
          else if (!source.mcp?.url) {
            hasErrors = true;
            results.push('**❌ No MCP URL configured**');
          } else {
            // Get MCP access token if the source is authenticated
            let mcpAccessToken: string | undefined;
            if (source.isAuthenticated && source.mcp.authType !== 'none') {
              const credentialManager = getCredentialManager();
              const workspaceId = basename(workspaceRootPath);
              // Try OAuth first, then bearer
              const oauthCred = await credentialManager.get({
                type: 'source_oauth',
                workspaceId,
                sourceId: args.sourceSlug,
              });
              if (oauthCred?.value) {
                mcpAccessToken = oauthCred.value;
              } else {
                const bearerCred = await credentialManager.get({
                  type: 'source_bearer',
                  workspaceId,
                  sourceId: args.sourceSlug,
                });
                if (bearerCred?.value) {
                  mcpAccessToken = bearerCred.value;
                }
              }
            }

            // Get Claude credentials for the validation request
            const claudeApiKey = await getAnthropicApiKey();
            const claudeOAuthToken = await getClaudeOAuthToken();

            if (!claudeApiKey && !claudeOAuthToken) {
              hasErrors = true;
              results.push('**❌ Cannot Test MCP**: No Claude API key or OAuth token configured.');
            } else {
              // Run the validation
              const mcpResult = await validateMcpConnection({
                mcpUrl: source.mcp.url,
                mcpAccessToken,
                claudeApiKey: claudeApiKey ?? undefined,
                claudeOAuthToken: claudeOAuthToken ?? undefined,
              });

              // Update the source's status and timestamp
              source.lastTestedAt = Date.now();
              if (mcpResult.success) {
                source.connectionStatus = 'connected';
                source.connectionError = undefined;
                // Set isAuthenticated for sources that don't require auth
                if (source.mcp?.authType === 'none') {
                  source.isAuthenticated = true;
                }
                saveSourceConfig(workspaceRootPath, source);

                results.push('**✓ MCP Connected**');
                if (mcpResult.serverInfo) {
                  results.push(`  Server: ${mcpResult.serverInfo.name} v${mcpResult.serverInfo.version}`);
                }
                if (mcpResult.tools && mcpResult.tools.length > 0) {
                  results.push(`  Tools: ${mcpResult.tools.length} available`);
                }

                // Verify credentials
                const loadedSource: LoadedSource = {
                  config: source,
                  guide: null,
                  folderPath: sourcePath,
                  workspaceRootPath,
                  workspaceId: basename(workspaceRootPath),
                };
                const credManager = getSourceCredentialManager();
                const hasCredentials = await credManager.hasValidCredentials(loadedSource);

                if (!hasCredentials && source.mcp?.authType !== 'none') {
                  results.push('');
                  results.push('**⚠ Credentials Missing**');
                  results.push('Use `source_oauth_trigger` to authenticate.');
                }
              } else if (mcpResult.errorType === 'needs-auth') {
                source.connectionStatus = 'needs_auth';
                source.connectionError = getValidationErrorMessage(mcpResult, { transport: source.mcp?.transport });
                saveSourceConfig(workspaceRootPath, source);
                results.push('**⚠ MCP Needs Authentication**');
                results.push('Use `source_oauth_trigger` to authenticate.');
              } else {
                hasErrors = true;
                source.connectionStatus = 'failed';
                const errorMsg = getValidationErrorMessage(mcpResult, { transport: source.mcp?.transport });
                source.connectionError = errorMsg;
                saveSourceConfig(workspaceRootPath, source);
                results.push(`**❌ MCP Connection Failed**`);
                results.push(`  Error: ${errorMsg}`);

                if (mcpResult.errorType === 'invalid-schema' && mcpResult.invalidProperties) {
                  results.push('  Invalid tool properties:');
                  for (const prop of mcpResult.invalidProperties.slice(0, 5)) {
                    results.push(`    - ${prop.toolName}: ${prop.propertyPath}`);
                  }
                }
              }
            }
          }
        } else {
          hasErrors = true;
          results.push(`**❌ Unknown source type**: '${source.type}'`);
        }

        // Add completeness warnings if any
        if (warnings.length > 0) {
          results.push('');
          results.push('---');
          results.push('**Completeness Suggestions:**');
          results.push(...warnings);
        }

        // Add summary
        results.push('');
        if (hasErrors) {
          results.push(`**Source '${source.name}' has issues to fix.**`);
        } else if (warnings.length > 0) {
          results.push(`**Source '${source.name}' is ready** (with suggestions above).`);
        } else {
          results.push(`**Source '${source.name}' is ready.**`);
        }

        return {
          content: [{
            type: 'text' as const,
            text: results.join('\n'),
          }],
          isError: hasErrors,
        };
      } catch (error) {
        debug('[source_test] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error testing source: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// OAuth Helpers
// ============================================================

/**
 * Verify that a source has a valid token in the credential store.
 * The isAuthenticated flag in config.json can be stale if the token was deleted or expired.
 *
 * @returns true if a valid token exists, false if re-authentication is needed
 */
async function verifySourceHasValidToken(
  workspaceRootPath: string,
  source: FolderSourceConfig,
  sourceSlug: string
): Promise<boolean> {
  if (!source.isAuthenticated) {
    return false;
  }

  const credManager = getSourceCredentialManager();
  const workspaceId = basename(workspaceRootPath);
  const loadedSource: LoadedSource = {
    config: source,
    guide: null,
    folderPath: getSourcePath(workspaceRootPath, sourceSlug),
    workspaceRootPath,
    workspaceId,
  };

  const token = await credManager.getToken(loadedSource);
  return token !== null;
}

// ============================================================
// OAuth Trigger Tool
// ============================================================

/**
 * Create a session-scoped source_oauth_trigger tool.
 * Initiates OAuth authentication for an MCP source.
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The OAuth flow runs in the background, and the result comes back as a new message.
 */
export function createOAuthTriggerTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_oauth_trigger',
    `Start OAuth authentication for an MCP source.

This tool initiates the OAuth 2.0 + PKCE flow for sources that require authentication.
A browser window will open for the user to complete authentication.

**Prerequisites:**
- Source must exist in the current workspace
- Source must be type 'mcp' with authType 'oauth'
- Source must have a valid MCP URL

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** while OAuth completes
- A browser window will open for user authentication
- Once complete or cancelled, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Returns:**
- Success message if already authenticated
- Authentication request if OAuth flow is triggered`,
    {
      sourceSlug: z.string().describe('The slug of the source to authenticate'),
    },
    async (args) => {
      debug('[source_oauth_trigger] Starting OAuth for source:', args.sourceSlug);

      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

        if (source.type !== 'mcp') {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is type '${source.type}'. OAuth is only for MCP sources.`,
            }],
            isError: true,
          };
        }

        if (source.mcp?.authType !== 'oauth') {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' uses '${source.mcp?.authType || 'none'}' auth, not OAuth. No authentication needed.`,
            }],
            isError: false,
          };
        }

        if (!source.mcp?.url) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' has no MCP URL configured.`,
            }],
            isError: true,
          };
        }

        // Get session callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No auth request handler available. This tool requires a UI to handle OAuth.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: McpOAuthAuthRequest = {
          type: 'oauth',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        // The session manager will then run the OAuth flow
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `OAuth authentication requested for '${source.name}'. Opening browser for authentication.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_oauth_trigger] Error:', error);

        return {
          content: [{
            type: 'text' as const,
            text: `OAuth authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped source_google_oauth_trigger tool.
 * Initiates Google OAuth authentication for any Google API source (Gmail, Calendar, Drive, etc.).
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The OAuth flow runs in the background, and the result comes back as a new message.
 */
export function createGoogleOAuthTriggerTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_google_oauth_trigger',
    `Trigger Google OAuth authentication flow for any Google API source.

Opens a browser window for the user to sign in with their Google account and authorize access to the specified Google service.
After successful authentication, the tokens are stored and the source is marked as authenticated.

**Supported services:**
- Gmail: Read, compose, and manage emails
- Calendar: Read and manage calendar events
- Drive: Read and manage Google Drive files

**Prerequisites:**
- The source must have provider 'google'
- Google OAuth must be configured in the build

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** while OAuth completes
- A browser window will open for Google sign-in
- Once complete or cancelled, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Returns:**
- Success message if already authenticated
- Authentication request if OAuth flow is triggered`,
    {
      sourceSlug: z.string().describe('The slug of the Google API source to authenticate'),
    },
    async (args) => {
      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

        // Verify this is a Google source
        if (source.provider !== 'google') {
          const hint = !source.provider
            ? `Add "provider": "google" to config.json and retry.`
            : `This source has provider '${source.provider}'. Use source_oauth_trigger for MCP sources.`;
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is not configured as a Google API source. ${hint}\n\nCurrent config: ${JSON.stringify(source, null, 2)}`,
            }],
            isError: true,
          };
        }

        // Check if Google OAuth credentials are configured (in source config or env vars)
        const api = source.api;
        if (!isGoogleOAuthConfigured(api?.googleOAuthClientId, api?.googleOAuthClientSecret)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Google OAuth credentials not configured for source '${args.sourceSlug}'.

To authenticate with Google services, you need to provide your own OAuth credentials.

**Option 1: Add credentials to source config**
Edit the source's config.json and add:
\`\`\`json
{
  "api": {
    "googleOAuthClientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "googleOAuthClientSecret": "YOUR_CLIENT_SECRET"
  }
}
\`\`\`

**Option 2: Set environment variables**
\`\`\`bash
export GOOGLE_OAUTH_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="YOUR_CLIENT_SECRET"
\`\`\`

**How to get credentials:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable the required API (Gmail API, Calendar API, etc.)
4. Go to "APIs & Services" → "Credentials"
5. Create OAuth 2.0 Client ID (Desktop app type)
6. Copy the Client ID and Client Secret

See the source's guide.md for detailed instructions.`,
            }],
            isError: true,
          };
        }

        // Check if source has valid credentials (not just isAuthenticated flag)
        const hasValidToken = await verifySourceHasValidToken(workspaceRootPath, source, args.sourceSlug);
        if (hasValidToken) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is already authenticated.`,
            }],
            isError: false,
          };
        }
        if (source.isAuthenticated) {
          debug(`[source_google_oauth_trigger] Source '${args.sourceSlug}' marked as authenticated but no valid token found, triggering re-auth`);
        }

        // Determine service from config for new pattern
        let service: GoogleService | undefined;

        if (api?.googleService) {
          service = api.googleService;
        } else {
          service = inferGoogleServiceFromUrl(api?.baseUrl);
        }

        // Get session callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No auth request handler available. This tool requires a UI to handle OAuth.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: GoogleOAuthAuthRequest = {
          type: 'oauth-google',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          service,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        // The session manager will then run the OAuth flow
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `Google OAuth requested for '${source.name}'. Opening browser for authentication.`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Google OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped source_slack_oauth_trigger tool.
 * Handles OAuth authentication for Slack API sources.
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The OAuth flow runs in the background, and the result comes back as a new message.
 */
export function createSlackOAuthTriggerTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_slack_oauth_trigger',
    `Trigger Slack OAuth authentication flow for a Slack API source.

Opens a browser window for the user to sign in with their Slack account and authorize access to the specified Slack workspace.
After successful authentication, the tokens are stored and the source is marked as authenticated.

**Supported services:**
- messaging: Send messages, post in channels
- channels: Read and manage channels
- users: Read user profiles
- files: Upload and manage files
- full: Full workspace access (messaging, channels, users, files, reactions)

**Prerequisites:**
- The source must have type 'api' and provider 'slack'
- Slack OAuth must be configured in the build

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** while OAuth completes
- A browser window will open for Slack sign-in
- Once complete or cancelled, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Returns:**
- Success message if already authenticated
- Authentication request if OAuth flow is triggered`,
    {
      sourceSlug: z.string().describe('The slug of the Slack API source to authenticate'),
    },
    async (args) => {
      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

        // Verify this is a Slack source
        if (source.provider !== 'slack') {
          const hint = !source.provider
            ? `Add "provider": "slack" to config.json and retry.`
            : `This source has provider '${source.provider}'. Use source_oauth_trigger for MCP sources or source_google_oauth_trigger for Google sources.`;
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is not configured as a Slack API source. ${hint}\n\nCurrent config: ${JSON.stringify(source, null, 2)}`,
            }],
            isError: true,
          };
        }

        // Verify source type is 'api', not 'mcp' - OAuth only works with API sources
        if (source.type !== 'api') {
          let hint = '';
          if (source.type === 'mcp') {
            hint = `For Slack integration, use the native Slack API approach (type: "api", provider: "slack") instead of an MCP server. This enables proper OAuth authentication via source_slack_oauth_trigger.`;
          }
          return {
            content: [{
              type: 'text' as const,
              text: `source_slack_oauth_trigger only works with API sources (type: "api"), not ${source.type} sources. ${hint}`,
            }],
            isError: true,
          };
        }

        // Check if source has valid credentials (not just isAuthenticated flag)
        const hasValidToken = await verifySourceHasValidToken(workspaceRootPath, source, args.sourceSlug);
        if (hasValidToken) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is already authenticated.`,
            }],
            isError: false,
          };
        }
        if (source.isAuthenticated) {
          debug(`[source_slack_oauth_trigger] Source '${args.sourceSlug}' marked as authenticated but no valid token found, triggering re-auth`);
        }

        // Determine service from config for new pattern
        let service: SlackService | undefined;
        const api = source.api;

        if (api?.slackService) {
          service = api.slackService;
        } else {
          service = inferSlackServiceFromUrl(api?.baseUrl) || 'full';
        }

        // Get session callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No auth request handler available. This tool requires a UI to handle OAuth.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: SlackOAuthAuthRequest = {
          type: 'oauth-slack',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          service,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        // The session manager will then run the OAuth flow
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `Slack OAuth requested for '${source.name}'. Opening browser for authentication.`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Slack OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped source_microsoft_oauth_trigger tool.
 * Handles OAuth authentication for Microsoft API sources (Outlook, OneDrive, Calendar, Teams, SharePoint).
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The OAuth flow runs in the background, and the result comes back as a new message.
 */
export function createMicrosoftOAuthTriggerTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_microsoft_oauth_trigger',
    `Trigger Microsoft OAuth authentication flow for a Microsoft API source.

Opens a browser window for the user to sign in with their Microsoft account and authorize access to the specified Microsoft service.
After successful authentication, the tokens are stored and the source is marked as authenticated.

**Supported services:**
- outlook: Read, compose, and manage emails
- calendar: Read and manage calendar events
- onedrive: Read and manage OneDrive files
- teams: Read and send Teams messages
- sharepoint: Read and manage SharePoint sites

**Prerequisites:**
- The source must have provider 'microsoft'
- Microsoft OAuth must be configured in the build

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** while OAuth completes
- A browser window will open for Microsoft sign-in
- Once complete or cancelled, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Returns:**
- Success message if already authenticated
- Authentication request if OAuth flow is triggered`,
    {
      sourceSlug: z.string().describe('The slug of the Microsoft API source to authenticate'),
    },
    async (args) => {
      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

        // Verify this is a Microsoft source
        if (source.provider !== 'microsoft') {
          const hint = !source.provider
            ? `Add "provider": "microsoft" to config.json and retry.`
            : `This source has provider '${source.provider}'. Use source_oauth_trigger for MCP sources, source_google_oauth_trigger for Google sources, or source_slack_oauth_trigger for Slack sources.`;
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is not configured as a Microsoft API source. ${hint}\n\nCurrent config: ${JSON.stringify(source, null, 2)}`,
            }],
            isError: true,
          };
        }

        // Check if source has valid credentials (not just isAuthenticated flag)
        const hasValidToken = await verifySourceHasValidToken(workspaceRootPath, source, args.sourceSlug);
        if (hasValidToken) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is already authenticated.`,
            }],
            isError: false,
          };
        }
        if (source.isAuthenticated) {
          debug(`[source_microsoft_oauth_trigger] Source '${args.sourceSlug}' marked as authenticated but no valid token found, triggering re-auth`);
        }

        // Determine service from config for new pattern
        let service: MicrosoftService | undefined;
        const api = source.api;

        if (api?.microsoftService) {
          service = api.microsoftService;
        } else {
          service = inferMicrosoftServiceFromUrl(api?.baseUrl);
        }

        // Require explicit service configuration if it can't be inferred
        if (!service) {
          return {
            content: [{
              type: 'text' as const,
              text: `Cannot determine Microsoft service for source '${args.sourceSlug}'. Set microsoftService ('outlook', 'microsoft-calendar', 'onedrive', 'teams', or 'sharepoint') in api config.`,
            }],
            isError: true,
          };
        }

        // Get session callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No auth request handler available. This tool requires a UI to handle OAuth.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: MicrosoftOAuthAuthRequest = {
          type: 'oauth-microsoft',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          service,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        // The session manager will then run the OAuth flow
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `Microsoft OAuth requested for '${source.name}'. Opening browser for authentication.`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Microsoft OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Credential Prompt Tool
// ============================================================

/**
 * Create a session-scoped source_credential_prompt tool.
 * Prompts the user to enter credentials for a source via the secure input UI.
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The user completes auth in the UI, and the result comes back as a new message.
 */
export function createCredentialPromptTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_credential_prompt',
    `Prompt the user to enter credentials for a source.

Use this when a source requires authentication that isn't OAuth.
The user will see a secure input UI with appropriate fields based on the auth mode.

**Auth Modes:**
- \`bearer\`: Single token field (Bearer Token, API Key)
- \`basic\`: Username and Password fields
- \`header\`: API Key with custom header name shown
- \`query\`: API Key for query parameter auth
- \`multi-header\`: Multiple header fields (e.g., Datadog's DD-API-KEY + DD-APPLICATION-KEY)

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to show the credential input UI
- Once the user completes or cancels, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Example usage:**
\`\`\`
source_credential_prompt({
  sourceSlug: "my-api",
  mode: "bearer",
  labels: { credential: "API Key" },
  description: "Enter your API key from the dashboard",
  hint: "Find it at https://example.com/settings/api"
})
\`\`\`

**Multi-header example (Datadog):**
\`\`\`
source_credential_prompt({
  sourceSlug: "datadog",
  mode: "multi-header",
  headerNames: ["DD-API-KEY", "DD-APPLICATION-KEY"],
  description: "Enter your Datadog API and Application keys",
  hint: "Get keys from Organization Settings > API Keys and Application Keys"
})
\`\`\``,
    {
      sourceSlug: z.string().describe('The slug of the source to authenticate'),
      mode: z.enum(['bearer', 'basic', 'header', 'query', 'multi-header']).describe('Type of credential input'),
      labels: z.object({
        credential: z.string().optional().describe('Label for primary credential field'),
        username: z.string().optional().describe('Label for username field (basic auth)'),
        password: z.string().optional().describe('Label for password field (basic auth)'),
      }).optional().describe('Custom field labels'),
      description: z.string().optional().describe('Description shown to user'),
      hint: z.string().optional().describe('Hint about where to find credentials'),
      headerNames: z.array(z.string()).optional().describe('Header names for multi-header auth (e.g., ["DD-API-KEY", "DD-APPLICATION-KEY"])'),
      passwordRequired: z.boolean().optional().describe('For basic auth: whether password field is required (default: true)'),
    },
    async (args) => {
      debug('[source_credential_prompt] Requesting credentials:', args.sourceSlug, args.mode);

      // Validate that passwordRequired only applies to basic auth
      if (args.passwordRequired !== undefined && args.mode !== 'basic') {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: passwordRequired parameter only applies to basic auth mode. You specified mode="${args.mode}" with passwordRequired=${args.passwordRequired}.`,
          }],
          isError: true,
        };
      }

      try {
        // Load source to get name and validate
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

        // Get callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No credential input handler available. This tool requires a UI to prompt for credentials.',
            }],
            isError: true,
          };
        }

        // Auto-detect multi-header mode from source config
        // If source has headerNames array, use multi-header mode regardless of what was passed
        const effectiveHeaderNames = getEffectiveHeaderNames(source, args.headerNames);
        const effectiveMode = detectCredentialMode(source, args.mode, args.headerNames);

        // Build auth request
        const authRequest: CredentialAuthRequest = {
          type: 'credential',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          mode: effectiveMode,
          labels: args.labels,
          description: args.description,
          hint: args.hint,
          headerName: source.api?.headerName,
          // For multi-header auth: use provided headerNames or fall back to source config
          headerNames: effectiveHeaderNames,
          // Pass source URL so password managers (1Password) can match stored credentials by domain
          sourceUrl: source.api?.baseUrl || source.mcp?.url,
          passwordRequired: args.passwordRequired,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `Authentication requested for '${source.name}'. Waiting for user input.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_credential_prompt] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error prompting for credentials: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Mermaid Validation Tool
// ============================================================

/**
 * Create the mermaid_validate tool for validating Mermaid diagram syntax.
 *
 * This tool helps the agent verify diagram syntax before outputting complex diagrams.
 * It attempts to parse and optionally render the diagram, returning structured
 * validation results with specific error messages if invalid.
 */
function createMermaidValidateTool() {
  return tool(
    'mermaid_validate',
    `Validate Mermaid diagram syntax before outputting.

Use this when:
- Creating complex diagrams with many nodes/relationships
- Unsure about syntax for a specific diagram type
- Debugging a diagram that failed to render

Returns validation result with specific error messages if invalid.`,
    {
      code: z.string().describe('The mermaid diagram code to validate'),
      render: z.boolean().optional().describe('Also attempt to render (catches layout errors). Default: true'),
    },
    async (args) => {
      const { code, render = true } = args;

      try {
        // Attempt to render the diagram (this parses + layouts, catching most errors)
        if (render) {
          await renderMermaid(code);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              valid: true,
              message: 'Diagram syntax is valid' + (render ? ' and renders successfully' : ''),
            }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              valid: false,
              error: message,
              suggestion: `Check the syntax against ${DOC_REFS.mermaid}`,
            }, null, 2),
          }],
        };
      }
    }
  );
}

// ============================================================
// fal.ai Image Generation
// ============================================================

/**
 * fal.ai API response structure (common across models)
 */
interface FalImageResponse {
  images: Array<{
    url: string;
    content_type?: string;
    width?: number;
    height?: number;
  }>;
  seed?: number;
  description?: string;
}

/**
 * Convert a local file path to a data URI for fal.ai API
 */
async function fileToDataUri(filePath: string): Promise<string> {
  const absolutePath = filePath.startsWith('~')
    ? filePath.replace('~', process.env.HOME || '')
    : filePath;

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const fileBuffer = readFileSync(absolutePath);
  const base64 = fileBuffer.toString('base64');

  // Determine mime type from extension
  const ext = absolutePath.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'gif': 'image/gif',
  };
  const mimeType = mimeTypes[ext || 'png'] || 'image/png';

  return `data:${mimeType};base64,${base64}`;
}

/**
 * Generate an image using fal.ai API.
 * Supports multiple models: Ideogram V3, Imagen 4, Reve, Gemini via fal.ai
 * Now supports style reference images for compatible models.
 */
async function generateWithFal(
  prompt: string,
  model: ImageModel,
  aspectRatio: string,
  filename: string | undefined,
  sessionId: string,
  workspaceRootPath: string,
  styleReferenceImagePath?: string
): Promise<{
  success: boolean;
  imagePath?: string;
  filename?: string;
  error?: string;
  cost: number;
  model: string;
  usedStyleReference?: boolean;
}> {
  const manager = getCredentialManager();
  const apiKey = await manager.getFalApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: 'fal.ai API key not configured. Ask the user to add their fal.ai API key in Settings > App > Integrations.',
      cost: 0,
      model: model.id,
    };
  }

  if (!model.falEndpoint) {
    return {
      success: false,
      error: `Model ${model.id} does not have a fal.ai endpoint configured.`,
      cost: 0,
      model: model.id,
    };
  }

  // Check if style reference is requested but not supported
  if (styleReferenceImagePath && !model.referenceCapabilities?.styleReference) {
    return {
      success: false,
      error: `Model ${model.name} does not support style reference. Use one of: Ideogram V3, Reve, or Gemini.`,
      cost: 0,
      model: model.id,
    };
  }

  // Convert style reference image to data URI if provided
  let styleReferenceDataUri: string | undefined;
  if (styleReferenceImagePath) {
    try {
      styleReferenceDataUri = await fileToDataUri(styleReferenceImagePath);
      debug(`[generateWithFal] Using style reference image: ${styleReferenceImagePath}`);
    } catch (error) {
      return {
        success: false,
        error: `Failed to read style reference image: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cost: 0,
        model: model.id,
      };
    }
  }

  debug(`[generateWithFal] Generating with ${model.id}: ${prompt.substring(0, 100)}...`);

  // Build request body based on model type
  let requestBody: Record<string, unknown>;

  if (model.falEndpoint.includes('ideogram')) {
    // Ideogram V3 uses image_size and rendering_speed
    // NOTE: expand_prompt (MagicPrompt) is set to false to avoid double billing
    // When expand_prompt is true, fal.ai charges for both prompt expansion AND image generation
    requestBody = {
      prompt,
      image_size: mapAspectRatioToIdeogram(aspectRatio),
      num_images: 1,
      expand_prompt: false,
      ...model.falParams,
    };

    // Add style reference for Ideogram (uses image_urls parameter)
    if (styleReferenceDataUri) {
      requestBody.image_urls = [styleReferenceDataUri];
    }
  } else if (model.falEndpoint.includes('reve')) {
    // Reve uses aspect_ratio directly and supports image_urls for reference
    requestBody = {
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
      output_format: 'png',
    };

    // Add style reference for Reve (uses image_urls parameter, supports up to 6!)
    if (styleReferenceDataUri) {
      requestBody.image_urls = [styleReferenceDataUri];
    }
  } else if (model.falEndpoint.includes('gemini')) {
    // Gemini via fal uses aspect_ratio and supports image_urls
    requestBody = {
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
      output_format: 'png',
    };

    // Add style reference for Gemini
    if (styleReferenceDataUri) {
      requestBody.image_urls = [styleReferenceDataUri];
    }
  } else {
    // Imagen 4 - does NOT support style reference
    requestBody = {
      prompt,
      aspect_ratio: aspectRatio,
      num_images: 1,
      output_format: 'png',
    };
  }

  try {
    const response = await fetch(
      `https://fal.run/${model.falEndpoint}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      debug(`[generateWithFal] API error: ${response.status} - ${errorText}`);

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: 'fal.ai API key is invalid or lacks permissions. Check your API key in Settings > App > Integrations.',
          cost: 0,
          model: model.id,
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: 'fal.ai rate limit exceeded. Please wait a moment and try again.',
          cost: 0,
          model: model.id,
        };
      }

      // Try to parse error message
      try {
        const errorJson = JSON.parse(errorText);
        const errorMessage = errorJson.detail || errorJson.error?.message || errorText;
        return {
          success: false,
          error: `fal.ai error: ${errorMessage}`,
          cost: 0,
          model: model.id,
        };
      } catch {
        return {
          success: false,
          error: `fal.ai API error (${response.status}): ${errorText}`,
          cost: 0,
          model: model.id,
        };
      }
    }

    const data = await response.json() as FalImageResponse;
    const firstImage = data.images?.[0];

    if (!firstImage?.url) {
      return {
        success: false,
        error: 'No image was generated. The model may have declined the request.',
        cost: 0,
        model: model.id,
      };
    }

    // Download the image from the URL
    const imageUrl = firstImage.url;
    debug(`[generateWithFal] Downloading image from: ${imageUrl}`);

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return {
        success: false,
        error: `Failed to download generated image: ${imageResponse.status}`,
        cost: model.cost,
        model: model.id,
      };
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Determine extension from content type or URL
    const contentType = firstImage.content_type || imageResponse.headers.get('content-type') || 'image/png';
    const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let baseFilename = filename || `image-${timestamp}`;
    baseFilename = baseFilename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
    const imageFilename = `${baseFilename}.${extension}`;

    // Create images directory in session folder
    const sessionPath = getSessionPath(workspaceRootPath, sessionId);
    const imagesDir = join(sessionPath, 'images');
    mkdirSync(imagesDir, { recursive: true });

    // Save the image
    const imagePath = join(imagesDir, imageFilename);
    writeFileSync(imagePath, imageBuffer);

    debug(`[generateWithFal] Image saved to: ${imagePath}`);

    return {
      success: true,
      imagePath,
      filename: imageFilename,
      cost: model.cost,
      model: model.id,
      usedStyleReference: !!styleReferenceImagePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    debug(`[generateWithFal] Error: ${message}`);
    return {
      success: false,
      error: `fal.ai generation failed: ${message}`,
      cost: 0,
      model: model.id,
    };
  }
}

// ============================================================
// Gemini Image Generation Tool (Direct Google API)
// ============================================================

/**
 * Gemini image generation API response structure
 */
interface GeminiImageResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string; // base64
        };
      }>;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Create a session-scoped gemini_generate_image tool.
 * Generates images using Google Gemini's image generation models and saves them to the session folder.
 */
export function createGeminiImageTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'gemini_generate_image',
    `Generate an image using Google Gemini 3 Pro Image (best quality model for social media).

Use this tool to create images for social media posts, marketing materials,
or visual content. Provide a detailed prompt describing the desired image.

**Tips for good prompts:**
- Be specific about style (photorealistic, illustration, flat design)
- Specify lighting, colors, composition
- Include camera/perspective details if relevant
- Mention what should NOT be in the image
- Describe the mood/atmosphere you want

**Aspect ratios:**
- 1:1 (square) - Instagram feed, LinkedIn
- 16:9 (landscape) - Twitter, YouTube thumbnails
- 9:16 (portrait) - Instagram Stories, TikTok

**Cost:** ~$0.13-0.24 per image depending on resolution:
- 1K/2K (up to 2048x2048): ~$0.13 per image
- 4K (up to 4096x4096): ~$0.24 per image

**IMPORTANT:** Always show the cost estimate to the user before AND after generating images.

The generated image will be saved to the session's images folder and can be displayed inline.`,
    {
      prompt: z.string().describe('Detailed image prompt describing the desired image. Be specific about style, lighting, composition, and mood.'),
      aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4'])
        .optional()
        .describe('Image aspect ratio. Default: 1:1 (square)'),
      filename: z.string()
        .optional()
        .describe('Optional filename (without extension) for the saved image. Default: auto-generated timestamp'),
    },
    async (args) => {
      const { prompt, aspect_ratio = '1:1', filename } = args;
      debug(`[gemini_generate_image] Generating image with prompt: ${prompt.substring(0, 100)}...`);

      try {
        const manager = getCredentialManager();
        const apiKey = await manager.getGeminiApiKey();

        if (!apiKey) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Gemini API key not configured. Ask the user to add their Google Gemini API key in Settings > App > Integrations.',
            }],
            isError: true,
          };
        }

        // Call Gemini image generation API
        // Using gemini-3-pro-image-preview model (best quality for social media)
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: prompt,
                    },
                  ],
                },
              ],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
              },
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          debug(`[gemini_generate_image] API error: ${response.status} - ${errorText}`);

          if (response.status === 401 || response.status === 403) {
            return {
              content: [{
                type: 'text' as const,
                text: 'Gemini API key is invalid or lacks permissions for image generation. Ask the user to check their API key in Settings > App > Integrations.',
              }],
              isError: true,
            };
          }

          if (response.status === 429) {
            return {
              content: [{
                type: 'text' as const,
                text: 'Gemini API rate limit exceeded. Please wait a moment and try again.',
              }],
              isError: true,
            };
          }

          if (response.status === 400) {
            // Parse error for more helpful message
            try {
              const errorJson = JSON.parse(errorText);
              const errorMessage = errorJson.error?.message || errorText;
              return {
                content: [{
                  type: 'text' as const,
                  text: `Gemini image generation failed: ${errorMessage}\n\nTry simplifying the prompt or removing any potentially blocked content.`,
                }],
                isError: true,
              };
            } catch {
              // Fall through to generic error
            }
          }

          return {
            content: [{
              type: 'text' as const,
              text: `Gemini API error (${response.status}): ${errorText}`,
            }],
            isError: true,
          };
        }

        const data = await response.json() as GeminiImageResponse;

        // Find the image part in the response
        const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

        if (!imagePart?.inlineData) {
          // Check if there's a text response explaining why no image was generated
          const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text);
          const explanation = textPart?.text || 'No image was generated. The model may have declined the request.';

          return {
            content: [{
              type: 'text' as const,
              text: `Image generation failed: ${explanation}\n\nTry adjusting the prompt to be more specific or less restricted.`,
            }],
            isError: true,
          };
        }

        const base64Data = imagePart.inlineData.data;
        const mimeType = imagePart.inlineData.mimeType;
        const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'png';

        // Generate filename - strip any existing extension from user-provided filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        let baseFilename = filename || `image-${timestamp}`;
        // Remove common image extensions if user accidentally included them
        baseFilename = baseFilename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
        const imageFilename = `${baseFilename}.${extension}`;

        // Create images directory in session folder
        const sessionPath = getSessionPath(workspaceRootPath, sessionId);
        const imagesDir = join(sessionPath, 'images');
        mkdirSync(imagesDir, { recursive: true });

        // Save the image
        const imagePath = join(imagesDir, imageFilename);
        writeFileSync(imagePath, Buffer.from(base64Data, 'base64'));

        debug(`[gemini_generate_image] Image saved to: ${imagePath}`);

        // Return success with image path and cost information
        // The image can be displayed inline in the chat using markdown: ![Image](path)
        // Gemini 3 Pro Image pricing: ~$0.13 for 1K/2K, ~$0.24 for 4K
        const estimatedCost = 0.13; // Conservative estimate (1K/2K resolution)
        const result = {
          success: true,
          imagePath,
          filename: imageFilename,
          aspectRatio: aspect_ratio,
          prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
          displayMarkdown: `![Generated Image](${imagePath})`,
          cost: {
            estimated: estimatedCost,
            currency: 'USD',
            model: 'gemini-3-pro-image-preview',
            note: 'Cost varies by resolution: ~$0.13 (1K/2K) or ~$0.24 (4K)',
          },
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        debug(`[gemini_generate_image] Error: ${message}`);
        return {
          content: [{
            type: 'text' as const,
            text: `Gemini image generation failed: ${message}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped open_images_folder tool.
 * Opens the session's images folder in the system file manager (Finder on macOS).
 */
export function createOpenImagesFolderTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'open_images_folder',
    `Open the images folder for this session in the system file manager (Finder on Mac, Explorer on Windows).

Use this when the user wants to:
- View generated images directly in their file manager
- Copy images to another location
- Open images in an external editor
- Access all images from this session

The images folder is located at: ~/.craft-agent/workspaces/{workspace}/sessions/{session}/images/`,
    {},
    async () => {
      debug(`[open_images_folder] Opening images folder for session ${sessionId}`);

      try {
        // Build the images folder path
        const sessionPath = getSessionPath(workspaceRootPath, sessionId);
        const imagesPath = join(sessionPath, 'images');

        // Ensure the folder exists
        if (!existsSync(imagesPath)) {
          mkdirSync(imagesPath, { recursive: true });
        }

        // Open in system file manager based on platform
        const platform = process.platform;
        let command: string;

        if (platform === 'darwin') {
          // macOS: Use 'open' command
          command = `open "${imagesPath}"`;
        } else if (platform === 'win32') {
          // Windows: Use 'explorer' command
          command = `explorer "${imagesPath.replace(/\//g, '\\')}"`;
        } else {
          // Linux: Try xdg-open
          command = `xdg-open "${imagesPath}"`;
        }

        // Execute the command
        await new Promise<void>((resolve, reject) => {
          exec(command, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });

        debug(`[open_images_folder] Successfully opened: ${imagesPath}`);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              path: imagesPath,
              message: 'Opened images folder in file manager',
            }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        debug(`[open_images_folder] Error: ${message}`);
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to open images folder: ${message}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Unified Image Generation Tool
// ============================================================

/**
 * Create a session-scoped generate_image tool.
 * Unified tool that supports multiple image generation models via fal.ai and direct Google API.
 * Includes automatic text analysis and platform-specific prompt enhancement.
 */
export function createUnifiedImageTool(sessionId: string, workspaceRootPath: string) {
  // Build model list for description
  const modelListForDescription = formatModelsByUseCase();
  const referenceCapabilitiesInfo = formatReferenceCapabilities();

  return tool(
    'generate_image',
    `Generate an image using various AI models. Supports multiple providers and quality tiers.

**Available Models:**
${modelListForDescription}

**Default:** ${DEFAULT_MODEL} (best balance of quality and cost for most use cases)

**Model Selection Guide:**
- Text-heavy posts (quotes, announcements, CTAs): Use ideogram models
- Visual posts (products, lifestyle, photos): Use imagen models
- Quick drafts/iterations: Use reve (cheapest)
- Complex scenes/illustrations: Use gemini-direct
- HEAVY TEXT (16+ words) or complex text: Use gemini-direct or gemini-fal (REQUIRED for good text rendering)

**STYLE REFERENCE (NEW!):**
You can pass a reference image to match its style! Use the 'style_reference_image' parameter with a path to an existing image.
The new image will be generated to match the visual style of the reference.

${referenceCapabilitiesInfo}

**TEXT ANALYSIS:**
The tool automatically analyzes your prompt for text content:
- Text-free: No text detected → imagen-4-ultra recommended
- Minimal (1-5 words): → ideogram-v3-balanced recommended
- Moderate (6-15 words): → ideogram-v3-quality recommended
- Heavy (16+ words): → gemini required (WARNING if not selected)
- Complex (quotes, multi-line): → gemini-direct required

**Platform Support:**
Pass the 'platform' parameter to automatically apply platform-specific design guidelines:
- linkedin: Professional, muted colors, minimal text
- instagram: Vibrant, bold, eye-catching
- twitter: High-impact, minimal, center-focused
- tiktok: Bright, vertical, thumbnail-optimized
- facebook: Warm, community-focused

**Aspect Ratios:**
- 1:1 (square) - Instagram feed, LinkedIn
- 16:9 (landscape) - Twitter, YouTube thumbnails
- 9:16 (portrait) - Instagram Stories, TikTok
- 4:3 / 3:4 - Standard photo ratios

**IMPORTANT:** Always show the cost estimate to the user before AND after generating images.

The generated image will be saved to the session's images folder and can be displayed inline.`,
    {
      prompt: z.string().describe('Detailed image prompt describing the desired image. Be specific about style, lighting, composition, and mood.'),
      model: z.enum(IMAGE_MODEL_IDS as [string, ...string[]])
        .optional()
        .describe(`Model to use for generation. Default: ${DEFAULT_MODEL}. IMPORTANT: For prompts with 16+ words of text to render, use gemini-direct or gemini-fal.`),
      aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4'])
        .optional()
        .describe('Image aspect ratio. Default: 1:1 (square)'),
      platform: z.enum(['linkedin', 'instagram', 'twitter', 'tiktok', 'facebook', 'general'])
        .optional()
        .describe('Target platform for automatic style optimization. Applies platform-specific colors, mood, and design guidelines to the prompt.'),
      filename: z.string()
        .optional()
        .describe('Optional filename (without extension) for the saved image. Default: auto-generated timestamp'),
      style_reference_image: z.string()
        .optional()
        .describe('Path to an image to use as style reference. The generated image will match this visual style. Supported by: Ideogram V3, Reve (up to 6 refs!), Gemini. NOT supported by: Imagen 4.'),
    },
    async (args) => {
      const { prompt: rawPrompt, model: modelId = DEFAULT_MODEL, aspect_ratio = '1:1', platform, filename, style_reference_image } = args;

      // Step 1: Analyze prompt for text content
      const textAnalysis = analyzePromptForText(rawPrompt);
      debug(`[generate_image] Text analysis: density=${textAnalysis.density}, words=${textAnalysis.wordCount}, recommended=${textAnalysis.recommendedModel}`);

      // Step 2: Check if selected model is appropriate for text content
      const modelCheck = checkModelForText(modelId, textAnalysis);
      let warnings: string[] = [];

      if (!modelCheck.isAppropriate && modelCheck.warning) {
        warnings.push(modelCheck.warning);
        debug(`[generate_image] Model warning: ${modelCheck.warning}`);
      }

      if (textAnalysis.warning) {
        warnings.push(textAnalysis.warning);
      }

      // Step 3: Enhance prompt with platform guidelines if specified
      let enhancedPrompt = rawPrompt;
      let platformInfo: string | undefined;

      if (platform) {
        const guidelines = getPlatformGuidelines(platform);
        enhancedPrompt = enhancePromptForPlatform(rawPrompt, platform, {
          includePrefix: true,
          includeSuffix: true,
          aspectRatio: aspect_ratio,
        });
        platformInfo = `Platform: ${platform} (${guidelines.mood})`;
        debug(`[generate_image] Enhanced prompt for ${platform}: ${enhancedPrompt.substring(0, 150)}...`);
      } else {
        // Add aspect ratio prefix if not already present
        const arPrefix = getAspectRatioPrefix(aspect_ratio);
        if (!rawPrompt.toLowerCase().includes('aspect ratio') && !rawPrompt.toLowerCase().includes('format')) {
          enhancedPrompt = `${arPrefix} ${rawPrompt}`;
        }
        // Add no-mockup instruction
        enhancedPrompt = `${enhancedPrompt} NO text labels, NO mockup frames, NO canvas borders - just the direct social media post image.`;
      }

      // Step 4: Add text-specific instructions
      enhancedPrompt = addTextInstructions(enhancedPrompt, textAnalysis);

      const model = getImageModel(modelId);

      if (!model) {
        return {
          content: [{
            type: 'text' as const,
            text: `Unknown model: ${modelId}. Available models: ${IMAGE_MODEL_IDS.join(', ')}`,
          }],
          isError: true,
        };
      }

      debug(`[generate_image] Generating with ${model.id} (${model.provider}): ${enhancedPrompt.substring(0, 100)}...`);

      // Route to appropriate provider
      if (model.provider === 'fal') {
        // Use fal.ai for this model (with optional style reference)
        const result = await generateWithFal(
          enhancedPrompt,
          model,
          aspect_ratio,
          filename,
          sessionId,
          workspaceRootPath,
          style_reference_image
        );

        if (!result.success) {
          return {
            content: [{
              type: 'text' as const,
              text: result.error || 'Image generation failed',
            }],
            isError: true,
          };
        }

        // Build response with text analysis info
        const response: Record<string, unknown> = {
          success: true,
          imagePath: result.imagePath,
          filename: result.filename,
          aspectRatio: aspect_ratio,
          prompt: enhancedPrompt.substring(0, 200) + (enhancedPrompt.length > 200 ? '...' : ''),
          displayMarkdown: `![Generated Image](${result.imagePath})`,
          cost: {
            estimated: result.cost,
            currency: 'USD',
            model: model.id,
            modelName: model.name,
            provider: 'fal.ai',
          },
          textAnalysis: {
            density: textAnalysis.density,
            wordCount: textAnalysis.wordCount,
            recommendedModel: textAnalysis.recommendedModel,
          },
        };

        // Add style reference info if used
        if (result.usedStyleReference) {
          response.styleReference = {
            used: true,
            sourceImage: style_reference_image,
          };
        }

        // Add platform info if provided
        if (platformInfo) {
          response.platform = platformInfo;
        }

        // Add warnings if any
        if (warnings.length > 0) {
          response.warnings = warnings;
        }

        // Add suggestion if model mismatch
        if (modelCheck.suggestedModel) {
          response.suggestedModel = modelCheck.suggestedModel;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          }],
        };
      } else {
        // Use direct Google API for gemini-direct
        // This reuses the existing Gemini direct implementation logic
        const manager = getCredentialManager();
        const apiKey = await manager.getGeminiApiKey();

        if (!apiKey) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Gemini API key not configured. Ask the user to add their Google Gemini API key in Settings > App > Integrations.',
            }],
            isError: true,
          };
        }

        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: enhancedPrompt,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  responseModalities: ['TEXT', 'IMAGE'],
                },
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            debug(`[generate_image] Gemini API error: ${response.status} - ${errorText}`);

            if (response.status === 401 || response.status === 403) {
              return {
                content: [{
                  type: 'text' as const,
                  text: 'Gemini API key is invalid or lacks permissions. Check your API key in Settings > App > Integrations.',
                }],
                isError: true,
              };
            }

            if (response.status === 429) {
              return {
                content: [{
                  type: 'text' as const,
                  text: 'Gemini API rate limit exceeded. Please wait a moment and try again.',
                }],
                isError: true,
              };
            }

            return {
              content: [{
                type: 'text' as const,
                text: `Gemini API error (${response.status}): ${errorText}`,
              }],
              isError: true,
            };
          }

          const data = await response.json() as GeminiImageResponse;
          const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

          if (!imagePart?.inlineData) {
            const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text);
            const explanation = textPart?.text || 'No image was generated.';
            return {
              content: [{
                type: 'text' as const,
                text: `Image generation failed: ${explanation}`,
              }],
              isError: true,
            };
          }

          const base64Data = imagePart.inlineData.data;
          const mimeType = imagePart.inlineData.mimeType;
          const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'png';

          // Generate filename
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          let baseFilename = filename || `image-${timestamp}`;
          baseFilename = baseFilename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
          const imageFilename = `${baseFilename}.${extension}`;

          // Create images directory
          const sessionPath = getSessionPath(workspaceRootPath, sessionId);
          const imagesDir = join(sessionPath, 'images');
          mkdirSync(imagesDir, { recursive: true });

          // Save the image
          const imagePath = join(imagesDir, imageFilename);
          writeFileSync(imagePath, Buffer.from(base64Data, 'base64'));

          debug(`[generate_image] Image saved to: ${imagePath}`);

          // Build response with text analysis info
          const geminiResponse: Record<string, unknown> = {
            success: true,
            imagePath,
            filename: imageFilename,
            aspectRatio: aspect_ratio,
            prompt: enhancedPrompt.substring(0, 200) + (enhancedPrompt.length > 200 ? '...' : ''),
            displayMarkdown: `![Generated Image](${imagePath})`,
            cost: {
              estimated: model.cost,
              currency: 'USD',
              model: model.id,
              modelName: model.name,
              provider: 'Google Direct',
              note: 'Cost varies by resolution: ~$0.13 (1K/2K) or ~$0.24 (4K)',
            },
            textAnalysis: {
              density: textAnalysis.density,
              wordCount: textAnalysis.wordCount,
              recommendedModel: textAnalysis.recommendedModel,
              note: 'Gemini selected - excellent choice for text rendering',
            },
          };

          // Add platform info if provided
          if (platformInfo) {
            geminiResponse.platform = platformInfo;
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(geminiResponse, null, 2),
            }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          debug(`[generate_image] Gemini error: ${message}`);
          return {
            content: [{
              type: 'text' as const,
              text: `Image generation failed: ${message}`,
            }],
            isError: true,
          };
        }
      }
    }
  );
}

/**
 * Create a session-scoped remix_image tool.
 * Transforms an existing image based on a prompt while maintaining visual similarity.
 */
export function createRemixImageTool(sessionId: string, workspaceRootPath: string) {
  const modelsWithRemix = getModelsWithRemix();
  const modelIds = modelsWithRemix.map(m => m.id);

  return tool(
    'remix_image',
    `Transform an existing image based on a prompt. This keeps the overall composition but applies changes.

**Use this when the user wants to:**
- "Make changes to this image"
- "Transform this into..."
- "Keep this but make it more..."
- "Same composition, different style"

**Models that support remix:**
${modelsWithRemix.map(m => `- ${m.name}${m.referenceCapabilities?.supportsStrength ? ' (supports strength control)' : ''}`).join('\n')}

**Strength parameter:**
- 0.1-0.3: Subtle changes, very close to original
- 0.4-0.6: Moderate transformation
- 0.7-0.9: Significant changes, may deviate from original
- Default: 0.8

**IMPORTANT:** This creates a NEW image inspired by the source. It cannot perfectly preserve every detail.
For precise edits, recommend Canva instead.`,
    {
      source_image: z.string().describe('Path to the image to transform (must be in session images folder or absolute path)'),
      prompt: z.string().describe('Description of how to transform the image'),
      model: z.enum(modelIds as [string, ...string[]])
        .optional()
        .describe('Model to use. Default: ideogram-v3-balanced'),
      strength: z.number()
        .min(0.1)
        .max(1.0)
        .optional()
        .describe('How much to transform (0.1=subtle, 1.0=major changes). Default: 0.8'),
      aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4'])
        .optional()
        .describe('Output aspect ratio. Default: matches source image if possible'),
      filename: z.string()
        .optional()
        .describe('Optional filename for the output'),
    },
    async (args) => {
      const {
        source_image,
        prompt,
        model: modelId = 'ideogram-v3-balanced',
        strength = 0.8,
        aspect_ratio = '1:1',
        filename
      } = args;

      const model = getImageModel(modelId);
      if (!model) {
        return {
          content: [{ type: 'text' as const, text: `Unknown model: ${modelId}` }],
          isError: true,
        };
      }

      if (!model.referenceCapabilities?.remix) {
        return {
          content: [{ type: 'text' as const, text: `Model ${model.name} does not support remix. Use one of: ${modelIds.join(', ')}` }],
          isError: true,
        };
      }

      const remixEndpoint = model.referenceCapabilities.remixEndpoint;
      if (!remixEndpoint) {
        return {
          content: [{ type: 'text' as const, text: `Model ${model.name} does not have a remix endpoint configured.` }],
          isError: true,
        };
      }

      // Get API key
      const manager = getCredentialManager();
      const apiKey = await manager.getFalApiKey();
      if (!apiKey) {
        return {
          content: [{ type: 'text' as const, text: 'fal.ai API key not configured. Add it in Settings > App > Integrations.' }],
          isError: true,
        };
      }

      // Convert source image to data URI
      let sourceDataUri: string;
      try {
        sourceDataUri = await fileToDataUri(source_image);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to read source image: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }

      debug(`[remix_image] Remixing with ${model.id}, strength=${strength}: ${prompt.substring(0, 100)}...`);

      // Build request body for remix
      const requestBody: Record<string, unknown> = {
        prompt,
        image_url: sourceDataUri,
        num_images: 1,
      };

      // Add strength if supported
      if (model.referenceCapabilities.supportsStrength) {
        requestBody.strength = strength;
      }

      // Add aspect ratio / image size
      if (remixEndpoint.includes('ideogram')) {
        requestBody.image_size = mapAspectRatioToIdeogram(aspect_ratio);
        requestBody.rendering_speed = model.falParams?.rendering_speed || 'BALANCED';
      } else {
        requestBody.aspect_ratio = aspect_ratio;
      }

      try {
        const response = await fetch(`https://fal.run/${remixEndpoint}`, {
          method: 'POST',
          headers: {
            'Authorization': `Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [{ type: 'text' as const, text: `Remix failed: ${errorText}` }],
            isError: true,
          };
        }

        const data = await response.json() as { images?: Array<{ url: string; content_type?: string }> };
        const firstImage = data.images?.[0];

        if (!firstImage?.url) {
          return {
            content: [{ type: 'text' as const, text: 'No image was generated.' }],
            isError: true,
          };
        }

        // Download and save the image
        const imageResponse = await fetch(firstImage.url);
        if (!imageResponse.ok) {
          return {
            content: [{ type: 'text' as const, text: `Failed to download generated image: ${imageResponse.status}` }],
            isError: true,
          };
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const contentType = firstImage.content_type || imageResponse.headers.get('content-type') || 'image/png';
        const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        let baseFilename = filename || `remix-${timestamp}`;
        baseFilename = baseFilename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
        const imageFilename = `${baseFilename}.${extension}`;

        const sessionPath = getSessionPath(workspaceRootPath, sessionId);
        const imagesDir = join(sessionPath, 'images');
        mkdirSync(imagesDir, { recursive: true });

        const imagePath = join(imagesDir, imageFilename);
        writeFileSync(imagePath, imageBuffer);

        debug(`[remix_image] Image saved to: ${imagePath}`);

        const result = {
          success: true,
          imagePath,
          filename: imageFilename,
          displayMarkdown: `![Remixed Image](${imagePath})`,
          sourceImage: source_image,
          strength,
          cost: {
            estimated: model.cost,
            currency: 'USD',
            model: model.id,
            modelName: model.name,
          },
          note: 'This is a NEW image inspired by the source. For precise edits, use Canva.',
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        debug(`[remix_image] Error: ${message}`);
        return {
          content: [{ type: 'text' as const, text: `Remix failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped edit_image tool.
 * Edit specific regions of an image using inpainting with a mask.
 */
export function createEditImageTool(sessionId: string, workspaceRootPath: string) {
  const modelsWithEdit = getModelsWithEdit();
  const modelIds = modelsWithEdit.map(m => m.id);

  return tool(
    'edit_image',
    `Edit specific regions of an image using inpainting. This allows precise modifications to parts of an image.

**Use this when the user wants to:**
- "Change the text on this image"
- "Replace the background"
- "Remove this element"
- "Change just this part"

**Models that support editing:**
${modelsWithEdit.map(m => `- ${m.name}`).join('\n')}

**Mask requirement:**
You need a mask image that indicates which regions to edit:
- WHITE areas (255) = regions to EDIT/REPLACE
- BLACK areas (0) = regions to KEEP unchanged

**If no mask is provided:** The entire image will be reimagined based on the prompt.

**IMPORTANT:** For best results, the mask should be the same dimensions as the source image.`,
    {
      source_image: z.string().describe('Path to the image to edit'),
      edit_prompt: z.string().describe('Description of what to put in the masked/edited region'),
      mask_image: z.string()
        .optional()
        .describe('Path to mask image (white=edit, black=keep). If not provided, will edit the entire image.'),
      model: z.enum(modelIds as [string, ...string[]])
        .optional()
        .describe('Model to use. Default: ideogram-v3-balanced'),
      filename: z.string()
        .optional()
        .describe('Optional filename for the output'),
    },
    async (args) => {
      const {
        source_image,
        edit_prompt,
        mask_image,
        model: modelId = 'ideogram-v3-balanced',
        filename
      } = args;

      const model = getImageModel(modelId);
      if (!model) {
        return {
          content: [{ type: 'text' as const, text: `Unknown model: ${modelId}` }],
          isError: true,
        };
      }

      if (!model.referenceCapabilities?.edit) {
        return {
          content: [{ type: 'text' as const, text: `Model ${model.name} does not support editing. Use one of: ${modelIds.join(', ')}` }],
          isError: true,
        };
      }

      const editEndpoint = model.referenceCapabilities.editEndpoint;
      if (!editEndpoint) {
        return {
          content: [{ type: 'text' as const, text: `Model ${model.name} does not have an edit endpoint configured.` }],
          isError: true,
        };
      }

      // Get API key
      const manager = getCredentialManager();
      const apiKey = await manager.getFalApiKey();
      if (!apiKey) {
        return {
          content: [{ type: 'text' as const, text: 'fal.ai API key not configured. Add it in Settings > App > Integrations.' }],
          isError: true,
        };
      }

      // Convert source image to data URI
      let sourceDataUri: string;
      try {
        sourceDataUri = await fileToDataUri(source_image);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to read source image: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }

      // Convert mask image if provided
      let maskDataUri: string | undefined;
      if (mask_image) {
        try {
          maskDataUri = await fileToDataUri(mask_image);
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `Failed to read mask image: ${error instanceof Error ? error.message : 'Unknown error'}` }],
            isError: true,
          };
        }
      }

      debug(`[edit_image] Editing with ${model.id}: ${edit_prompt.substring(0, 100)}...`);

      // Build request body for edit/inpaint
      const requestBody: Record<string, unknown> = {
        prompt: edit_prompt,
        image_url: sourceDataUri,
        num_images: 1,
      };

      // Add mask if provided
      if (maskDataUri) {
        requestBody.mask_url = maskDataUri;
      }

      // Add model-specific params
      if (editEndpoint.includes('ideogram')) {
        requestBody.rendering_speed = model.falParams?.rendering_speed || 'BALANCED';
        requestBody.expand_prompt = false;
      }

      try {
        const response = await fetch(`https://fal.run/${editEndpoint}`, {
          method: 'POST',
          headers: {
            'Authorization': `Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [{ type: 'text' as const, text: `Edit failed: ${errorText}` }],
            isError: true,
          };
        }

        const data = await response.json() as { images?: Array<{ url: string; content_type?: string }> };
        const firstImage = data.images?.[0];

        if (!firstImage?.url) {
          return {
            content: [{ type: 'text' as const, text: 'No image was generated.' }],
            isError: true,
          };
        }

        // Download and save the image
        const imageResponse = await fetch(firstImage.url);
        if (!imageResponse.ok) {
          return {
            content: [{ type: 'text' as const, text: `Failed to download generated image: ${imageResponse.status}` }],
            isError: true,
          };
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const contentType = firstImage.content_type || imageResponse.headers.get('content-type') || 'image/png';
        const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        let baseFilename = filename || `edited-${timestamp}`;
        baseFilename = baseFilename.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
        const imageFilename = `${baseFilename}.${extension}`;

        const sessionPath = getSessionPath(workspaceRootPath, sessionId);
        const imagesDir = join(sessionPath, 'images');
        mkdirSync(imagesDir, { recursive: true });

        const imagePath = join(imagesDir, imageFilename);
        writeFileSync(imagePath, imageBuffer);

        debug(`[edit_image] Image saved to: ${imagePath}`);

        const result = {
          success: true,
          imagePath,
          filename: imageFilename,
          displayMarkdown: `![Edited Image](${imagePath})`,
          sourceImage: source_image,
          maskUsed: !!mask_image,
          cost: {
            estimated: model.cost,
            currency: 'USD',
            model: model.id,
            modelName: model.name,
          },
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        debug(`[edit_image] Error: ${message}`);
        return {
          content: [{ type: 'text' as const, text: `Edit failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Session-Scoped Tools Provider
// ============================================================

/**
 * Cache of session-scoped tool providers, keyed by sessionId.
 */
const sessionScopedToolsCache = new Map<string, ReturnType<typeof createSdkMcpServer>>();

/**
 * Get the session-scoped tools provider for a session.
 * Creates and caches the provider if it doesn't exist.
 *
 * @param sessionId - Unique session identifier
 * @param workspaceRootPath - Absolute path to workspace folder (e.g., ~/.craft-agent/workspaces/xxx)
 */
export function getSessionScopedTools(sessionId: string, workspaceRootPath: string): ReturnType<typeof createSdkMcpServer> {
  const cacheKey = `${sessionId}::${workspaceRootPath}`;
  let cached = sessionScopedToolsCache.get(cacheKey);
  if (!cached) {
    // Create session-scoped tools that capture the sessionId and workspaceRootPath in their closures
    // Note: Source CRUD is done via standard file editing tools (Read/Write/Edit).
    // See ~/.craft-agent/docs/ for config format documentation.
    cached = createSdkMcpServer({
      name: 'session',
      version: '1.0.0',
      tools: [
        createSubmitPlanTool(sessionId),
        // Config validation tool
        createConfigValidateTool(sessionId, workspaceRootPath),
        // Skill validation tool
        createSkillValidateTool(sessionId, workspaceRootPath),
        // Mermaid diagram validation tool
        createMermaidValidateTool(),
        // Source tools: test + auth only (CRUD via file editing)
        createSourceTestTool(sessionId, workspaceRootPath),
        createOAuthTriggerTool(sessionId, workspaceRootPath),
        createGoogleOAuthTriggerTool(sessionId, workspaceRootPath),
        createSlackOAuthTriggerTool(sessionId, workspaceRootPath),
        createMicrosoftOAuthTriggerTool(sessionId, workspaceRootPath),
        createCredentialPromptTool(sessionId, workspaceRootPath),
        // Image generation tools (saves to session folder)
        createUnifiedImageTool(sessionId, workspaceRootPath),  // New unified tool with model selection + style reference
        createRemixImageTool(sessionId, workspaceRootPath),    // Transform existing images
        createEditImageTool(sessionId, workspaceRootPath),     // Edit/inpaint specific regions
        createGeminiImageTool(sessionId, workspaceRootPath),   // Legacy tool for backwards compatibility
        // Open images folder tool
        createOpenImagesFolderTool(sessionId, workspaceRootPath),
        // LLM tool - invoke secondary Claude calls for subtasks
        createLLMTool({ sessionId }),
      ],
    });
    sessionScopedToolsCache.set(cacheKey, cached);
    debug(`[SessionScopedTools] Created tools provider for session ${sessionId} in workspace ${workspaceRootPath}`);
  }
  return cached;
}

/**
 * Clean up session-scoped tools when a session is disposed.
 * Removes the cached provider and clears all session state.
 *
 * @param sessionId - Unique session identifier
 * @param workspaceRootPath - Optional workspace root path; if provided, only cleans up that specific workspace's cache
 */
export function cleanupSessionScopedTools(sessionId: string, workspaceRootPath?: string): void {
  if (workspaceRootPath) {
    // Clean up specific workspace cache
    const cacheKey = `${sessionId}::${workspaceRootPath}`;
    sessionScopedToolsCache.delete(cacheKey);
  } else {
    // Clean up all workspace caches for this session
    for (const key of sessionScopedToolsCache.keys()) {
      if (key.startsWith(`${sessionId}::`)) {
        sessionScopedToolsCache.delete(key);
      }
    }
  }
  sessionScopedToolCallbackRegistry.delete(sessionId);
  sessionPlanFiles.delete(sessionId);
  debug(`[SessionScopedTools] Cleaned up session ${sessionId}`);
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Get the plans directory for a session
 */
export function getSessionPlansDir(workspaceRootPath: string, sessionId: string): string {
  return getSessionPlansPath(workspaceRootPath, sessionId);
}

/**
 * Check if a file path is within the plans directory
 */
export function isPathInPlansDir(filePath: string, workspaceRootPath: string, sessionId: string): boolean {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  // Normalize paths for comparison
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPlansDir = plansDir.replace(/\\/g, '/');
  return normalizedPath.startsWith(normalizedPlansDir);
}
