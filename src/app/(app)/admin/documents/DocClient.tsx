"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "@/components/api";

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
