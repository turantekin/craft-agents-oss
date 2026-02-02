/**
 * Label Types
 *
 * Types for configurable session labels.
 * Labels are additive tags (many-per-session), unlike statuses which are exclusive (one-per-session).
 * Stored at {workspaceRootPath}/labels/config.json
 *
 * Hierarchy: Labels form a recursive JSON tree via the `children` array.
 * Array position determines display order (no separate order field).
 * IDs are simple slugs, globally unique across the entire tree.
 *
 * Visual: Labels are identified by color only (rendered as colored circles).
 *
 * Color format: EntityColor (system color string or custom color object)
 * - System: "accent", "foreground/50", "info/80" (uses CSS variables, auto light/dark)
 * - Custom: { light: "#EF4444", dark: "#F87171" } (explicit values)
 */

import type { EntityColor } from '../colors/types.ts'

/**
 * Auto-label rule: regex pattern that scans user messages and automatically
 * applies labels with extracted values.
 *
 * Uses capture groups ($1, $2, etc.) in the pattern and substitutes them
 * into the valueTemplate. Rules are evaluated in order. Multiple rules on
 * the same label means multiple ways to trigger it (e.g., URL regex + bare
 * key regex for issue IDs).
 */
export interface AutoLabelRule {
  /** Regex pattern with capture groups for value extraction */
  pattern: string
  /** Regex flags (default: 'gi' for global, case-insensitive). 'g' is always enforced. */
  flags?: string
  /** Template for the label value using $1, $2, etc. for capture group substitution */
  valueTemplate?: string
  /** Human-readable description of what this rule matches */
  description?: string
}

/**
 * AI classification settings for a label.
 * When present, the AI evaluator analyzes user messages for semantic matches
 * using Claude Haiku for fast, cost-efficient classification.
 */
export interface AiClassificationConfig {
  /**
   * Human-readable description of when this label should apply.
   * This is the primary input to the AI classifier.
   * Example: "Conversations about debugging or fixing errors in code"
   */
  description: string

  /**
   * How AI matches should be applied:
   * - 'suggest': Show as suggestion, user must accept (default, safer)
   * - 'auto': Auto-apply like regex rules (faster workflow)
   */
  mode?: 'suggest' | 'auto'

  /**
   * Optional value extraction hint for valued labels (those with valueType).
   * When set, AI will attempt to extract a value matching this guidance.
   * Example for priority: "Extract priority level (1-5, or map low/medium/high to 2/3/4)"
   */
  valueHint?: string
}

/**
 * Label configuration (stored in labels/config.json).
 * Recursive: each label can have nested children forming a tree.
 * Array position = display order (no explicit order field needed).
 */
export interface LabelConfig {
  /** Unique ID — simple slug, globally unique across the tree (e.g., 'bug', 'frontend') */
  id: string;

  /** Display name */
  name: string;

  /** Optional color. Rendered as a colored circle in the UI. */
  color?: EntityColor;

  /** Child labels forming a sub-tree. Array position = display order. */
  children?: LabelConfig[];

  /**
   * Optional value type hint for UI rendering and agent affordances.
   * When set, indicates this label carries a typed value (e.g., "priority::3").
   * Parser always infers the type from raw value, but this hint tells UI
   * what input widget to show and tells the agent what format to write.
   * Omit for boolean (presence-only) labels.
   */
  valueType?: 'string' | 'number' | 'date';

  /**
   * Auto-label rules: regex patterns that scan user messages and automatically
   * apply this label with extracted values.
   * Multiple rules = multiple ways to trigger (evaluated in order, all matches collected).
   */
  autoRules?: AutoLabelRule[];

  /**
   * AI classification settings for this label.
   * When present, the AI evaluator will analyze messages for semantic matches.
   * Uses Claude Haiku for fast, cost-efficient classification.
   * Omit to disable AI classification for this label (regex-only or manual).
   */
  aiClassification?: AiClassificationConfig;
}

/**
 * Complete label configuration for a workspace
 */
export interface WorkspaceLabelConfig {
  /** Schema version (start at 1) */
  version: number;

  /** Root-level labels. Array position = display order. May contain nested children. */
  labels: LabelConfig[];
}

/**
 * Input for creating a new label (via CRUD operations).
 * parentId determines where in the tree to insert (null/undefined = root level).
 */
export interface CreateLabelInput {
  name: string;
  color?: EntityColor;
  parentId?: string; // Target parent label ID (null = root)
  valueType?: 'string' | 'number' | 'date';
}

/**
 * Input for updating an existing label (name, color, valueType — cannot change ID or hierarchy)
 */
export interface UpdateLabelInput {
  name?: string;
  color?: EntityColor;
  valueType?: 'string' | 'number' | 'date';
}

/**
 * Parsed session label entry (after splitting on ::).
 * Session labels are stored as flat strings like "bug" or "priority::3".
 * This interface represents the parsed form for typed access.
 */
export interface ParsedLabelEntry {
  /** Label ID (the part before ::, or the entire string for boolean labels) */
  id: string;

  /** Raw string value (the part after ::), undefined for boolean labels */
  rawValue?: string;

  /**
   * Typed value inferred from rawValue:
   * - number: if rawValue parses as a finite number
   * - Date: if rawValue matches ISO date format (YYYY-MM-DD)
   * - string: otherwise
   * - undefined: for boolean labels (no :: separator)
   */
  value?: string | number | Date;
}
