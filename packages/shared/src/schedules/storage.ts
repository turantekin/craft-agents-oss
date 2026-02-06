/**
 * Schedule Storage
 *
 * Filesystem-based storage for workspace schedule configurations.
 * Schedules are stored at {workspaceRootPath}/schedules/config.json
 *
 * Follows patterns from statuses/storage.ts and labels/storage.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type {
  WorkspaceSchedulesConfig,
  ScheduleConfig,
  CreateScheduleInput,
  UpdateScheduleInput,
  ScheduleHistoryEntry,
  ScheduleStatus,
} from './types.ts';
import { calculateNextRun } from './next-run.ts';
import { debug } from '../utils/debug.ts';

// ============================================================
// Constants
// ============================================================

const SCHEDULE_CONFIG_DIR = 'schedules';
const SCHEDULE_CONFIG_FILE = 'schedules/config.json';
const MAX_HISTORY_ENTRIES = 10;
const AUTO_PAUSE_FAILURE_THRESHOLD = 3;

// ============================================================
// Default Configuration
// ============================================================

/**
 * Get default (empty) schedule configuration
 */
export function getDefaultSchedulesConfig(): WorkspaceSchedulesConfig {
  return {
    version: 1,
    schedules: [],
  };
}

// ============================================================
// Load / Save
// ============================================================

/**
 * Load workspace schedules configuration.
 * Returns defaults if no config exists.
 */
export function loadSchedulesConfig(workspaceRootPath: string): WorkspaceSchedulesConfig {
  const configPath = join(workspaceRootPath, SCHEDULE_CONFIG_FILE);

  // Return defaults if config doesn't exist
  if (!existsSync(configPath)) {
    return getDefaultSchedulesConfig();
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as WorkspaceSchedulesConfig;

    // Validate version
    if (config.version !== 1) {
      debug(`[loadSchedulesConfig] Unknown version ${config.version}, returning defaults`);
      return getDefaultSchedulesConfig();
    }

    return config;
  } catch (error) {
    debug('[loadSchedulesConfig] Failed to parse config:', error);
    return getDefaultSchedulesConfig();
  }
}

/**
 * Save workspace schedules configuration to disk
 */
export function saveSchedulesConfig(
  workspaceRootPath: string,
  config: WorkspaceSchedulesConfig
): void {
  const scheduleDir = join(workspaceRootPath, SCHEDULE_CONFIG_DIR);
  const configPath = join(workspaceRootPath, SCHEDULE_CONFIG_FILE);

  // Create schedule directory if missing
  if (!existsSync(scheduleDir)) {
    mkdirSync(scheduleDir, { recursive: true });
  }

  // Write config to disk
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    debug('[saveSchedulesConfig] Config saved successfully');
  } catch (error) {
    debug('[saveSchedulesConfig] Failed to save config:', error);
    throw error;
  }
}

// ============================================================
// Read Operations
// ============================================================

/**
 * Get a single schedule by ID.
 * Returns null if not found.
 */
export function getSchedule(
  workspaceRootPath: string,
  scheduleId: string
): ScheduleConfig | null {
  const config = loadSchedulesConfig(workspaceRootPath);
  return config.schedules.find(s => s.id === scheduleId) || null;
}

/**
 * List all schedules for a workspace.
 * Returns schedules sorted by createdAt (newest first).
 */
export function listSchedules(workspaceRootPath: string): ScheduleConfig[] {
  const config = loadSchedulesConfig(workspaceRootPath);
  return [...config.schedules].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * List active schedules (for scheduler to process)
 */
export function listActiveSchedules(workspaceRootPath: string): ScheduleConfig[] {
  const config = loadSchedulesConfig(workspaceRootPath);
  return config.schedules.filter(s => s.status === 'active');
}

/**
 * Check if a schedule ID exists
 */
export function scheduleExists(
  workspaceRootPath: string,
  scheduleId: string
): boolean {
  const config = loadSchedulesConfig(workspaceRootPath);
  return config.schedules.some(s => s.id === scheduleId);
}

// ============================================================
// Write Operations
// ============================================================

/**
 * Create a new schedule.
 * Returns the created schedule with computed fields.
 */
export function createSchedule(
  workspaceRootPath: string,
  input: CreateScheduleInput
): ScheduleConfig {
  const config = loadSchedulesConfig(workspaceRootPath);
  const now = new Date().toISOString();

  // Compute next run time
  const nextRunAt = calculateNextRun(input.timing);

  const schedule: ScheduleConfig = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    nextRunAt: nextRunAt?.toISOString(),
    history: [],
    consecutiveFailures: 0,
  };

  config.schedules.push(schedule);
  saveSchedulesConfig(workspaceRootPath, config);

  debug(`[createSchedule] Created schedule "${schedule.name}" (${schedule.id})`);
  return schedule;
}

/**
 * Update an existing schedule.
 * Returns the updated schedule or null if not found.
 */
export function updateSchedule(
  workspaceRootPath: string,
  scheduleId: string,
  updates: UpdateScheduleInput
): ScheduleConfig | null {
  const config = loadSchedulesConfig(workspaceRootPath);
  const index = config.schedules.findIndex(s => s.id === scheduleId);

  if (index === -1) {
    debug(`[updateSchedule] Schedule not found: ${scheduleId}`);
    return null;
  }

  const existing = config.schedules[index]!;
  const now = new Date().toISOString();

  // Determine nextRunAt: use explicit update, recalculate if timing changed, or keep existing
  let nextRunAt: string | undefined;
  if ('nextRunAt' in updates) {
    // Explicit nextRunAt update
    nextRunAt = updates.nextRunAt;
  } else if (updates.timing) {
    // Timing changed, recalculate
    const calculated = calculateNextRun(updates.timing);
    nextRunAt = calculated?.toISOString();
  } else {
    // Keep existing
    nextRunAt = existing.nextRunAt;
  }

  const updated: ScheduleConfig = {
    ...existing,
    ...updates,
    updatedAt: now,
    nextRunAt,
  };

  config.schedules[index] = updated;
  saveSchedulesConfig(workspaceRootPath, config);

  debug(`[updateSchedule] Updated schedule "${updated.name}" (${scheduleId})`);
  return updated;
}

/**
 * Delete a schedule.
 * Returns true if deleted, false if not found.
 */
export function deleteSchedule(
  workspaceRootPath: string,
  scheduleId: string
): boolean {
  const config = loadSchedulesConfig(workspaceRootPath);
  const index = config.schedules.findIndex(s => s.id === scheduleId);

  if (index === -1) {
    debug(`[deleteSchedule] Schedule not found: ${scheduleId}`);
    return false;
  }

  const deleted = config.schedules.splice(index, 1)[0];
  saveSchedulesConfig(workspaceRootPath, config);

  debug(`[deleteSchedule] Deleted schedule "${deleted?.name}" (${scheduleId})`);
  return true;
}

// ============================================================
// Status Management
// ============================================================

/**
 * Pause a schedule.
 * Returns the updated schedule or null if not found.
 */
export function pauseSchedule(
  workspaceRootPath: string,
  scheduleId: string
): ScheduleConfig | null {
  return updateSchedule(workspaceRootPath, scheduleId, {
    status: 'paused',
  });
}

/**
 * Resume a paused schedule.
 * Recalculates next run time.
 * Returns the updated schedule or null if not found.
 */
export function resumeSchedule(
  workspaceRootPath: string,
  scheduleId: string
): ScheduleConfig | null {
  const schedule = getSchedule(workspaceRootPath, scheduleId);
  if (!schedule) return null;

  const nextRunAt = calculateNextRun(schedule.timing);

  return updateSchedule(workspaceRootPath, scheduleId, {
    status: 'active',
    nextRunAt: nextRunAt?.toISOString(),
    consecutiveFailures: 0, // Reset failures on resume
  });
}

/**
 * Update schedule status.
 * Used internally for marking completed or error states.
 */
export function setScheduleStatus(
  workspaceRootPath: string,
  scheduleId: string,
  status: ScheduleStatus
): ScheduleConfig | null {
  return updateSchedule(workspaceRootPath, scheduleId, { status });
}

// ============================================================
// History Management
// ============================================================

/**
 * Add a history entry to a schedule.
 * Keeps only the last MAX_HISTORY_ENTRIES entries.
 * Updates lastRunAt and handles consecutive failure logic.
 */
export function addHistoryEntry(
  workspaceRootPath: string,
  scheduleId: string,
  entry: Omit<ScheduleHistoryEntry, 'executedAt'>
): ScheduleConfig | null {
  const schedule = getSchedule(workspaceRootPath, scheduleId);
  if (!schedule) return null;

  const historyEntry: ScheduleHistoryEntry = {
    ...entry,
    executedAt: new Date().toISOString(),
  };

  // Build new history (prepend new entry, trim to max)
  const history = [historyEntry, ...(schedule.history || [])].slice(0, MAX_HISTORY_ENTRIES);

  // Calculate consecutive failures
  let consecutiveFailures = entry.success ? 0 : (schedule.consecutiveFailures || 0) + 1;

  // Auto-pause if too many consecutive failures
  let status = schedule.status;
  if (consecutiveFailures >= AUTO_PAUSE_FAILURE_THRESHOLD) {
    status = 'error';
    debug(`[addHistoryEntry] Auto-pausing schedule "${schedule.name}" after ${consecutiveFailures} consecutive failures`);
  }

  // Mark one-time schedules as completed after execution
  if (schedule.timing.frequency === 'once' && entry.success) {
    status = 'completed';
  }

  // Calculate next run time
  const nextRunAt = status === 'active'
    ? calculateNextRun(schedule.timing)?.toISOString()
    : undefined;

  return updateSchedule(workspaceRootPath, scheduleId, {
    history,
    lastRunAt: historyEntry.executedAt,
    nextRunAt,
    consecutiveFailures,
    status,
  });
}

/**
 * Update the next run time for a schedule.
 * Called after scheduling the next timer.
 */
export function updateNextRunAt(
  workspaceRootPath: string,
  scheduleId: string,
  nextRunAt: string | null
): ScheduleConfig | null {
  return updateSchedule(workspaceRootPath, scheduleId, {
    nextRunAt: nextRunAt ?? undefined,
  });
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Get schedules that have missed their scheduled time.
 * Used on app startup to handle missed executions.
 */
export function getMissedSchedules(workspaceRootPath: string): ScheduleConfig[] {
  const now = new Date();
  const schedules = listActiveSchedules(workspaceRootPath);

  return schedules.filter(schedule => {
    if (!schedule.nextRunAt) return false;
    const nextRun = new Date(schedule.nextRunAt);
    return nextRun < now;
  });
}

/**
 * Check if a schedule name is unique within the workspace.
 */
export function isScheduleNameUnique(
  workspaceRootPath: string,
  name: string,
  excludeId?: string
): boolean {
  const config = loadSchedulesConfig(workspaceRootPath);
  return !config.schedules.some(
    s => s.name.toLowerCase() === name.toLowerCase() && s.id !== excludeId
  );
}
