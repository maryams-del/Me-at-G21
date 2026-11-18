"use client";
import { useState } from "react";
import { api, ApiError, toast } from "@/components/api";
import { CURRENCIES } from "@/lib/money";

export function ProfileForm({ initial }: { initial: { displayName: string; timezone: string; defaultCurrency: string } }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["Asia/Riyadh"];
  return (
    <form className="grid gap-4 sm:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { await api("/api/auth/profile-update", v); toast("Settings saved"); } catch (x) { setErr(x instanceof ApiError ? x.message : "Couldn't save"); } finally { setBusy(false); }
    }}>
      <label className="field"><span className="label">Name</span><input className="input" value={v.displayName} maxLength={60} onChange={(e) => setV({ ...v, displayName: e.target.value })} /></label>
      <label className="field"><span className="label">Timezone</span><select className="select" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>{zones.map((z) => <option key={z}>{z}</option>)}</select></label>
      <label className="field"><span className="label">Default currency</span><select className="select" value={v.defaultCurrency} onChange={(e) => setV({ ...v, defaultCurrency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      {err && <p className="error sm:col-span-3" role="alert">{err}</p>}
      <div><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  );
}

export function SignOut() {
  return <button className="btn" onClick={async () => { await api("/api/auth/logout").catch(() => {}); window.location.href = "/login"; }}>Sign out of this device</button>;
}
