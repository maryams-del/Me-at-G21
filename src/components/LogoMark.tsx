/** "Two & one": two overlapping circles and one upright bar (a quiet 2 and 1). Colours follow Dark/Light. */
export function LogoMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className={className}>
      <circle cx="33" cy="52" r="23" fill="var(--mark-stone)" />
      <circle cx="55" cy="52" r="23" fill="var(--mark-green)" opacity=".85" />
      <rect x="80" y="27" width="13" height="50" rx="6.5" fill="var(--mark-bar)" />
    </svg>
  );
}
