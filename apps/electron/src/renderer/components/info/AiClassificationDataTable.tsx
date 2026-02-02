/**
 * AiClassificationDataTable
 *
 * Flat data table displaying all AI classification settings across all labels.
 * Each row shows which label has AI classification enabled, its description,
 * mode (suggest/auto), and value hint for typed labels.
 *
 * Settings are collected by recursively traversing the label tree and flattening
 * all aiClassification configs into a single list.
 */

import * as React from 'react'
import { useState, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Maximize2, Sparkles } from 'lucide-react'
import { Info_DataTable, SortableHeader } from './Info_DataTable'
import { Info_Badge } from './Info_Badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { DataTableOverlay } from '@craft-agent/ui'
import { LabelIcon } from '@/components/ui/label-icon'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import type { LabelConfig, AiClassificationConfig } from '@craft-agent/shared/labels'

/**
 * Flattened AI classification row: associates config with its parent label
 */
interface AiClassificationRow {
  /** The label this classification belongs to */
  label: LabelConfig
  /** The AI classification config */
  config: AiClassificationConfig
}

interface AiClassificationDataTableProps {
  /** Label tree (root-level nodes with nested children) */
  data: LabelConfig[]
  /** Show search input */
  searchable?: boolean
  /** Max height with scroll */
  maxHeight?: number
  /** Enable fullscreen button */
  fullscreen?: boolean
  /** Title for fullscreen overlay */
  fullscreenTitle?: string
  className?: string
}

/**
 * DescriptionCell - Shows AI classification description with tooltip for long text.
 */
function DescriptionCell({ description }: { description: string }) {
  const cell = (
    <span className="block overflow-hidden whitespace-nowrap text-ellipsis max-w-[250px] text-sm">
      {description}
    </span>
  )

  if (description.length >= 50) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{cell}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-md">{description}</TooltipContent>
      </Tooltip>
    )
  }

  return cell
}

// Column definitions for the AI classification table
const columns: ColumnDef<AiClassificationRow>[] = [
  {
    id: 'label',
    header: ({ column }) => <SortableHeader column={column} title="Label" />,
    accessorFn: (row) => row.label.name,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5 flex items-center gap-1.5">
        <LabelIcon label={row.original.label} size="xs" />
        <span className="text-sm truncate">{row.original.label.name}</span>
      </div>
    ),
    minSize: 100,
  },
  {
    id: 'description',
    header: ({ column }) => <SortableHeader column={column} title="Description" />,
    accessorFn: (row) => row.config.description,
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        <DescriptionCell description={row.original.config.description} />
      </div>
    ),
    minSize: 200,
    meta: { fillWidth: true, truncate: true },
  },
  {
    id: 'mode',
    header: () => <span className="p-1.5 pl-2.5">Mode</span>,
    accessorFn: (row) => row.config.mode ?? 'suggest',
    cell: ({ row }) => {
      const mode = row.original.config.mode ?? 'suggest'
      return (
        <div className="p-1.5 pl-2.5">
          <Info_Badge color={mode === 'auto' ? 'blue' : 'muted'} className="text-xs">
            {mode}
          </Info_Badge>
        </div>
      )
    },
    minSize: 80,
  },
  {
    id: 'valueHint',
    header: () => <span className="p-1.5 pl-2.5">Value Hint</span>,
    accessorFn: (row) => row.config.valueHint ?? '',
    cell: ({ row }) => (
      <div className="p-1.5 pl-2.5">
        {row.original.config.valueHint ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground truncate block max-w-[150px] cursor-help">
                {row.original.config.valueHint}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-md">
              {row.original.config.valueHint}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground/50 text-sm">—</span>
        )}
      </div>
    ),
    minSize: 100,
  },
]

/**
 * Recursively collect all AI classification configs from the label tree,
 * associating each config with its parent label.
 */
function collectAiClassifications(labels: LabelConfig[]): AiClassificationRow[] {
  const rows: AiClassificationRow[] = []

  function traverse(nodes: LabelConfig[]) {
    for (const label of nodes) {
      if (label.aiClassification?.description) {
        rows.push({ label, config: label.aiClassification })
      }
      if (label.children?.length) {
        traverse(label.children)
      }
    }
  }

  traverse(labels)
  return rows
}

export function AiClassificationDataTable({
  data,
  searchable = false,
  maxHeight = 400,
  fullscreen = false,
  fullscreenTitle = 'AI Classification',
  className,
}: AiClassificationDataTableProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { isDark } = useTheme()

  // Flatten label tree into AI classification rows
  const rows = useMemo(() => collectAiClassifications(data), [data])

  // Fullscreen button (shown on hover)
  const fullscreenButton = fullscreen ? (
    <button
      onClick={() => setIsFullscreen(true)}
      className={cn(
        'p-1 rounded-[6px] transition-all',
        'opacity-0 group-hover:opacity-100',
        'bg-background/80 backdrop-blur-sm shadow-minimal',
        'text-muted-foreground/50 hover:text-foreground',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100'
      )}
      title="View Fullscreen"
    >
      <Maximize2 className="w-3.5 h-3.5" />
    </button>
  ) : undefined

  // Empty state with helpful message
  const emptyContent = (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Sparkles className="w-8 h-8 text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground">No AI classification configured</p>
      <p className="text-xs text-muted-foreground/60 mt-1 max-w-[300px]">
        Add <code className="bg-foreground/5 px-1 rounded">aiClassification</code> to labels to enable semantic auto-tagging
      </p>
    </div>
  )

  return (
    <>
      <Info_DataTable
        columns={columns}
        data={rows}
        searchable={searchable ? { placeholder: 'Search AI classifications...' } : false}
        maxHeight={maxHeight}
        emptyContent={emptyContent}
        floatingAction={fullscreenButton}
        className={cn(fullscreen && 'group', className)}
      />

      {/* Fullscreen overlay */}
      {fullscreen && (
        <DataTableOverlay
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          title={fullscreenTitle}
          subtitle={`${rows.length} ${rows.length === 1 ? 'label' : 'labels'} with AI classification`}
          theme={isDark ? 'dark' : 'light'}
        >
          <Info_DataTable
            columns={columns}
            data={rows}
            searchable={searchable ? { placeholder: 'Search AI classifications...' } : false}
            emptyContent={emptyContent}
          />
        </DataTableOverlay>
      )}
    </>
  )
}
