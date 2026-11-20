"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "@/components/api";
import { FamilyIcon } from "@/components/FilterPanel";
import { PlusIcon } from "@/components/OpForm";

type Person = { id: string; name: string; relation: string };
type Opt = { value: string; label: string };

const PencilIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" /></svg>;
const TrashIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>;

/** Family button with a small dropdown box under it: the members, plus add / edit / delete icons. Floats over the page. */
export function FamilyMenu({ people, relations }: { people: Person[]; relations: Opt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setEditing(null); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setEditing(null); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const rel = (v: string) => relations.find((r) => r.value === v)?.label ?? v;

  async function run(path: string, body: unknown, ok: string) {
    setBusy(true);
    try { await api(path, body); toast(ok); setEditing(null); router.refresh(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save. Try again.", "error"); }
    finally { setBusy(false); }
  }

  return (
    <div ref={box} className="relative inline-block">
      <button type="button" className="btn icon-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => {
        const rect = box.current?.getBoundingClientRect();
        if (rect) setAlignRight(rect.left + Math.min(304, window.innerWidth - 40) > window.innerWidth - 12);
        setOpen(!open); setEditing(null);
      }}>
        <FamilyIcon />Family ({people.length})
      </button>
      {open && (
        <div role="dialog" aria-label="Family" className="glass p-3 preview-enter"
          style={{ position: "absolute", top: "calc(100% + 8px)", ...(alignRight ? { right: 0 } : { left: 0 }), zIndex: 50, width: "min(19rem, calc(100vw - 2.5rem))", borderRadius: 22,
            background: "color-mix(in srgb, var(--paper) 96%, transparent)" }}>
          <div className="flex items-center justify-between mb-1">
            <p className="t-label">Family</p>
            <button type="button" className="plus-btn" style={{ width: 32, height: 32 }} aria-label="Add a member" title="Add a member" onClick={() => setEditing("new")}><PlusIcon size={16} /></button>
          </div>
          {editing === "new" && <Row busy={busy} relations={relations} run={run} onCancel={() => setEditing(null)} />}
          {people.length === 0 && editing !== "new" && <p className="t-meta py-2">No family members yet.</p>}
          <ul className="list">
            {people.map((p) => (
              <li key={p.id}>
                {editing === p.id ? <Row p={p} busy={busy} relations={relations} run={run} onCancel={() => setEditing(null)} /> : (
                  <div className="flex items-center gap-1 py-2">
                    <span className="flex-1 min-w-0 truncate"><span className="font-semibold">{p.name}</span> <span className="t-meta">{rel(p.relation)}</span></span>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ width: 34, padding: 0 }} aria-label={`Edit ${p.name}`} onClick={() => setEditing(p.id)}><PencilIcon /></button>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ width: 34, padding: 0 }} aria-label={`Delete ${p.name}`} disabled={busy}
                      onClick={() => { if (window.confirm(`Remove ${p.name}? Their documents and expiries stay, but will show as yours.`)) void run("/api/ops/person.delete", { id: p.id }, `${p.name} removed`); }}><TrashIcon /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ p, busy, relations, run, onCancel }: { p?: Person; busy: boolean; relations: Opt[]; run: (path: string, body: unknown, ok: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(p?.name ?? "");
  const [relation, setRelation] = useState(p?.relation ?? "child");
  return (
    <form className="grid gap-2 py-2" onSubmit={(e) => {
      e.preventDefault(); if (!name.trim()) return;
      void (p ? run("/api/ops/person.update", { id: p.id, name: name.trim(), relation }, "Saved") : run("/api/ops/person.create", { name: name.trim(), relation }, `${name.trim()} added`));
    }}>
      <input className="input" style={{ minHeight: 38, borderRadius: 999, fontSize: 14 }} autoFocus placeholder="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <div className="flex gap-2">
        <select className="select flex-1" style={{ minHeight: 38, borderRadius: 999, fontSize: 14 }} value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="Relation">
          {relations.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button className="btn btn-sm btn-primary" disabled={busy || !name.trim()}>{busy ? "…" : "Save"}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
