"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "@/components/api";
import { useRevealClose } from "@/components/OpForm";

/**
 * Optional, owner-chosen compression for photos: resize to ≤2000 px on the long side and re-encode as
 * JPEG (quality 0.82). Done in the browser, before upload. PDFs are never changed. If the result
 * isn't smaller, or the browser can't decode the image (e.g. HEIC on some browsers), the original is kept.
 */
export async function compressIfImage(file: File): Promise<{ file: File; note: string | null }> {
  if (!file.type.startsWith("image/")) return { file, note: "PDFs are uploaded as they are." };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return { file, note: null };
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return { file, note: "Already small; kept the original." };
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return { file: new File([blob], name, { type: "image/jpeg" }), note: `Compressed ${Math.round(file.size / 1024)} KB → ${Math.round(blob.size / 1024)} KB` };
  } catch {
    return { file, note: "This browser couldn't compress that image; uploaded the original." };
  }
}

async function uploadFile(documentId: string, file: File) {
  const fd = new FormData();
  fd.set("documentId", documentId);
  fd.set("file", file);
  const res = await fetch("/api/documents/upload", { method: "POST", body: fd, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  return data as { message?: string };
}

/** Upload a new file version. Bytes go to our server, which encrypts them before storage. */
export function UploadButton({ documentId, hasFiles }: { documentId: string; hasFiles: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [compress, setCompress] = useState(false);
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setBusy(true);
    try {
      const { file, note } = compress ? await compressIfImage(picked) : { file: picked, note: null };
      if (file.size > 4 * 1024 * 1024) throw new Error(file.type.startsWith("image/") && !compress ? "Files must be 4 MB or smaller. Tick “Compress” to shrink a photo." : "Files must be 4 MB or smaller");
      const data = await uploadFile(documentId, file);
      toast([data.message ?? "Uploaded", compress ? note : null].filter(Boolean).join(". "));
      router.refresh();
    } catch (err) { toast((err as Error).message, "error"); }
    finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" className="sr-only" onChange={onPick} aria-label="Choose a file to upload" />
      <button className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Encrypting & uploading…" : hasFiles ? "Upload new version" : "Upload file"}</button>
      <label className="check t-small" style={{ minHeight: 36 }}><input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />Compress file to reduce size</label>
    </span>
  );
}

/** Reveal / copy a protected ID number. The server demands a fresh Face ID / Touch ID check first. */
export function ProtectedId({ documentId, masked }: { documentId: string; masked: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      const r = await api<{ value: string }>("/api/documents/reveal", { documentId });
      setValue(r.value);
      setTimeout(() => setValue(null), 30_000); // auto-hide
      return r.value;
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't reveal", "error"); return null; }
    finally { setBusy(false); }
  }
  async function copy() {
    const v = value ?? (await load());
    if (!v) return;
    await navigator.clipboard.writeText(v);
    toast("Copied. It will be cleared from the clipboard in 60 seconds if this tab stays open.");
    setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 60_000);
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium tracking-wider" aria-live="polite">{value ?? masked}</span>
      {value ? <button className="btn btn-sm btn-ghost" onClick={() => setValue(null)}>Hide</button>
        : <button className="btn btn-sm btn-ghost" disabled={busy} onClick={load}>{busy ? "Checking…" : "Reveal"}</button>}
      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={copy}>Copy</button>
    </span>
  );
}

/** Share via the device share sheet (Mail, AirDrop, WhatsApp…) — no public link is ever created. */
export function ShareFile({ fileId, filename, contentType }: { fileId: string; filename: string; contentType: string }) {
  const [busy, setBusy] = useState(false);
  if (typeof navigator !== "undefined" && !("share" in navigator)) return null;
  return (
    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={async () => {
      if (!window.confirm(`Share “${filename}” using your device's share sheet? Whoever you send it to will have a copy.`)) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/documents/file/${fileId}`, { credentials: "same-origin" });
        if (!res.ok) throw new Error("Couldn't fetch the file");
        const file = new File([await res.blob()], filename, { type: contentType });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error("This device can't share files from the browser. Use Download instead.");
        await navigator.share({ files: [file], title: filename });
      } catch (e) { if ((e as Error).name !== "AbortError") toast((e as Error).message, "error"); }
      finally { setBusy(false); }
    }}>{busy ? "Preparing…" : "Share"}</button>
  );
}

const DOC_KIND_OPTIONS = [
  { value: "passport", label: "Passport" }, { value: "national_id", label: "National ID / Iqama" }, { value: "transcript", label: "Transcript" },
  { value: "certificate", label: "Certificate" }, { value: "cv", label: "CV" }, { value: "application", label: "Application file" },
  { value: "letter", label: "Official letter" }, { value: "other", label: "Other" },
];

/** New document with an optional file chosen up front: saves the details, then encrypts + uploads the file. */
export type PersonOpt = { id: string; name: string; relation: string };

export function NewDocumentForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [compress, setCompress] = useState(false);
  const [remind, setRemind] = useState(false);
  const close = useRevealClose();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? "").trim();
    let toSend = file, note: string | null = null;
    if (file && compress) ({ file: toSend, note } = await compressIfImage(file));
    if (toSend && toSend.size > 4 * 1024 * 1024) { setError(toSend.type.startsWith("image/") && !compress ? "Files must be 4 MB or smaller. Tick “Compress file to reduce size” to shrink a photo." : "Files must be 4 MB or smaller."); return; }
    const input: Record<string, unknown> = {
      title: v("title"), personId: null, kind: v("kind"), issuer: v("issuer") || null, issuedOn: v("issuedOn") || null, expiresOn: v("expiresOn") || null,
      notes: v("notes") || null, trackExpiry: remind,
    };
    if (remind) {
      if (!v("expiresOn")) { setError("Add an expiry date to get reminders."); return; }
      const offs = v("remindDays").split(/[\s,]+/).filter(Boolean).map((n) => -Math.abs(Number(n))).filter((n) => Number.isFinite(n));
      if (offs.length) input.reminderOffsetsDays = [...new Set(offs)];
      if (v("reminderTime")) input.reminderTime = v("reminderTime");
    }
    if (v("idNumber")) input.idNumber = v("idNumber");
    setBusy("Saving…");
    let docId: string | null = null;
    try {
      const r = await api<{ id: string }>("/api/ops/document.create", input);
      docId = r.id;
      if (toSend) {
        setBusy("Encrypting & uploading…");
        try { await uploadFile(r.id, toSend); }
        catch (up) { throw new Error(`Document saved, but the file didn't upload: ${(up as Error).message}. Use “Upload file” on its card to try again.`); }
      }
      toast([toSend ? "Document saved with its file" : "Document saved", note].filter(Boolean).join(". "));
      onDone?.();
      close?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
      if (docId) router.refresh();
    } finally { setBusy(null); }
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field"><span className="label">Title</span><input className="input" name="title" required placeholder="Passport" /></label>
        <label className="field"><span className="label">Type</span>
          <select className="select" name="kind" defaultValue="passport">{DOC_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="field"><span className="label">Issued by <span className="t-meta">(optional)</span></span><input className="input" name="issuer" /></label>
        <label className="field"><span className="label">Issue date <span className="t-meta">(optional)</span></span><input className="input" type="date" name="issuedOn" /></label>
        <label className="field"><span className="label">Expiry date <span className="t-meta">(optional)</span></span><input className="input" type="date" name="expiresOn" /></label>
        <label className="field"><span className="label">ID number <span className="t-meta">(optional)</span></span><input className="input" name="idNumber" autoComplete="off" spellCheck={false} />
          <span className="t-meta">Encrypted; shown only as the last 4 digits until you reveal it.</span></label>
        <div className="field sm:col-span-2">
          <span className="label">File <span className="t-meta">(optional, PDF or photo, up to 4 MB)</span></span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn btn-sm cursor-pointer">
              {file ? "Change file" : "Choose file"}
              <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Choose a file for this document" />
            </label>
            <span className="t-small text-ink-2">{file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : "No file chosen"}</span>
            {file && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFile(null)}>Remove</button>}
          </div>
          <label className="check t-small"><input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />Compress file to reduce size
            <span className="t-meta">(photos only; leave unticked to keep full quality)</span></label>
        </div>
        <div className="sm:col-span-2 rounded-[16px] p-3 grid gap-3" style={{ border: "1px solid var(--hair)", background: "color-mix(in srgb, var(--field-bg) 60%, transparent)" }}>
          <label className="check"><input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /><span className="font-semibold">Reminders on</span></label>
          {remind && (
            <div className="grid gap-4 sm:grid-cols-2 preview-enter">
              <label className="field"><span className="label">Remind me this many days before</span><input className="input" name="remindDays" defaultValue="90, 30, 7" inputMode="numeric" /></label>
              <label className="field"><span className="label">Reminder time</span><input className="input" type="time" name="reminderTime" defaultValue="09:00" /></label>
            </div>
          )}
        </div>
        <label className="field sm:col-span-2"><span className="label">Notes <span className="t-meta">(optional)</span></span><textarea className="textarea" name="notes" /></label>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <div><button className="btn btn-primary" disabled={!!busy}>{busy ?? "Save document"}</button></div>
    </form>
  );
}
