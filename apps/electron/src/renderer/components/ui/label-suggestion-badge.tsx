/**
 * LabelSuggestionBadge - Displays an AI-suggested label with accept/dismiss actions.
 *
 * Shows with a dotted border and sparkle icon to indicate it's an AI suggestion
 * pending user acceptance. Hovering reveals accept (checkmark) and dismiss (X) buttons.
 *
 * Layout: [sparkle] [colored circle] [name] [value?] [accept|dismiss]
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { LabelIcon } from './label-icon'
import { formatDisplayValue } from '@craft-agent/shared/labels'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { Sparkles, Check, X } from 'lucide-react'

export interface LabelSuggestionBadgeProps {
  /** Label configuration (for color, name, valueType) */
  label: LabelConfig
  /** Suggested value for typed labels */
  value?: string
  /** Called when user accepts the suggestion */
  onAccept: () => void
  /** Called when user dismisses the suggestion */
  onDismiss: () => void
  className?: string
}

export function LabelSuggestionBadge({
  label,
  value,
  onAccept,
  onDismiss,
  className,
}: LabelSuggestionBadgeProps) {
  const displayValue = value ? formatDisplayValue(value, label.valueType) : undefined

  return (
    <div
      className={cn(
        // Base chip styles with dotted border for suggestion appearance
        'group inline-flex items-center gap-1.5 h-6 px-2 rounded-[5px]',
        'text-[12px] leading-none text-foreground/70 select-none',
        'bg-background/50 border border-dashed border-foreground/20',
        'transition-colors',
        className
      )}
    >
      {/* Sparkle icon indicating AI suggestion */}
      <Sparkles className="h-3 w-3 text-accent/70 shrink-0" />

      {/* Colored circle representing the label */}
      <LabelIcon label={label} size="xs" />

      {/* Label name */}
      <span className="truncate max-w-[80px]">{label.name}</span>

      {/* Optional value */}
      {displayValue && (
        <>
          <span className="text-foreground/30">·</span>
          <span className="text-[11px] text-foreground/50 truncate max-w-[80px]">
            {displayValue}
          </span>
        </>
      )}

      {/* Accept/dismiss buttons - visible on hover */}
      <div className="flex items-center gap-0.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAccept()
          }}
          className={cn(
            'p-0.5 rounded hover:bg-green-500/20 text-foreground/50 hover:text-green-600',
            'transition-colors'
          )}
          title="Accept suggestion"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          className={cn(
            'p-0.5 rounded hover:bg-red-500/20 text-foreground/50 hover:text-red-500',
            'transition-colors'
          )}
          title="Dismiss suggestion"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
