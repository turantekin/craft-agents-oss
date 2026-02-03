import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { cn } from '../../lib/utils'
import { CodeBlock, InlineCode } from './CodeBlock'
import { MarkdownDiffBlock } from './MarkdownDiffBlock'
import { MarkdownJsonBlock } from './MarkdownJsonBlock'
import { MarkdownMermaidBlock } from './MarkdownMermaidBlock'
import { QuickChoiceBlock } from './QuickChoiceBlock'
import { preprocessLinks } from './linkify'
import remarkCollapsibleSections from './remarkCollapsibleSections'
import { CollapsibleSection } from './CollapsibleSection'
import { useCollapsibleMarkdown } from './CollapsibleMarkdownContext'

/**
 * Render modes for markdown content:
 *
 * - 'terminal': Raw output with minimal formatting, control chars visible
 *   Best for: Debug output, raw logs, when you want to see exactly what's there
 *
 * - 'minimal': Clean rendering with syntax highlighting but no extra chrome
 *   Best for: Chat messages, inline content, when you want readability without clutter
 *
 * - 'full': Rich rendering with beautiful tables, styled code blocks, proper typography
 *   Best for: Documentation, long-form content, when presentation matters
 */
export type RenderMode = 'terminal' | 'minimal' | 'full'

export interface MarkdownProps {
  children: string
  /**
   * Render mode controlling formatting level
   * @default 'minimal'
   */
  mode?: RenderMode
  className?: string
  /**
   * Message ID for memoization (optional)
   * When provided, memoizes parsed blocks to avoid re-parsing during streaming
   */
  id?: string
  /**
   * Callback when a URL is clicked
   */
  onUrlClick?: (url: string) => void
  /**
   * Callback when a file path is clicked
   */
  onFileClick?: (path: string) => void
  /**
   * Enable collapsible headings
   * Requires wrapping in CollapsibleMarkdownProvider
   * @default false
   */
  collapsible?: boolean
  /**
   * Hide expand button on first mermaid block (when message starts with mermaid)
   * Used in chat to avoid overlap with TurnCard's fullscreen button
   * @default true
   */
  hideFirstMermaidExpand?: boolean
  /**
   * Callback when a quick choice option is selected
   * Used for interactive choice buttons in ```choices code blocks
   */
  onChoiceSelect?: (choice: string) => void
}

/** Context for collapsible sections */
interface CollapsibleContext {
  collapsedSections: Set<string>
  toggleSection: (id: string) => void
}

// File path detection regex - matches paths starting with /, ~/, or ./
const FILE_PATH_REGEX = /^(?:\/|~\/|\.\/)[\w\-./@]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yaml|yml|py|go|rs|css|scss|less|html|htm|txt|log|sh|bash|zsh|swift|kt|java|c|cpp|h|hpp|rb|php|xml|toml|ini|cfg|conf|env|sql|graphql|vue|svelte|astro|prisma)$/i

// Image file path detection regex - matches paths ending with common image extensions
const IMAGE_PATH_REGEX = /^(?:\/|~\/|\.\/)[\w\-./@]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|tif|heic|heif|avif)$/i

/**
 * LocalImage - Component for displaying local file images
 * Attempts to load via file:// protocol, shows fallback path if loading fails
 * (e.g., in web viewer where file:// URLs are not accessible)
 */
function LocalImage({ src, alt, originalPath }: { src: string; alt: string; originalPath: string }) {
  const [loadError, setLoadError] = React.useState(false)

  // Extract folder path from file path
  const folderPath = originalPath.substring(0, originalPath.lastIndexOf('/'))

  // Open folder in system file manager (shows file selected in Finder)
  const handleOpenFolder = () => {
    // Use the Electron API to show file in folder if available
    if (window.electronAPI?.showInFolder) {
      window.electronAPI.showInFolder(originalPath)
    } else {
      // Fallback: copy path to clipboard
      navigator.clipboard.writeText(folderPath)
    }
  }

  if (loadError) {
    // Fallback for web viewer or if file not found
    return (
      <div className="my-3 p-3 bg-muted/30 rounded-lg border border-border/50 text-sm inline-block max-w-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>📷</span>
          <span>Image saved to:</span>
        </div>
        <code className="text-xs mt-1 block font-mono break-all">{originalPath}</code>
        <button
          onClick={handleOpenFolder}
          className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
        >
          <span>📂</span>
          <span>Open folder</span>
        </button>
      </div>
    )
  }

  return (
    <div className="my-3 inline-block max-w-full">
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-[400px] rounded-lg border border-border/50 shadow-sm"
        loading="lazy"
        onError={() => setLoadError(true)}
      />
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <code className="font-mono truncate max-w-[300px]" title={originalPath}>
          {originalPath.split('/').slice(-2).join('/')}
        </code>
        <button
          onClick={handleOpenFolder}
          className="flex items-center gap-1 text-primary hover:underline cursor-pointer"
        >
          <span>📂</span>
          <span>Open folder</span>
        </button>
      </div>
    </div>
  )
}

/**
 * Create custom components based on render mode.
 *
 * @param firstMermaidCodeRef - Ref holding the code of the first mermaid block
 *   when the markdown message starts with a mermaid fence. Used to hide the
 *   inline expand button on that block (TurnCard's own fullscreen button
 *   occupies the same top-right position). A ref is used so the closure can
 *   read the latest value without adding content to the memo deps — that would
 *   cause component re-mounting on every streaming update.
 * @param hideFirstMermaidExpand - Whether to hide the expand button on the first
 *   mermaid block when the message starts with a mermaid fence. Defaults to true.
 */
function createComponents(
  mode: RenderMode,
  onUrlClick?: (url: string) => void,
  onFileClick?: (path: string) => void,
  collapsibleContext?: CollapsibleContext | null,
  firstMermaidCodeRef?: React.RefObject<string | null>,
  hideFirstMermaidExpand: boolean = true,
  onChoiceSelect?: (choice: string) => void
): Partial<Components> {
  const baseComponents: Partial<Components> = {
    // Section wrapper for collapsible headings
    div: ({ node, children, ...props }) => {
      const sectionId = (props as Record<string, unknown>)['data-section-id'] as string | undefined
      const headingLevel = (props as Record<string, unknown>)['data-heading-level'] as number | undefined

      // If this is a collapsible section div and we have context
      if (sectionId && headingLevel && collapsibleContext) {
        return (
          <CollapsibleSection
            sectionId={sectionId}
            headingLevel={headingLevel}
            isCollapsed={collapsibleContext.collapsedSections.has(sectionId)}
            onToggle={collapsibleContext.toggleSection}
          >
            {children}
          </CollapsibleSection>
        )
      }

      // Regular div
      return <div {...props}>{children}</div>
    },
    // Links: Make clickable with callbacks
    a: ({ href, children }) => {
      const handleClick = (e: React.MouseEvent) => {
        e.preventDefault()
        if (href) {
          // Check if it's a file path
          if (FILE_PATH_REGEX.test(href) && onFileClick) {
            onFileClick(href)
          } else if (onUrlClick) {
            onUrlClick(href)
          }
        }
      }

      return (
        <a
          href={href}
          onClick={handleClick}
          className="text-foreground hover:underline cursor-pointer"
        >
          {children}
        </a>
      )
    },
    // Images: Handle local file paths with file:// protocol
    img: ({ src, alt }) => {
      if (!src) return null

      // Check if it's a local file path (absolute path starting with / or ~)
      const isLocalPath = src.startsWith('/') || src.startsWith('~')

      if (isLocalPath) {
        // Convert to file:// URL for Electron
        const fileSrc = `file://${src}`
        return <LocalImage src={fileSrc} alt={alt || 'Generated image'} originalPath={src} />
      }

      // HTTP/HTTPS images: render normally
      return (
        <img
          src={src}
          alt={alt}
          className="max-w-full rounded-lg my-3"
          loading="lazy"
        />
      )
    },
  }

  // Terminal mode: minimal formatting
  if (mode === 'terminal') {
    return {
      ...baseComponents,
      // No special code handling - just monospace, but detect image paths
      code: ({ children }) => {
        const codeText = String(children).trim()
        if (IMAGE_PATH_REGEX.test(codeText)) {
          const fileSrc = `file://${codeText}`
          return <LocalImage src={fileSrc} alt="Generated image" originalPath={codeText} />
        }
        return <code className="font-mono">{children}</code>
      },
      pre: ({ children }) => (
        <pre className="font-mono whitespace-pre-wrap my-2">{children}</pre>
      ),
      // Minimal paragraph spacing
      p: ({ children }) => <p className="my-1">{children}</p>,
      // Simple lists
      ul: ({ children }) => <ul className="list-disc list-inside my-1">{children}</ul>,
      ol: ({ children }) => <ol className="list-decimal list-inside my-1">{children}</ol>,
      li: ({ children }) => <li className="my-0.5">{children}</li>,
      // Plain tables
      table: ({ children }) => (
        <table className="my-2 font-mono text-sm">{children}</table>
      ),
      th: ({ children }) => <th className="text-left pr-4">{children}</th>,
      td: ({ children }) => <td className="pr-4">{children}</td>,
    }
  }

  // Minimal mode: clean with syntax highlighting
  if (mode === 'minimal') {
    return {
      ...baseComponents,
      // Inline code
      code: ({ className, children, ...props }) => {
        const match = /language-(\w+)/.exec(className || '')
        const isBlock = 'node' in props && props.node?.position?.start.line !== props.node?.position?.end.line

        // Block code
        if (match || isBlock) {
          const code = String(children).replace(/\n$/, '')
          // Diff code blocks → pierre/diffs for a proper diff viewer
          if (match?.[1] === 'diff') {
            return <MarkdownDiffBlock code={code} className="my-1" />
          }
          // JSON code blocks → interactive tree viewer
          if (match?.[1] === 'json') {
            return <MarkdownJsonBlock code={code} className="my-1" />
          }
          // Mermaid code blocks → zinc-styled SVG diagram.
          // Hide the inline expand button when the mermaid block is the first
          // content in the message — TurnCard's own fullscreen button occupies
          // the same top-right spot. Detection uses firstMermaidCodeRef (content
          // match) rather than AST line positions which are unreliable after
          // preprocessLinks transforms the markdown.
          if (match?.[1] === 'mermaid') {
            const isFirstBlock = hideFirstMermaidExpand &&
                                firstMermaidCodeRef?.current != null &&
                                code === firstMermaidCodeRef.current
            return <MarkdownMermaidBlock code={code} className="my-1" showExpandButton={!isFirstBlock} />
          }
          // Choices code blocks → interactive quick choice buttons
          if (match?.[1] === 'choices') {
            return <QuickChoiceBlock code={code} onChoiceSelect={onChoiceSelect} className="my-1" />
          }
          return <CodeBlock code={code} language={match?.[1]} mode="full" className="my-1" />
        }

        // Inline code - check for image paths and render as LocalImage
        const codeText = String(children).trim()
        if (IMAGE_PATH_REGEX.test(codeText)) {
          const fileSrc = `file://${codeText}`
          return <LocalImage src={fileSrc} alt="Generated image" originalPath={codeText} />
        }
        return <InlineCode>{children}</InlineCode>
      },
      pre: ({ children }) => <>{children}</>,
      // Comfortable paragraph spacing
      p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
      // Styled lists - ul uses tighter spacing, ol uses standard for number alignment
      ul: ({ children }) => (
        <ul className="my-2 space-y-1 ps-[16px] pe-2 list-disc marker:text-[var(--md-bullets)]">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-2 space-y-1 pl-6 list-decimal">{children}</ol>
      ),
      li: ({ children }) => <li>{children}</li>,
      // Clean tables
      table: ({ children }) => (
        <div className="my-3 overflow-x-auto">
          <table className="min-w-full text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="border-b">{children}</thead>,
      th: ({ children }) => (
        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">{children}</th>
      ),
      td: ({ children }) => (
        <td className="py-2 px-3 border-b border-border/50">{children}</td>
      ),
      // Headings - H1/H2 same size, differentiated by weight
      h1: ({ children }) => <h1 className="font-sans text-[16px] font-bold mt-5 mb-3">{children}</h1>,
      h2: ({ children }) => <h2 className="font-sans text-[16px] font-semibold mt-4 mb-3">{children}</h2>,
      h3: ({ children }) => <h3 className="font-sans text-[15px] font-semibold mt-4 mb-2">{children}</h3>,
      // Blockquotes
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-muted-foreground/30 pl-3 my-2 text-muted-foreground italic">
          {children}
        </blockquote>
      ),
      // Horizontal rules
      hr: () => <hr className="my-4 border-border" />,
      // Strong/emphasis
      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
    }
  }

  // Full mode: rich styling
  return {
    ...baseComponents,
    // Full code blocks with copy button
    code: ({ className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '')
      const isBlock = 'node' in props && props.node?.position?.start.line !== props.node?.position?.end.line

      if (match || isBlock) {
        const code = String(children).replace(/\n$/, '')
        // Diff code blocks → pierre/diffs for a proper diff viewer
        if (match?.[1] === 'diff') {
          return <MarkdownDiffBlock code={code} className="my-1" />
        }
        // JSON code blocks → interactive tree viewer
        if (match?.[1] === 'json') {
          return <MarkdownJsonBlock code={code} className="my-1" />
        }
        // Mermaid code blocks → zinc-styled SVG diagram.
        // (Same first-block detection as minimal mode — see comment above.)
        if (match?.[1] === 'mermaid') {
          const isFirstBlock = hideFirstMermaidExpand &&
                              firstMermaidCodeRef?.current != null &&
                              code === firstMermaidCodeRef.current
          return <MarkdownMermaidBlock code={code} className="my-1" showExpandButton={!isFirstBlock} />
        }
        // Choices code blocks → interactive quick choice buttons
        if (match?.[1] === 'choices') {
          return <QuickChoiceBlock code={code} onChoiceSelect={onChoiceSelect} className="my-1" />
        }
        return <CodeBlock code={code} language={match?.[1]} mode="full" className="my-1" />
      }

      // Inline code - check for image paths and render as LocalImage
      const codeText = String(children).trim()
      if (IMAGE_PATH_REGEX.test(codeText)) {
        const fileSrc = `file://${codeText}`
        return <LocalImage src={fileSrc} alt="Generated image" originalPath={codeText} />
      }
      return <InlineCode>{children}</InlineCode>
    },
    pre: ({ children }) => <>{children}</>,
    // Rich paragraph spacing
    p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
    // Styled lists - ul uses tighter spacing, ol uses standard for number alignment
    ul: ({ children }) => (
      <ul className="my-3 space-y-1.5 ps-[16px] pe-2 list-disc marker:text-[var(--md-bullets)]">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 space-y-1.5 pl-6 list-decimal">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    // Beautiful tables
    table: ({ children }) => (
      <div className="my-4 overflow-x-auto rounded-md border">
        <table className="min-w-full divide-y divide-border">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
    th: ({ children }) => (
      <th className="text-left py-3 px-4 font-semibold text-sm">{children}</th>
    ),
    td: ({ children }) => (
      <td className="py-3 px-4 text-sm">{children}</td>
    ),
    tr: ({ children }) => (
      <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
    ),
    // Rich headings - H1/H2 same size, differentiated by weight
    h1: ({ children }) => (
      <h1 className="font-sans text-[16px] font-bold mt-7 mb-4">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="font-sans text-[16px] font-semibold mt-6 mb-3">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="font-sans text-[15px] font-semibold mt-5 mb-3">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-[14px] font-semibold mt-3 mb-1">{children}</h4>
    ),
    // Styled blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-foreground/30 bg-muted/30 pl-4 pr-3 py-2 my-3 rounded-r-md">
        {children}
      </blockquote>
    ),
    // Task lists (GFM)
    input: ({ type, checked }) => {
      if (type === 'checkbox') {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mr-2 rounded border-muted-foreground"
          />
        )
      }
      return <input type={type} />
    },
    // Horizontal rules
    hr: () => <hr className="my-6 border-border" />,
    // Strong/emphasis
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="line-through text-muted-foreground">{children}</del>,
    // Handle unknown <markdown> tags that may come through rehype-raw
    markdown: ({ children }) => <>{children}</>,
  }
}

/**
 * Markdown - Customizable markdown renderer with multiple render modes
 *
 * Features:
 * - Three render modes: terminal, minimal, full
 * - Syntax highlighting via Shiki
 * - GFM support (tables, task lists, strikethrough)
 * - Clickable links and file paths
 * - Memoization for streaming performance
 */
export function Markdown({
  children,
  mode = 'minimal',
  className,
  id,
  onUrlClick,
  onFileClick,
  collapsible = false,
  hideFirstMermaidExpand = true,
  onChoiceSelect,
}: MarkdownProps) {
  // Get collapsible context if enabled
  const collapsibleContext = useCollapsibleMarkdown()

  // Extract the first mermaid code block's content when the message starts
  // with a mermaid fence. Stored in a ref so createComponents can read it
  // without adding `children` to the memo deps (which would remount all
  // components on every streaming update, breaking internal state).
  const firstMermaidCodeRef = React.useRef<string | null>(null)
  const trimmed = children.trimStart()
  if (trimmed.startsWith('```mermaid')) {
    const m = trimmed.match(/^```mermaid\n([\s\S]*?)```/)
    firstMermaidCodeRef.current = m?.[1] ? m[1].replace(/\n$/, '') : null
  } else {
    firstMermaidCodeRef.current = null
  }

  const components = React.useMemo(
    () => createComponents(mode, onUrlClick, onFileClick, collapsible ? collapsibleContext : null, firstMermaidCodeRef, hideFirstMermaidExpand, onChoiceSelect),
    [mode, onUrlClick, onFileClick, collapsible, collapsibleContext, hideFirstMermaidExpand, onChoiceSelect]
  )

  // Preprocess to convert raw URLs and file paths to markdown links
  const processedContent = React.useMemo(
    () => preprocessLinks(children),
    [children]
  )

  // Conditionally include the collapsible sections plugin
  const remarkPlugins = React.useMemo(
    () => collapsible ? [remarkGfm, remarkCollapsibleSections] : [remarkGfm],
    [collapsible]
  )

  // Custom URL transform that allows craftagents:// deep links and craftdocs:// links
  // React-markdown's default urlTransform only allows http, https, mailto, etc.
  // We need to allow our custom protocols for internal navigation
  const urlTransform = React.useCallback((url: string) => {
    // Allow craftagents:// deep links (internal app navigation)
    if (url.startsWith('craftagents://')) {
      return url
    }
    // Allow craftdocs:// links (Craft Docs app)
    if (url.startsWith('craftdocs://')) {
      return url
    }
    // Allow file:// URLs for local images in Electron
    if (url.startsWith('file://')) {
      return url
    }
    // Allow standard protocols
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      return url
    }
    // Allow relative URLs
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../') || url.startsWith('#')) {
      return url
    }
    // Block other protocols (javascript:, data:, etc.) for security
    return ''
  }, [])

  return (
    <div className={cn('markdown-content', className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeRaw]}
        components={components}
        urlTransform={urlTransform}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}

/**
 * MemoizedMarkdown - Optimized for streaming scenarios
 *
 * Splits content into blocks and memoizes each block separately,
 * so only new/changed blocks re-render during streaming.
 */
export const MemoizedMarkdown = React.memo(
  Markdown,
  (prevProps, nextProps) => {
    // If id is provided, use it for memoization
    if (prevProps.id && nextProps.id) {
      return (
        prevProps.id === nextProps.id &&
        prevProps.children === nextProps.children &&
        prevProps.mode === nextProps.mode
      )
    }
    // Otherwise compare content and mode
    return (
      prevProps.children === nextProps.children &&
      prevProps.mode === nextProps.mode
    )
  }
)
MemoizedMarkdown.displayName = 'MemoizedMarkdown'

// Re-export for convenience
export { CodeBlock, InlineCode } from './CodeBlock'
export { CollapsibleMarkdownProvider } from './CollapsibleMarkdownContext'
