/**
 * Scheduler Service
 *
 * Manages scheduled session execution in the main process.
 * Uses native setTimeout for timing (no external dependencies).
 *
 * Key responsibilities:
 * - Load schedules from disk on app start
 * - Set up timers for next execution
 * - Execute schedules by creating sessions
 * - Handle app close/restart gracefully
 * - Support pause/resume functionality
 */

import { getWorkspaces, type Workspace } from '@craft-agent/shared/config'
import {
  loadSchedulesConfig,
  listActiveSchedules,
  getMissedSchedules,
  addHistoryEntry,
  updateNextRunAt,
  type ScheduleConfig,
  type ScheduleWithWorkspace,
  calculateNextRun,
} from '@craft-agent/shared/schedules'
import { loadSkill } from '@craft-agent/shared/skills'
import type { SessionManager } from './sessions'
import type { WindowManager } from './window-manager'
import { showNotification } from './notifications'
import { mainLog } from './logger'
import { IPC_CHANNELS } from '../shared/types'

// ============================================================
// Constants
// ============================================================

/**
 * Maximum delay for setTimeout (24 hours in ms).
 * For schedules further out, we use intermediate timers.
 */
const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000

/**
 * Minimum delay to allow system to settle (1 second).
 */
const MIN_TIMER_DELAY_MS = 1000

// ============================================================
// SchedulerService Class
// ============================================================

export class SchedulerService {
  private sessionManager: SessionManager | null = null
  private windowManager: WindowManager | null = null
  private isRunning = false

  /**
   * Map of scheduleId → timer handle
   */
  private timers: Map<string, NodeJS.Timeout> = new Map()

  /**
   * Map of scheduleId → ScheduleWithWorkspace (cached for quick access)
   */
  private schedules: Map<string, ScheduleWithWorkspace> = new Map()

  /**
   * Set of scheduleIds currently executing (to prevent overlap)
   */
  private executingSchedules: Set<string> = new Set()

  /**
   * Map of scheduleId → retry timer handle
   */
  private retryTimers: Map<string, NodeJS.Timeout> = new Map()

  /**
   * Map of scheduleId → current retry attempt count
   */
  private retryAttempts: Map<string, number> = new Map()

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Initialize the scheduler service with required dependencies.
   */
  async initialize(
    sessionManager: SessionManager,
    windowManager: WindowManager
  ): Promise<void> {
    this.sessionManager = sessionManager
    this.windowManager = windowManager
    mainLog.info('[Scheduler] Service initialized')
  }

  /**
   * Start the scheduler.
   * - Loads all schedules from all workspaces
   * - Checks for missed executions
   * - Sets up timers for active schedules
   */
  start(): void {
    if (this.isRunning) {
      mainLog.warn('[Scheduler] Already running')
      return
    }

    this.isRunning = true
    mainLog.info('[Scheduler] Starting...')

    // Load schedules from all workspaces
    const workspaces = getWorkspaces()
    for (const workspace of workspaces) {
      this.loadWorkspaceSchedules(workspace)
    }

    // Process missed schedules (app was closed when they were supposed to run)
    this.processMissedSchedules()

    mainLog.info(`[Scheduler] Started with ${this.schedules.size} schedules`)
  }

  /**
   * Stop the scheduler.
   * - Clears all timers
   * - Clears cached schedules
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    mainLog.info('[Scheduler] Stopping...')

    // Clear all timers
    for (const [scheduleId, timer] of this.timers) {
      clearTimeout(timer)
      mainLog.debug(`[Scheduler] Cleared timer for ${scheduleId}`)
    }
    this.timers.clear()

    // Clear retry timers
    for (const [, timer] of this.retryTimers) {
      clearTimeout(timer)
    }
    this.retryTimers.clear()
    this.retryAttempts.clear()

    // Clear cached schedules
    this.schedules.clear()
    this.executingSchedules.clear()

    mainLog.info('[Scheduler] Stopped')
  }

  /**
   * Clean up resources (called on app quit)
   */
  cleanup(): void {
    this.stop()
  }

  // ============================================================
  // Schedule Loading
  // ============================================================

  /**
   * Load schedules for a workspace.
   */
  loadWorkspaceSchedules(workspace: Workspace): void {
    const config = loadSchedulesConfig(workspace.rootPath)

    for (const schedule of config.schedules) {
      const withWorkspace: ScheduleWithWorkspace = {
        ...schedule,
        workspaceRootPath: workspace.rootPath,
        workspaceId: workspace.id,
      }

      this.schedules.set(schedule.id, withWorkspace)

      // Set up timer if active
      if (schedule.status === 'active') {
        this.scheduleNext(withWorkspace)
      }
    }

    mainLog.debug(`[Scheduler] Loaded ${config.schedules.length} schedules from workspace ${workspace.id}`)
  }

  /**
   * Handle schedule config change (from ConfigWatcher).
   * Reloads schedules for the workspace and updates timers.
   */
  handleScheduleConfigChange(workspaceRootPath: string, workspaceId: string): void {
    mainLog.info(`[Scheduler] Schedule config changed for workspace ${workspaceId}`)

    // Remove existing schedules for this workspace
    for (const [scheduleId, schedule] of this.schedules) {
      if (schedule.workspaceRootPath === workspaceRootPath) {
        this.clearTimer(scheduleId)
        this.schedules.delete(scheduleId)
      }
    }

    // Reload from disk - try to find the full workspace object
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.rootPath === workspaceRootPath || w.id === workspaceId)
    if (workspace) {
      this.loadWorkspaceSchedules(workspace)
    } else {
      mainLog.warn(`[Scheduler] Workspace not found for config change: ${workspaceId}`)
    }
  }

  // ============================================================
  // Timer Management
  // ============================================================

  /**
   * Schedule the next execution for a schedule.
   */
  private scheduleNext(schedule: ScheduleWithWorkspace): void {
    // Clear any existing timer
    this.clearTimer(schedule.id)

    // Calculate next run time
    const nextRun = schedule.nextRunAt ? new Date(schedule.nextRunAt) : calculateNextRun(schedule.timing)
    if (!nextRun) {
      mainLog.debug(`[Scheduler] No next run for ${schedule.name} (${schedule.id})`)
      return
    }

    const now = new Date()
    let delayMs = nextRun.getTime() - now.getTime()

    // If in the past, execute soon
    if (delayMs < MIN_TIMER_DELAY_MS) {
      delayMs = MIN_TIMER_DELAY_MS
    }

    // If > 24 hours, use intermediate timer
    if (delayMs > MAX_TIMER_DELAY_MS) {
      mainLog.debug(`[Scheduler] ${schedule.name} is ${Math.round(delayMs / 3600000)}h away, using intermediate timer`)
      delayMs = MAX_TIMER_DELAY_MS
    }

    const timer = setTimeout(() => {
      this.onTimerFired(schedule.id)
    }, delayMs)

    this.timers.set(schedule.id, timer)

    mainLog.info(`[Scheduler] Scheduled "${schedule.name}" for ${nextRun.toISOString()} (in ${Math.round(delayMs / 1000)}s)`)
  }

  /**
   * Clear timer for a schedule.
   */
  private clearTimer(scheduleId: string): void {
    const timer = this.timers.get(scheduleId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(scheduleId)
    }
  }

  /**
   * Handle timer firing.
   */
  private onTimerFired(scheduleId: string): void {
    this.timers.delete(scheduleId)

    const schedule = this.schedules.get(scheduleId)
    if (!schedule) {
      mainLog.warn(`[Scheduler] Timer fired for unknown schedule: ${scheduleId}`)
      return
    }

    // Check if it's actually time to run, or if this was an intermediate timer
    if (schedule.nextRunAt) {
      const nextRun = new Date(schedule.nextRunAt)
      const now = new Date()

      if (nextRun.getTime() - now.getTime() > MIN_TIMER_DELAY_MS) {
        // Not time yet, reschedule
        this.scheduleNext(schedule)
        return
      }
    }

    // Time to execute
    this.executeSchedule(scheduleId).catch(error => {
      mainLog.error(`[Scheduler] Failed to execute ${schedule.name}:`, error)
    })
  }

  // ============================================================
  // Execution
  // ============================================================

  /**
   * Execute a schedule (create session and send message).
   */
  private async executeSchedule(scheduleId: string): Promise<void> {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) {
      mainLog.warn(`[Scheduler] Cannot execute unknown schedule: ${scheduleId}`)
      return
    }

    // Check status
    if (schedule.status !== 'active') {
      mainLog.info(`[Scheduler] Skipping ${schedule.name} - status is ${schedule.status}`)
      return
    }

    // Check if already executing
    if (this.executingSchedules.has(scheduleId)) {
      mainLog.warn(`[Scheduler] Skipping ${schedule.name} - previous execution still running`)
      addHistoryEntry(schedule.workspaceRootPath, scheduleId, {
        sessionId: '',
        success: false,
        error: 'Skipped - previous execution still running',
      })
      return
    }

    if (!this.sessionManager) {
      mainLog.error('[Scheduler] SessionManager not initialized')
      return
    }

    mainLog.info(`[Scheduler] Executing "${schedule.name}"`)
    this.executingSchedules.add(scheduleId)

    const startTime = Date.now()
    let sessionId = ''
    let success = false
    let error: string | undefined

    try {
      // Create session with pre-configured sources
      const session = await this.sessionManager.createSession(schedule.workspaceId, {
        permissionMode: schedule.sessionConfig?.permissionMode,
        enabledSourceSlugs: schedule.sessionConfig?.enabledSourceSlugs,
      })
      sessionId = session.id

      // Build the message to send
      let message: string
      if (schedule.execution.skillSlug) {
        // Invoke skill via mention
        const skill = loadSkill(schedule.workspaceRootPath, schedule.execution.skillSlug)
        if (skill) {
          message = `[skill:${schedule.workspaceId}:${schedule.execution.skillSlug}] ${skill.metadata.description || 'Run scheduled task'}`
        } else {
          message = `[skill:${schedule.execution.skillSlug}] Run scheduled task`
        }
      } else if (schedule.execution.prompt) {
        message = schedule.execution.prompt
      } else {
        throw new Error('Schedule has no skill or prompt configured')
      }

      // Send the message
      await this.sessionManager.sendMessage(sessionId, message)

      success = true
      mainLog.info(`[Scheduler] "${schedule.name}" completed successfully (session: ${sessionId})`)

      // Show notification
      showNotification(
        `Schedule Completed: ${schedule.name}`,
        'Click to view the session',
        schedule.workspaceId,
        sessionId
      )

      // Open window if configured
      if (schedule.openOnRun && this.windowManager) {
        const window = this.windowManager.getWindowByWorkspace(schedule.workspaceId)
        if (window && !window.isDestroyed()) {
          if (window.isMinimized()) {
            window.restore()
          }
          window.focus()
          // Navigate to the session
          window.webContents.send('notification:navigate', {
            workspaceId: schedule.workspaceId,
            sessionId,
          })
        }
      }

    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      mainLog.error(`[Scheduler] "${schedule.name}" failed:`, error)

      // Show error notification
      showNotification(
        `Schedule Failed: ${schedule.name}`,
        error,
        schedule.workspaceId,
        sessionId || ''
      )
    } finally {
      this.executingSchedules.delete(scheduleId)

      // Determine if this was a retry attempt
      const retryAttempt = this.retryAttempts.get(scheduleId) || 0
      const isRetry = retryAttempt > 0

      // Update history
      const durationMs = Date.now() - startTime
      const updatedSchedule = addHistoryEntry(schedule.workspaceRootPath, scheduleId, {
        sessionId,
        success,
        error,
        durationMs,
        isRetry: isRetry || undefined,
        retryAttempt: isRetry ? retryAttempt : undefined,
      })

      // Handle retry logic on failure
      if (!success && schedule.retryOnFailure) {
        const maxRetries = schedule.maxRetries ?? 3
        const delayMinutes = schedule.retryDelayMinutes ?? [5, 15, 60]
        const nextAttempt = retryAttempt + 1

        if (nextAttempt <= maxRetries) {
          const delayIndex = Math.min(nextAttempt - 1, delayMinutes.length - 1)
          const delayMs = (delayMinutes[delayIndex] ?? 5) * 60 * 1000

          mainLog.info(`[Scheduler] Scheduling retry ${nextAttempt}/${maxRetries} for "${schedule.name}" in ${delayMinutes[delayIndex]}m`)
          this.retryAttempts.set(scheduleId, nextAttempt)

          // Clear any existing retry timer
          const existingRetry = this.retryTimers.get(scheduleId)
          if (existingRetry) clearTimeout(existingRetry)

          const retryTimer = setTimeout(() => {
            this.retryTimers.delete(scheduleId)
            this.executeSchedule(scheduleId).catch(err => {
              mainLog.error(`[Scheduler] Retry failed for ${schedule.name}:`, err)
            })
          }, delayMs)
          this.retryTimers.set(scheduleId, retryTimer)

          // Don't schedule regular next run while retrying
        } else {
          // Max retries exhausted, reset and schedule next regular run
          mainLog.warn(`[Scheduler] Max retries exhausted for "${schedule.name}"`)
          this.retryAttempts.delete(scheduleId)

          if (updatedSchedule) {
            const withWorkspace: ScheduleWithWorkspace = {
              ...updatedSchedule,
              workspaceRootPath: schedule.workspaceRootPath,
              workspaceId: schedule.workspaceId,
            }
            this.schedules.set(scheduleId, withWorkspace)
            if (updatedSchedule.status === 'active') {
              this.scheduleNext(withWorkspace)
            }
          }
        }
      } else {
        // Success or no retry configured — reset retry counter and schedule next
        if (success) {
          this.retryAttempts.delete(scheduleId)
        }

        // Update cached schedule
        if (updatedSchedule) {
          const withWorkspace: ScheduleWithWorkspace = {
            ...updatedSchedule,
            workspaceRootPath: schedule.workspaceRootPath,
            workspaceId: schedule.workspaceId,
          }
          this.schedules.set(scheduleId, withWorkspace)

          // Schedule next execution if still active
          if (updatedSchedule.status === 'active') {
            this.scheduleNext(withWorkspace)
          }
        }
      }

      // Broadcast execution event to all renderer windows
      if (this.windowManager) {
        this.windowManager.broadcastToAll(IPC_CHANNELS.SCHEDULE_EXECUTED, {
          workspaceId: schedule.workspaceId,
          scheduleId,
          sessionId,
          success,
        })
        // Also notify that schedules config changed (for list updates)
        this.windowManager.broadcastToAll(IPC_CHANNELS.SCHEDULES_CHANGED, schedule.workspaceId)
      }
    }
  }

  /**
   * Manually trigger a schedule (for "Run Now" button).
   */
  async executeScheduleManually(scheduleId: string, workspaceRootPath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    const schedule = this.schedules.get(scheduleId)
    if (!schedule) {
      return { success: false, error: 'Schedule not found' }
    }

    if (this.executingSchedules.has(scheduleId)) {
      return { success: false, error: 'Schedule is already executing' }
    }

    try {
      await this.executeSchedule(scheduleId)
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { success: false, error }
    }
  }

  // ============================================================
  // Missed Executions
  // ============================================================

  /**
   * Process schedules that missed their execution time (app was closed).
   * Executes them immediately.
   */
  private processMissedSchedules(): void {
    const workspaces = getWorkspaces()

    for (const workspace of workspaces) {
      const missed = getMissedSchedules(workspace.rootPath)

      for (const schedule of missed) {
        mainLog.info(`[Scheduler] Found missed schedule: "${schedule.name}" (was due ${schedule.nextRunAt})`)

        // Execute immediately
        const withWorkspace: ScheduleWithWorkspace = {
          ...schedule,
          workspaceRootPath: workspace.rootPath,
          workspaceId: workspace.id,
        }
        this.schedules.set(schedule.id, withWorkspace)

        // Execute after a short delay to let app settle
        setTimeout(() => {
          this.executeSchedule(schedule.id).catch(error => {
            mainLog.error(`[Scheduler] Failed to execute missed schedule ${schedule.name}:`, error)
          })
        }, 2000)
      }
    }
  }

  // ============================================================
  // Status Management
  // ============================================================

  // Note: Pause/resume are handled by the IPC layer which calls
  // storage.pauseSchedule/resumeSchedule then handleScheduleConfigChange(),
  // which reloads all schedules from disk and resets timers accordingly.
  // No separate pauseSchedule/resumeSchedule methods needed here.

  // ============================================================
  // Getters
  // ============================================================

  /**
   * Get all cached schedules for a workspace.
   */
  getWorkspaceSchedules(workspaceId: string): ScheduleWithWorkspace[] {
    const result: ScheduleWithWorkspace[] = []
    for (const schedule of this.schedules.values()) {
      if (schedule.workspaceId === workspaceId) {
        result.push(schedule)
      }
    }
    return result
  }

  /**
   * Check if a schedule is currently executing.
   */
  isExecuting(scheduleId: string): boolean {
    return this.executingSchedules.has(scheduleId)
  }
}
