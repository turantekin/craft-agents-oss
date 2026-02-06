/**
 * ScheduleCreator
 *
 * Dialog for creating new scheduled sessions.
 * Multi-step form:
 * 1. What to Run - Skill or custom prompt
 * 2. When to Run - Frequency, time, days
 * 3. Options - Permission mode, model, open on run
 */

import * as React from 'react'
import { useState, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useRegisterModal } from '@/context/ModalContext'
import { toast } from 'sonner'
import { Calendar, Zap, Settings2, ChevronLeft, ChevronRight, Clock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LoadedSkill } from '../../../shared/types'
import type { LoadedSource } from '@craft-agent/shared/sources/types'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { SCHEDULE_TEMPLATES } from './schedule-templates'
import {
  getNextNRuns,
  type ScheduleFrequency,
  type ScheduleTiming,
  type ScheduleConfig,
  type CreateScheduleInput,
  type UpdateScheduleInput,
  type DayOfWeek,
} from '@craft-agent/shared/schedules/browser'

// ============================================================
// Types
// ============================================================

interface ScheduleCreatorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  skills: LoadedSkill[]
  onCreated?: (scheduleId: string) => void
  /** When set, dialog edits this schedule instead of creating a new one */
  editSchedule?: ScheduleConfig | null
  onUpdated?: (scheduleId: string) => void
  /** Existing group names for autocomplete suggestions */
  existingGroups?: string[]
  /** Pre-fill values from deep link */
  initialValues?: { skill?: string; name?: string }
}

type Step = 'what' | 'when' | 'options'

interface FormData {
  // Step 1: What to run
  executionType: 'skill' | 'prompt'
  skillSlug: string
  prompt: string

  // Step 2: When to run
  name: string
  frequency: ScheduleFrequency
  time: string
  date: string // ISO date for 'once', or day number for 'monthly'
  daysOfWeek: DayOfWeek[]
  cronExpression: string
  timezone: string

  // Step 3: Options
  permissionMode: 'safe' | 'ask' | 'allow-all'
  openOnRun: boolean
  icon: string
  description: string
  group: string
  retryOnFailure: boolean
  maxRetries: number
  enabledSourceSlugs: string[]
}

/** Sentinel value for "use system default timezone" (Radix Select doesn't allow empty strings) */
const SYSTEM_TIMEZONE = '__system__'

const DEFAULT_FORM_DATA: FormData = {
  executionType: 'skill',
  skillSlug: '',
  prompt: '',
  name: '',
  frequency: 'daily',
  time: '09:00',
  date: '',
  daysOfWeek: [1, 2, 3, 4, 5], // Weekdays
  cronExpression: '',
  timezone: SYSTEM_TIMEZONE,
  permissionMode: 'ask',
  openOnRun: false,
  icon: '',
  description: '',
  group: '',
  retryOnFailure: false,
  maxRetries: 3,
  enabledSourceSlugs: [],
}

const DAYS_OF_WEEK: { value: DayOfWeek; label: string; short: string }[] = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
]

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
]

/**
 * Convert a ScheduleConfig back into FormData for editing.
 */
function formDataFromSchedule(schedule: ScheduleConfig): FormData {
  const hasSkill = !!schedule.execution.skillSlug
  return {
    executionType: hasSkill ? 'skill' : 'prompt',
    skillSlug: schedule.execution.skillSlug || '',
    prompt: schedule.execution.prompt || '',
    name: schedule.name,
    frequency: schedule.timing.frequency,
    time: schedule.timing.time,
    date: schedule.timing.frequency === 'monthly'
      ? String(schedule.timing.date ?? '')
      : String(schedule.timing.date ?? ''),
    daysOfWeek: schedule.timing.daysOfWeek ?? [1, 2, 3, 4, 5],
    cronExpression: schedule.timing.cronExpression || '',
    timezone: schedule.timing.timezone || SYSTEM_TIMEZONE,
    permissionMode: (schedule.sessionConfig?.permissionMode as FormData['permissionMode']) || 'ask',
    openOnRun: schedule.openOnRun ?? false,
    icon: schedule.icon || '',
    description: schedule.description || '',
    group: schedule.group || '',
    retryOnFailure: schedule.retryOnFailure ?? false,
    maxRetries: schedule.maxRetries ?? 3,
    enabledSourceSlugs: schedule.sessionConfig?.enabledSourceSlugs || [],
  }
}

// ============================================================
// Main Component
// ============================================================

export function ScheduleCreator({
  open,
  onOpenChange,
  workspaceId,
  skills,
  onCreated,
  editSchedule,
  onUpdated,
  existingGroups = [],
  initialValues,
}: ScheduleCreatorProps) {
  const isEditing = !!editSchedule
  const [step, setStep] = useState<Step>('what')
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM_DATA)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Load workspace sources for the source selector
  const [sources, setSources] = useState<LoadedSource[]>([])
  React.useEffect(() => {
    if (open && workspaceId) {
      window.electronAPI.getSources(workspaceId).then((loaded) => {
        setSources(loaded || [])
      }).catch(() => {
        setSources([])
      })
    }
  }, [open, workspaceId])

  // Register with modal context
  useRegisterModal(open, () => onOpenChange(false))

  // Reset or populate form when dialog opens/closes
  React.useEffect(() => {
    if (open && editSchedule) {
      setFormData(formDataFromSchedule(editSchedule))
      setStep('what')
    } else if (open && initialValues) {
      // Pre-fill from deep link params
      setFormData(prev => ({
        ...DEFAULT_FORM_DATA,
        ...(initialValues.skill ? { executionType: 'skill' as const, skillSlug: initialValues.skill } : {}),
        ...(initialValues.name ? { name: initialValues.name } : {}),
      }))
      setStep('what')
    } else if (!open) {
      setStep('what')
      setFormData(DEFAULT_FORM_DATA)
    }
  }, [open, editSchedule, initialValues])

  // Update form field
  const updateField = useCallback(<K extends keyof FormData>(
    field: K,
    value: FormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }, [])

  // Toggle day of week
  const toggleDay = useCallback((day: DayOfWeek) => {
    setFormData(prev => {
      const newDays = prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter(d => d !== day)
        : [...prev.daysOfWeek, day].sort((a, b) => a - b)
      return { ...prev, daysOfWeek: newDays }
    })
  }, [])

  // Generate default name from execution type
  const defaultName = useMemo(() => {
    if (formData.executionType === 'skill' && formData.skillSlug) {
      const skill = skills.find(s => s.slug === formData.skillSlug)
      return skill ? `${skill.metadata.name} Schedule` : 'New Schedule'
    }
    return 'New Schedule'
  }, [formData.executionType, formData.skillSlug, skills])

  // Validation
  const canProceedToWhen = formData.executionType === 'skill'
    ? !!formData.skillSlug
    : !!formData.prompt.trim()

  const canProceedToOptions = !!formData.time && (
    formData.frequency === 'once' ? !!formData.date :
    formData.frequency === 'weekly' ? formData.daysOfWeek.length > 0 :
    formData.frequency === 'monthly' ? !!formData.date :
    formData.frequency === 'cron' ? !!formData.cronExpression :
    true // daily
  )

  const canSubmit = canProceedToWhen && canProceedToOptions

  // Navigation
  const goToStep = (newStep: Step) => {
    setStep(newStep)
  }

  const goNext = () => {
    if (step === 'what') setStep('when')
    else if (step === 'when') setStep('options')
  }

  const goBack = () => {
    if (step === 'options') setStep('when')
    else if (step === 'when') setStep('what')
  }

  // Submit
  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return

    setIsSubmitting(true)
    try {
      // Build timing
      const timing: ScheduleTiming = {
        frequency: formData.frequency,
        time: formData.time,
      }

      if (formData.frequency === 'once') {
        timing.date = formData.date
      } else if (formData.frequency === 'weekly') {
        timing.daysOfWeek = formData.daysOfWeek
      } else if (formData.frequency === 'monthly') {
        timing.date = parseInt(formData.date, 10)
      } else if (formData.frequency === 'cron') {
        timing.cronExpression = formData.cronExpression
      }

      if (formData.timezone && formData.timezone !== SYSTEM_TIMEZONE) {
        timing.timezone = formData.timezone
      }

      if (isEditing && editSchedule) {
        // Update existing schedule
        const updates: UpdateScheduleInput = {
          name: formData.name || defaultName,
          description: formData.description || undefined,
          icon: formData.icon || undefined,
          timing,
          execution: formData.executionType === 'skill'
            ? { skillSlug: formData.skillSlug }
            : { prompt: formData.prompt },
          sessionConfig: {
            permissionMode: formData.permissionMode,
            enabledSourceSlugs: formData.enabledSourceSlugs.length > 0
              ? formData.enabledSourceSlugs
              : undefined,
          },
          openOnRun: formData.openOnRun,
          group: formData.group || undefined,
          retryOnFailure: formData.retryOnFailure || undefined,
          maxRetries: formData.retryOnFailure ? formData.maxRetries : undefined,
        }

        await window.electronAPI.updateSchedule(workspaceId, editSchedule.id, updates)
        toast.success(`Updated schedule: ${formData.name || defaultName}`)
        onOpenChange(false)
        onUpdated?.(editSchedule.id)
      } else {
        // Create new schedule
        const input: CreateScheduleInput = {
          name: formData.name || defaultName,
          description: formData.description || undefined,
          icon: formData.icon || undefined,
          timing,
          execution: formData.executionType === 'skill'
            ? { skillSlug: formData.skillSlug }
            : { prompt: formData.prompt },
          sessionConfig: {
            permissionMode: formData.permissionMode,
            enabledSourceSlugs: formData.enabledSourceSlugs.length > 0
              ? formData.enabledSourceSlugs
              : undefined,
          },
          status: 'active',
          openOnRun: formData.openOnRun,
          group: formData.group || undefined,
          retryOnFailure: formData.retryOnFailure || undefined,
          maxRetries: formData.retryOnFailure ? formData.maxRetries : undefined,
        }

        const schedule = await window.electronAPI.createSchedule(workspaceId, input)
        toast.success(`Created schedule: ${schedule.name}`)
        onOpenChange(false)
        onCreated?.(schedule.id)
      }
    } catch (err) {
      toast.error(isEditing ? 'Failed to update schedule' : 'Failed to create schedule', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Step indicator
  const steps: { id: Step; label: string; icon: React.ReactNode }[] = [
    { id: 'what', label: 'What', icon: <Zap className="h-4 w-4" /> },
    { id: 'when', label: 'When', icon: <Calendar className="h-4 w-4" /> },
    { id: 'options', label: 'Options', icon: <Settings2 className="h-4 w-4" /> },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Schedule' : 'Create Schedule'}</DialogTitle>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          {steps.map((s, index) => (
            <React.Fragment key={s.id}>
              {index > 0 && (
                <div className="h-px w-8 bg-border" />
              )}
              <button
                onClick={() => {
                  // Only allow going back or to completed steps
                  const currentIndex = steps.findIndex(st => st.id === step)
                  const targetIndex = steps.findIndex(st => st.id === s.id)
                  if (targetIndex <= currentIndex) {
                    goToStep(s.id)
                  }
                }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  step === s.id
                    ? 'bg-foreground/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {s.icon}
                {s.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Step Content */}
        <div className="py-4 min-h-[280px]">
          {step === 'what' && (
            <StepWhat
              formData={formData}
              skills={skills}
              updateField={updateField}
              isEditing={isEditing}
              setFormData={setFormData}
            />
          )}
          {step === 'when' && (
            <StepWhen
              formData={formData}
              updateField={updateField}
              toggleDay={toggleDay}
              defaultName={defaultName}
            />
          )}
          {step === 'options' && (
            <StepOptions
              formData={formData}
              updateField={updateField}
              existingGroups={existingGroups}
              sources={sources}
            />
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {step !== 'what' && (
            <Button variant="outline" onClick={goBack} disabled={isSubmitting}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <div className="flex-1" />
          {step !== 'options' ? (
            <Button
              onClick={goNext}
              disabled={step === 'what' ? !canProceedToWhen : !canProceedToOptions}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || isSubmitting}
            >
              {isSubmitting ? (isEditing ? 'Saving...' : 'Creating...') : (isEditing ? 'Save Changes' : 'Create Schedule')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Step 1: What to Run
// ============================================================

interface StepWhatProps {
  formData: FormData
  skills: LoadedSkill[]
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void
  isEditing: boolean
  setFormData: React.Dispatch<React.SetStateAction<FormData>>
}

function StepWhat({ formData, skills, updateField, isEditing, setFormData }: StepWhatProps) {
  return (
    <div className="space-y-4">
      {/* Templates (only when creating, not editing) */}
      {!isEditing && (
        <div className="space-y-2">
          <Label>Quick start</Label>
          <div className="grid grid-cols-2 gap-2">
            {SCHEDULE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFormData(prev => ({
                  ...prev,
                  ...t.defaults,
                  date: t.defaults.date ?? prev.date,
                  daysOfWeek: t.defaults.daysOfWeek ?? prev.daysOfWeek,
                  cronExpression: t.defaults.cronExpression ?? prev.cronExpression,
                }))}
                className="flex items-start gap-2 p-2.5 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
              >
                <span className="text-base mt-0.5">{t.icon}</span>
                <div>
                  <div className="text-xs font-medium">{t.name}</div>
                  <div className="text-[11px] text-muted-foreground">{t.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>What to run</Label>
        <div className="flex gap-2">
          <Button
            variant={formData.executionType === 'skill' ? 'default' : 'outline'}
            size="sm"
            onClick={() => updateField('executionType', 'skill')}
            className="flex-1"
          >
            <Zap className="h-4 w-4 mr-1.5" />
            Skill
          </Button>
          <Button
            variant={formData.executionType === 'prompt' ? 'default' : 'outline'}
            size="sm"
            onClick={() => updateField('executionType', 'prompt')}
            className="flex-1"
          >
            Custom Prompt
          </Button>
        </div>
      </div>

      {formData.executionType === 'skill' ? (
        <div className="space-y-2">
          <Label htmlFor="skill-select">Select a skill</Label>
          {skills.length > 0 ? (
            <Select
              value={formData.skillSlug}
              onValueChange={(value) => updateField('skillSlug', value)}
            >
              <SelectTrigger id="skill-select">
                <SelectValue placeholder="Choose a skill..." />
              </SelectTrigger>
              <SelectContent>
                {skills.map((skill) => (
                  <SelectItem key={skill.slug} value={skill.slug}>
                    {skill.metadata.icon && (
                      <span className="mr-2">{skill.metadata.icon}</span>
                    )}
                    {skill.metadata.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="text-sm text-muted-foreground p-3 rounded-md bg-muted/30 border border-border/50">
              No skills available. Create a skill first to use it in a schedule.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="prompt-input">Prompt to send</Label>
          <Textarea
            id="prompt-input"
            placeholder="Enter the prompt that will be sent when this schedule runs..."
            value={formData.prompt}
            onChange={(e) => updateField('prompt', e.target.value)}
            rows={4}
          />
        </div>
      )}
    </div>
  )
}

// ============================================================
// Step 2: When to Run
// ============================================================

interface StepWhenProps {
  formData: FormData
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void
  toggleDay: (day: DayOfWeek) => void
  defaultName: string
}

function StepWhen({ formData, updateField, toggleDay, defaultName }: StepWhenProps) {
  return (
    <div className="space-y-4">
      {/* Schedule Name */}
      <div className="space-y-2">
        <Label htmlFor="schedule-name">Name</Label>
        <Input
          id="schedule-name"
          placeholder={defaultName}
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
        />
      </div>

      {/* Frequency */}
      <div className="space-y-2">
        <Label>Frequency</Label>
        <Select
          value={formData.frequency}
          onValueChange={(value) => updateField('frequency', value as ScheduleFrequency)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="once">Once</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="cron">Custom (Cron)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Time (for all except cron) */}
      {formData.frequency !== 'cron' && (
        <div className="space-y-2">
          <Label htmlFor="schedule-time">Time</Label>
          <div className="flex gap-2">
            <Input
              id="schedule-time"
              type="time"
              value={formData.time}
              onChange={(e) => updateField('time', e.target.value)}
              className="flex-1"
            />
            <Select
              value={formData.timezone}
              onValueChange={(value) => updateField('timezone', value)}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="System default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SYSTEM_TIMEZONE}>System default</SelectItem>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Date for 'once' */}
      {formData.frequency === 'once' && (
        <div className="space-y-2">
          <Label htmlFor="schedule-date">Date</Label>
          <Input
            id="schedule-date"
            type="date"
            value={formData.date}
            onChange={(e) => updateField('date', e.target.value)}
            min={new Date().toISOString().split('T')[0]}
          />
        </div>
      )}

      {/* Days for 'weekly' */}
      {formData.frequency === 'weekly' && (
        <div className="space-y-2">
          <Label>Days of Week</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  formData.daysOfWeek.includes(day.value)
                    ? 'bg-foreground text-background'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                )}
              >
                {day.short}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Day of month for 'monthly' */}
      {formData.frequency === 'monthly' && (
        <div className="space-y-2">
          <Label htmlFor="schedule-day">Day of Month</Label>
          <Select
            value={formData.date}
            onValueChange={(value) => updateField('date', value)}
          >
            <SelectTrigger id="schedule-day">
              <SelectValue placeholder="Select day..." />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <SelectItem key={day} value={String(day)}>
                  {day}{getOrdinalSuffix(day)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Cron expression */}
      {formData.frequency === 'cron' && (
        <div className="space-y-2">
          <Label htmlFor="cron-expression">Cron Expression</Label>
          <Input
            id="cron-expression"
            placeholder="0 9 * * 1-5"
            value={formData.cronExpression}
            onChange={(e) => updateField('cronExpression', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Format: minute hour day-of-month month day-of-week
          </p>
        </div>
      )}

      {/* Next Runs Preview */}
      <NextRunsPreview formData={formData} />
    </div>
  )
}

/**
 * Shows preview of the next 5 run times based on current form data.
 */
function NextRunsPreview({ formData }: { formData: FormData }) {
  const timing = useMemo((): ScheduleTiming | null => {
    const t: ScheduleTiming = {
      frequency: formData.frequency,
      time: formData.time,
    }

    if (formData.frequency === 'once') {
      if (!formData.date) return null
      t.date = formData.date
    } else if (formData.frequency === 'weekly') {
      if (formData.daysOfWeek.length === 0) return null
      t.daysOfWeek = formData.daysOfWeek
    } else if (formData.frequency === 'monthly') {
      if (!formData.date) return null
      t.date = parseInt(formData.date, 10)
    } else if (formData.frequency === 'cron') {
      if (!formData.cronExpression) return null
      t.cronExpression = formData.cronExpression
    }

    if (formData.timezone && formData.timezone !== SYSTEM_TIMEZONE) {
      t.timezone = formData.timezone
    }

    return t
  }, [formData.frequency, formData.time, formData.date, formData.daysOfWeek, formData.cronExpression, formData.timezone])

  const nextRuns = useMemo(() => {
    if (!timing) return []
    try {
      return getNextNRuns(timing, 5)
    } catch {
      return []
    }
  }, [timing])

  if (nextRuns.length === 0) return null

  return (
    <div className="mt-1 p-3 rounded-lg bg-muted/30 border border-border/50">
      <div className="flex items-center gap-1.5 mb-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Next runs</span>
      </div>
      <div className="space-y-1">
        {nextRuns.map((date, i) => (
          <div key={i} className="text-xs text-foreground/80">
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
    </div>
  )
}

// ============================================================
// Step 3: Options
// ============================================================

interface StepOptionsProps {
  formData: FormData
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void
  existingGroups?: string[]
  sources: LoadedSource[]
}

function StepOptions({ formData, updateField, existingGroups = [], sources }: StepOptionsProps) {
  return (
    <div className="space-y-4">
      {/* Icon & Group row */}
      <div className="flex gap-3">
        <div className="space-y-2">
          <Label htmlFor="schedule-icon">Icon</Label>
          <Input
            id="schedule-icon"
            placeholder="e.g. 📊"
            value={formData.icon}
            onChange={(e) => updateField('icon', e.target.value)}
            maxLength={2}
            className="w-20"
          />
        </div>
        <div className="space-y-2 flex-1">
          <Label htmlFor="schedule-group">Group</Label>
          <Input
            id="schedule-group"
            list="group-suggestions"
            placeholder="e.g. Reports"
            value={formData.group}
            onChange={(e) => updateField('group', e.target.value)}
          />
          {existingGroups.length > 0 && (
            <datalist id="group-suggestions">
              {existingGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="schedule-description">Description (optional)</Label>
        <Textarea
          id="schedule-description"
          placeholder="Brief description of what this schedule does..."
          value={formData.description}
          onChange={(e) => updateField('description', e.target.value)}
          rows={2}
        />
      </div>

      {/* Permission Mode */}
      <div className="space-y-2">
        <Label>Permission Mode</Label>
        <Select
          value={formData.permissionMode}
          onValueChange={(value) => updateField('permissionMode', value as FormData['permissionMode'])}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="safe">Explore (read-only)</SelectItem>
            <SelectItem value="ask">Ask to Edit</SelectItem>
            <SelectItem value="allow-all">Auto</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {formData.permissionMode === 'safe' && 'Agent can only read files and explore the codebase'}
          {formData.permissionMode === 'ask' && 'Agent asks for permission before making changes'}
          {formData.permissionMode === 'allow-all' && 'Agent can make changes without asking'}
        </p>
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="space-y-2">
          <Label>Sources</Label>
          <p className="text-xs text-muted-foreground">
            Connect these sources when the schedule runs
          </p>
          <div className="rounded-lg border border-border/50 bg-muted/20 divide-y divide-border/30 max-h-[200px] overflow-y-auto">
            {sources.map((source) => {
              const isSelected = formData.enabledSourceSlugs.includes(source.config.slug)
              const needsAuth = !source.config.isAuthenticated
              return (
                <button
                  key={source.config.slug}
                  type="button"
                  onClick={() => {
                    const newSlugs = isSelected
                      ? formData.enabledSourceSlugs.filter(s => s !== source.config.slug)
                      : [...formData.enabledSourceSlugs, source.config.slug]
                    updateField('enabledSourceSlugs', newSlugs)
                  }}
                  className={cn(
                    'flex items-center gap-3 w-full px-3 py-2 text-left text-sm transition-colors',
                    'hover:bg-muted/40',
                    isSelected && 'bg-foreground/[0.03]'
                  )}
                >
                  <SourceAvatar source={source} size="sm" />
                  <span className="flex-1 truncate">{source.config.name}</span>
                  {needsAuth && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-medium shrink-0">
                      Needs Auth
                    </span>
                  )}
                  <div className={cn(
                    'shrink-0 h-4 w-4 rounded border flex items-center justify-center transition-colors',
                    isSelected
                      ? 'bg-foreground border-foreground'
                      : 'border-muted-foreground/30'
                  )}>
                    {isSelected && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Open on Run */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
        <div className="space-y-0.5">
          <Label htmlFor="open-on-run">Open when schedule runs</Label>
          <p className="text-xs text-muted-foreground">
            Automatically open the app and navigate to the session
          </p>
        </div>
        <Switch
          id="open-on-run"
          checked={formData.openOnRun}
          onCheckedChange={(checked) => updateField('openOnRun', checked)}
        />
      </div>

      {/* Retry on Failure */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="retry-on-failure">Retry on failure</Label>
            <p className="text-xs text-muted-foreground">
              Automatically retry if the schedule fails
            </p>
          </div>
          <Switch
            id="retry-on-failure"
            checked={formData.retryOnFailure}
            onCheckedChange={(checked) => updateField('retryOnFailure', checked)}
          />
        </div>
        {formData.retryOnFailure && (
          <div className="space-y-2">
            <Label>Max retries</Label>
            <Select
              value={String(formData.maxRetries)}
              onValueChange={(value) => updateField('maxRetries', parseInt(value, 10))}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Retries after 5, 15, and 60 minutes
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] || s[v] || s[0] || 'th'
}
