"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, toast } from "@/components/api";
import { PasskeyStep, TotpStep, CodesDisplay } from "@/app/(auth)/onboarding/OnboardingClient";
import { Section } from "@/components/ui";

type Overview = {
  session: { method: string; createdAt: string; stepUpFresh: boolean };
  passkeys: { id: string; nickname: string; backedUp: boolean; deviceType: string; createdAt: string; lastUsedAt: string | null }[];
  totp: { label: string; verifiedAt: string } | null;
  recoveryCodes: { total: number; remaining: number; generatedAt: string | null; used: number[] };
  sessions: { id: string; device: string; method: string; createdAt: string; lastSeenAt: string; current: boolean }[];
  events: { type: string; at: string; ua: string | null }[];
};
const d = (s: string | null) => {
  if (!s) return "never";
  const t = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getDate())}/${p(t.getMonth() + 1)}/${t.getFullYear()}, ${p(t.getHours())}:${p(t.getMinutes())}`;
};

export function SecurityClient({ recovered }: { recovered: boolean }) {
  const [o, setO] = useState<Overview | null>(null);
  const [mode, setMode] = useState<null | "passkey" | "totp" | "codes">(recovered ? "passkey" : null);
  const [codes, setCodes] = useState<{ codes: string[]; generatedAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<Overview>("/api/auth/security-overview").then(setO).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const act = async (path: string, body: unknown, ok: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setErr(null);
    try { await api(path, body); toast(ok); await load(); } catch (e) { setErr(e instanceof ApiError ? e.message : "Action failed"); }
  };
  if (!o) return <p className="t-meta">{err ?? "Loading…"}</p>;
  const isRecovery = o.session.method === "recovery";

  return (
    <div>
      {(recovered || isRecovery) && (
        <div className="panel p-4 mb-6" style={{ background: "var(--tint-rust)" }} role="status">
          <p className="t-h3">You recovered your account</p>
          <ol className="list-decimal pl-5 t-small mt-2 grid gap-1">
            <li>Add a passkey on this device (below).</li>
            <li>Sign out any lost or unknown devices under “Signed-in devices”.</li>
            <li>After 24 hours you can remove the lost phone&apos;s passkey and rotate your recovery codes. This delay protects you if someone else started the recovery.</li>
          </ol>
          <p className="t-meta mt-2">Signing out a device ends its session here. It can&apos;t erase data already on that phone.</p>
        </div>
      )}
      {err && <p className="error mb-4" role="alert">{err}</p>}

      <Section title="Passkeys" aside={<button className="btn btn-sm" onClick={() => setMode(mode === "passkey" ? null : "passkey")}>{mode === "passkey" ? "Close" : "Add passkey"}</button>}>
        {mode === "passkey" && <div className="panel p-4 mb-3"><PasskeyStep again onDone={() => { setMode(null); toast("Passkey added"); load(); }} /></div>}
        <ul className="list panel px-4">
          {o.passkeys.map((p) => (
            <li key={p.id} className="py-3 flex flex-wrap justify-between gap-3 items-center">
              <div><p className="font-medium">{p.nickname}</p><p className="t-meta">{p.backedUp ? "Synced (e.g. iCloud Keychain)" : "Stored on one device"}. Added {d(p.createdAt)}. Last used {d(p.lastUsedAt)}.</p></div>
              <div className="flex gap-2">
                <button className="btn btn-sm btn-ghost" onClick={() => { const n = window.prompt("Name this passkey", p.nickname); if (n) act("/api/auth/passkey-rename", { id: p.id, nickname: n }, "Renamed"); }}>Rename</button>
                <button className="btn btn-sm btn-danger" disabled={o.passkeys.length <= 1} onClick={() => act("/api/auth/passkey-remove", { id: p.id }, "Passkey removed", `Remove “${p.nickname}”? That device will no longer be able to sign in.`)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
        {o.passkeys.length < 2 && <p className="t-small mt-2 panel p-3" style={{ background: "var(--tint-mustard)" }}>Add a second passkey on another device you trust (a Mac, iPad or security key). It&apos;s the fastest way back in if your phone is lost.</p>}
      </Section>

      <Section title="Authenticator app" aside={<button className="btn btn-sm" onClick={() => setMode(mode === "totp" ? null : "totp")}>{mode === "totp" ? "Close" : o.totp ? "Replace" : "Set up"}</button>}>
        {mode === "totp" ? <div className="panel p-4"><TotpStep onDone={() => { setMode(null); toast("Authenticator app saved"); load(); }} /></div> : (
          <div className="panel p-4 flex flex-wrap justify-between gap-3 items-center">
            <p className="t-small">{o.totp ? `Active since ${d(o.totp.verifiedAt)}.` : "Not set up. Recovery will need an offline recovery code."}</p>
            {o.totp && <button className="btn btn-sm btn-danger" onClick={() => act("/api/auth/totp-remove", {}, "Authenticator removed", "Remove the authenticator app as a backup factor?")}>Remove</button>}
          </div>
        )}
      </Section>

      <Section title="Recovery codes" aside={<button className="btn btn-sm" onClick={async () => {
        if (!window.confirm("Generate new codes? All your current codes stop working immediately.")) return;
        setErr(null);
        try { setCodes(await api("/api/auth/recovery-codes-generate")); setMode("codes"); load(); } catch (e) { setErr(e instanceof ApiError ? e.message : "Failed"); }
      }}>Replace codes</button>}>
        {mode === "codes" && codes ? (
          <div className="panel p-4 grid gap-3"><p className="t-small">Your new codes. They won&apos;t be shown again.</p><CodesDisplay {...codes} /><button className="btn btn-sm justify-self-start" onClick={() => { setCodes(null); setMode(null); }}>I&apos;ve saved them</button></div>
        ) : (
          <div className="panel p-4"><p className="t-small"><span className="t-num text-2xl">{o.recoveryCodes.remaining}</span> of {o.recoveryCodes.total} unused{o.recoveryCodes.used.length ? ` (used: #${o.recoveryCodes.used.join(", #")})` : ""}. Generated {d(o.recoveryCodes.generatedAt)}.</p>
            {o.recoveryCodes.remaining <= 3 && <p className="t-small mt-2" style={{ color: "var(--danger)" }}>Running low. Replace your codes and store the new set offline.</p>}</div>
        )}
      </Section>

      <Section title="Signed-in devices" aside={<button className="btn btn-sm" onClick={() => act("/api/auth/session-revoke", { all: true }, "Signed out everywhere else", "Sign out every other device?")}>Sign out all others</button>}>
        <ul className="list panel px-4">
          {o.sessions.map((s) => (
            <li key={s.id} className="py-3 flex flex-wrap justify-between gap-3 items-center">
              <div><p className="font-medium">{s.device} {s.current && <span className="chip chip-pine">this device</span>}</p><p className="t-meta">Signed in {d(s.createdAt)} with {s.method}. Last active {d(s.lastSeenAt)}.</p></div>
              {!s.current && <button className="btn btn-sm btn-danger" onClick={() => act("/api/auth/session-revoke", { id: s.id }, "Device signed out", `Sign out ${s.device}?`)}>Sign out</button>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Security activity">
        <ul className="list panel px-4">{o.events.map((e, i) => <li key={i} className="py-2 flex justify-between gap-3 t-small"><span>{e.type.replace(/_/g, " ")}</span><span className="t-meta">{d(e.at)}</span></li>)}</ul>
      </Section>
    </div>
  );
}
