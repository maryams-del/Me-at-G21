"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "@/components/api";
import { useRevealClose } from "@/components/OpForm";

/** Upload a new file version. Bytes go to our server, which encrypts them before storage. */
export function UploadButton({ documentId, hasFiles }: { documentId: string; hasFiles: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast("Files must be 4 MB or smaller", "error"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("documentId", documentId);
      fd.set("file", file);
      const res = await fetch("/api/documents/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      toast(data.message ?? "Uploaded");
      router.refresh();
    } catch (err) { toast((err as Error).message, "error"); }
    finally { setBusy(false); }
  }
  return (
    <>
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" className="sr-only" onChange={onPick} aria-label="Choose a file to upload" />
      <button className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Encrypting & uploading…" : hasFiles ? "Upload new version" : "Upload file"}</button>
    </>
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
export function NewDocumentForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const close = useRevealClose();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => String(fd.get(k) ?? "").trim();
    if (file && file.size > 4 * 1024 * 1024) { setError("Files must be 4 MB or smaller."); return; }
    const input: Record<string, unknown> = {
      title: v("title"), kind: v("kind"), issuer: v("issuer") || null, issuedOn: v("issuedOn") || null, expiresOn: v("expiresOn") || null,
      notes: v("notes") || null, trackExpiry: fd.get("trackExpiry") === "on",
    };
    if (v("idNumber")) input.idNumber = v("idNumber");
    setBusy("Saving…");
    let docId: string | null = null;
    try {
      const r = await api<{ id: string }>("/api/ops/document.create", input);
      docId = r.id;
      if (file) {
        setBusy("Encrypting & uploading…");
        const up = new FormData();
        up.set("documentId", r.id);
        up.set("file", file);
        const res = await fetch("/api/documents/upload", { method: "POST", body: up, credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Document saved, but the file didn't upload: ${data.error ?? "upload failed"}. Use “Upload file” on its card to try again.`);
      }
      toast(file ? "Document saved with its file" : "Document saved");
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
        </div>
        <label className="check sm:col-span-2"><input type="checkbox" name="trackExpiry" defaultChecked />Remind me before it expires (adds it to Expiries)</label>
        <label className="field sm:col-span-2"><span className="label">Notes <span className="t-meta">(optional)</span></span><textarea className="textarea" name="notes" /></label>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <div><button className="btn btn-primary" disabled={!!busy}>{busy ?? "Save document"}</button></div>
    </form>
  );
}
