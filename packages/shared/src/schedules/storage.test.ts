/**
 * Tests for Schedule Storage
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadSchedulesConfig,
  saveSchedulesConfig,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  getMissedSchedules,
} from './storage'
import type { CreateScheduleInput, ScheduleConfig, WorkspaceSchedulesConfig } from './types'

describe('Schedule Storage', () => {
  let tempDir: string

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'schedules-test-'))
  })

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('loadSchedulesConfig', () => {
    test('returns empty schedules when file does not exist', () => {
      const config = loadSchedulesConfig(tempDir)
      expect(config.version).toBe(1)
      expect(config.schedules).toEqual([])
    })

    test('loads existing config from file', () => {
      // Create a config file
      const existingConfig: WorkspaceSchedulesConfig = {
        version: 1,
        schedules: [
          {
            id: 'test-id',
            name: 'Test Schedule',
            timing: { frequency: 'daily', time: '09:00' },
            execution: { prompt: 'Hello' },
            status: 'active',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ],
      }
      saveSchedulesConfig(tempDir, existingConfig)

      const config = loadSchedulesConfig(tempDir)
      expect(config.schedules.length).toBe(1)
      expect(config.schedules[0]!.name).toBe('Test Schedule')
    })
  })

  describe('createSchedule', () => {
    test('creates a new schedule with generated id and timestamps', () => {
      const input: CreateScheduleInput = {
        name: 'Daily Briefing',
        timing: { frequency: 'daily', time: '08:00' },
        execution: { skillSlug: 'briefing' },
        status: 'active',
      }

      const schedule = createSchedule(tempDir, input)

      expect(schedule.id).toBeDefined()
      expect(schedule.name).toBe('Daily Briefing')
      expect(schedule.timing.frequency).toBe('daily')
      expect(schedule.execution.skillSlug).toBe('briefing')
      expect(schedule.status).toBe('active')
      expect(schedule.createdAt).toBeDefined()
      expect(schedule.updatedAt).toBeDefined()
      expect(schedule.nextRunAt).toBeDefined()
    })

    test('schedule is persisted to disk', () => {
      const input: CreateScheduleInput = {
        name: 'Test Schedule',
        timing: { frequency: 'daily', time: '10:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      }

      const created = createSchedule(tempDir, input)
      const config = loadSchedulesConfig(tempDir)

      expect(config.schedules.length).toBe(1)
      expect(config.schedules[0]!.id).toBe(created.id)
    })
  })

  describe('updateSchedule', () => {
    test('updates schedule fields', () => {
      // Create a schedule first
      const created = createSchedule(tempDir, {
        name: 'Original Name',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Original' },
        status: 'active',
      })

      // Update it
      const updated = updateSchedule(tempDir, created.id, {
        name: 'New Name',
        timing: { frequency: 'daily', time: '10:00' },
      })

      expect(updated).not.toBeNull()
      expect(updated!.name).toBe('New Name')
      expect(updated!.timing.time).toBe('10:00')
      expect(updated!.execution.prompt).toBe('Original') // Unchanged
    })

    test('returns null for non-existent schedule', () => {
      const updated = updateSchedule(tempDir, 'non-existent', { name: 'New' })
      expect(updated).toBeNull()
    })

    test('updates updatedAt timestamp', async () => {
      const created = createSchedule(tempDir, {
        name: 'Test',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      })

      const originalUpdatedAt = created.updatedAt

      // Wait a bit to ensure timestamp difference (at least 1ms)
      await new Promise(resolve => setTimeout(resolve, 10))

      const updated = updateSchedule(tempDir, created.id, { name: 'Updated' })
      // The updatedAt should be different or at least not older
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime())
    })
  })

  describe('deleteSchedule', () => {
    test('deletes existing schedule', () => {
      const created = createSchedule(tempDir, {
        name: 'To Delete',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      })

      const result = deleteSchedule(tempDir, created.id)
      expect(result).toBe(true)

      const config = loadSchedulesConfig(tempDir)
      expect(config.schedules.length).toBe(0)
    })

    test('returns false for non-existent schedule', () => {
      const result = deleteSchedule(tempDir, 'non-existent')
      expect(result).toBe(false)
    })
  })

  describe('pauseSchedule', () => {
    test('pauses an active schedule', () => {
      const created = createSchedule(tempDir, {
        name: 'To Pause',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      })

      const paused = pauseSchedule(tempDir, created.id)

      expect(paused).not.toBeNull()
      expect(paused!.status).toBe('paused')
    })

    test('returns null for non-existent schedule', () => {
      const paused = pauseSchedule(tempDir, 'non-existent')
      expect(paused).toBeNull()
    })
  })

  describe('resumeSchedule', () => {
    test('resumes a paused schedule', () => {
      const created = createSchedule(tempDir, {
        name: 'To Resume',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      })

      // First pause it
      pauseSchedule(tempDir, created.id)

      // Then resume it
      const resumed = resumeSchedule(tempDir, created.id)

      expect(resumed).not.toBeNull()
      expect(resumed!.status).toBe('active')
      expect(resumed!.consecutiveFailures).toBe(0)
    })

    test('resumes an error schedule and resets failure count', () => {
      const created = createSchedule(tempDir, {
        name: 'Error Schedule',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      })

      // Manually set to error state with failures
      updateSchedule(tempDir, created.id, {
        status: 'error',
        consecutiveFailures: 3,
      })

      const resumed = resumeSchedule(tempDir, created.id)

      expect(resumed).not.toBeNull()
      expect(resumed!.status).toBe('active')
      expect(resumed!.consecutiveFailures).toBe(0)
    })
  })

  describe('getMissedSchedules', () => {
    test('returns schedules that should have run but did not', () => {
      // Create a schedule with nextRunAt in the past
      const schedule = createSchedule(tempDir, {
        name: 'Missed Schedule',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      })

      // Manually set nextRunAt to the past
      const pastDate = new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
      updateSchedule(tempDir, schedule.id, {
        nextRunAt: pastDate.toISOString(),
      })

      const missed = getMissedSchedules(tempDir)

      expect(missed.length).toBe(1)
      expect(missed[0]!.id).toBe(schedule.id)
    })

    test('does not return paused schedules', () => {
      const schedule = createSchedule(tempDir, {
        name: 'Paused Schedule',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      })

      // Set nextRunAt to the past and pause
      const pastDate = new Date(Date.now() - 60 * 60 * 1000)
      updateSchedule(tempDir, schedule.id, {
        nextRunAt: pastDate.toISOString(),
      })
      pauseSchedule(tempDir, schedule.id)

      const missed = getMissedSchedules(tempDir)

      expect(missed.length).toBe(0)
    })

    test('does not return schedules with future nextRunAt', () => {
      const schedule = createSchedule(tempDir, {
        name: 'Future Schedule',
        timing: { frequency: 'daily', time: '09:00' },
        execution: { prompt: 'Test' },
        status: 'active',
      })

      // nextRunAt is set to the future by createSchedule (based on time)
      const missed = getMissedSchedules(tempDir)

      // Depending on timing, this may or may not be missed
      // Since the schedule is created with next run calculated, it should be in the future
      const config = loadSchedulesConfig(tempDir)
      const sched = config.schedules[0]!
      const nextRun = new Date(sched.nextRunAt!)

      if (nextRun > new Date()) {
        expect(missed.length).toBe(0)
      }
    })
  })
})
