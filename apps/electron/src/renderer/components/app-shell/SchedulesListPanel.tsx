/**
 * SchedulesListPanel
 *
 * Panel component for displaying workspace schedules in the sidebar.
 * Styled to match SkillsListPanel with avatar, title, and subtitle layout.
 */

import * as React from 'react'
import { useState, useMemo } from 'react'
import { MoreHorizontal, Calendar, Clock, Pause, Play, AlertCircle, CheckCircle, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
} from '@/components/ui/styled-dropdown'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { DropdownMenuProvider, ContextMenuProvider } from '@/components/ui/menu-context'
import { ScheduleMenu } from './ScheduleMenu'
import { cn } from '@/lib/utils'
import { formatNextRun, formatTiming, type ScheduleConfig } from '@craft-agent/shared/schedules/browser'

export interface SchedulesListPanelProps {
  schedules: ScheduleConfig[]
  onScheduleClick: (schedule: ScheduleConfig) => void
  onPauseSchedule: (scheduleId: string) => void
  onResumeSchedule: (scheduleId: string) => void
  onRunNow: (scheduleId: string) => void
  onDeleteSchedule: (scheduleId: string) => void
  onEditSchedule?: (scheduleId: string) => void
  onCreateSchedule?: () => void
  selectedScheduleId?: string | null
  workspaceId?: string
  className?: string
}

export function SchedulesListPanel({
  schedules,
  onScheduleClick,
  onPauseSchedule,
  onResumeSchedule,
  onRunNow,
  onDeleteSchedule,
  onEditSchedule,
  onCreateSchedule,
  selectedScheduleId,
  workspaceId,
  className,
}: SchedulesListPanelProps) {
  // Empty state - rendered outside ScrollArea for proper vertical centering
  if (schedules.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1', className)}>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Calendar />
            </EmptyMedia>
            <EmptyTitle>No schedules configured</EmptyTitle>
            <EmptyDescription>
              Schedules let you run skills or prompts automatically at specific times.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <button
              onClick={onCreateSchedule}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
            >
              Create Schedule
            </button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  // Group schedules by group field
  const { ungrouped, groups } = useMemo(() => {
    const ungrouped: ScheduleConfig[] = []
    const groupMap = new Map<string, ScheduleConfig[]>()

    for (const schedule of schedules) {
      if (schedule.group) {
        const list = groupMap.get(schedule.group) || []
        list.push(schedule)
        groupMap.set(schedule.group, list)
      } else {
        ungrouped.push(schedule)
      }
    }

    // Sort group names alphabetically
    const groups = Array.from(groupMap.entries()).sort(([a], [b]) => a.localeCompare(b))
    return { ungrouped, groups }
  }, [schedules])

  const renderItem = (schedule: ScheduleConfig, isFirst: boolean) => (
    <ScheduleItem
      key={schedule.id}
      schedule={schedule}
      isSelected={selectedScheduleId === schedule.id}
      isFirst={isFirst}
      workspaceId={workspaceId}
      onClick={() => onScheduleClick(schedule)}
      onEdit={onEditSchedule ? () => onEditSchedule(schedule.id) : undefined}
      onPause={() => onPauseSchedule(schedule.id)}
      onResume={() => onResumeSchedule(schedule.id)}
      onRunNow={() => onRunNow(schedule.id)}
      onDelete={() => onDeleteSchedule(schedule.id)}
    />
  )

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      <ScrollArea className="flex-1">
        <div className="pb-2">
          <div className="pt-2">
            {/* Ungrouped schedules first */}
            {ungrouped.map((schedule, index) => renderItem(schedule, index === 0))}

            {/* Grouped schedules */}
            {groups.map(([groupName, groupSchedules]) => (
              <ScheduleGroup
                key={groupName}
                name={groupName}
                schedules={groupSchedules}
                selectedScheduleId={selectedScheduleId}
                workspaceId={workspaceId}
                onScheduleClick={onScheduleClick}
                onEditSchedule={onEditSchedule}
                onPauseSchedule={onPauseSchedule}
                onResumeSchedule={onResumeSchedule}
                onRunNow={onRunNow}
                onDeleteSchedule={onDeleteSchedule}
                isFirstGroup={ungrouped.length === 0}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * Collapsible schedule group section
 */
function ScheduleGroup({
  name,
  schedules,
  selectedScheduleId,
  workspaceId,
  onScheduleClick,
  onEditSchedule,
  onPauseSchedule,
  onResumeSchedule,
  onRunNow,
  onDeleteSchedule,
  isFirstGroup,
}: {
  name: string
  schedules: ScheduleConfig[]
  selectedScheduleId?: string | null
  workspaceId?: string
  onScheduleClick: (schedule: ScheduleConfig) => void
  onEditSchedule?: (scheduleId: string) => void
  onPauseSchedule: (scheduleId: string) => void
  onResumeSchedule: (scheduleId: string) => void
  onRunNow: (scheduleId: string) => void
  onDeleteSchedule: (scheduleId: string) => void
  isFirstGroup: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div>
      {!isFirstGroup && (
        <div className="pl-4 pr-4 pt-1">
          <Separator />
        </div>
      )}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        <FolderOpen className="h-3 w-3" />
        {name}
        <span className="text-foreground/30 ml-1">{schedules.length}</span>
      </button>
      {!collapsed && schedules.map((schedule, index) => (
        <ScheduleItem
          key={schedule.id}
          schedule={schedule}
          isSelected={selectedScheduleId === schedule.id}
          isFirst={index === 0}
          workspaceId={workspaceId}
          onClick={() => onScheduleClick(schedule)}
          onEdit={onEditSchedule ? () => onEditSchedule(schedule.id) : undefined}
          onPause={() => onPauseSchedule(schedule.id)}
          onResume={() => onResumeSchedule(schedule.id)}
          onRunNow={() => onRunNow(schedule.id)}
          onDelete={() => onDeleteSchedule(schedule.id)}
        />
      ))}
    </div>
  )
}

interface ScheduleItemProps {
  schedule: ScheduleConfig
  isSelected: boolean
  isFirst: boolean
  workspaceId?: string
  onClick: () => void
  onEdit?: () => void
  onPause: () => void
  onResume: () => void
  onRunNow: () => void
  onDelete: () => void
}

function ScheduleItem({
  schedule,
  isSelected,
  isFirst,
  workspaceId,
  onClick,
  onEdit,
  onPause,
  onResume,
  onRunNow,
  onDelete,
}: ScheduleItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)

  // Get status badge
  const statusBadge = getStatusBadge(schedule.status)

  return (
    <div className="schedule-item" data-selected={isSelected || undefined}>
      {/* Separator - only show if not first */}
      {!isFirst && (
        <div className="schedule-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      {/* Wrapper for button + dropdown + context menu, group for hover state */}
      <ContextMenu modal={true} onOpenChange={setContextMenuOpen}>
        <ContextMenuTrigger asChild>
          <div className="schedule-content relative group select-none pl-2 mr-2">
            {/* Schedule Icon - positioned absolutely */}
            <div className="absolute left-[18px] top-3.5 z-10 flex items-center justify-center">
              <ScheduleAvatar schedule={schedule} />
            </div>
            {/* Main content button */}
            <button
              className={cn(
                "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm transition-all outline-none rounded-[8px]",
                isSelected
                  ? "bg-foreground/5 hover:bg-foreground/7"
                  : "hover:bg-foreground/2"
              )}
              onClick={onClick}
            >
              {/* Spacer for avatar */}
              <div className="w-5 h-5 shrink-0" />
              {/* Content column */}
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                {/* Title - schedule name */}
                <div className="flex items-start gap-2 w-full pr-6 min-w-0">
                  <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                    {schedule.name}
                  </div>
                </div>
                {/* Subtitle - timing and status */}
                <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
                  <span className="truncate">
                    {formatTiming(schedule.timing)}
                  </span>
                  <span className="text-foreground/40">·</span>
                  <span className={cn("shrink-0", statusBadge.className)}>
                    {statusBadge.label}
                  </span>
                </div>
                {/* Next run time */}
                {schedule.status === 'active' && schedule.nextRunAt && (
                  <div className="flex items-center gap-1 text-xs text-foreground/50 -mb-[2px]">
                    <Clock className="h-3 w-3" />
                    <span>Next: {formatNextRun(schedule.nextRunAt)}</span>
                  </div>
                )}
              </div>
            </button>
            {/* Action buttons - visible on hover or when menu is open */}
            <div
              className={cn(
                "absolute right-2 top-2 transition-opacity z-10",
                menuOpen || contextMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
            >
              {/* More menu */}
              <div className="flex items-center rounded-[8px] overflow-hidden border border-transparent hover:border-border/50">
                <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <div className="p-1.5 hover:bg-foreground/10 data-[state=open]:bg-foreground/10 cursor-pointer">
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </DropdownMenuTrigger>
                  <StyledDropdownMenuContent align="end">
                    <DropdownMenuProvider>
                      <ScheduleMenu
                        schedule={schedule}
                        onEdit={onEdit}
                        onRunNow={onRunNow}
                        onPause={onPause}
                        onResume={onResume}
                        onDelete={onDelete}
                      />
                    </DropdownMenuProvider>
                  </StyledDropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        {/* Context menu - same content as dropdown */}
        <StyledContextMenuContent>
          <ContextMenuProvider>
            <ScheduleMenu
              schedule={schedule}
              onRunNow={onRunNow}
              onPause={onPause}
              onResume={onResume}
              onDelete={onDelete}
            />
          </ContextMenuProvider>
        </StyledContextMenuContent>
      </ContextMenu>
    </div>
  )
}

/**
 * Simple avatar component for schedules
 */
function ScheduleAvatar({ schedule }: { schedule: ScheduleConfig }) {
  // Use the schedule's icon if provided, otherwise use a default
  if (schedule.icon) {
    return (
      <div className="flex items-center justify-center w-5 h-5 text-sm">
        {schedule.icon}
      </div>
    )
  }

  // Default icon based on status
  const Icon = schedule.status === 'paused' ? Pause
    : schedule.status === 'error' ? AlertCircle
    : schedule.status === 'completed' ? CheckCircle
    : Calendar

  return (
    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-foreground/10">
      <Icon className="h-3 w-3 text-foreground/70" />
    </div>
  )
}

/**
 * Get status badge styling
 */
function getStatusBadge(status: ScheduleConfig['status']): { label: string; className: string } {
  switch (status) {
    case 'active':
      return { label: 'Active', className: 'text-success' }
    case 'paused':
      return { label: 'Paused', className: 'text-warning' }
    case 'completed':
      return { label: 'Completed', className: 'text-foreground/50' }
    case 'error':
      return { label: 'Error', className: 'text-destructive' }
    default:
      return { label: status, className: '' }
  }
}
