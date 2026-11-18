/** "Two & one": two overlapping glass circles and one upright bar (a quiet 2 and 1). Colours follow Dark/Light. */
export function LogoMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className={className}>
      <circle cx="33" cy="52" r="23" fill="#F0A94B" />
      <circle cx="55" cy="52" r="23" fill="var(--mark-green)" opacity=".82" />
      <rect x="80" y="27" width="13" height="50" rx="6.5" fill="var(--mark-bar)" />
      <path d="M20 40 A16 16 0 0 1 34 32" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}
