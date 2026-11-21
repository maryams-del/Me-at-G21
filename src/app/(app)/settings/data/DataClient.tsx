"use client";
import { askConfirm } from "@/components/ConfirmDialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { stepUp, toast } from "@/components/api";
import { PortableWriter, PortableReader, blobSource, sha256Hex, MIN_PASSWORD, PORTABLE_MAGIC } from "@/lib/portable";
import { backupItems } from "@/lib/backup-labels";

/** Private sections ask before downloading. */
export function PrivateCsvLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="t-small" onClick={async (e) => {
      e.preventDefault();
      if (await askConfirm("This file contains your period log in plain text.", { note: "Download it and keep it somewhere private?", confirmLabel: "Download" })) window.location.href = href;
    }}>{label}</a>
  );
}

type Summary = { createdAt: string; items: { label: string; count: number }[]; files?: number; fileBytes?: number };
type Portable = { createdAt: string; counts: Record<string, number>; files: { id: string; filename: string; sizeBytes: number; sha256: string }[] };
const dmyTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(",", "");
const mb = (b: number) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

/** fetch that runs the Face ID / passkey check once if the server asks for it */
async function withStepUp(run: () => Promise<Response>) {
  let res = await run();
  if (res.status === 403) {
    const j = await res.clone().json().catch(() => ({}));
    if (j.error === "step_up_required") { await stepUp(); res = await run(); }
  }
  return res;
}
async function gzip(text: string): Promise<{ body: BodyInit; type: string }> {
  if (typeof CompressionStream === "undefined") return { body: text, type: "application/json" };
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return { body: await new Response(s).blob(), type: "application/json+gzip" };
}

/* ───────────── Full backup: records + every document, locked with the owner's password ───────────── */

export function FullBackupPanel() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = pw.length >= MIN_PASSWORD && pw === pw2 && saved;

  const create = async () => {
    setBusy(true); setError(null);
    try {
      setProgress("Checking it's you…");
      const res = await withStepUp(() => fetch("/api/backup/portable", { credentials: "same-origin", cache: "no-store" }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't prepare the backup");
      const p = data as Portable;
      setProgress("Locking your records with your password…");
      const w = await PortableWriter.create(pw);
      await w.records(JSON.stringify(p));
      let n = 0;
      for (const f of p.files) {
        setProgress(`Adding documents: ${++n} of ${p.files.length} (${f.filename})`);
        const r = await fetch(`/api/documents/file/${f.id}`, { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) throw new Error(`Couldn't read “${f.filename}”. Nothing was saved; try again.`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        if ((await sha256Hex(bytes)) !== f.sha256) throw new Error(`“${f.filename}” failed its integrity check. Try again.`);
        await w.file(f.id, bytes);
      }
      const parts = await w.finish();
      const blob = new Blob(parts.map((x) => x.slice().buffer), { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `me-at-g21-full-backup-${new Date().toISOString().slice(0, 10)}.mebackup` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setProgress(null); setPw(""); setPw2(""); setSaved(false);
      toast(`Full backup ready: ${p.files.length} document file${p.files.length === 1 ? "" : "s"}, ${mb(blob.size)}. Keep it with your password.`);
    } catch (e) {
      setProgress(null);
      setError((e as Error).name === "NotAllowedError" ? "The Face ID / passkey check was cancelled." : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field"><span className="label">Backup password</span><input type="password" className="input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="field"><span className="label">Type it again</span><input type="password" className="input" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
      </div>
      <p className="t-meta">At least {MIN_PASSWORD} characters. A short sentence works well. {pw && pw.length < MIN_PASSWORD ? `(${MIN_PASSWORD - pw.length} more)` : pw2 && pw !== pw2 ? "(the two don't match yet)" : ""}</p>
      <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /><span>I've saved this password somewhere safe. Without it this backup can't be opened by anyone.</span></label>
      <button type="button" className="btn btn-primary justify-self-start" disabled={!valid || busy} onClick={create}>{busy ? "Working…" : "Create full backup (Face ID)"}</button>
      {progress && <p className="t-small" aria-live="polite">{progress}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

/* ───────────── Restore: a nightly/quick backup (.mebackup from the server) or a full backup (password) ───────────── */

async function send(form: FormData): Promise<{ ok?: boolean; error?: string; summary?: Summary; message?: string }> {
  const res = await fetch("/api/backup/restore", { method: "POST", body: form, credentials: "same-origin" });
  return res.json().catch(() => ({ error: "Something went wrong" }));
}

export function RestorePanel({ stored, pending = 0 }: { stored: { id: string; label: string }[]; pending?: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isFull, setIsFull] = useState(false);
  const [password, setPassword] = useState("");
  const [storedId, setStoredId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [portable, setPortable] = useState<Portable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => { setSummary(null); setPortable(null); setError(null); setFailed([]); };
  const pick = async (f: File | null) => {
    setFile(f); setStoredId(""); reset(); setPassword("");
    setIsFull(!!f && new TextDecoder().decode(await f.slice(0, 4).arrayBuffer()) === PORTABLE_MAGIC);
  };
  const source = () => { const f = new FormData(); if (file) f.set("file", file); else f.set("id", storedId); return f; };

  const preview = async () => {
    setBusy(true); reset();
    try {
      if (isFull && file) {
        setProgress("Unlocking…");
        const r = await PortableReader.open(blobSource(file), password);
        const p = JSON.parse(await r.records()) as Portable;
        setPortable(p);
        setSummary({ createdAt: p.createdAt, items: backupItems(p.counts), files: p.files.length, fileBytes: p.files.reduce((a, x) => a + x.sizeBytes, 0) });
      } else {
        const f = source(); f.set("mode", "preview");
        const r = await send(f);
        if (r.summary) setSummary(r.summary); else setError(r.error ?? "Couldn't read that backup");
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(null); }
  };

  const uploadFiles = async () => {
    if (!file) return;
    const pend = await fetch("/api/backup/portable/file", { credentials: "same-origin", cache: "no-store" }).then((x) => x.json()).catch(() => ({ pending: [] }));
    const waiting = new Set<string>((pend.pending ?? []).map((x: { id: string }) => x.id));
    const r = await PortableReader.open(blobSource(file), password);
    await r.records();
    const total = waiting.size;
    const bad: string[] = [];
    let n = 0;
    for await (const f of r.files()) {
      if (!waiting.has(f.id)) continue;
      const name = portable?.files.find((x) => x.id === f.id)?.filename ?? f.id;
      setProgress(`Restoring documents: ${++n} of ${total} (${name})`);
      const form = new FormData();
      form.set("fileId", f.id);
      form.set("file", new Blob([f.bytes.slice().buffer]), name);
      const res = await fetch("/api/backup/portable/file", { method: "POST", body: form, credentials: "same-origin" });
      if (!res.ok) bad.push(name);
    }
    setFailed(bad);
    return bad;
  };

  const restore = async () => {
    if (!(await askConfirm("Replace ALL your current records with this backup?", { note: "Your current data will be saved as a safety backup first.", danger: true, confirmLabel: "Yes, replace" }))) return;
    setBusy(true); setError(null);
    try {
      if (isFull && portable && file) {
        setProgress("Restoring your records…");
        const r = await PortableReader.open(blobSource(file), password);
        const { body, type } = await gzip(JSON.stringify({ payload: JSON.parse(await r.records()) }));
        const res = await withStepUp(() => fetch("/api/backup/portable/restore", { method: "POST", body, headers: { "Content-Type": type }, credentials: "same-origin" }));
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "Restore failed. Nothing was changed.");
        const bad = await uploadFiles();
        toast(bad?.length ? `Records restored, but ${bad.length} document file${bad.length === 1 ? "" : "s"} didn't upload. Use “Retry documents”.` : "Full backup restored, documents included. Your previous data was saved as a safety backup.", bad?.length ? "error" : "ok");
        if (!bad?.length) { setSummary(null); setPortable(null); }
      } else {
        const f = source(); f.set("mode", "restore");
        let r = await send(f);
        if (r.error === "step_up_required") { await stepUp(); const g = source(); g.set("mode", "restore"); r = await send(g); }
        if (!r.ok) throw new Error(r.error ?? "Restore failed. Nothing was changed.");
        toast(r.message ?? "Restored"); setSummary(null);
      }
      router.refresh();
    } catch (e) { setError((e as Error).name === "NotAllowedError" ? "The Face ID / passkey check was cancelled. Nothing was changed." : (e as Error).message); }
    finally { setBusy(false); setProgress(null); }
  };

  const retry = async () => {
    setBusy(true); setError(null);
    try { const bad = await uploadFiles(); if (!bad?.length) { toast("All documents restored"); setSummary(null); setPortable(null); router.refresh(); } }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(null); }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field"><span className="label">A backup file from your device</span>
          <input type="file" accept=".mebackup,application/octet-stream" className="input" onChange={(e) => pick(e.target.files?.[0] ?? null)} /></label>
        <label className="field"><span className="label">or one saved in the app</span>
          <select className="select" value={storedId} onChange={(e) => { setStoredId(e.target.value); setFile(null); setIsFull(false); reset(); }}>
            <option value="">Choose…</option>{stored.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select></label>
      </div>
      {isFull && <label className="field max-w-md"><span className="label">This is a full backup. Its password:</span><input type="password" className="input" autoComplete="off" value={password} onChange={(e) => { setPassword(e.target.value); reset(); }} /></label>}
      <button type="button" className="btn justify-self-start" disabled={busy || (!file && !storedId) || (isFull && !password)} onClick={preview}>{busy && !summary ? "Checking…" : "Check backup"}</button>
      {progress && <p className="t-small" aria-live="polite">{progress}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {summary && (
        <div className="panel p-4 grid gap-3" style={{ boxShadow: "inset 6px 0 0 var(--mustard)" }}>
          <p className="t-small"><strong>Backup is complete and intact.</strong> Made {dmyTime(summary.createdAt)}. It contains:</p>
          <ul className="t-small grid gap-0.5 sm:grid-cols-2">{summary.items.map((i) => <li key={i.label}>{i.count} {i.label}</li>)}</ul>
          {summary.files !== undefined && <p className="t-small">Including the contents of {summary.files} document file{summary.files === 1 ? "" : "s"} ({mb(summary.fileBytes ?? 0)}).</p>}
          <p className="t-small text-ink-2">Restoring replaces everything you have now with this backup. Your current data is saved first as a safety backup, which you can restore if this was a mistake.</p>
          {failed.length > 0 ? (
            <><p role="alert" className="error">These documents didn't upload: {failed.join(", ")}.</p>
              <button type="button" className="btn btn-primary justify-self-start" disabled={busy} onClick={retry}>Retry documents</button></>
          ) : (
            <div className="flex flex-wrap gap-2">
              {portable && pending > 0 && <button type="button" className="btn btn-primary" disabled={busy} onClick={retry}>Only restore the {pending} missing document file{pending === 1 ? "" : "s"}</button>}
              <button type="button" className="btn btn-danger" disabled={busy} onClick={restore}>{busy ? "Restoring…" : "Restore this backup (Face ID)"}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
