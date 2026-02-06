/**
 * Schedules Atom
 *
 * Simple atom for storing workspace schedules.
 * Used by NavigationContext for auto-selection when navigating to schedules view.
 */

import { atom } from 'jotai'
import type { ScheduleConfig } from '@craft-agent/shared/schedules/browser'

/**
 * Atom to store the current workspace's schedules.
 * AppShell populates this when schedules are loaded.
 * NavigationContext reads from it for auto-selection.
 */
export const schedulesAtom = atom<ScheduleConfig[]>([])
