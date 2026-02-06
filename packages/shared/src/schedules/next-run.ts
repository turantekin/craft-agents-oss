/**
 * Next Run Calculator
 *
 * Calculates the next execution time for a schedule based on its timing configuration.
 * Supports: once, daily, weekly, monthly, and cron frequencies.
 *
 * No external dependencies - uses native Date APIs.
 */

import type { ScheduleTiming, DayOfWeek } from './types.ts';
import { debug } from '../utils/debug.ts';

// ============================================================
// Main Calculator
// ============================================================

/**
 * Calculate the next run time for a schedule.
 * Returns null if the schedule should not run again (e.g., completed one-time schedule).
 *
 * @param timing - The schedule timing configuration
 * @param after - Calculate next run after this time (defaults to now)
 * @returns Date of next run, or null if no future runs
 */
export function calculateNextRun(
  timing: ScheduleTiming,
  after: Date = new Date()
): Date | null {
  switch (timing.frequency) {
    case 'once':
      return calculateOnceNextRun(timing, after);
    case 'daily':
      return calculateDailyNextRun(timing, after);
    case 'weekly':
      return calculateWeeklyNextRun(timing, after);
    case 'monthly':
      return calculateMonthlyNextRun(timing, after);
    case 'cron':
      return calculateCronNextRun(timing, after);
    default:
      debug(`[calculateNextRun] Unknown frequency: ${(timing as ScheduleTiming).frequency}`);
      return null;
  }
}

// ============================================================
// Frequency-Specific Calculators
// ============================================================

/**
 * Calculate next run for one-time schedules.
 * Returns null if the scheduled date/time is in the past.
 */
function calculateOnceNextRun(timing: ScheduleTiming, after: Date): Date | null {
  if (!timing.date || typeof timing.date !== 'string') {
    debug('[calculateOnceNextRun] Missing or invalid date for once schedule');
    return null;
  }

  const [hours, minutes] = parseTime(timing.time);
  const targetDate = new Date(timing.date);
  targetDate.setHours(hours, minutes, 0, 0);

  const adjusted = adjustForTimezone(targetDate, timing.timezone);

  // If the target time is in the past, return null (schedule is completed)
  if (adjusted <= after) {
    return null;
  }

  return adjusted;
}

/**
 * Calculate next run for daily schedules.
 * If today's time has passed, returns tomorrow's time.
 */
function calculateDailyNextRun(timing: ScheduleTiming, after: Date): Date | null {
  const [hours, minutes] = parseTime(timing.time);

  const next = new Date(after);
  next.setHours(hours, minutes, 0, 0);

  let adjusted = adjustForTimezone(next, timing.timezone);

  // If today's time has passed, move to tomorrow
  if (adjusted <= after) {
    next.setDate(next.getDate() + 1);
    adjusted = adjustForTimezone(next, timing.timezone);
  }

  return adjusted;
}

/**
 * Calculate next run for weekly schedules.
 * Finds the next occurrence on specified days of the week.
 */
function calculateWeeklyNextRun(timing: ScheduleTiming, after: Date): Date | null {
  const daysOfWeek = timing.daysOfWeek;
  if (!daysOfWeek || daysOfWeek.length === 0) {
    debug('[calculateWeeklyNextRun] No days specified for weekly schedule');
    return null;
  }

  const [hours, minutes] = parseTime(timing.time);

  // Sort days to ensure consistent ordering
  const sortedDays = [...daysOfWeek].sort((a, b) => a - b);

  // Start from today
  const next = new Date(after);
  next.setHours(hours, minutes, 0, 0);

  // Search up to 8 days ahead (covers all possible cases)
  for (let i = 0; i < 8; i++) {
    const candidateDay = next.getDay() as DayOfWeek;

    // Check if this day is in the schedule
    if (sortedDays.includes(candidateDay)) {
      const adjusted = adjustForTimezone(next, timing.timezone);
      // If this is today and time hasn't passed, use it
      // If this is a future day, use it
      if (adjusted > after) {
        return adjusted;
      }
    }

    // Move to next day
    next.setDate(next.getDate() + 1);
  }

  // This shouldn't happen if daysOfWeek is valid
  debug('[calculateWeeklyNextRun] Could not find next run day');
  return null;
}

/**
 * Calculate next run for monthly schedules.
 * If the requested day doesn't exist in a month (e.g., day 31 in February),
 * clamps to the last day of that month instead of rolling over.
 */
function calculateMonthlyNextRun(timing: ScheduleTiming, after: Date): Date | null {
  const dayOfMonth = timing.date;
  if (typeof dayOfMonth !== 'number' || dayOfMonth < 1 || dayOfMonth > 31) {
    debug('[calculateMonthlyNextRun] Invalid day of month:', dayOfMonth);
    return null;
  }

  const [hours, minutes] = parseTime(timing.time);

  // Try up to 13 months ahead (covers current + next 12)
  for (let monthOffset = 0; monthOffset < 13; monthOffset++) {
    const next = new Date(after);
    next.setMonth(next.getMonth() + monthOffset);

    // Clamp to last day of month if requested day doesn't exist
    const lastDayOfMonth = getLastDayOfMonth(next.getFullYear(), next.getMonth());
    const actualDay = Math.min(dayOfMonth, lastDayOfMonth);

    next.setDate(actualDay);
    next.setHours(hours, minutes, 0, 0);

    const adjusted = adjustForTimezone(next, timing.timezone);
    if (adjusted > after) {
      return adjusted;
    }
  }

  debug('[calculateMonthlyNextRun] Could not find next run within 13 months');
  return null;
}

/**
 * Get the last day of a given month.
 * @param year - Full year (e.g., 2025)
 * @param month - Zero-based month (0=January, 11=December)
 */
function getLastDayOfMonth(year: number, month: number): number {
  // Day 0 of the *next* month gives the last day of the current month
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Calculate next run for cron schedules.
 * Supports standard 5-field cron expressions: minute hour day-of-month month day-of-week
 *
 * Examples:
 * - "0 9 * * 1-5" - 9am on weekdays
 * - "30 14 * * *" - 2:30pm every day
 * - "0 8 1 * *" - 8am on the 1st of every month
 */
function calculateCronNextRun(timing: ScheduleTiming, after: Date): Date | null {
  if (!timing.cronExpression) {
    debug('[calculateCronNextRun] Missing cron expression');
    return null;
  }

  try {
    const cron = parseCronExpression(timing.cronExpression);
    return findNextCronMatch(cron, after);
  } catch (error) {
    debug('[calculateCronNextRun] Failed to parse cron expression:', error);
    return null;
  }
}

// ============================================================
// Cron Expression Parser
// ============================================================

interface ParsedCron {
  minutes: number[];  // 0-59
  hours: number[];    // 0-23
  daysOfMonth: number[];  // 1-31
  months: number[];   // 1-12
  daysOfWeek: number[];   // 0-6 (Sunday=0)
  dayOfMonthWild: boolean;  // true if day-of-month field was *
  dayOfWeekWild: boolean;   // true if day-of-week field was *
}

/**
 * Parse a cron expression into its components.
 * Supports: *, ranges (1-5), lists (1,3,5), and specific values.
 */
function parseCronExpression(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  const [minutePart, hourPart, dayOfMonthPart, monthPart, dayOfWeekPart] = parts;

  return {
    minutes: parseCronField(minutePart!, 0, 59),
    hours: parseCronField(hourPart!, 0, 23),
    daysOfMonth: parseCronField(dayOfMonthPart!, 1, 31),
    months: parseCronField(monthPart!, 1, 12),
    daysOfWeek: parseCronField(dayOfWeekPart!, 0, 6),
    dayOfMonthWild: dayOfMonthPart === '*',
    dayOfWeekWild: dayOfWeekPart === '*',
  };
}

/**
 * Parse a single cron field into an array of valid values.
 */
function parseCronField(field: string, min: number, max: number): number[] {
  // Handle wildcard
  if (field === '*') {
    return range(min, max);
  }

  const values: number[] = [];

  // Handle comma-separated values
  const parts = field.split(',');
  for (const part of parts) {
    // Handle range (e.g., "1-5")
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);

      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
        throw new Error(`Invalid range in cron field: ${part}`);
      }

      values.push(...range(start, end));
    } else {
      // Handle single value
      const value = parseInt(part, 10);
      if (isNaN(value) || value < min || value > max) {
        throw new Error(`Invalid value in cron field: ${part}`);
      }
      values.push(value);
    }
  }

  // Remove duplicates and sort
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Find the next date that matches the cron schedule.
 * Searches up to 366 days ahead (1 year + leap day).
 */
function findNextCronMatch(cron: ParsedCron, after: Date): Date | null {
  // Start from the next minute
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 366 days
  const maxIterations = 366 * 24 * 60; // Max minutes to search

  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getMonth() + 1; // 1-12
    const dayOfMonth = candidate.getDate(); // 1-31
    const dayOfWeek = candidate.getDay(); // 0-6
    const hour = candidate.getHours(); // 0-23
    const minute = candidate.getMinutes(); // 0-59

    // Check if all fields match
    const monthMatches = cron.months.includes(month);
    const dayOfMonthMatches = cron.daysOfMonth.includes(dayOfMonth);
    const dayOfWeekMatches = cron.daysOfWeek.includes(dayOfWeek);
    const hourMatches = cron.hours.includes(hour);
    const minuteMatches = cron.minutes.includes(minute);

    // Day matching: POSIX cron semantics
    // - If both day-of-month and day-of-week are restricted (not *), use OR (either can match)
    // - If only one is restricted, use that one alone
    // - If both are *, any day matches
    let dayMatches: boolean;
    if (!cron.dayOfMonthWild && !cron.dayOfWeekWild) {
      // Both restricted: OR logic
      dayMatches = dayOfMonthMatches || dayOfWeekMatches;
    } else if (!cron.dayOfMonthWild) {
      // Only day-of-month restricted
      dayMatches = dayOfMonthMatches;
    } else if (!cron.dayOfWeekWild) {
      // Only day-of-week restricted
      dayMatches = dayOfWeekMatches;
    } else {
      // Both wildcard: any day matches
      dayMatches = true;
    }

    if (monthMatches && dayMatches && hourMatches && minuteMatches) {
      return candidate;
    }

    // Move to next minute
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  debug('[findNextCronMatch] Could not find match within 1 year');
  return null;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Parse a time string (HH:MM) into hours and minutes.
 */
function parseTime(time: string): [number, number] {
  const [hoursStr, minutesStr] = time.split(':');
  const hours = parseInt(hoursStr || '0', 10);
  const minutes = parseInt(minutesStr || '0', 10);

  // Validate
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    debug(`[parseTime] Invalid time format: ${time}, defaulting to 00:00`);
    return [0, 0];
  }

  return [hours, minutes];
}

/**
 * Get the UTC offset in minutes for a given timezone at a specific point in time.
 * Returns the offset such that: localTime = UTC + offset.
 * Returns 0 (UTC) if the timezone is invalid.
 */
function getTimezoneOffsetMinutes(timezone: string, date: Date): number {
  try {
    // Format the date in the target timezone to extract components
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);

    // Build a UTC timestamp from the timezone-local components
    const tzYear = get('year');
    const tzMonth = get('month') - 1; // 0-based
    const tzDay = get('day');
    let tzHour = get('hour');
    // Intl may return 24 for midnight in some locales
    if (tzHour === 24) tzHour = 0;
    const tzMinute = get('minute');
    const tzSecond = get('second');

    const tzAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, tzSecond);
    const utcMs = date.getTime();

    // offset = tzLocal - UTC (in minutes)
    return Math.round((tzAsUtc - utcMs) / 60000);
  } catch {
    debug(`[getTimezoneOffsetMinutes] Invalid timezone: ${timezone}`);
    return 0;
  }
}

/**
 * Adjust a Date that was constructed in local time so that its
 * wall-clock reading corresponds to the given IANA timezone instead.
 *
 * If timezone is undefined, returns the date unchanged (uses system timezone).
 */
function adjustForTimezone(date: Date, timezone?: string): Date {
  if (!timezone) return date;

  // date was built with setHours(h, m, 0, 0) in local time.
  // We want h:m to be in `timezone` instead.
  // Strategy: find the difference between local offset and target offset,
  // then shift the date accordingly.
  const localOffsetMin = -date.getTimezoneOffset(); // local offset from UTC in minutes (positive = east)
  const targetOffsetMin = getTimezoneOffsetMinutes(timezone, date);
  const diffMin = localOffsetMin - targetOffsetMin;

  if (diffMin === 0) return date;

  return new Date(date.getTime() + diffMin * 60000);
}

/**
 * Generate a range of numbers (inclusive).
 */
function range(start: number, end: number): number[] {
  const result: number[] = [];
  for (let i = start; i <= end; i++) {
    result.push(i);
  }
  return result;
}

// ============================================================
// Helper Functions for UI
// ============================================================

/**
 * Format next run time as a human-readable string.
 * Returns relative descriptions like "Tomorrow at 8:00 AM" or "Friday at 5:00 PM"
 */
export function formatNextRun(nextRunAt: string | undefined): string {
  if (!nextRunAt) {
    return 'Not scheduled';
  }

  const date = new Date(nextRunAt);
  const now = new Date();

  // Check if today
  if (isSameDay(date, now)) {
    return `Today at ${formatTime(date)}`;
  }

  // Check if tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(date, tomorrow)) {
    return `Tomorrow at ${formatTime(date)}`;
  }

  // Check if within this week
  const daysUntil = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 7) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    return `${dayName} at ${formatTime(date)}`;
  }

  // Full date
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${dateStr} at ${formatTime(date)}`;
}

/**
 * Format a Date as time string (e.g., "8:00 AM")
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Check if two dates are on the same day.
 */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Format timing configuration as a human-readable string.
 * Used for displaying schedule frequency in lists.
 */
export function formatTiming(timing: ScheduleTiming): string {
  const time = formatTimeString(timing.time);

  switch (timing.frequency) {
    case 'once': {
      if (timing.date && typeof timing.date === 'string') {
        const date = new Date(timing.date);
        const dateStr = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        return `Once on ${dateStr} at ${time}`;
      }
      return `Once at ${time}`;
    }

    case 'daily':
      return `Daily at ${time}`;

    case 'weekly': {
      if (timing.daysOfWeek && timing.daysOfWeek.length > 0) {
        const dayNames = timing.daysOfWeek.map(d => getDayName(d));
        if (timing.daysOfWeek.length === 5 &&
            timing.daysOfWeek.includes(1) &&
            timing.daysOfWeek.includes(2) &&
            timing.daysOfWeek.includes(3) &&
            timing.daysOfWeek.includes(4) &&
            timing.daysOfWeek.includes(5)) {
          return `Weekdays at ${time}`;
        }
        if (timing.daysOfWeek.length === 2 &&
            timing.daysOfWeek.includes(0) &&
            timing.daysOfWeek.includes(6)) {
          return `Weekends at ${time}`;
        }
        return `${dayNames.join(', ')} at ${time}`;
      }
      return `Weekly at ${time}`;
    }

    case 'monthly': {
      if (typeof timing.date === 'number') {
        const ordinal = getOrdinal(timing.date);
        return `Monthly on the ${ordinal} at ${time}`;
      }
      return `Monthly at ${time}`;
    }

    case 'cron':
      return timing.cronExpression || 'Custom schedule';

    default:
      return 'Unknown schedule';
  }
}

/**
 * Format 24h time string to 12h format.
 */
function formatTimeString(time: string): string {
  const [hours, minutes] = parseTime(time);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Get short day name from day number.
 */
function getDayName(day: DayOfWeek): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[day] || '';
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 */
export function getOrdinal(n: number): string {
  const v = n % 100;
  // 11th, 12th, 13th are special cases (not 11st, 12nd, 13rd)
  if (v >= 11 && v <= 13) {
    return n + 'th';
  }
  const lastDigit = n % 10;
  if (lastDigit === 1) return n + 'st';
  if (lastDigit === 2) return n + 'nd';
  if (lastDigit === 3) return n + 'rd';
  return n + 'th';
}

/**
 * Calculate the next N run times for a schedule.
 * Returns up to n Date objects. Returns fewer if the schedule
 * has no more future runs (e.g., completed one-time schedule).
 */
export function getNextNRuns(
  timing: ScheduleTiming,
  n: number,
  after: Date = new Date()
): Date[] {
  const results: Date[] = [];
  let current = after;
  for (let i = 0; i < n; i++) {
    const next = calculateNextRun(timing, current);
    if (!next) break;
    results.push(next);
    // Advance past this result by 1 minute to find the next one
    current = new Date(next.getTime() + 60000);
  }
  return results;
}
