/**
 * AI-Based Label Evaluator
 *
 * Uses Claude Haiku to semantically classify user messages against
 * labels configured with aiClassification settings.
 *
 * Design principles:
 * - Single API call evaluates all AI-enabled labels at once (efficiency)
 * - Returns matches with optional values for typed labels
 * - Graceful failure: returns empty array on any error
 * - Non-blocking: runs async, doesn't delay message flow
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { getDefaultOptions } from '../../agent/options.ts'
import { SUMMARIZATION_MODEL } from '../../config/models.ts'
import { resolveModelId } from '../../config/storage.ts'
import type { LabelConfig } from '../types.ts'
import type { AutoLabelMatch } from './types.ts'
import { normalizeValue } from './normalize.ts'
import { debug } from '../../utils/debug.ts'

/** Maximum labels to evaluate in a single AI call (to keep prompt size reasonable) */
const MAX_AI_LABELS = 20

/** Maximum message length to send to AI (truncate to save tokens) */
const MAX_MESSAGE_LENGTH = 1000

/**
 * Recursively collect all labels that have AI classification enabled.
 * Walks the entire label tree depth-first.
 */
export function collectAiClassificationLabels(labels: LabelConfig[]): LabelConfig[] {
  const result: LabelConfig[] = []

  function walk(nodes: LabelConfig[]) {
    for (const label of nodes) {
      if (label.aiClassification?.description) {
        result.push(label)
      }
      if (label.children) {
        walk(label.children)
      }
    }
  }

  walk(labels)
  return result.slice(0, MAX_AI_LABELS)
}

/**
 * Evaluate AI classification for a user message.
 * Returns matches for labels that semantically match the message content.
 *
 * @param message - The user's message text
 * @param labels - The workspace label tree
 * @returns Array of AI-detected label matches (empty on failure)
 */
export async function evaluateAiLabels(
  message: string,
  labels: LabelConfig[]
): Promise<AutoLabelMatch[]> {
  const aiLabels = collectAiClassificationLabels(labels)

  if (aiLabels.length === 0) {
    return []
  }

  try {
    const truncatedMessage = message.slice(0, MAX_MESSAGE_LENGTH)
    const prompt = buildClassificationPrompt(truncatedMessage, aiLabels)

    const defaultOptions = getDefaultOptions()
    const options = {
      ...defaultOptions,
      model: resolveModelId(SUMMARIZATION_MODEL),
      maxTurns: 1,
    }

    let responseText = ''

    for await (const event of query({ prompt, options })) {
      if (event.type === 'assistant') {
        for (const block of event.message.content) {
          if (block.type === 'text') {
            responseText += block.text
          }
        }
      }
    }

    return parseClassificationResponse(responseText, aiLabels)
  } catch (error) {
    debug('[ai-label-evaluator] AI classification failed:', error)
    return []
  }
}

/**
 * Build the classification prompt for Claude.
 * Structured to get JSON-formatted responses for reliable parsing.
 */
function buildClassificationPrompt(message: string, labels: LabelConfig[]): string {
  const labelDescriptions = labels
    .map((l) => {
      let desc = `- "${l.id}": ${l.aiClassification!.description}`
      if (l.valueType && l.aiClassification!.valueHint) {
        desc += ` [Value: ${l.aiClassification!.valueHint}]`
      }
      return desc
    })
    .join('\n')

  return `Analyze this message and determine which labels apply.

Labels to consider:
${labelDescriptions}

Message:
"${message}"

Reply with ONLY a JSON array of matching labels. For each match include:
- "id": the label ID
- "value": extracted value if applicable (omit for boolean labels)

Example responses:
- [{"id": "bug"}] - single boolean label
- [{"id": "priority", "value": "3"}] - label with extracted value
- [] - no labels match

JSON:`
}

/**
 * Parse the AI response into structured matches.
 * Handles malformed JSON gracefully.
 */
function parseClassificationResponse(
  response: string,
  labels: LabelConfig[]
): AutoLabelMatch[] {
  try {
    // Extract JSON array from response (may have surrounding text)
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return []
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ id: string; value?: string }>

    if (!Array.isArray(parsed)) {
      return []
    }

    const labelMap = new Map(labels.map((l) => [l.id, l]))
    const matches: AutoLabelMatch[] = []

    for (const item of parsed) {
      if (!item || typeof item.id !== 'string') continue

      const label = labelMap.get(item.id)
      if (!label) continue // AI hallucinated a label ID

      let value = item.value ?? ''
      if (label.valueType && value) {
        value = normalizeValue(value, label.valueType)
      }

      matches.push({
        labelId: item.id,
        value,
        matchedText: '', // AI doesn't extract specific text
        source: 'ai',
      })
    }

    return matches
  } catch {
    return []
  }
}
