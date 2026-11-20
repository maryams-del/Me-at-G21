/** Small stroke icons used on entry cards and forms. Decorative: pair them with visible text or an aria-label. */
const PATHS = {
  edit: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4",
  close: "M6 6l12 12M18 6L6 18",
  renew: "M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5",
  check: "M20 6L9 17l-5-5",
  cash: "M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M6 10v4M18 10v4",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  stop: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M5.6 5.6l12.8 12.8",
  play: "M8 5v14l11-7z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  skip: "M5 5v14l9-7zM18 5v14",
  plus: "M12 5v14M5 12h14",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, strokeWidth = 2 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" style={{ flexShrink: 0 }}>
      <path d={PATHS[name]} />
    </svg>
  );
}
