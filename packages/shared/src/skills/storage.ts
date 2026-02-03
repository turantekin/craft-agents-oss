/**
 * Skills Storage
 *
 * CRUD operations for workspace skills.
 * Skills are stored in {workspace}/skills/{slug}/ directories.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { LoadedSkill, SkillMetadata, KnowledgeSource } from './types.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Parsing
// ============================================================

/**
 * Parse and validate knowledge sources from frontmatter
 * @param raw - Raw knowledge array from YAML frontmatter
 * @returns Validated knowledge sources array, or undefined if none
 */
function parseKnowledgeSources(raw: unknown): KnowledgeSource[] | undefined {
  if (!raw || !Array.isArray(raw)) {
    return undefined;
  }

  const sources: KnowledgeSource[] = [];

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;

    const obj = item as Record<string, unknown>;

    // path and label are required
    if (typeof obj.path !== 'string' || !obj.path.trim()) continue;
    if (typeof obj.label !== 'string' || !obj.label.trim()) continue;

    sources.push({
      path: obj.path.trim(),
      label: obj.label.trim(),
      description: typeof obj.description === 'string' ? obj.description.trim() : undefined,
    });
  }

  return sources.length > 0 ? sources : undefined;
}

/**
 * Parse SKILL.md content and extract frontmatter + body
 */
function parseSkillFile(content: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    // Only accepts emoji or URL - rejects inline SVG and relative paths
    const icon = validateIconValue(parsed.data.icon, 'Skills');

    // Validate requiredMode if present
    const requiredMode = parsed.data.requiredMode as string | undefined;
    const validModes = ['safe', 'ask', 'allow-all'];
    const validatedRequiredMode = requiredMode && validModes.includes(requiredMode)
      ? requiredMode as 'safe' | 'ask' | 'allow-all'
      : undefined;

    // Parse and validate knowledge sources if present
    const knowledge = parseKnowledgeSources(parsed.data.knowledge);

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon,
        requiredMode: validatedRequiredMode,
        knowledge,
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function loadSkill(workspaceRoot: string, slug: string): LoadedSkill | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  // Check directory exists
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    return null;
  }

  // Check SKILL.md exists
  if (!existsSync(skillFile)) {
    return null;
  }

  // Read and parse SKILL.md
  let content: string;
  try {
    content = readFileSync(skillFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseSkillFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
  };
}

/**
 * Load all skills from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceSkills(workspaceRoot: string): LoadedSkill[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);

  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = loadSkill(workspaceRoot, entry.name);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch {
    // Ignore errors reading skills directory
  }

  return skills;
}

/**
 * Get icon path for a skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function getSkillIconPath(workspaceRoot: string, slug: string): string | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);

  if (!existsSync(skillDir)) {
    return null;
  }

  return findIconFile(skillDir) || null;
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete a skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function deleteSkill(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);

  if (!existsSync(skillDir)) {
    return false;
  }

  try {
    rmSync(skillDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a skill exists in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function skillExists(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  return existsSync(skillDir) && existsSync(skillFile);
}

/**
 * List skill slugs in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function listSkillSlugs(workspaceRoot: string): string[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);

  if (!existsSync(skillsDir)) {
    return [];
  }

  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const skillFile = join(skillsDir, entry.name, 'SKILL.md');
        return existsSync(skillFile);
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// ============================================================
// Icon Download (uses shared utilities)
// ============================================================

/**
 * Download an icon from a URL and save it to the skill directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSkillIcon(
  skillDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(skillDir, iconUrl, 'Skills');
}

/**
 * Check if a skill needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function skillNeedsIconDownload(skill: LoadedSkill): boolean {
  return needsIconDownload(skill.metadata.icon, skill.iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';

// ============================================================
// Skill Preferences (per-workspace user settings for skills)
// ============================================================

/**
 * User preferences for a specific skill
 */
export interface SkillPreference {
  /** Whether to auto-switch permission mode when this skill is invoked */
  autoSwitchMode?: boolean;
}

/**
 * Map of skill slug to preferences
 */
export interface SkillPreferences {
  [slug: string]: SkillPreference;
}

const SKILL_PREFERENCES_FILE = 'skill-preferences.json';

/**
 * Get path to skill preferences file for a workspace
 */
function getSkillPreferencesPath(workspaceRoot: string): string {
  return join(workspaceRoot, SKILL_PREFERENCES_FILE);
}

/**
 * Load skill preferences for a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadSkillPreferences(workspaceRoot: string): SkillPreferences {
  const prefsPath = getSkillPreferencesPath(workspaceRoot);

  try {
    if (!existsSync(prefsPath)) {
      return {};
    }
    const content = readFileSync(prefsPath, 'utf-8');
    return JSON.parse(content) as SkillPreferences;
  } catch {
    return {};
  }
}

/**
 * Save skill preferences for a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param prefs - Skill preferences to save
 */
export function saveSkillPreferences(workspaceRoot: string, prefs: SkillPreferences): void {
  const prefsPath = getSkillPreferencesPath(workspaceRoot);

  try {
    writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save skill preferences:', error);
  }
}

/**
 * Get preference for a specific skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill slug
 */
export function getSkillPreference(workspaceRoot: string, slug: string): SkillPreference {
  const prefs = loadSkillPreferences(workspaceRoot);
  return prefs[slug] ?? {};
}

/**
 * Update preference for a specific skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill slug
 * @param updates - Preference updates
 */
export function updateSkillPreference(
  workspaceRoot: string,
  slug: string,
  updates: Partial<SkillPreference>
): SkillPreference {
  const prefs = loadSkillPreferences(workspaceRoot);
  const current = prefs[slug] ?? {};
  const updated = { ...current, ...updates };

  // Remove undefined values
  Object.keys(updated).forEach((key) => {
    if (updated[key as keyof SkillPreference] === undefined) {
      delete updated[key as keyof SkillPreference];
    }
  });

  // If no preferences left, remove the skill entry
  if (Object.keys(updated).length === 0) {
    delete prefs[slug];
  } else {
    prefs[slug] = updated;
  }

  saveSkillPreferences(workspaceRoot, prefs);
  return updated;
}

// ============================================================
// Knowledge Source Utilities
// ============================================================

/**
 * Resolve a knowledge source path to an absolute path
 * @param workspaceRoot - Absolute path to workspace root
 * @param relativePath - Relative path from workspace root (e.g., "knowledge/audience.md")
 */
export function resolveKnowledgePath(workspaceRoot: string, relativePath: string): string {
  return join(workspaceRoot, relativePath);
}

/**
 * Check if a knowledge source file exists
 * @param workspaceRoot - Absolute path to workspace root
 * @param source - Knowledge source to check
 */
export function knowledgeSourceExists(workspaceRoot: string, source: KnowledgeSource): boolean {
  const fullPath = resolveKnowledgePath(workspaceRoot, source.path);
  return existsSync(fullPath);
}

/**
 * Read the content of a knowledge source file
 * @param workspaceRoot - Absolute path to workspace root
 * @param relativePath - Relative path from workspace root
 * @returns File content or null if not found
 */
export function readKnowledgeSource(workspaceRoot: string, relativePath: string): string | null {
  const fullPath = resolveKnowledgePath(workspaceRoot, relativePath);

  if (!existsSync(fullPath)) {
    return null;
  }

  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}
