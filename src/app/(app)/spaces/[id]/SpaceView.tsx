"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Glyph, type GlyphKind } from "@/components/Glyph";
import { Icon } from "@/components/icons";
import { OpForm, PanelClose, PlusIcon, RevealCtx, type FieldDef } from "@/components/OpForm";
import { api, ApiError, toast } from "@/components/api";
import { askConfirm } from "@/components/ConfirmDialog";

type Space = { id: string; name: string; description: string | null; section: string; glyph: string };

const UNDO_NOTE = "You can undo this from Settings › Data for 30 days.";

/**
 * The top of every custom space: icon, name and what it's for, with add (+), edit and delete on the same line.
 * + opens a bar above the list for a new to-do item; edit opens the space's settings on the right.
 */
export function SpaceView({ space: s, glyph, fields, children }: { space: Space; glyph: GlyphKind; fields: FieldDef[]; children: React.ReactNode }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function addItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = input.current?.value.trim() ?? "";
    if (!text) { setError("Type something to add."); input.current?.focus(); return; }
    setBusy(true); setError(null);
    try {
      await api("/api/ops/spaceItem.add", { spaceId: s.id, text });
      toast("Added");
      if (input.current) input.current.value = "";
      input.current?.focus();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add it. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function deleteSpace() {
    if (!(await askConfirm(`This will delete the space “${s.name}” and everything in its list.`, { title: "Delete space?", note: UNDO_NOTE, danger: true }))) return;
    setDeleting(true);
    try {
      const r = await api<{ message?: string }>("/api/ops/space.delete", { id: s.id });
      toast(r.message ?? "Space deleted");
      router.push("/more");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't delete the space. Nothing was changed.", "error");
      setDeleting(false);
    }
  }

  return (
    <>
      <p className="t-label mb-2">Spaces · {s.section}</p>
      <header className="space-head rule-b">
        <Glyph kind={glyph} size={34} accent="var(--rust)" className="space-head-ic" />
        <h1 className="t-h1 space-head-title">{s.name}</h1>
        <div className="space-head-actions">
          <button type="button" className="head-plus" aria-label={adding ? "Close" : "Add a to do list item"} title="Add a to do list item"
            aria-expanded={adding} aria-controls="add-item" onClick={() => { setAdding(!adding); setError(null); }}>
            <PlusIcon size={18} />
          </button>
          <button type="button" className="icon-ghost" style={{ margin: 0 }} aria-label={editing ? "Close editing" : "Edit space"} title="Edit space"
            aria-expanded={editing} aria-controls="edit-space" onClick={() => setEditing(!editing)}>
            <Icon name="edit" size={18} />
          </button>
          <button type="button" className="icon-ghost icon-danger" style={{ margin: 0 }} aria-label="Delete space" title="Delete space"
            disabled={deleting} onClick={() => { setEditing(false); void deleteSpace(); }}>
            <Icon name="trash" size={18} />
          </button>
        </div>
        {s.description && <p className="t-small text-ink-2 prose-w space-head-desc">{s.description}</p>}
      </header>

      {editing && (
        <div className="center-panel-wrap">
          <div id="edit-space" className="panel center-panel panel-closable p-4 md:p-5 preview-enter" role="region" aria-labelledby="edit-h">
            <PanelClose onClick={() => setEditing(false)} label="Close editing" />
            <p id="edit-h" className="t-h3 mb-3 pr-10">Edit space</p>
            <RevealCtx.Provider value={{ close: () => setEditing(false) }}>
              <OpForm op="space.update" fields={fields} fixed={{ id: s.id }} compact submitLabel="Save"
                initial={{ name: s.name, description: s.description, section: s.section, glyph: s.glyph }}
                deleteAction={{ op: "space.delete", input: { id: s.id }, asButton: true, label: "Delete space", redirectTo: "/more",
                  confirm: `This will delete the space “${s.name}” and everything in its list.`, note: UNDO_NOTE }} />
            </RevealCtx.Provider>
          </div>
        </div>
      )}

      {adding && (
        <div className="center-panel-wrap">
        <form id="add-item" className="panel center-panel panel-closable p-4 md:p-5 preview-enter" onSubmit={addItem} noValidate>
          <PanelClose onClick={() => setAdding(false)} label="Close adding" />
          <label htmlFor="add-item-text" className="block text-[0.875rem] font-semibold text-ink-2 mb-2 pr-10">Add a to do list item</label>
          <div className="flex items-center gap-2">
            <input ref={input} id="add-item-text" className="input flex-1 min-w-0" placeholder="Something to remember or do" maxLength={500} autoFocus autoComplete="off"
              aria-invalid={!!error || undefined} aria-describedby={error ? "add-item-err" : undefined} />
            <button className="btn btn-primary shrink-0" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
          </div>
          {error && <p id="add-item-err" role="alert" className="error mt-2">{error}</p>}
        </form>
        </div>
      )}

      {children}
    </>
  );
}
