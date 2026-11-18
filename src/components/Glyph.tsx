/** The tracker glyph system: one flat geometric shape per area, used in nav, tiles and lists. */
export type GlyphKind =
  | "home" | "fasts" | "waxing" | "dental" | "routines" | "charity" | "savings" | "debts"
  | "quran" | "projects" | "inbox" | "history" | "settings" | "finance" | "care" | "vault" | "ai";

export function Glyph({ kind, size = 22, color = "currentColor", accent, className, title }: {
  kind: GlyphKind; size?: number; color?: string; accent?: string; className?: string; title?: string;
}) {
  const a = accent ?? color;
  const shapes: Record<GlyphKind, React.ReactNode> = {
    home: <><rect x="2" y="12" width="10" height="10" fill={color} /><circle cx="17" cy="7" r="5" fill={a} /><path d="M12 22 L22 22 L22 12 Z" fill={color} /></>,
    fasts: <><circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="2.5" /><circle cx="12" cy="12" r="4" fill={a} /></>,
    waxing: <><path d="M12 3 A9 9 0 0 1 12 21 Z" fill={color} /><path d="M12 3 A9 9 0 0 0 12 21" fill="none" stroke={color} strokeWidth="2" /></>,
    dental: <><path d="M3 21 A18 18 0 0 1 21 3 L21 21 Z" fill={color} /></>,
    routines: <><rect x="3" y="3" width="18" height="18" fill="none" stroke={color} strokeWidth="2.5" /><rect x="8" y="8" width="8" height="8" fill={a} /></>,
    charity: <><rect x="3" y="3" width="18" height="18" fill={color} /><circle cx="12" cy="12" r="4" fill="var(--paper)" /></>,
    savings: <><rect x="3" y="14" width="4" height="7" fill={color} /><rect x="10" y="9" width="4" height="12" fill={color} /><rect x="17" y="3" width="4" height="18" fill={a} /></>,
    debts: <><circle cx="9" cy="12" r="6.5" fill={color} /><circle cx="15" cy="12" r="6.5" fill="none" stroke={a} strokeWidth="2.5" /></>,
    quran: <><path d="M12 3 L21.5 20 L2.5 20 Z" fill={color} /><circle cx="12" cy="14.5" r="2.6" fill="var(--paper)" /></>,
    projects: <><path d="M3 21 L21 3" stroke={color} strokeWidth="3" /><rect x="3" y="3" width="8" height="8" fill={a} /><circle cx="17" cy="17" r="4" fill={color} /></>,
    inbox: <><rect x="3" y="5" width="18" height="14" fill="none" stroke={color} strokeWidth="2.5" /><path d="M3 12 H9 L12 15 L15 12 H21" fill="none" stroke={color} strokeWidth="2.5" /></>,
    history: <><circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="2.5" /><path d="M12 6 V12 L16 14" fill="none" stroke={color} strokeWidth="2.5" /></>,
    settings: <><circle cx="12" cy="12" r="4" fill={color} /><path d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22" stroke={color} strokeWidth="2.5" /></>,
    finance: <><rect x="3" y="3" width="11" height="11" fill={color} /><circle cx="16" cy="16" r="5.5" fill={a} /></>,
    care: <><path d="M12 3 A9 9 0 0 1 12 21 Z" fill={color} /><circle cx="7" cy="12" r="3" fill={a} /></>,
    vault: <><rect x="3" y="9" width="18" height="12" fill={color} /><path d="M7 9 V7 A5 5 0 0 1 17 7 V9" fill="none" stroke={color} strokeWidth="2.5" /></>,
    ai: <><circle cx="12" cy="12" r="9" fill={color} /><path d="M12 6 L13.6 10.4 L18 12 L13.6 13.6 L12 18 L10.4 13.6 L6 12 L10.4 10.4 Z" fill={a} /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      {shapes[kind]}
    </svg>
  );
}
