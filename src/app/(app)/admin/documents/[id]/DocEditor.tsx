"use client";
import { Dropdown } from "@/components/GlyphSelect";
import { titleCase, sentenceCase, titleCaseInput, sentenceCaseInput } from "@/lib/titlecase";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "@/components/api";
import { askConfirm } from "@/components/ConfirmDialog";
import { daysBetween, dayMonth, shiftDate } from "@/lib/countdown";
import { dmy } from "@/lib/time";
import { Icon } from "@/components/icons";
import { compressIfImage, uploadFile, ShareFile, DOC_KIND_OPTIONS } from "../DocClient";

type Doc = { id: string; title: string; kind: string; issuer: string | null; issuedOn: string | null; expiresOn: string | null; notes: string | null; idMasked: string | null; personId: string | null; tags: string[] };
type FileV = { id: string; version: number; filename: string; contentType: string; sizeBytes: number; when: string };
type Rem = { enabled: boolean; offsets: number[]; time: string } | null;

const MAX = 4 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/heic,image/webp";
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isPhoto = (t: string) => t.startsWith("image/");
const shows = (t: string) => t === "application/pdf" || ["image/jpeg", "image/png", "image/webp"].includes(t);
const NICE: Record<number, string> = { 1: "1 day", 3: "3 days", 7: "1 week", 14: "2 weeks", 30: "1 month", 60: "2 months", 90: "3 months", 180: "6 months" };
const nice = (n: number) => NICE[n] ?? `${n} days`;
const PRESETS = [90, 30, 14, 7, 3, 1];
function localToday() {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const TABS = [["details", "Details"], ["reminders", "Reminders"], ["files", "Files"], ["notes", "Notes"]] as const;
type Tab = (typeof TABS)[number][0];

export function DocEditor({ doc, files, reminders }: { doc: Doc; files: FileV[]; reminders: Rem }) {
  const router = useRouter();
  const formId = "doc-edit-form";
  const pickRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>("details");
  const [sel, setSel] = useState<string | null>(files[0]?.id ?? null);
  useEffect(() => { if (!files.some((f) => f.id === sel)) setSel(files[0]?.id ?? null); }, [files, sel]);
  const cur = files.find((f) => f.id === sel) ?? null;

  // ID number: one number, edited in place. Editing an existing one needs Face ID / Touch ID to load it first.
  const [idEditing, setIdEditing] = useState(!doc.idMasked);
  const [idOriginal, setIdOriginal] = useState("");
  const [idValue, setIdValue] = useState("");
  const [idBusy, setIdBusy] = useState(false);

  const [expires, setExpires] = useState(doc.expiresOn ?? "");
  const [remOn, setRemOn] = useState(!!reminders?.enabled);
  const [remDays, setRemDays] = useState<number[]>(() => [...new Set((reminders?.offsets ?? [-90, -30, -7]).map((n) => Math.abs(n)).filter((n) => n > 0))]);
  const [remTime, setRemTime] = useState(reminders?.time ?? "09:00");
  const left = /^\d{4}-\d{2}-\d{2}$/.test(expires) ? daysBetween(localToday(), expires) : null;
  const tiles = [...new Set([...PRESETS, ...remDays])].sort((a, b) => b - a);
  const isPast = (n: number) => left !== null && n >= left;
  const upcoming = remDays.filter((n) => !isPast(n)).length;
  const remSummary = upcoming ? `${upcoming} reminder${upcoming === 1 ? "" : "s"}${left !== null ? ` before ${dmy(expires)}` : ""}` : "None picked yet";
  const toggleDay = (n: number) => setRemDays((ds) => ds.includes(n) ? ds.filter((x) => x !== n) : ds.length >= 8 ? ds : [...ds, n]);

  // A new version waits here until "Upload" is pressed, so the compress choice can be made first.
  const [pending, setPending] = useState<File | null>(null);
  const [compressNew, setCompressNew] = useState(false);
  const [fileBusy, setFileBusy] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadId(): Promise<string | null> {
    setIdBusy(true);
    try {
      const r = await api<{ value: string }>("/api/documents/reveal", { documentId: doc.id });
      return r.value;
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't open the ID number", "error"); return null; }
    finally { setIdBusy(false); }
  }
  async function editId() {
    const v = await loadId();
    if (v === null) return;
    setIdOriginal(v); setIdValue(v); setIdEditing(true);
  }
  async function copyId() {
    const v = idEditing ? idValue : await loadId();
    if (!v) return;
    await navigator.clipboard.writeText(v);
    toast("Copied. It will be cleared from the clipboard in 60 seconds if this tab stays open.");
    setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 60_000);
  }

  async function uploadPending() {
    if (!pending) return;
    setFileBusy("Encrypting & uploading…");
    try {
      const { file, note } = compressNew ? await compressIfImage(pending) : { file: pending, note: null };
      if (file.size > MAX) throw new Error(isPhoto(file.type) && !compressNew ? "Files must be 4 MB or smaller. Tick “Compress” to shrink a photo." : "Files must be 4 MB or smaller");
      const r = await uploadFile(doc.id, file);
      toast([r.message ?? "Uploaded", compressNew ? note : null].filter(Boolean).join(". "));
      setPending(null); setCompressNew(false);
      router.refresh();
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setFileBusy(null); }
  }

  async function compressExisting(f: FileV) {
    if (!isPhoto(f.contentType)) { toast("Only photos can be compressed. PDFs stay as they are.", "error"); return; }
    if (!(await askConfirm(`Compress “${f.filename}”?`, {
      title: "Confirm compress", confirmLabel: "Compress",
      note: "A smaller copy (up to 2000 px, JPEG) is saved as the newest version and this one is deleted.",
    }))) return;
    setFileBusy("Compressing…");
    try {
      const res = await fetch(`/api/documents/file/${f.id}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Couldn't open the file");
      const original = new File([await res.blob()], f.filename, { type: f.contentType });
      const { file, note } = await compressIfImage(original);
      if (file === original) { toast(note ?? "Already small; nothing changed."); return; }
      await uploadFile(doc.id, file);
      await api("/api/ops/document.file.delete", { fileId: f.id });
      toast(note ?? "Compressed");
      setSel(null);
      router.refresh();
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't compress", "error"); }
    finally { setFileBusy(null); }
  }

  async function deleteFile(f: FileV) {
    if (!(await askConfirm(`Delete ${f.filename} (v${f.version})?`, { note: "You can’t undo this.", danger: true, confirmLabel: "Delete" }))) return;
    try {
      await api("/api/ops/document.file.delete", { fileId: f.id });
      toast("File deleted");
      setSel(null);
      router.refresh();
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn't delete", "error"); }
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? "").trim();
    if (!v("title")) { setTab("details"); setError("Add a title."); return; }
    if (remOn && !v("expiresOn")) { setTab("details"); setError("Add an expiry date to get reminders."); return; }
    if (remOn && !remDays.length) { setTab("reminders"); setError("Pick at least one reminder, or turn reminders off."); return; }
    const input: Record<string, unknown> = {
      id: doc.id, personId: doc.personId, tags: doc.tags, title: v("title"), kind: v("kind"),
      issuer: v("issuer") || null, issuedOn: v("issuedOn") || null, expiresOn: v("expiresOn") || null, notes: v("notes") || null,
    };
    if (idEditing && idValue.trim() !== idOriginal.trim()) {
      if (idValue.trim()) input.idNumber = idValue.trim();
      else if (doc.idMasked) input.clearId = true;
    }
    setSaving(true);
    try {
      await api("/api/ops/document.update", input);
      if (v("expiresOn") && (remOn || reminders)) {
        const offs = v("reminderOffsetsDays").split(/[\s,]+/).filter(Boolean).map((n) => -Math.abs(Number(n))).filter((n) => Number.isFinite(n));
        await api("/api/ops/document.reminders", {
          documentId: doc.id, remindersEnabled: remOn,
          ...(offs.length ? { reminderOffsetsDays: [...new Set(offs)] } : {}),
          ...(v("reminderTime") ? { reminderTime: v("reminderTime") } : {}),
        });
      }
      toast("Saved");
      router.push("/admin/documents");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally { setSaving(false); }
  }

  const fileActions = (f: FileV) => (
    <>
      <a className="icon-ghost doc-ico" href={`/api/documents/file/${f.id}`} aria-label={`Download ${f.filename}`} title="Download"><Icon name="download" size={18} /></a>
      <ShareFile fileId={f.id} filename={f.filename} contentType={f.contentType} iconOnly className="icon-ghost doc-ico" />
      <button type="button" className="icon-ghost doc-ico icon-danger" aria-label={`Delete ${f.filename} v${f.version}`} title="Delete" onClick={() => deleteFile(f)}><Icon name="trash" size={18} /></button>
    </>
  );

  return (
    <div className="doc-edit">
      <Link href="/admin/documents" className="btn btn-sm btn-ghost doc-back"><Icon name="back" size={17} />Documents &amp; IDs</Link>

      <div className="doc-edit-grid">
        {/* Preview of the chosen version: tap it to open the file */}
        <aside className="doc-preview-col">
          <div className="doc-preview">
            <div className="doc-preview-top">
              <span className="t-label truncate">{cur ? cur.filename : "No file yet"}</span>
              {cur && <span className="chip-soft">{cur.id === files[0]?.id ? "Latest" : `v${cur.version}`}</span>}
            </div>
            {cur ? (
              <a className="doc-preview-sheet" href={`/file/${cur.id}`} target="_blank" rel="noopener" aria-label={`Open ${cur.filename}`}>
                {cur.contentType === "application/pdf"
                  ? <iframe src={`/api/documents/file/${cur.id}?view=1#toolbar=0&navpanes=0`} title={`Preview of ${cur.filename}`} tabIndex={-1} />
                  : shows(cur.contentType)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/api/documents/file/${cur.id}?view=1`} alt={`Preview of ${cur.filename}`} />
                    : <span className="doc-preview-empty"><Icon name="doc" size={34} />Tap to open</span>}
              </a>
            ) : (
              <button type="button" className="doc-preview-sheet doc-preview-empty" onClick={() => pickRef.current?.click()}>
                <Icon name="upload" size={30} />Upload a PDF or photo
              </button>
            )}
            {cur && (
              <div className="doc-preview-actions" aria-label="File actions">
                {fileActions(cur)}
                <button type="button" className="btn btn-sm doc-compress" disabled={!!fileBusy || !isPhoto(cur.contentType)}
                  title={isPhoto(cur.contentType) ? "Make this photo smaller" : "Only photos can be compressed"} onClick={() => compressExisting(cur)}>
                  <Icon name="compress" size={16} />{fileBusy === "Compressing…" ? "Compressing…" : "Compress"}
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Details, reminders, files and notes */}
        <form id={formId} className="doc-main" onSubmit={save} noValidate>
          <header className="grid gap-1">
            <span className="t-label">{DOC_KIND_OPTIONS.find((k) => k.value === doc.kind)?.label ?? "Document"}</span>
            <h1 className="t-h1">{doc.title}</h1>
          </header>

          <div className="seg-tabs doc-tabs" role="tablist" aria-label="Sections">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" id={`doc-tab-${key}`} aria-selected={tab === key} aria-controls={`doc-panel-${key}`} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>

          <section id="doc-panel-details" role="tabpanel" aria-labelledby="doc-tab-details" hidden={tab !== "details"} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field"><span className="label">Title</span><input className="input" name="title" defaultValue={doc.title} required autoCapitalize="words" onInput={titleCaseInput} /></label>
              <div className="field" role="group"><span className="label">Type</span>
                <Dropdown name="kind" initial={doc.kind} ariaLabel="Type" options={DOC_KIND_OPTIONS} /></div>
              <label className="field"><span className="label">Issued by <span className="t-meta">(optional)</span></span><input className="input" name="issuer" defaultValue={doc.issuer ?? ""} autoCapitalize="words" onInput={titleCaseInput} /></label>
              <label className="field"><span className="label">Issue date <span className="t-meta">(optional)</span></span><input className="input" type="date" name="issuedOn" defaultValue={doc.issuedOn ?? ""} /></label>
              <label className="field"><span className="label">Expiry date <span className="t-meta">(optional)</span></span><input className="input" type="date" name="expiresOn" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
              <div className="field">
                <label className="label" htmlFor="doc-id-number">ID number <span className="t-meta">(optional)</span></label>
                {idEditing ? (
                  <div className="doc-id">
                    <input id="doc-id-number" className="input" value={idValue} onChange={(e) => setIdValue(e.target.value)} autoComplete="off" spellCheck={false} placeholder={doc.idMasked ? "Empty to remove it" : ""} />
                    {doc.idMasked && <button type="button" className="icon-ghost doc-ico" aria-label="Copy ID number" title="Copy" onClick={copyId}><Icon name="copy" size={17} /></button>}
                  </div>
                ) : (
                  <div className="doc-id doc-id-locked">
                    <span id="doc-id-number" className="doc-id-mask">{doc.idMasked}</span>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={idBusy} onClick={editId}>{idBusy ? "Checking…" : "Edit"}</button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={idBusy} onClick={copyId}>Copy</button>
                  </div>
                )}
                <span className="t-meta">Encrypted. Face ID / Touch ID is needed to see or change it.</span>
              </div>
            </div>
          </section>

          <section id="doc-panel-reminders" role="tabpanel" aria-labelledby="doc-tab-reminders" hidden={tab !== "reminders"} className="grid gap-4">
            <div className="doc-rem-head">
              <label htmlFor="doc-rem" className="grid gap-0.5 cursor-pointer">
                <span className="font-semibold">Reminders</span>
                <span className="t-meta">{!expires ? "Add an expiry date in Details first" : remOn ? remSummary || "On" : "Off"}</span>
              </label>
              <input id="doc-rem" type="checkbox" role="switch" className="switch" checked={remOn} disabled={!expires} onChange={(e) => setRemOn(e.target.checked)} />
            </div>
            <div className={remOn && expires ? "grid gap-4" : "grid gap-4 doc-off"} inert={!(remOn && expires)} aria-disabled={!(remOn && expires)}>
              <div className="field" role="group" aria-labelledby="doc-rail-l">
                <span id="doc-rail-l" className="label">Remind me before</span>
                <input type="hidden" name="reminderOffsetsDays" value={remDays.join(",")} />
                <div className="doc-rem-tiles">
                  {tiles.map((n) => {
                    const on = remDays.includes(n), past = isPast(n);
                    return (
                      <button key={n} type="button" className={`doc-rem-tile${on && !past ? " on" : ""}`} aria-pressed={on && !past} disabled={past} onClick={() => toggleDay(n)}>
                        <span className="font-semibold">{nice(n)}</span>
                        <span className="t-meta">{past ? "passed" : left !== null ? dayMonth(shiftDate(expires, -n)) : ""}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="field doc-rem-time"><span className="label">Reminder time</span>
                <input className="input" type="time" name="reminderTime" value={remTime} onChange={(e) => setRemTime(e.target.value)} required /></label>
            </div>
          </section>

          <section id="doc-panel-files" role="tabpanel" aria-labelledby="doc-tab-files" hidden={tab !== "files"} className="grid gap-2">
            {files.length ? files.map((f, i) => (
              <div key={f.id} className={`doc-file${f.id === sel ? " on" : ""}`}>
                <button type="button" className="doc-file-main" onClick={() => setSel(f.id)} aria-pressed={f.id === sel}>
                  <span className="doc-ext">{f.contentType === "application/pdf" ? "PDF" : f.contentType.split("/")[1]?.toUpperCase().slice(0, 4)}</span>
                  <span className="grid gap-0.5 min-w-0 text-left"><span className="font-semibold truncate">{f.filename}</span>
                    <span className="t-meta">v{f.version}{i === 0 ? " · latest" : ""} · {kb(f.sizeBytes)} · {f.when}</span></span>
                </button>
                <span className="flex">{fileActions(f)}</span>
              </div>
            )) : <p className="t-meta">No file uploaded yet.</p>}
            <div><button type="button" className="btn btn-sm mt-2" onClick={() => pickRef.current?.click()}><Icon name="upload" size={16} />Upload new version</button></div>
          </section>

          <section id="doc-panel-notes" role="tabpanel" aria-labelledby="doc-tab-notes" hidden={tab !== "notes"}>
            <label className="field"><span className="label">Notes</span><textarea className="textarea" name="notes" rows={8} defaultValue={doc.notes ?? ""} placeholder="Anything to remember about this document" autoCapitalize="sentences" onInput={sentenceCaseInput} /></label>
          </section>

          {error && <p role="alert" className="error">{error}</p>}
        </form>

        {/* Version boxes under the preview */}
        <div className="doc-versions" aria-label="File versions">
          {files.map((f) => (
            <button key={f.id} type="button" className={`doc-ver${f.id === sel ? " on" : ""}`} aria-pressed={f.id === sel} onClick={() => setSel(f.id)}>
              <span className="font-semibold">v{f.version}</span><span className="t-meta">{f.when.replace(/^\w+ /, "").split(",")[0]}</span>
            </button>
          ))}
          <input ref={pickRef} type="file" className="sr-only" accept={ACCEPT} aria-label="Choose a new version"
            onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; setPending(f); setCompressNew(false); }} />
          <button type="button" className="doc-ver doc-ver-add" onClick={() => pickRef.current?.click()}><Icon name="plus" size={16} />New version</button>
          {pending && (
            <div className="doc-pending preview-enter">
              <span className="min-w-0 grid"><span className="font-semibold truncate">{pending.name}</span><span className="t-meta">{kb(pending.size)}</span></span>
              <label className="check t-small">
                <input type="checkbox" checked={compressNew} disabled={!isPhoto(pending.type)} onChange={(e) => setCompressNew(e.target.checked)} />
                Compress file to reduce size{!isPhoto(pending.type) && <span className="t-meta">(photos only)</span>}
              </label>
              <span className="flex gap-2">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPending(null)} disabled={!!fileBusy}>Cancel</button>
                <button type="button" className="btn btn-sm btn-primary" onClick={uploadPending} disabled={!!fileBusy}>{fileBusy && fileBusy !== "Compressing…" ? fileBusy : "Upload"}</button>
              </span>
            </div>
          )}
        </div>

        {/* Save / cancel: bottom right, in line with the version boxes */}
        <div className="doc-save">
          <Link href="/admin/documents" className="btn btn-ghost">Cancel</Link>
          <button type="submit" form={formId} className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
