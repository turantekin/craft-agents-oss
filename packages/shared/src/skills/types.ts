/**
 * Skills Types
 *
 * Type definitions for workspace skills.
 * Skills are specialized instructions that extend Claude's capabilities.
 */

/**
 * A knowledge source linked to a skill.
 * Knowledge sources are markdown files that provide context/training data for the skill.
 */
export interface KnowledgeSource {
  /** Relative path from workspace root (e.g., "knowledge/audience-profile.md") */
  path: string;
  /** Display label for the source */
  label: string;
  /** Optional description of what this file contains */
  description?: string;
}

/**
 * Skill metadata from SKILL.md YAML frontmatter
 */
export interface SkillMetadata {
  /** Display name for the skill */
  name: string;
  /** Brief description shown in skill list */
  description: string;
  /** Optional file patterns that trigger this skill */
  globs?: string[];
  /** Optional tools to always allow when skill is active */
  alwaysAllow?: string[];
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "🔧")
   * - URL: auto-downloaded to icon.{ext} file
   * Note: Relative paths and inline SVG are NOT supported.
   */
  icon?: string;
  /**
   * Optional required permission mode for this skill.
   * If set, the app will auto-switch to this mode when the skill is invoked.
   * - 'safe': Read-only exploration (Explore mode)
   * - 'ask': Prompts for dangerous operations (Ask to Edit mode)
   * - 'allow-all': Everything allowed, no prompts (Execute mode)
   */
  requiredMode?: 'safe' | 'ask' | 'allow-all';
  /**
   * Optional knowledge sources that provide context for this skill.
   * These are markdown files containing training data, guidelines, or reference material.
   */
  knowledge?: KnowledgeSource[];
}

/** Source of a loaded skill */
export type SkillSource = 'global' | 'workspace' | 'project';

/**
 * A loaded skill with parsed content
 */
export interface LoadedSkill {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /** Full SKILL.md content (without frontmatter) */
  content: string;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to skill directory */
  path: string;
  /** Where this skill was loaded from */
  source: SkillSource;
}
