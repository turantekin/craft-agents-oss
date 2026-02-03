/**
 * QuickChoiceBlock - Interactive choice buttons for markdown code blocks
 *
 * When the markdown viewer encounters a ```choices code block, this component
 * renders clickable pill buttons that auto-send the selection as a user message.
 *
 * Supports both numbered (1. Option) and bullet (- Option) list formats.
 * Handles emojis and special characters gracefully.
 */

import * as React from 'react'
import { MousePointerClick } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface QuickChoiceBlockProps {
  /** Raw content from the choices code block */
  code: string
  /** Callback when a choice is selected */
  onChoiceSelect?: (choice: string) => void
  className?: string
}

interface ParsedChoice {
  /** The full text to send when clicked (includes number/bullet) */
  full: string
  /** The display text (without number/bullet prefix) */
  display: string
}

/**
 * Parse choices from code block content.
 * Supports:
 * - Numbered lists: "1. Option", "2. Option"
 * - Bullet lists: "- Option", "* Option"
 * - Plain lines (fallback)
 */
function parseChoices(code: string): ParsedChoice[] {
  const lines = code.split('\n').filter((line) => line.trim().length > 0)
  const choices: ParsedChoice[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Match numbered list: "1. Option text" or "1) Option text"
    const numberedMatch = trimmed.match(/^(\d+)[.)]\s*(.+)$/)
    if (numberedMatch && numberedMatch[2]) {
      choices.push({
        full: trimmed,
        display: numberedMatch[2].trim(),
      })
      continue
    }

    // Match bullet list: "- Option" or "* Option"
    const bulletMatch = trimmed.match(/^[-*]\s*(.+)$/)
    if (bulletMatch && bulletMatch[1]) {
      choices.push({
        full: trimmed,
        display: bulletMatch[1].trim(),
      })
      continue
    }

    // Fallback: use the whole line
    if (trimmed.length > 0) {
      choices.push({
        full: trimmed,
        display: trimmed,
      })
    }
  }

  return choices
}

export function QuickChoiceBlock({ code, onChoiceSelect, className }: QuickChoiceBlockProps) {
  const choices = React.useMemo(() => parseChoices(code), [code])

  // Don't render anything if no valid choices
  if (choices.length === 0) {
    return null
  }

  const handleChoiceClick = (choice: ParsedChoice) => {
    onChoiceSelect?.(choice.full)
  }

  return (
    <div
      className={cn(
        'bg-accent/10 border border-accent/30 rounded-[8px] p-3 my-3',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2.5">
        <MousePointerClick className="h-3.5 w-3.5" />
        <span>Quick Choice</span>
      </div>

      {/* Choice buttons */}
      <div className="flex flex-wrap gap-2">
        {choices.map((choice, i) => (
          <button
            key={i}
            onClick={() => handleChoiceClick(choice)}
            className={cn(
              'px-3 py-1.5 text-sm bg-background border border-border',
              'rounded-full cursor-pointer',
              'hover:bg-foreground/5 hover:border-foreground/20',
              'active:bg-foreground/10',
              'transition-colors duration-150'
            )}
          >
            {choice.display}
          </button>
        ))}
      </div>
    </div>
  )
}
