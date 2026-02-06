/**
 * ScheduleInfoPage
 *
 * Displays comprehensive schedule details including timing,
 * execution configuration, and history.
 * Uses the Info_ component system for consistent styling.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { Calendar, Clock, Play, Pause, PlayCircle, Pencil, AlertCircle, CheckCircle, History, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { ScheduleMenu } from '@/components/app-shell/ScheduleMenu'
import { routes, navigate } from '@/lib/navigate'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Badge,
  type BadgeColor,
} from '@/components/info'
import { Button } from '@/components/ui/button'
import {
  formatNextRun,
  formatTiming,
  getNextNRuns,
  type ScheduleConfig,
  type ScheduleHistoryEntry,
} from '@craft-agent/shared/schedules/browser'

interface ScheduleInfoPageProps {
  scheduleId: string
  workspaceId: string
  onEditSchedule?: (schedule: ScheduleConfig) => void
}

export default function ScheduleInfoPage({ scheduleId, workspaceId, onEditSchedule }: ScheduleInfoPageProps) {
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load schedule data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSchedule = async () => {
      try {
        const result = await window.electronAPI.getSchedule(workspaceId, scheduleId)

        if (!isMounted) return

        if (result) {
          setSchedule(result)
        } else {
          setError('Schedule not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load schedule')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSchedule()

    // Subscribe to schedule changes
    const unsubscribe = window.electronAPI.onSchedulesChanged?.(() => {
      // Reload schedule when config changes
      loadSchedule()
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, scheduleId])

  // Handle run now
  const handleRunNow = useCallback(async () => {
    if (!schedule) return

    try {
      const result = await window.electronAPI.runScheduleNow(workspaceId, scheduleId)
      if (result.success) {
        toast.success(`Schedule "${schedule.name}" started`)
        if (result.sessionId) {
          // Optionally navigate to the session
          navigate(routes.view.allChats(result.sessionId))
        }
      } else {
        toast.error('Failed to run schedule', {
          description: result.error,
        })
      }
    } catch (err) {
      toast.error('Failed to run schedule', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [schedule, workspaceId, scheduleId])

  // Handle pause
  const handlePause = useCallback(async () => {
    if (!schedule) return

    try {
      await window.electronAPI.pauseSchedule(workspaceId, scheduleId)
      toast.success(`Schedule "${schedule.name}" paused`)
    } catch (err) {
      toast.error('Failed to pause schedule', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [schedule, workspaceId, scheduleId])

  // Handle resume
  const handleResume = useCallback(async () => {
    if (!schedule) return

    try {
      await window.electronAPI.resumeSchedule(workspaceId, scheduleId)
      toast.success(`Schedule "${schedule.name}" resumed`)
    } catch (err) {
      toast.error('Failed to resume schedule', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [schedule, workspaceId, scheduleId])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!schedule) return

    try {
      await window.electronAPI.deleteSchedule(workspaceId, scheduleId)
      toast.success(`Deleted schedule: ${schedule.name}`)
      navigate(routes.view.schedules())
    } catch (err) {
      toast.error('Failed to delete schedule', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [schedule, workspaceId, scheduleId])

  // Get schedule name for header
  const scheduleName = schedule?.name || scheduleId

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!schedule && !loading && !error ? 'Schedule not found' : undefined}
    >
      <Info_Page.Header
        title={scheduleName}
        titleMenu={
          schedule && (
            <ScheduleMenu
              schedule={schedule}
              onEdit={onEditSchedule ? () => onEditSchedule(schedule) : undefined}
              onRunNow={handleRunNow}
              onPause={handlePause}
              onResume={handleResume}
              onDelete={handleDelete}
            />
          )
        }
      />

      {schedule && (
        <Info_Page.Content>
          {/* Hero: Icon, title, and description */}
          <Info_Page.Hero
            avatar={<ScheduleHeroAvatar schedule={schedule} />}
            title={schedule.name}
            tagline={schedule.description || formatTiming(schedule.timing)}
          />

          {/* Quick Actions */}
          <div className="flex items-center gap-2 px-4 pb-4">
            {schedule.status !== 'completed' && onEditSchedule && (
              <Button variant="outline" size="sm" onClick={() => onEditSchedule(schedule)}>
                <Pencil className="h-4 w-4 mr-1.5" />
                Edit
              </Button>
            )}
            {schedule.status === 'active' && (
              <Button variant="outline" size="sm" onClick={handlePause}>
                <Pause className="h-4 w-4 mr-1.5" />
                Pause
              </Button>
            )}
            {(schedule.status === 'paused' || schedule.status === 'error') && (
              <Button variant="outline" size="sm" onClick={handleResume}>
                <Play className="h-4 w-4 mr-1.5" />
                Resume
              </Button>
            )}
            {schedule.status !== 'completed' && (
              <Button variant="outline" size="sm" onClick={handleRunNow}>
                <PlayCircle className="h-4 w-4 mr-1.5" />
                Run Now
              </Button>
            )}
          </div>

          {/* Schedule Details */}
          <Info_Section title="Schedule">
            <Info_Table>
              <Info_Table.Row label="Status">
                <ScheduleStatusBadge status={schedule.status} />
              </Info_Table.Row>
              <Info_Table.Row label="Frequency">
                {formatTiming(schedule.timing)}
              </Info_Table.Row>
              <Info_Table.Row label="Time">
                {formatTimeDisplay(schedule.timing.time)}
              </Info_Table.Row>
              {schedule.nextRunAt && schedule.status === 'active' && (
                <Info_Table.Row label="Next Run">
                  {formatNextRun(schedule.nextRunAt)}
                </Info_Table.Row>
              )}
              {schedule.status === 'active' && (
                <Info_Table.Row label="Upcoming">
                  <UpcomingRuns timing={schedule.timing} />
                </Info_Table.Row>
              )}
              {schedule.lastRunAt && (
                <Info_Table.Row label="Last Run">
                  {formatLastRun(schedule.lastRunAt)}
                </Info_Table.Row>
              )}
              {schedule.timing.timezone && (
                <Info_Table.Row label="Timezone">
                  {schedule.timing.timezone}
                </Info_Table.Row>
              )}
              {schedule.group && (
                <Info_Table.Row label="Group">
                  {schedule.group}
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>

          {/* Execution Configuration */}
          <Info_Section title="Execution">
            <Info_Table>
              {schedule.execution.skillSlug && (
                <Info_Table.Row label="Skill">
                  {schedule.execution.skillSlug}
                </Info_Table.Row>
              )}
              {schedule.execution.prompt && (
                <Info_Table.Row label="Prompt">
                  <span className="line-clamp-3">{schedule.execution.prompt}</span>
                </Info_Table.Row>
              )}
              {schedule.sessionConfig?.permissionMode && (
                <Info_Table.Row label="Permission Mode">
                  {getPermissionModeLabel(schedule.sessionConfig.permissionMode)}
                </Info_Table.Row>
              )}
              {schedule.sessionConfig?.model && (
                <Info_Table.Row label="Model">
                  {schedule.sessionConfig.model}
                </Info_Table.Row>
              )}
              <Info_Table.Row label="Open on Run">
                {schedule.openOnRun ? 'Yes' : 'No'}
              </Info_Table.Row>
              {schedule.sessionConfig?.enabledSourceSlugs &&
               schedule.sessionConfig.enabledSourceSlugs.length > 0 && (
                <Info_Table.Row label="Sources">
                  <div className="flex flex-wrap gap-1">
                    {schedule.sessionConfig.enabledSourceSlugs.map(slug => (
                      <span key={slug} className="text-xs px-2 py-0.5 rounded-full bg-foreground/5 border border-border/50">
                        {slug}
                      </span>
                    ))}
                  </div>
                </Info_Table.Row>
              )}
              {schedule.retryOnFailure && (
                <Info_Table.Row label="Retry on Failure">
                  Up to {schedule.maxRetries ?? 3} retries
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>

          {/* Execution History */}
          {schedule.history && schedule.history.length > 0 && (
            <Info_Section title="History">
              <div className="px-4 py-2 space-y-2">
                {schedule.history.slice(0, 10).map((entry, index) => (
                  <HistoryEntry key={index} entry={entry} />
                ))}
              </div>
            </Info_Section>
          )}
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}

/**
 * Hero avatar for schedule
 */
function ScheduleHeroAvatar({ schedule }: { schedule: ScheduleConfig }) {
  if (schedule.icon) {
    return (
      <div className="flex items-center justify-center w-16 h-16 text-4xl rounded-2xl bg-foreground/5">
        {schedule.icon}
      </div>
    )
  }

  const Icon = schedule.status === 'paused' ? Pause
    : schedule.status === 'error' ? AlertCircle
    : schedule.status === 'completed' ? CheckCircle
    : Calendar

  return (
    <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-foreground/5">
      <Icon className="h-8 w-8 text-foreground/70" />
    </div>
  )
}

/**
 * Status badge component
 */
function ScheduleStatusBadge({ status }: { status: ScheduleConfig['status'] }) {
  const config: Record<ScheduleConfig['status'], { label: string; color: BadgeColor }> = {
    active: { label: 'Active', color: 'success' },
    paused: { label: 'Paused', color: 'warning' },
    completed: { label: 'Completed', color: 'muted' },
    error: { label: 'Error', color: 'destructive' },
  }

  const { label, color } = config[status]

  return <Info_Badge color={color}>{label}</Info_Badge>
}

/**
 * History entry component
 */
function HistoryEntry({ entry }: { entry: ScheduleHistoryEntry }) {
  const handleViewSession = () => {
    if (entry.sessionId) {
      navigate(routes.view.allChats(entry.sessionId))
    }
  }

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 border border-border/50">
      <div className="flex items-center gap-3">
        {/* Status icon */}
        <div className={`flex items-center justify-center w-6 h-6 rounded-full ${
          entry.success ? 'bg-success/20' : 'bg-destructive/20'
        }`}>
          {entry.success ? (
            <CheckCircle className="h-3.5 w-3.5 text-success" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
          )}
        </div>
        {/* Details */}
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">
              {formatHistoryDate(entry.executedAt)}
            </span>
            {entry.isRetry && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning font-medium">
                Retry {entry.retryAttempt}
              </span>
            )}
          </div>
          {entry.error && (
            <span className="text-xs text-destructive">{entry.error}</span>
          )}
          {entry.durationMs && !entry.error && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(entry.durationMs)}
            </span>
          )}
        </div>
      </div>
      {/* View session button */}
      {entry.sessionId && entry.success && (
        <button
          onClick={handleViewSession}
          className="text-xs text-foreground/60 hover:text-foreground flex items-center gap-1"
        >
          View Session
          <ExternalLink className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

/**
 * Shows next 5 upcoming run dates for an active schedule.
 */
function UpcomingRuns({ timing }: { timing: import('@craft-agent/shared/schedules/browser').ScheduleTiming }) {
  const runs = React.useMemo(() => {
    try {
      return getNextNRuns(timing, 5)
    } catch {
      return []
    }
  }, [timing])

  if (runs.length === 0) {
    return <span className="text-muted-foreground">None</span>
  }

  return (
    <div className="space-y-0.5">
      {runs.map((date, i) => (
        <div key={i} className="text-sm">
          {date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}{' '}
          at{' '}
          {date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * Format time for display (24h to 12h)
 */
function formatTimeDisplay(time: string): string {
  const [hoursStr, minutesStr] = time.split(':')
  const hours = parseInt(hoursStr || '0', 10)
  const minutes = minutesStr || '00'
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${minutes} ${period}`
}

/**
 * Format last run date
 */
function formatLastRun(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Format history date
 */
function formatHistoryDate(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Get permission mode label
 */
function getPermissionModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    safe: 'Explore (read-only)',
    ask: 'Ask to Edit',
    'allow-all': 'Auto',
  }
  return labels[mode] || mode
}
