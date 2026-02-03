/**
 * Skill Handoff System
 *
 * Enables skills to pass context to other skills via file-based handoffs.
 * When a skill wants to hand off to another skill (e.g., Trend to Post → Image Creator),
 * it creates a handoff file with the context. The target skill can then read this
 * context when it starts.
 *
 * Handoff flow:
 * 1. Source skill creates handoff via createHandoff()
 * 2. Deep link opens new chat with skill and handoff ID
 * 3. Target skill reads handoff via readHandoff() (auto-deletes after read)
 * 4. Orphaned handoffs are cleaned up after 24 hours
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { debug } from '../utils/debug.ts';

// ============================================================
// Types
// ============================================================

/**
 * Generic skill handoff structure.
 * The payload is typed by the caller.
 */
export interface SkillHandoff<T = unknown> {
  /** Unique handoff identifier */
  id: string;
  /** Source skill that created the handoff */
  source: string;
  /** Session ID of the source skill */
  sourceSessionId: string;
  /** Target skill that will receive the handoff */
  targetSkill: string;
  /** When the handoff was created */
  createdAt: string;
  /** The actual context data to pass */
  payload: T;
}

/**
 * Image Creator handoff payload structure.
 * Used when handing off from Trend to Post to Image Creator.
 */
export interface ImageCreatorHandoff {
  /** Platform for the post (determines aspect ratio) */
  platform: 'Instagram' | 'Twitter' | 'LinkedIn' | 'TikTok' | 'Facebook';
  /** Post format */
  format: 'carousel' | 'single-image' | 'reel' | 'story' | 'thread';
  /** Number of slides for carousel */
  slideCount?: number;
  /** Topic/trend selected */
  topic: string;
  /** Persona selected */
  persona: string;
  /** Post content details */
  postContent: {
    hook?: string;
    slides?: string[];
    cta?: string;
    fullText?: string;
  };
  /** Visual style suggestions */
  visualSuggestions: string[];
  /** Auto-selected aspect ratio based on platform */
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3';
  /** Optional brand guidelines */
  brandGuidelines?: {
    primaryColor?: string;
    style?: string;
    avoidElements?: string[];
  };
}

// ============================================================
// Constants
// ============================================================

const HANDOFF_DIR = 'handoffs';
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================
// Handoff Functions
// ============================================================

/**
 * Get the handoffs directory path for a workspace.
 */
export function getHandoffsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, HANDOFF_DIR);
}

/**
 * Ensure the handoffs directory exists.
 */
function ensureHandoffsDir(workspaceRootPath: string): string {
  const dir = getHandoffsPath(workspaceRootPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Create a new skill handoff.
 *
 * @param workspaceRootPath - Path to the workspace root
 * @param source - Source skill identifier (e.g., 'trend-to-post')
 * @param sourceSessionId - Session ID of the source skill
 * @param targetSkill - Target skill identifier (e.g., 'image-creator')
 * @param payload - The context data to pass
 * @returns The handoff ID (used in deep link)
 */
export async function createHandoff<T>(
  workspaceRootPath: string,
  source: string,
  sourceSessionId: string,
  targetSkill: string,
  payload: T
): Promise<string> {
  const id = randomUUID();
  const handoffDir = ensureHandoffsDir(workspaceRootPath);

  const handoff: SkillHandoff<T> = {
    id,
    source,
    sourceSessionId,
    targetSkill,
    createdAt: new Date().toISOString(),
    payload,
  };

  const filePath = join(handoffDir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(handoff, null, 2), 'utf-8');

  debug(`[skill-handoff] Created handoff ${id}: ${source} → ${targetSkill}`);
  return id;
}

/**
 * Read a skill handoff by ID.
 * The handoff file is deleted after reading (one-time use).
 *
 * @param workspaceRootPath - Path to the workspace root
 * @param handoffId - The handoff ID to read
 * @returns The handoff data, or null if not found
 */
export async function readHandoff<T>(
  workspaceRootPath: string,
  handoffId: string
): Promise<SkillHandoff<T> | null> {
  const handoffPath = join(getHandoffsPath(workspaceRootPath), `${handoffId}.json`);

  try {
    if (!existsSync(handoffPath)) {
      debug(`[skill-handoff] Handoff not found: ${handoffId}`);
      return null;
    }

    const content = readFileSync(handoffPath, 'utf-8');
    const handoff = JSON.parse(content) as SkillHandoff<T>;

    // Delete after reading (one-time use)
    rmSync(handoffPath);
    debug(`[skill-handoff] Read and deleted handoff ${handoffId}`);

    return handoff;
  } catch (error) {
    debug(`[skill-handoff] Error reading handoff ${handoffId}: ${error}`);
    return null;
  }
}

/**
 * Check if a handoff exists (without reading/deleting it).
 *
 * @param workspaceRootPath - Path to the workspace root
 * @param handoffId - The handoff ID to check
 * @returns True if the handoff exists
 */
export function handoffExists(workspaceRootPath: string, handoffId: string): boolean {
  const handoffPath = join(getHandoffsPath(workspaceRootPath), `${handoffId}.json`);
  return existsSync(handoffPath);
}

/**
 * Clean up old handoff files that are past their TTL.
 * Call this on app startup or periodically.
 *
 * @param workspaceRootPath - Path to the workspace root
 * @returns Number of handoffs cleaned up
 */
export async function cleanupOldHandoffs(workspaceRootPath: string): Promise<number> {
  const handoffDir = getHandoffsPath(workspaceRootPath);

  if (!existsSync(handoffDir)) {
    return 0;
  }

  let cleaned = 0;
  const now = Date.now();

  try {
    const files = readdirSync(handoffDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = join(handoffDir, file);
      try {
        const stat = statSync(filePath);

        if (now - stat.mtimeMs > HANDOFF_TTL_MS) {
          rmSync(filePath);
          cleaned++;
          debug(`[skill-handoff] Cleaned up old handoff: ${file}`);
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }
  } catch (error) {
    debug(`[skill-handoff] Error during cleanup: ${error}`);
  }

  if (cleaned > 0) {
    debug(`[skill-handoff] Cleaned up ${cleaned} old handoffs`);
  }

  return cleaned;
}

/**
 * Build a deep link URL for opening a new chat with a skill and handoff.
 *
 * @param skillId - The skill to invoke (e.g., 'image-creator')
 * @param handoffId - Optional handoff ID to pass
 * @returns The craftagents:// deep link URL
 */
export function buildSkillDeepLink(skillId: string, handoffId?: string): string {
  let url = `craftagents://action/new-chat?skill=${encodeURIComponent(skillId)}`;
  if (handoffId) {
    url += `&handoff=${encodeURIComponent(handoffId)}`;
  }
  return url;
}
