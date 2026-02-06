/**
 * Schedule Templates
 *
 * Pre-built schedule configurations that users can select
 * as starting points when creating a new schedule.
 */

import type { ScheduleFrequency, DayOfWeek } from '@craft-agent/shared/schedules/browser'

export interface ScheduleTemplate {
  id: string
  name: string
  description: string
  icon: string
  defaults: {
    frequency: ScheduleFrequency
    time: string
    daysOfWeek?: DayOfWeek[]
    date?: string
    cronExpression?: string
  }
}

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    id: 'daily-morning',
    name: 'Daily Morning Briefing',
    description: 'Every day at 8:00 AM',
    icon: '\u2600\uFE0F',
    defaults: {
      frequency: 'daily',
      time: '08:00',
    },
  },
  {
    id: 'weekday-standup',
    name: 'Weekday Standup Prep',
    description: 'Mon-Fri at 8:30 AM',
    icon: '\uD83D\uDCCB',
    defaults: {
      frequency: 'weekly',
      time: '08:30',
      daysOfWeek: [1, 2, 3, 4, 5],
    },
  },
  {
    id: 'weekly-report',
    name: 'Weekly Report',
    description: 'Every Friday at 5:00 PM',
    icon: '\uD83D\uDCCA',
    defaults: {
      frequency: 'weekly',
      time: '17:00',
      daysOfWeek: [5],
    },
  },
  {
    id: 'monthly-review',
    name: 'Monthly Review',
    description: '1st of each month at 9:00 AM',
    icon: '\uD83D\uDCC5',
    defaults: {
      frequency: 'monthly',
      time: '09:00',
      date: '1',
    },
  },
  {
    id: 'end-of-day',
    name: 'End of Day Summary',
    description: 'Every day at 5:30 PM',
    icon: '\uD83C\uDF07',
    defaults: {
      frequency: 'daily',
      time: '17:30',
    },
  },
]
