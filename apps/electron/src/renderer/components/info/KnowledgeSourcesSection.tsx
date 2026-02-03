/**
 * KnowledgeSourcesSection
 *
 * Displays knowledge sources linked to a skill.
 * Shows file existence status, allows preview and editing.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { FileText, Check, X, Eye, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Info_Section } from './Info_Section'
import { Info_Markdown } from './Info_Markdown'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import type { KnowledgeSource } from '../../../shared/types'

interface KnowledgeSourceWithStatus extends KnowledgeSource {
  exists: boolean
}

export interface KnowledgeSourcesSectionProps {
  /** Knowledge sources from skill metadata */
  sources: KnowledgeSource[]
  /** Workspace ID for IPC calls */
  workspaceId: string
  /** Skill path for edit popover context */
  skillPath: string
}

export function KnowledgeSourcesSection({
  sources,
  workspaceId,
  skillPath,
}: KnowledgeSourcesSectionProps) {
  const [sourcesWithStatus, setSourcesWithStatus] = useState<KnowledgeSourceWithStatus[]>([])
  const [previewSource, setPreviewSource] = useState<KnowledgeSource | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Check existence of all knowledge sources
  useEffect(() => {
    const checkSources = async () => {
      const results = await Promise.all(
        sources.map(async (source) => {
          const exists = await window.electronAPI.checkKnowledgeExists(workspaceId, source.path)
          return { ...source, exists }
        })
      )
      setSourcesWithStatus(results)
    }
    checkSources()
  }, [sources, workspaceId])

  // Handle preview click
  const handlePreview = useCallback(async (source: KnowledgeSource) => {
    setPreviewSource(source)
    setPreviewLoading(true)
    setPreviewContent(null)

    try {
      const content = await window.electronAPI.readKnowledgeSource(workspaceId, source.path)
      setPreviewContent(content)
    } catch (err) {
      setPreviewContent(`*Failed to load: ${err instanceof Error ? err.message : 'Unknown error'}*`)
    } finally {
      setPreviewLoading(false)
    }
  }, [workspaceId])

  // Derive workspace root from skill path (skill path is {workspaceRoot}/skills/{slug})
  const workspaceRoot = skillPath.replace(/\/skills\/[^/]+$/, '')

  // Handle open in editor
  const handleOpenInEditor = useCallback((relativePath: string) => {
    // Construct absolute path from workspace root + relative path
    const absolutePath = `${workspaceRoot}/${relativePath}`
    window.electronAPI.openFile(absolutePath)
  }, [workspaceRoot])

  // Close preview modal
  const handleClosePreview = useCallback(() => {
    setPreviewSource(null)
    setPreviewContent(null)
  }, [])

  if (sources.length === 0) {
    return null
  }

  return (
    <>
      <Info_Section
        title="Knowledge Sources"
        actions={
          <EditPopover
            trigger={<EditButton />}
            {...getEditConfig('skill-knowledge', skillPath)}
            secondaryAction={{
              label: 'Edit File',
              filePath: `${skillPath}/SKILL.md`,
            }}
          />
        }
      >
        <div className="divide-y divide-border/30">
          {sourcesWithStatus.map((source) => (
            <div
              key={source.path}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              {/* Icon */}
              <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{source.label}</span>
                  {/* Existence indicator */}
                  {source.exists ? (
                    <Check className="h-3.5 w-3.5 text-success shrink-0" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                  )}
                </div>
                {source.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {source.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground/70 mt-0.5 font-mono truncate">
                  {source.path}
                  {!source.exists && ' (missing)'}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {source.exists ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handlePreview(source)}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    Preview
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => handleOpenInEditor(source.path)}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Create
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Info_Section>

      {/* Preview Modal */}
      <Dialog open={!!previewSource} onOpenChange={(open) => !open && handleClosePreview()}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {previewSource?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {previewLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                Loading...
              </div>
            ) : previewContent ? (
              <Info_Markdown maxHeight={500}>
                {previewContent}
              </Info_Markdown>
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                No content
              </div>
            )}
          </div>
          {previewSource && (
            <div className="flex justify-between items-center pt-4 border-t">
              <span className="text-xs text-muted-foreground font-mono">
                {previewSource.path}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenInEditor(previewSource.path)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open in Editor
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
