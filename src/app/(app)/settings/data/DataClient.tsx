"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { stepUp, toast } from "@/components/api";

/** Private sections ask before downloading. */
export function PrivateCsvLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="t-small" onClick={(e) => { if (!window.confirm("This file contains your period log in plain text. Download it and keep it somewhere private?")) e.preventDefault(); }}>{label}</a>
  );
}

type Summary = { createdAt: string; items: { label: string; count: number }[] };
const dmyTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(",", "");

async function send(form: FormData): Promise<{ ok?: boolean; error?: string; summary?: Summary; message?: string }> {
  const res = await fetch("/api/backup/restore", { method: "POST", body: form, credentials: "same-origin" });
  return res.json().catch(() => ({ error: "Something went wrong" }));
}

export function RestorePanel({ stored }: { stored: { id: string; label: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [storedId, setStoredId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const source = () => { const f = new FormData(); if (file) f.set("file", file); else f.set("id", storedId); return f; };
  const reset = () => { setSummary(null); setError(null); };

  const preview = async () => {
    setBusy(true); reset();
    const f = source(); f.set("mode", "preview");
    const r = await send(f);
    setBusy(false);
    if (r.summary) setSummary(r.summary); else setError(r.error ?? "Couldn't read that backup");
  };

  const restore = async () => {
    if (!window.confirm("Replace ALL your current records with this backup? Your current data will be saved as a safety backup first.")) return;
    setBusy(true); setError(null);
    try {
      const f = source(); f.set("mode", "restore");
      let r = await send(f);
      if (r.error === "step_up_required") { await stepUp(); const g = source(); g.set("mode", "restore"); r = await send(g); }
      if (r.ok) { toast(r.message ?? "Restored"); setSummary(null); setFile(null); setStoredId(""); router.refresh(); }
      else setError(r.error ?? "Restore failed. Nothing was changed.");
    } catch { setError("Face ID / passkey check was cancelled. Nothing was changed."); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field"><span className="label">A backup file from your device</span>
          <input type="file" accept=".mebackup,application/octet-stream" className="input" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStoredId(""); reset(); }} /></label>
        <label className="field"><span className="label">or one saved in the app</span>
          <select className="select" value={storedId} onChange={(e) => { setStoredId(e.target.value); setFile(null); reset(); }}>
            <option value="">Choose…</option>{stored.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select></label>
      </div>
      <button type="button" className="btn justify-self-start" disabled={busy || (!file && !storedId)} onClick={preview}>{busy && !summary ? "Checking…" : "Check backup"}</button>
      {error && <p role="alert" className="error">{error}</p>}
      {summary && (
        <div className="panel p-4 grid gap-3" style={{ boxShadow: "inset 6px 0 0 var(--mustard)" }}>
          <p className="t-small"><strong>Backup is complete and intact.</strong> Made {dmyTime(summary.createdAt)}. It contains:</p>
          <ul className="t-small grid gap-0.5 sm:grid-cols-2">{summary.items.map((i) => <li key={i.label}>{i.count} {i.label}</li>)}</ul>
          <p className="t-small text-ink-2">Restoring replaces everything you have now with this backup. Your current data is saved first as a safety backup, which you can restore if this was a mistake.</p>
          <button type="button" className="btn btn-danger justify-self-start" disabled={busy} onClick={restore}>{busy ? "Restoring…" : "Restore this backup (Face ID)"}</button>
        </div>
      )}
    </div>
  );
}
