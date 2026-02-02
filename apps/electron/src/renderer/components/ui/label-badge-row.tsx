/**
 * LabelBadgeRow - Renders a flex-wrap row of LabelBadge chips for applied session labels.
 *
 * Positioned above the RichTextInput in FreeFormInput. Each badge shows
 * the label's color, name, and optional typed value. Clicking a badge
 * opens a LabelValuePopover for editing or removing.
 *
 * Also renders AI-suggested labels (LabelSuggestionBadge) with accept/dismiss actions.
 *
 * Data flow:
 * - sessionLabels: string[] (e.g., ["bug", "priority::3", "due::2026-01-30"])
 * - labelSuggestions: LabelSuggestion[] (AI suggestions pending acceptance)
 * - labels: LabelConfig[] (workspace label tree for resolving colors/valueTypes)
 * - Parses each entry via parseLabelEntry() to extract id + rawValue
 * - Resolves LabelConfig from flat tree for color and valueType
 */

import * as React from 'react'
import { LabelBadge } from './label-badge'
import { LabelValuePopover } from './label-value-popover'
import { LabelSuggestionBadge } from './label-suggestion-badge'
import { parseLabelEntry, formatLabelEntry, extractLabelId } from '@craft-agent/shared/labels'
import type { LabelConfig } from '@craft-agent/shared/labels'
import type { LabelSuggestion } from '@craft-agent/shared/labels/auto'
import { cn } from '@/lib/utils'

export interface LabelBadgeRowProps {
  /** Applied session labels (encoded strings like "bug" or "priority::3") */
  sessionLabels: string[]
  /** AI-suggested labels pending user acceptance */
  labelSuggestions?: LabelSuggestion[]
  /** Full label config tree (for resolving colors, names, valueTypes) */
  labels: LabelConfig[]
  /** Called when a label value is changed — receives the updated full sessionLabels array */
  onLabelsChange?: (updatedLabels: string[]) => void
  /** Called when user accepts an AI suggestion */
  onSuggestionAccept?: (suggestion: LabelSuggestion) => void
  /** Called when user dismisses an AI suggestion */
  onSuggestionDismiss?: (labelId: string) => void
  /** Additional className for the container */
  className?: string
}

/**
 * Flatten a recursive LabelConfig tree into a map of id → LabelConfig
 * for O(1) lookup when resolving session label entries.
 */
function flattenLabelTree(labels: LabelConfig[]): Map<string, LabelConfig> {
  const map = new Map<string, LabelConfig>()
  function walk(items: LabelConfig[]) {
    for (const item of items) {
      map.set(item.id, item)
      if (item.children?.length) {
        walk(item.children)
      }
    }
  }
  walk(labels)
  return map
}

export function LabelBadgeRow({
  sessionLabels,
  labelSuggestions,
  labels,
  onLabelsChange,
  onSuggestionAccept,
  onSuggestionDismiss,
  className,
}: LabelBadgeRowProps) {
  // Track which badge's popover is open (by index)
  const [openIndex, setOpenIndex] = React.useState<number | null>(null)

  // Memoize flat lookup map (only recompute when labels config changes)
  const labelMap = React.useMemo(() => flattenLabelTree(labels), [labels])

  // Don't render if no labels applied and no suggestions
  const hasSuggestions = labelSuggestions && labelSuggestions.length > 0
  if (sessionLabels.length === 0 && !hasSuggestions) return null

  /** Update a specific label entry's value */
  const handleValueChange = (index: number, labelId: string, newValue: string | undefined) => {
    const updated = [...sessionLabels]
    updated[index] = formatLabelEntry(labelId, newValue)
    onLabelsChange?.(updated)
  }

  /** Remove a label at a specific index */
  const handleRemove = (index: number) => {
    const updated = sessionLabels.filter((_, i) => i !== index)
    onLabelsChange?.(updated)
  }

  return (
    <div className={cn('flex flex-wrap gap-1 px-4 pt-3 pb-1', className)}>
      {/* Applied labels */}
      {sessionLabels.map((entry, index) => {
        const parsed = parseLabelEntry(entry)
        const config = labelMap.get(parsed.id)

        // If no config found, create a minimal fallback so the badge still renders
        const resolvedConfig: LabelConfig = config ?? { id: parsed.id, name: parsed.id }

        return (
          <LabelValuePopover
            key={`${parsed.id}-${index}`}
            label={resolvedConfig}
            value={parsed.rawValue}
            open={openIndex === index}
            onOpenChange={(open) => setOpenIndex(open ? index : null)}
            onValueChange={(newValue) => handleValueChange(index, parsed.id, newValue)}
            onRemove={() => handleRemove(index)}
          >
            <LabelBadge
              label={resolvedConfig}
              value={parsed.rawValue}
              isActive={openIndex === index}
            />
          </LabelValuePopover>
        )
      })}

      {/* AI-suggested labels */}
      {labelSuggestions?.map((suggestion) => {
        const config = labelMap.get(suggestion.labelId)
        if (!config) return null

        return (
          <LabelSuggestionBadge
            key={`suggestion-${suggestion.labelId}`}
            label={config}
            value={suggestion.value}
            onAccept={() => onSuggestionAccept?.(suggestion)}
            onDismiss={() => onSuggestionDismiss?.(suggestion.labelId)}
          />
        )
      })}
    </div>
  )
}
