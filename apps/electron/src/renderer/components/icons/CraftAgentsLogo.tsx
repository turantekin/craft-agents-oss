import craftLogo from "@/assets/craft_logo_c.svg"

interface CraftAgentsLogoProps {
  className?: string
}

/**
 * Craft Agents logo - displays the Lily AI logo
 */
export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return (
    <img
      src={craftLogo}
      alt="Lily AI"
      className={className}
    />
  )
}
