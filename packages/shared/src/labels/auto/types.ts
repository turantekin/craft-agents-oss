/**
 * Auto-Label Types
 *
 * Result types for the auto-label evaluation pipeline.
 * An AutoLabelMatch represents a single extracted label+value from a user message.
 */

/**
 * A single match from auto-label evaluation.
 * Represents a label that should be applied to the session.
 */
export interface AutoLabelMatch {
  /** Label ID to apply */
  labelId: string
  /** Normalized value ready for storage (already formatted per valueType) */
  value: string
  /** The original text in the message that triggered this match */
  matchedText: string
  /** Source of the match: 'regex' for pattern-based, 'ai' for AI classification */
  source?: 'regex' | 'ai'
}

/**
 * A label suggestion from AI classification, pending user acceptance.
 * Stored separately from applied labels until accepted by the user.
 * Suggestions appear in the UI with accept/dismiss actions.
 */
export interface LabelSuggestion {
  /** Label ID being suggested */
  labelId: string
  /** Optional value for typed labels (e.g., "3" for priority) */
  value?: string
  /** ID of the user message that triggered this suggestion */
  triggerMessageId: string
  /** Timestamp when the suggestion was created */
  suggestedAt: number
}
