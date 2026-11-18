"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/components/api";

export function SearchBox() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ answer: string; sources: { label: string; date: string; href: string }[]; calculation?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mb-6">
      <form className="flex gap-2" onSubmit={async (e) => {
        e.preventDefault(); if (!q.trim()) return; setBusy(true); setErr(null);
        try { setRes(await api("/api/ai/search", { text: q })); } catch (x) { setErr(x instanceof ApiError ? x.message : "Search failed"); } finally { setBusy(false); }
      }}>
        <label htmlFor="ask" className="sr-only">Ask about your records</label>
        <input id="ask" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="When did I last get dental scaling? How much did I donate this year?" />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Searching…" : "Ask"}</button>
      </form>
      {err && <p className="error mt-2" role="alert">{err}</p>}
      {res && (
        <div className="panel p-4 mt-3 preview-enter" aria-live="polite">
          <p className="font-medium">{res.answer}</p>
          {res.calculation && <p className="t-meta mt-1">{res.calculation}</p>}
          {res.sources.length > 0 && <ul className="list mt-2">{res.sources.map((s, i) => <li key={i} className="py-1.5 flex justify-between t-small gap-3"><Link href={s.href} className="underline underline-offset-4">{s.label}</Link><span className="t-meta">{s.date}</span></li>)}</ul>}
        </div>
      )}
    </div>
  );
}
