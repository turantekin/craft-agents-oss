/**
 * ScheduleMenu - Shared menu content for schedule actions
 *
 * Used by:
 * - SchedulesListPanel (dropdown via "..." button, context menu via right-click)
 * - ScheduleInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent schedule actions:
 * - Run Now
 * - Pause/Resume
 * - Delete
 */

import * as React from 'react'
import { Play, Pause, PlayCircle, Pencil, Trash2 } from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import type { ScheduleConfig } from '@craft-agent/shared/schedules/browser'

export interface ScheduleMenuProps {
  /** Schedule config */
  schedule: ScheduleConfig
  /** Callbacks */
  onEdit?: () => void
  onRunNow: () => void
  onPause: () => void
  onResume: () => void
  onDelete: () => void
}

/**
 * ScheduleMenu - Renders the menu items for schedule actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function ScheduleMenu({
  schedule,
  onEdit,
  onRunNow,
  onPause,
  onResume,
  onDelete,
}: ScheduleMenuProps) {
  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator } = useMenuComponents()

  const isActive = schedule.status === 'active'
  const isPaused = schedule.status === 'paused' || schedule.status === 'error'
  const canRun = schedule.status !== 'completed'

  return (
    <>
      {/* Edit - available unless completed */}
      {canRun && onEdit && (
        <MenuItem onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          <span className="flex-1">Edit Schedule</span>
        </MenuItem>
      )}

      {/* Run Now - available unless completed */}
      {canRun && (
        <MenuItem onClick={onRunNow}>
          <PlayCircle className="h-3.5 w-3.5" />
          <span className="flex-1">Run Now</span>
        </MenuItem>
      )}

      {/* Pause - only for active schedules */}
      {isActive && (
        <MenuItem onClick={onPause}>
          <Pause className="h-3.5 w-3.5" />
          <span className="flex-1">Pause Schedule</span>
        </MenuItem>
      )}

      {/* Resume - only for paused or error schedules */}
      {isPaused && (
        <MenuItem onClick={onResume}>
          <Play className="h-3.5 w-3.5" />
          <span className="flex-1">Resume Schedule</span>
        </MenuItem>
      )}

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">Delete Schedule</span>
      </MenuItem>
    </>
  )
}
