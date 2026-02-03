import craftLogo from "@/assets/craft_logo_c.svg"

interface CraftAgentsSymbolProps {
  className?: string
}

/**
 * Craft Agents symbol - the app logo icon
 * Displays the Lily AI logo from the SVG asset
 */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return (
    <img
      src={craftLogo}
      alt="Lily AI"
      className={className}
    />
  )
}
