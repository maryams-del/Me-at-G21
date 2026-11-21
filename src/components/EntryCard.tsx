"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { RevealCtx, InEntryCardCtx, DeleteIcon } from "./OpForm";
import { Icon, type IconName } from "./icons";
import type { Countdown } from "@/lib/countdown";

/**
 * The list card used across the app: name and type top-left, a pencil (Edit) top-right,
 * the big "x days till…" number with one small action pill beside it, and the reminder line underneath.
 * Edit turns the card into the edit view: icon, name and close, the countdown panel, then the entry's
 * form (tabs, Save, and Delete behind a confirmation).
 */
export function EntryCard({ title, subtitle, badge, icon = "calendar", count, countSub, countLabel = "Due", action, reminder, edit, del, href, dim, children }: {
  title: string;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  icon?: IconName;
  count?: Countdown | null;
  countSub?: React.ReactNode;
  /** Small label over the date in the edit view's countdown panel, e.g. "Expires". */
  countLabel?: string;
  action?: React.ReactNode;
  reminder?: string | null;
  edit?: React.ReactNode;
  /** Delete action: a bin icon beside the pencil on the title line (asks first). */
  del?: { op: string; input: unknown; confirm: string; note?: string; label?: string };
  href?: string;
  dim?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // The edit form's delete action also gets a bin icon on the card's title line, beside the pencil.

  if (open && edit) {
    const short = count ? count.unit.replace(/ till .*$/, "") : "";
    return (
      <li className="entry editing" id={id}>
        <div className="flex items-center gap-3">
          <span className="entry-ico" aria-hidden><Icon name={icon} size={22} strokeWidth={1.8} /></span>
          <div className="min-w-0 flex-1 grid gap-0.5">
            <h2 className="entry-title">{title}{badge}</h2>
            {subtitle && <p className="entry-sub">{subtitle}</p>}
          </div>
          <button type="button" className="icon-ghost" style={{ margin: "-4px -8px 0 0" }} aria-label={`Close editing ${title}`} title="Close" aria-expanded onClick={() => setOpen(false)}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {count && (
          <div className="due-well">
            <div className="grid gap-0.5"><span className="t-label">{countLabel}</span><span className="font-semibold">{countSub}</span></div>
            <div className={`entry-count ${count.tone === "calm" ? "soon" : count.tone}`}><span className="n">{count.n}</span><span className="u">{short}</span></div>
          </div>
        )}
        <InEntryCardCtx.Provider value={true}>
          <RevealCtx.Provider value={{ close: () => setOpen(false) }}>{edit}</RevealCtx.Provider>
        </InEntryCardCtx.Provider>
      </li>
    );
  }

  return (
    <li className="entry" style={dim ? { opacity: 0.72 } : undefined}>
      <div className="entry-head">
        <div className="min-w-0 flex-1 grid gap-0.5">
          <h2 className="entry-title">{href ? <Link href={href} className="no-underline hover:underline underline-offset-4">{title}</Link> : title}{badge}</h2>
          {subtitle && <p className="entry-sub">{subtitle}</p>}
        </div>
        {(edit || del) && (
          <div className="entry-actions">
            {edit && (
              <button type="button" className="icon-ghost" style={{ margin: 0 }} aria-label={`Edit ${title}`} title="Edit" aria-expanded={false} aria-controls={id} onClick={() => setOpen(true)}>
                <Icon name="edit" size={17} />
              </button>
            )}
            {del && <DeleteIcon op={del.op} input={del.input} confirm={del.confirm} note={del.note} label={`Delete ${title}`} />}
          </div>
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
    </li>
  );
}
