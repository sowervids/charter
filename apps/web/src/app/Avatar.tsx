import { agentHueVar, initials } from "../lib/identity.js";

type Kind = "human" | "agent" | "system" | "integration";

/**
 * The identity chip. Humans read as a soft square; agents as a hue-ringed
 * circle. A live agent gets a breathing presence dot. This is the structural
 * human-vs-agent distinction, not just a color swap on a text span.
 */
export function Avatar({
  id,
  name,
  kind,
  size = 28,
  live = false,
}: {
  id: string;
  name: string;
  kind: Kind;
  size?: number;
  live?: boolean;
}) {
  const isAgent = kind === "agent";
  const hue = agentHueVar(id);
  const px = `${size}px`;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center font-mono font-medium"
      style={{
        width: px,
        height: px,
        fontSize: `${Math.round(size * 0.4)}px`,
        borderRadius: isAgent ? "9999px" : "var(--radius-sm)",
        background: isAgent
          ? `color-mix(in srgb, ${hue} 16%, var(--color-bg-2))`
          : "var(--color-bg-3)",
        color: isAgent ? hue : "var(--color-text-2)",
        boxShadow: isAgent ? `inset 0 0 0 1.5px ${hue}` : "none",
      }}
      aria-hidden
    >
      {initials(name)}
      {live && (
        <span
          className="presence-live absolute -bottom-0.5 -right-0.5 rounded-full"
          style={{
            width: `${Math.max(7, size * 0.28)}px`,
            height: `${Math.max(7, size * 0.28)}px`,
            background: hue,
            boxShadow: "0 0 0 2px var(--color-bg-0)",
          }}
        />
      )}
    </span>
  );
}
