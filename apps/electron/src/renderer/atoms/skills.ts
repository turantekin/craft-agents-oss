/**
 * Skills Atom
 *
 * Simple atom for storing workspace skills and preferences.
 * Used by NavigationContext for auto-selection when navigating to skills view.
 */

import { atom } from 'jotai'
import type { LoadedSkill } from '../../shared/types'
import type { SkillPreferences } from '@craft-agent/shared/skills'

/**
 * Atom to store the current workspace's skills.
 * AppShell populates this when skills are loaded.
 * NavigationContext reads from it for auto-selection.
 */
export const skillsAtom = atom<LoadedSkill[]>([])

/**
 * Atom to store skill preferences for the current workspace.
 * Used by App.tsx to check if auto-switch mode is enabled for a skill.
 */
export const skillPreferencesAtom = atom<SkillPreferences>({})
