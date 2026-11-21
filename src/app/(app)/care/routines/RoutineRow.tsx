"use client";
import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { PanelClose, RevealCtx } from "@/components/OpForm";

/**
 * One routine on the Routines page: a ring (or a dashed circle when it hasn't started), the name and
 * schedule, the due date, the Done pill and the pencil. Delete lives inside the edit panel.
 * The edit panel drops down on the right, under the pencil.
 */
export function RoutineRow({ name, badge, sub, ring, due, action, edit, fresh }: {
  name: string; badge?: React.ReactNode; sub: string; ring: React.ReactNode; due?: React.ReactNode;
  action: React.ReactNode; edit: React.ReactNode; fresh?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className={`routine-row${fresh ? " fresh" : ""}`}>
      {ring}
      <div className="routine-main">
        <div className="flex items-center gap-2 flex-wrap"><h2 className="routine-name">{name}</h2>{badge}</div>
        <p className="t-meta">{sub}</p>
      </div>
      {due && <div className="routine-due">{due}</div>}
      <div className="routine-acts entry-actions">
        {action}
        {fresh && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)} aria-controls={id}>Another date</button>}
        <button type="button" className="icon-ghost" style={{ margin: 0 }} aria-label={open ? "Close editing" : `Edit ${name}`} title="Edit" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <Icon name="edit" size={17} />
        </button>
        {open && (
          <div id={id} className="panel form-panel panel-closable p-4 item-pop preview-enter" role="dialog" aria-label={`Edit ${name}`}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
            <PanelClose onClick={() => setOpen(false)} label="Close editing" />
            <p className="t-h3 mb-3 pr-10">Edit</p>
            <RevealCtx.Provider value={{ close: () => setOpen(false) }}>{edit}</RevealCtx.Provider>
          </div>
        )}
      </div>
    </li>
  );
}
