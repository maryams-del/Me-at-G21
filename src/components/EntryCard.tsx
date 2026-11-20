"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { RevealCtx, InEntryCardCtx } from "./OpForm";
import { Icon } from "./icons";
import type { Countdown } from "@/lib/countdown";

/**
 * The list card used across the app: name and type top-left, a pencil (Edit) top-right,
 * the big "x days till…" number with one small action pill beside it, and the reminder line underneath.
 * Edit opens the entry's form inside the card; Delete lives in that form, behind a confirmation.
 */
export function EntryCard({ title, subtitle, badge, count, countSub, action, reminder, edit, href, dim, children }: {
  title: string;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  count?: Countdown | null;
  countSub?: React.ReactNode;
  action?: React.ReactNode;
  reminder?: string | null;
  edit?: React.ReactNode;
  href?: string;
  dim?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="entry" style={dim ? { opacity: 0.72 } : undefined}>
      <div className="entry-head">
        <div className="min-w-0 flex-1 grid gap-0.5">
          <h2 className="entry-title">{href ? <Link href={href} className="no-underline hover:underline underline-offset-4">{title}</Link> : title}{badge}</h2>
          {subtitle && <p className="entry-sub">{subtitle}</p>}
        </div>
        {edit && (
          <button type="button" className="icon-ghost" aria-label={open ? `Close editing ${title}` : `Edit ${title}`} title={open ? "Close" : "Edit"} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
            <Icon name={open ? "close" : "edit"} size={17} />
          </button>
        )}
      </div>
      {(count || action) && (
        <div className="entry-row">
          {count ? (
            <div className={`entry-count ${count.tone}`}>
              <span className="n">{count.n}</span>
              <span className="grid"><span className="u">{count.unit}</span>{countSub && <span className="s">{countSub}</span>}</span>
            </div>
          ) : <span />}
          {action}
        </div>
      )}
      {children}
      {reminder && <p className="entry-foot"><Icon name="bell" size={13} />{reminder}</p>}
      {open && edit && (
        <div id={id} className="entry-edit preview-enter">
          <InEntryCardCtx.Provider value={true}><RevealCtx.Provider value={{ close: () => setOpen(false) }}>{edit}</RevealCtx.Provider></InEntryCardCtx.Provider>
        </div>
      )}
    </li>
  );
}
