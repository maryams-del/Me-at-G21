"use client";
import { useId, useState } from "react";

export function FilterIcon({ size = 17 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" /></svg>;
}

/** A "Filter" button with the funnel icon; the filtering options appear when it's tapped. Starts open while a filter is active. */
export function FilterPanel({ active = false, children, className = "" }: { active?: boolean; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(active);
  const id = useId();
  return (
    <div className={`contents ${className}`}>
      <button type="button" className="btn icon-btn relative shrink-0" style={{ width: 46, height: 46, padding: 0 }} aria-label="Filter" title="Filter" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <FilterIcon size={19} />
        {active && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: "var(--mustard)" }} aria-label="Filters applied" />}
      </button>
      {open && <div id={id} className="basis-full w-full min-w-0 order-last mt-1 preview-enter">{children}</div>}
    </div>
  );
}

export function FamilyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="7" r="2.6" /><circle cx="16.5" cy="8" r="2.1" /><circle cx="12.5" cy="14" r="1.7" />
      <path d="M3.5 19.5c0-3 2-5 4.5-5s3 1 3 1M21 19.5c0-2.6-1.7-4.4-4-4.4-1.3 0-2.2.5-2.8 1.2M9.5 20.5c0-1.9 1.3-3.2 3-3.2s3 1.3 3 3.2" />
    </svg>
  );
}

/** An icon button that opens a panel underneath (e.g. Family). */
export function IconToggle({ icon, label, count, children }: { icon: "family"; label: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="contents">
      <button type="button" className="btn icon-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {icon === "family" && <FamilyIcon />}{label}{count !== undefined && ` (${count})`}
      </button>
      {open && <div id={id} className="basis-full w-full min-w-0 order-last mt-1 panel p-4 preview-enter">{children}</div>}
    </div>
  );
}
