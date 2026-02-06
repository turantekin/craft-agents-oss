/**
 * Tests for Schedule Next Run Calculation
 */

import { describe, test, expect } from 'bun:test'
import { calculateNextRun, formatNextRun, formatTiming, getOrdinal, getNextNRuns } from './next-run'
import type { ScheduleTiming } from './types'

describe('calculateNextRun', () => {
  // Use a fixed date for testing
  const fixedNow = new Date('2025-06-15T10:00:00Z') // Sunday, June 15, 2025, 10:00 UTC

  describe('daily frequency', () => {
    test('returns next occurrence today if time has not passed', () => {
      const timing: ScheduleTiming = {
        frequency: 'daily',
        time: '14:00', // 2 PM
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getUTCHours()).toBe(14)
      expect(date.getUTCMinutes()).toBe(0)
      expect(date.getUTCDate()).toBe(15) // Same day
    })

    test('returns next day if time has passed', () => {
      const timing: ScheduleTiming = {
        frequency: 'daily',
        time: '08:00', // 8 AM - already passed
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getUTCHours()).toBe(8)
      expect(date.getUTCMinutes()).toBe(0)
      expect(date.getUTCDate()).toBe(16) // Next day
    })
  })

  describe('weekly frequency', () => {
    test('returns next occurrence on specified day', () => {
      const timing: ScheduleTiming = {
        frequency: 'weekly',
        time: '09:00',
        daysOfWeek: [1], // Monday
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getUTCDay()).toBe(1) // Monday
      expect(date.getUTCDate()).toBe(16) // June 16, 2025 is Monday
    })

    test('returns same day if time has not passed and day matches', () => {
      const timing: ScheduleTiming = {
        frequency: 'weekly',
        time: '14:00',
        daysOfWeek: [0], // Sunday (fixedNow is Sunday)
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getUTCDay()).toBe(0) // Sunday
      expect(date.getUTCDate()).toBe(15) // Same day
    })

    test('returns next week if time has passed on same day', () => {
      const timing: ScheduleTiming = {
        frequency: 'weekly',
        time: '08:00', // Already passed
        daysOfWeek: [0], // Sunday (fixedNow is Sunday)
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getUTCDay()).toBe(0) // Sunday
      expect(date.getUTCDate()).toBe(22) // Next Sunday
    })

    test('returns null for empty daysOfWeek', () => {
      const timing: ScheduleTiming = {
        frequency: 'weekly',
        time: '09:00',
        daysOfWeek: [],
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).toBeNull()
    })
  })

  describe('monthly frequency', () => {
    test('returns next occurrence on specified day of month', () => {
      const timing: ScheduleTiming = {
        frequency: 'monthly',
        time: '09:00',
        date: 20, // 20th of month
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getUTCDate()).toBe(20)
      expect(date.getUTCMonth()).toBe(5) // June (0-indexed)
    })

    test('returns next month if day has passed', () => {
      const timing: ScheduleTiming = {
        frequency: 'monthly',
        time: '09:00',
        date: 10, // 10th of month - already passed
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getUTCDate()).toBe(10)
      expect(date.getUTCMonth()).toBe(6) // July
    })

    test('clamps day 31 to last day of month (February)', () => {
      // After January 31, next should be Feb 28 (2025 is not a leap year)
      const afterJan = new Date('2025-02-01T00:00:00Z')
      const timing: ScheduleTiming = {
        frequency: 'monthly',
        time: '09:00',
        date: 31,
      }
      const result = calculateNextRun(timing, afterJan)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      // February 2025 has 28 days - should clamp to 28th
      expect(date.getUTCDate()).toBe(28)
      expect(date.getUTCMonth()).toBe(1) // February
    })

    test('clamps day 31 to last day of month (April has 30 days)', () => {
      const afterMarch = new Date('2025-04-01T00:00:00Z')
      const timing: ScheduleTiming = {
        frequency: 'monthly',
        time: '09:00',
        date: 31,
      }
      const result = calculateNextRun(timing, afterMarch)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      // April has 30 days - should clamp to 30th
      expect(date.getUTCDate()).toBe(30)
      expect(date.getUTCMonth()).toBe(3) // April
    })

    test('uses exact day when month has enough days', () => {
      const afterJune = new Date('2025-07-01T00:00:00Z')
      const timing: ScheduleTiming = {
        frequency: 'monthly',
        time: '09:00',
        date: 31,
      }
      const result = calculateNextRun(timing, afterJune)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      // July has 31 days
      expect(date.getUTCDate()).toBe(31)
      expect(date.getUTCMonth()).toBe(6) // July
    })

    test('clamps day 29 in Feb for non-leap year', () => {
      const afterJan2025 = new Date('2025-02-01T00:00:00Z')
      const timing: ScheduleTiming = {
        frequency: 'monthly',
        time: '09:00',
        date: 29,
      }
      const result = calculateNextRun(timing, afterJan2025)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      // 2025 is not a leap year, Feb has 28 days
      expect(date.getUTCDate()).toBe(28)
      expect(date.getUTCMonth()).toBe(1) // February
    })

    test('returns null for invalid day of month', () => {
      const timing: ScheduleTiming = {
        frequency: 'monthly',
        time: '09:00',
        date: 0,
      }
      expect(calculateNextRun(timing, fixedNow)).toBeNull()
    })

    test('returns null for day > 31', () => {
      const timing: ScheduleTiming = {
        frequency: 'monthly',
        time: '09:00',
        date: 32,
      }
      expect(calculateNextRun(timing, fixedNow)).toBeNull()
    })
  })

  describe('once frequency', () => {
    test('returns the specified date if in the future', () => {
      const timing: ScheduleTiming = {
        frequency: 'once',
        time: '09:00',
        date: '2025-06-20', // Future date
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getUTCDate()).toBe(20)
      expect(date.getUTCMonth()).toBe(5) // June
    })

    test('returns null if date has passed', () => {
      const timing: ScheduleTiming = {
        frequency: 'once',
        time: '09:00',
        date: '2025-06-10', // Past date
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).toBeNull()
    })
  })

  describe('cron frequency', () => {
    test('matches simple daily cron (0 9 * * *)', () => {
      const timing: ScheduleTiming = {
        frequency: 'cron',
        time: '00:00', // time field unused for cron
        cronExpression: '0 14 * * *', // 2 PM daily
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getHours()).toBe(14)
      expect(date.getMinutes()).toBe(0)
    })

    test('matches weekday cron (0 9 * * 1-5)', () => {
      const timing: ScheduleTiming = {
        frequency: 'cron',
        time: '00:00',
        cronExpression: '0 9 * * 1-5', // 9 AM weekdays
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      const day = date.getDay()
      expect(day).toBeGreaterThanOrEqual(1)
      expect(day).toBeLessThanOrEqual(5)
    })

    test('matches monthly cron (0 8 1 * *)', () => {
      const timing: ScheduleTiming = {
        frequency: 'cron',
        time: '00:00',
        cronExpression: '0 8 1 * *', // 8 AM on 1st
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getDate()).toBe(1)
      expect(date.getHours()).toBe(8)
    })

    test('matches comma-separated values (0 9 * * 1,3,5)', () => {
      const timing: ScheduleTiming = {
        frequency: 'cron',
        time: '00:00',
        cronExpression: '0 9 * * 1,3,5', // Mon, Wed, Fri at 9am
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect([1, 3, 5]).toContain(date.getDay())
    })

    test('returns null for invalid cron expression', () => {
      const timing: ScheduleTiming = {
        frequency: 'cron',
        time: '00:00',
        cronExpression: 'invalid',
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).toBeNull()
    })

    test('returns null for missing cron expression', () => {
      const timing: ScheduleTiming = {
        frequency: 'cron',
        time: '00:00',
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).toBeNull()
    })

    test('handles specific month cron (0 0 1 1 *) - Jan 1st', () => {
      const timing: ScheduleTiming = {
        frequency: 'cron',
        time: '00:00',
        cronExpression: '0 0 1 1 *', // Midnight on Jan 1st
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      const date = new Date(result!)
      expect(date.getMonth()).toBe(0) // January
      expect(date.getDate()).toBe(1)
      expect(date.getFullYear()).toBe(2026) // Next year since June 2025 > January
    })
  })

  describe('timezone support', () => {
    test('adjusts daily schedule for timezone', () => {
      // Test with UTC+0 reference time (10:00 UTC on June 15)
      // Schedule for 09:00 in UTC should give 09:00 UTC
      const timing: ScheduleTiming = {
        frequency: 'daily',
        time: '09:00',
        timezone: 'UTC',
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      // With UTC timezone explicitly set, 09:00 is in the past (fixedNow = 10:00 UTC)
      // so it should return next day
      const date = new Date(result!)
      expect(date.getUTCHours()).toBe(9)
      expect(date.getUTCDate()).toBe(16)
    })

    test('no timezone uses system local time (default behavior)', () => {
      const timing: ScheduleTiming = {
        frequency: 'daily',
        time: '14:00',
      }
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
      // Without timezone, should use local time (same as before timezone feature)
    })

    test('invalid timezone falls back gracefully', () => {
      const timing: ScheduleTiming = {
        frequency: 'daily',
        time: '14:00',
        timezone: 'Invalid/Timezone',
      }
      // Should not throw, should fall back to no adjustment
      const result = calculateNextRun(timing, fixedNow)
      expect(result).not.toBeNull()
    })
  })
})

describe('getOrdinal', () => {
  test('handles 1st', () => {
    expect(getOrdinal(1)).toBe('1st')
  })

  test('handles 2nd', () => {
    expect(getOrdinal(2)).toBe('2nd')
  })

  test('handles 3rd', () => {
    expect(getOrdinal(3)).toBe('3rd')
  })

  test('handles 4th', () => {
    expect(getOrdinal(4)).toBe('4th')
  })

  test('handles 11th (special case)', () => {
    expect(getOrdinal(11)).toBe('11th')
  })

  test('handles 12th (special case)', () => {
    expect(getOrdinal(12)).toBe('12th')
  })

  test('handles 13th (special case)', () => {
    expect(getOrdinal(13)).toBe('13th')
  })

  test('handles 21st', () => {
    expect(getOrdinal(21)).toBe('21st')
  })

  test('handles 22nd', () => {
    expect(getOrdinal(22)).toBe('22nd')
  })

  test('handles 23rd', () => {
    expect(getOrdinal(23)).toBe('23rd')
  })

  test('handles 31st', () => {
    expect(getOrdinal(31)).toBe('31st')
  })

  test('handles 111th (special case - teens pattern)', () => {
    expect(getOrdinal(111)).toBe('111th')
  })

  test('handles 112th', () => {
    expect(getOrdinal(112)).toBe('112th')
  })

  test('handles 113th', () => {
    expect(getOrdinal(113)).toBe('113th')
  })

  test('handles 101st', () => {
    expect(getOrdinal(101)).toBe('101st')
  })
})

describe('formatTiming', () => {
  test('formats daily schedule', () => {
    const timing: ScheduleTiming = {
      frequency: 'daily',
      time: '09:00',
    }
    const result = formatTiming(timing)
    expect(result).toBe('Daily at 9:00 AM')
  })

  test('formats weekly schedule with single day', () => {
    const timing: ScheduleTiming = {
      frequency: 'weekly',
      time: '14:30',
      daysOfWeek: [1],
    }
    const result = formatTiming(timing)
    expect(result).toBe('Mon at 2:30 PM')
  })

  test('formats weekly schedule with multiple days', () => {
    const timing: ScheduleTiming = {
      frequency: 'weekly',
      time: '08:00',
      daysOfWeek: [1, 3, 5],
    }
    const result = formatTiming(timing)
    expect(result).toBe('Mon, Wed, Fri at 8:00 AM')
  })

  test('formats weekdays schedule', () => {
    const timing: ScheduleTiming = {
      frequency: 'weekly',
      time: '09:00',
      daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
    }
    const result = formatTiming(timing)
    expect(result).toBe('Weekdays at 9:00 AM')
  })

  test('formats weekends schedule', () => {
    const timing: ScheduleTiming = {
      frequency: 'weekly',
      time: '10:00',
      daysOfWeek: [0, 6], // Sun, Sat
    }
    const result = formatTiming(timing)
    expect(result).toBe('Weekends at 10:00 AM')
  })

  test('formats monthly schedule', () => {
    const timing: ScheduleTiming = {
      frequency: 'monthly',
      time: '10:00',
      date: 15,
    }
    const result = formatTiming(timing)
    expect(result).toBe('Monthly on the 15th at 10:00 AM')
  })

  test('formats monthly schedule with ordinal edge cases', () => {
    expect(formatTiming({ frequency: 'monthly', time: '10:00', date: 1 }))
      .toBe('Monthly on the 1st at 10:00 AM')
    expect(formatTiming({ frequency: 'monthly', time: '10:00', date: 2 }))
      .toBe('Monthly on the 2nd at 10:00 AM')
    expect(formatTiming({ frequency: 'monthly', time: '10:00', date: 3 }))
      .toBe('Monthly on the 3rd at 10:00 AM')
    expect(formatTiming({ frequency: 'monthly', time: '10:00', date: 11 }))
      .toBe('Monthly on the 11th at 10:00 AM')
    expect(formatTiming({ frequency: 'monthly', time: '10:00', date: 12 }))
      .toBe('Monthly on the 12th at 10:00 AM')
    expect(formatTiming({ frequency: 'monthly', time: '10:00', date: 13 }))
      .toBe('Monthly on the 13th at 10:00 AM')
    expect(formatTiming({ frequency: 'monthly', time: '10:00', date: 21 }))
      .toBe('Monthly on the 21st at 10:00 AM')
    expect(formatTiming({ frequency: 'monthly', time: '10:00', date: 31 }))
      .toBe('Monthly on the 31st at 10:00 AM')
  })

  test('formats once schedule', () => {
    const timing: ScheduleTiming = {
      frequency: 'once',
      time: '16:00',
      date: '2025-07-04',
    }
    const result = formatTiming(timing)
    expect(result).toContain('4:00 PM')
    expect(result).toContain('Jul')
    expect(result).toContain('4')
  })

  test('formats cron schedule', () => {
    const timing: ScheduleTiming = {
      frequency: 'cron',
      time: '00:00',
      cronExpression: '0 9 * * 1-5',
    }
    expect(formatTiming(timing)).toBe('0 9 * * 1-5')
  })
})

describe('formatNextRun', () => {
  test('formats relative time for today', () => {
    const now = new Date()
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
    const result = formatNextRun(inOneHour.toISOString())
    expect(result).toContain('Today')
  })

  test('formats relative time for tomorrow', () => {
    const now = new Date()
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const result = formatNextRun(tomorrow.toISOString())
    expect(result).toContain('Tomorrow')
  })

  test('returns "Not scheduled" for undefined', () => {
    expect(formatNextRun(undefined)).toBe('Not scheduled')
  })
})

describe('getNextNRuns', () => {
  const fixedNow = new Date('2025-06-15T10:00:00Z') // Sunday, June 15, 2025

  test('daily returns 5 consecutive days', () => {
    const timing: ScheduleTiming = {
      frequency: 'daily',
      time: '14:00',
    }
    const runs = getNextNRuns(timing, 5, fixedNow)
    expect(runs).toHaveLength(5)

    // Each run should be one day apart
    for (let i = 1; i < runs.length; i++) {
      const diff = runs[i]!.getTime() - runs[i - 1]!.getTime()
      // Should be exactly 24 hours apart
      expect(diff).toBe(24 * 60 * 60 * 1000)
    }
  })

  test('weekly Mon/Wed/Fri returns alternating days', () => {
    const timing: ScheduleTiming = {
      frequency: 'weekly',
      time: '09:00',
      daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
    }
    const runs = getNextNRuns(timing, 5, fixedNow)
    expect(runs).toHaveLength(5)

    // All results should be on Mon, Wed, or Fri
    for (const run of runs) {
      expect([1, 3, 5]).toContain(run.getDay())
    }

    // Should be in ascending order
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]!.getTime()).toBeGreaterThan(runs[i - 1]!.getTime())
    }
  })

  test('once returns at most 1 result', () => {
    const timing: ScheduleTiming = {
      frequency: 'once',
      time: '09:00',
      date: '2025-06-20',
    }
    const runs = getNextNRuns(timing, 5, fixedNow)
    expect(runs).toHaveLength(1)
  })

  test('past once returns 0 results', () => {
    const timing: ScheduleTiming = {
      frequency: 'once',
      time: '09:00',
      date: '2025-06-10', // Already passed
    }
    const runs = getNextNRuns(timing, 5, fixedNow)
    expect(runs).toHaveLength(0)
  })

  test('monthly returns dates on the correct day', () => {
    const timing: ScheduleTiming = {
      frequency: 'monthly',
      time: '09:00',
      date: 20,
    }
    const runs = getNextNRuns(timing, 5, fixedNow)
    expect(runs).toHaveLength(5)

    // Each run should be on the 20th (or clamped for short months)
    for (const run of runs) {
      expect(run.getDate()).toBe(20)
    }

    // Should span 5 consecutive months
    const months = runs.map(r => r.getMonth())
    for (let i = 1; i < months.length; i++) {
      const expected = (months[i - 1]! + 1) % 12
      expect(months[i]).toBe(expected)
    }
  })

  test('cron returns correct results', () => {
    const timing: ScheduleTiming = {
      frequency: 'cron',
      time: '00:00',
      cronExpression: '0 9 * * 1-5', // Weekdays at 9am
    }
    const runs = getNextNRuns(timing, 5, fixedNow)
    expect(runs).toHaveLength(5)

    for (const run of runs) {
      expect(run.getDay()).toBeGreaterThanOrEqual(1)
      expect(run.getDay()).toBeLessThanOrEqual(5)
      expect(run.getHours()).toBe(9)
      expect(run.getMinutes()).toBe(0)
    }
  })

  test('returns empty array for invalid timing', () => {
    const timing: ScheduleTiming = {
      frequency: 'cron',
      time: '00:00',
      cronExpression: 'invalid',
    }
    const runs = getNextNRuns(timing, 5, fixedNow)
    expect(runs).toHaveLength(0)
  })

  test('defaults to current time when after not provided', () => {
    const timing: ScheduleTiming = {
      frequency: 'daily',
      time: '23:59',
    }
    const runs = getNextNRuns(timing, 1)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.getTime()).toBeGreaterThan(Date.now() - 60000)
  })
})
