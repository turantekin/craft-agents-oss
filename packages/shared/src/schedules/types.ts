/**
 * Schedule Types
 *
 * Type definitions for scheduled session execution.
 * Schedules are workspace-scoped and stored at {workspaceRootPath}/schedules/config.json
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

// ============================================================
// Schedule Frequency
// ============================================================

/**
 * Schedule frequency type
 */
export type ScheduleFrequency =
  | 'once'    // One-time execution
  | 'daily'   // Every day at specified time
  | 'weekly'  // Specific days of week
  | 'monthly' // Specific day of month
  | 'cron';   // Advanced cron expression

/**
 * Day of week for weekly schedules (0=Sunday, 6=Saturday)
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ============================================================
// Schedule Timing
// ============================================================

/**
 * Schedule timing configuration
 */
export interface ScheduleTiming {
  /** Frequency type */
  frequency: ScheduleFrequency;

  /** Time of day in 24h format (e.g., "08:00", "14:30") */
  time: string;

  /** For 'once': ISO date string (YYYY-MM-DD). For 'monthly': day of month (1-31) */
  date?: string | number;

  /** For 'weekly': array of days (0-6, Sunday=0) */
  daysOfWeek?: DayOfWeek[];

  /** For 'cron': cron expression (e.g., "0 9 * * 1-5" for weekdays at 9am) */
  cronExpression?: string;

  /** Timezone (IANA format, e.g., "America/New_York"). Defaults to system timezone */
  timezone?: string;
}

// ============================================================
// Schedule Execution
// ============================================================

/**
 * What to execute in the scheduled session
 */
export interface ScheduleExecution {
  /** Skill slug to invoke (mutually exclusive with prompt) */
  skillSlug?: string;

  /** Custom prompt to send (mutually exclusive with skillSlug) */
  prompt?: string;

  /** Optional handoff data for skill chaining */
  handoffPayload?: Record<string, unknown>;
}

// ============================================================
// Session Configuration
// ============================================================

/**
 * Session configuration for scheduled execution
 */
export interface ScheduleSessionConfig {
  /** Permission mode for the session (defaults to 'ask') */
  permissionMode?: PermissionMode;

  /** Thinking level (defaults to 'off') */
  thinkingLevel?: ThinkingLevel;

  /** Model override (uses workspace default if not specified) */
  model?: string;

  /** Working directory override */
  workingDirectory?: string;

  /** Source slugs to enable (uses workspace defaults if not specified) */
  enabledSourceSlugs?: string[];
}

// ============================================================
// Execution History
// ============================================================

/**
 * Schedule execution history entry
 */
export interface ScheduleHistoryEntry {
  /** When the execution occurred (ISO string) */
  executedAt: string;

  /** Session ID created by this execution */
  sessionId: string;

  /** Whether execution completed successfully */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Note about the execution (e.g., "Executed on startup (missed scheduled time)") */
  note?: string;

  /** Whether this entry was a retry attempt */
  isRetry?: boolean;

  /** Retry attempt number (1-based) */
  retryAttempt?: number;
}

// ============================================================
// Schedule Status
// ============================================================

/**
 * Schedule status
 */
export type ScheduleStatus =
  | 'active'    // Schedule is running
  | 'paused'    // Schedule is paused by user
  | 'completed' // One-time schedule has executed
  | 'error';    // Schedule auto-paused after consecutive failures

// ============================================================
// Schedule Config
// ============================================================

/**
 * Complete schedule configuration
 */
export interface ScheduleConfig {
  /** Unique schedule ID (UUID) */
  id: string;

  /** User-friendly name */
  name: string;

  /** Optional description */
  description?: string;

  /** Icon (emoji) */
  icon?: string;

  /** When to run */
  timing: ScheduleTiming;

  /** What to execute */
  execution: ScheduleExecution;

  /** Session configuration */
  sessionConfig?: ScheduleSessionConfig;

  /** Schedule status */
  status: ScheduleStatus;

  /** When schedule was created (ISO string) */
  createdAt: string;

  /** When schedule was last modified (ISO string) */
  updatedAt: string;

  /** Next scheduled execution time (ISO string, computed) */
  nextRunAt?: string;

  /** Last execution time (ISO string) */
  lastRunAt?: string;

  /** Execution history (last 10 entries) */
  history?: ScheduleHistoryEntry[];

  /** Auto-open window when schedule runs (default: false) */
  openOnRun?: boolean;

  /** Optional group name for organizing schedules */
  group?: string;

  /** Enable retry on failure instead of auto-pausing */
  retryOnFailure?: boolean;

  /** Maximum number of retries before giving up (default: 3) */
  maxRetries?: number;

  /** Delay in minutes between retries (default: [5, 15, 60]) */
  retryDelayMinutes?: number[];

  /** Number of consecutive failures (for auto-pause logic) */
  consecutiveFailures?: number;
}

// ============================================================
// Workspace Schedules Config
// ============================================================

/**
 * Workspace schedules configuration file structure
 */
export interface WorkspaceSchedulesConfig {
  /** Config version for migrations */
  version: 1;

  /** All schedules for this workspace */
  schedules: ScheduleConfig[];
}

// ============================================================
// Schedule Input Types (for creation/updates)
// ============================================================

/**
 * Input for creating a new schedule (id, timestamps computed automatically)
 */
export type CreateScheduleInput = Omit<
  ScheduleConfig,
  'id' | 'createdAt' | 'updatedAt' | 'nextRunAt' | 'lastRunAt' | 'history' | 'consecutiveFailures'
>;

/**
 * Input for updating an existing schedule
 */
export type UpdateScheduleInput = Partial<
  Omit<ScheduleConfig, 'id' | 'createdAt' | 'updatedAt'>
>;

// ============================================================
// Schedule with Workspace Info (for main process)
// ============================================================

/**
 * Schedule with workspace context (used by SchedulerService)
 */
export interface ScheduleWithWorkspace extends ScheduleConfig {
  /** Workspace root path */
  workspaceRootPath: string;

  /** Workspace ID */
  workspaceId: string;
}
