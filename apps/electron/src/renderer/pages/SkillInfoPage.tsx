/**
 * SkillInfoPage
 *
 * Displays comprehensive skill details including metadata,
 * permission modes, and instructions.
 * Uses the Info_ component system for consistent styling with SourceInfoPage.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { Check, X, Minus } from 'lucide-react'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { toast } from 'sonner'
import { SkillMenu } from '@/components/app-shell/SkillMenu'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { routes, navigate } from '@/lib/navigate'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import { Switch } from '@/components/ui/switch'
import { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/mode-types'
import { useSetAtom } from 'jotai'
import { skillPreferencesAtom } from '@/atoms/skills'
import type { LoadedSkill } from '../../shared/types'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
}

export default function SkillInfoPage({ skillSlug, workspaceId }: SkillInfoPageProps) {
  const [skill, setSkill] = useState<LoadedSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoSwitchMode, setAutoSwitchMode] = useState<boolean>(true) // Default to enabled
  const setSkillPreferences = useSetAtom(skillPreferencesAtom)

  // Load skill data and preferences
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSkill = async () => {
      try {
        const skills = await window.electronAPI.getSkills(workspaceId)

        if (!isMounted) return

        // Find the skill by slug
        const found = skills.find((s) => s.slug === skillSlug)
        if (found) {
          setSkill(found)

          // Load skill preference (autoSwitchMode defaults to true if not set)
          const pref = await window.electronAPI.getSkillPreference(workspaceId, skillSlug)
          if (isMounted) {
            setAutoSwitchMode(pref.autoSwitchMode !== false) // Default to true
          }
        } else {
          setError('Skill not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load skill')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSkill()

    // Subscribe to skill changes
    const unsubscribe = window.electronAPI.onSkillsChanged?.((skills) => {
      const updated = skills.find((s) => s.slug === skillSlug)
      if (updated) {
        setSkill(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, skillSlug])

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.openSkillInFinder(workspaceId, skillSlug)
    } catch (err) {
      console.error('Failed to open skill in finder:', err)
    }
  }, [skill, workspaceId, skillSlug])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.deleteSkill(workspaceId, skillSlug)
      toast.success(`Deleted skill: ${skill.metadata.name}`)
      navigate(routes.view.skills())
    } catch (err) {
      toast.error('Failed to delete skill', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [skill, workspaceId, skillSlug])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://skills/skill/${skillSlug}?window=focused`)
  }, [skillSlug])

  // Handle auto-switch mode toggle
  const handleAutoSwitchModeChange = useCallback(async (enabled: boolean) => {
    setAutoSwitchMode(enabled)
    try {
      await window.electronAPI.setSkillPreference(workspaceId, skillSlug, { autoSwitchMode: enabled })

      // Sync to atom so App.tsx sees the change immediately
      setSkillPreferences(prev => ({
        ...prev,
        [skillSlug]: { ...prev[skillSlug], autoSwitchMode: enabled }
      }))

      const modeName = skill?.metadata.requiredMode
        ? PERMISSION_MODE_CONFIG[skill.metadata.requiredMode].displayName
        : 'required'
      toast.success(enabled
        ? `Auto-switch to ${modeName} mode enabled`
        : `Auto-switch to ${modeName} mode disabled`
      )
    } catch (err) {
      // Revert on error
      setAutoSwitchMode(!enabled)
      toast.error('Failed to save preference')
    }
  }, [workspaceId, skillSlug, skill, setSkillPreferences])

  // Get skill name for header
  const skillName = skill?.metadata.name || skillSlug

  // Format path to show just the skill-relative portion (skills/{slug}/)
  const formatPath = (path: string) => {
    const skillsIndex = path.indexOf('/skills/')
    if (skillsIndex !== -1) {
      return path.slice(skillsIndex + 1) // Remove leading slash, keep "skills/{slug}/..."
    }
    return path
  }

  // Open the skill folder in Finder with SKILL.md selected
  const handleLocationClick = () => {
    if (!skill) return
    // Show the SKILL.md file in Finder (this reveals the enclosing folder with file focused)
    window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
  }

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!skill && !loading && !error ? 'Skill not found' : undefined}
    >
      <Info_Page.Header
        title={skillName}
        titleMenu={
          <SkillMenu
            skillSlug={skillSlug}
            skillName={skillName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            onDelete={handleDelete}
          />
        }
      />

      {skill && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<SkillAvatar skill={skill} fluid workspaceId={workspaceId} />}
            title={skill.metadata.name}
            tagline={skill.metadata.description}
          />

          {/* Metadata */}
          <Info_Section
            title="Metadata"
            actions={
              // EditPopover for AI-assisted metadata editing (name, description in frontmatter)
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-metadata', skill.path)}
                secondaryAction={{
                  label: 'Edit File',
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            }
          >
            <Info_Table>
              <Info_Table.Row label="Slug" value={skill.slug} />
              <Info_Table.Row label="Name">{skill.metadata.name}</Info_Table.Row>
              <Info_Table.Row label="Description">
                {skill.metadata.description}
              </Info_Table.Row>
              <Info_Table.Row label="Location">
                <button
                  onClick={handleLocationClick}
                  className="hover:underline cursor-pointer text-left"
                >
                  {formatPath(skill.path)}
                </button>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          {/* Permission Modes - show if skill has requiredMode or alwaysAllow */}
          {(skill.metadata.requiredMode || (skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0)) && (
            <Info_Section title="Permission Modes">
              <div className="space-y-4 px-4 py-3">
                {/* Auto-switch toggle for skills with requiredMode */}
                {skill.metadata.requiredMode && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">Auto-switch to {PERMISSION_MODE_CONFIG[skill.metadata.requiredMode].displayName} mode</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Automatically switch permission mode when this skill is invoked
                      </p>
                    </div>
                    <Switch
                      checked={autoSwitchMode}
                      onCheckedChange={handleAutoSwitchModeChange}
                    />
                  </div>
                )}

                {/* Always Allowed Tools explanation */}
                {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      How "Always Allowed Tools" interacts with permission modes:
                    </p>
                    <div className="rounded-[8px] border border-border/50 overflow-hidden">
                      <table className="w-full text-sm">
                        <tbody>
                          <tr className="border-b border-border/30">
                            <td className="px-3 py-2 font-medium text-muted-foreground w-[140px]">Explore</td>
                            <td className="px-3 py-2 flex items-center gap-2">
                              <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                              <span className="text-foreground/80">Blocked — write tools blocked regardless</span>
                            </td>
                          </tr>
                          <tr className="border-b border-border/30">
                            <td className="px-3 py-2 font-medium text-muted-foreground">Ask to Edit</td>
                            <td className="px-3 py-2 flex items-center gap-2">
                              <Check className="h-3.5 w-3.5 text-success shrink-0" />
                              <span className="text-foreground/80">Auto-approved — no prompts for allowed tools</span>
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2 font-medium text-muted-foreground">Auto</td>
                            <td className="px-3 py-2 flex items-center gap-2">
                              <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-foreground/80">No effect — all tools already auto-approved</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </Info_Section>
          )}

          {/* Instructions */}
          <Info_Section
            title="Instructions"
            actions={
              // EditPopover for AI-assisted editing with "Edit File" as secondary action
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-instructions', skill.path)}
                secondaryAction={{
                  label: 'Edit File',
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            }
          >
            <Info_Markdown maxHeight={540} fullscreen>
              {skill.content || '*No instructions provided.*'}
            </Info_Markdown>
          </Info_Section>

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
