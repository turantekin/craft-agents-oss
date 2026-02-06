/**
 * Schedules Browser Module
 *
 * Browser-safe exports for the schedules module.
 * Does NOT include storage functions which require Node.js fs module.
 *
 * Use this import path in renderer/browser code:
 *   import { formatNextRun, type ScheduleConfig } from '@craft-agent/shared/schedules/browser'
 *
 * Use the main path in Node.js/main process code:
 *   import { listSchedules, createSchedule } from '@craft-agent/shared/schedules'
 */

// Types (all browser-safe)
export type {
  ScheduleFrequency,
  DayOfWeek,
  ScheduleTiming,
  ScheduleExecution,
  ScheduleSessionConfig,
  ScheduleHistoryEntry,
  ScheduleStatus,
  ScheduleConfig,
  WorkspaceSchedulesConfig,
  CreateScheduleInput,
  UpdateScheduleInput,
  ScheduleWithWorkspace,
} from './types.ts';

// Next run calculation and formatting (browser-safe - no fs usage)
export {
  calculateNextRun,
  formatNextRun,
  formatTiming,
  getOrdinal,
  getNextNRuns,
} from './next-run.ts';
