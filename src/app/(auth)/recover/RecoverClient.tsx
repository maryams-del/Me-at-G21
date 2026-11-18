"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/components/api";

export function RecoverClient() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [factor, setFactor] = useState<"recovery_code" | "totp">("recovery_code");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-5">
      <div className="text-ink-2 prose-w grid gap-2 t-small">
        <p>Try these first, they&apos;re faster:</p>
        <ul className="list-disc pl-5 grid gap-1">
          <li>Sign in with a passkey on another device you registered (Mac, iPad, security key).</li>
          <li>On a replacement iPhone or Mac, once your Apple Account and iCloud Keychain are restored, a synced passkey may appear. This depends on your Apple settings.</li>
        </ul>
        <p>Otherwise, recover with your verified email <strong>plus</strong> one offline recovery code or your authenticator app. You don&apos;t need the lost phone.</p>
      </div>

      {!sent ? (
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError(null);
          try { await api("/api/auth/recovery-start", { email }); setSent(true); } catch (err) { setError(err instanceof ApiError ? err.message : "Couldn't send the code."); } finally { setBusy(false); }
        }}>
          <label className="field"><span className="label">Account email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
        </form>
      ) : (
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError(null);
          try {
            const r = await api<{ next: string }>("/api/auth/recovery-verify", { email, emailCode, factor, value });
            window.location.href = r.next;
          } catch (err) { setError(err instanceof ApiError ? err.message : "Recovery failed."); } finally { setBusy(false); }
        }}>
          <label className="field"><span className="label">6-digit code from your email</span><input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))} /></label>
          <fieldset className="grid gap-2">
            <legend className="label t-small font-medium text-ink-2 mb-1">Second factor</legend>
            <label className="check"><input type="radio" name="f" checked={factor === "recovery_code"} onChange={() => { setFactor("recovery_code"); setValue(""); }} />One of my offline recovery codes</label>
            <label className="check"><input type="radio" name="f" checked={factor === "totp"} onChange={() => { setFactor("totp"); setValue(""); }} />A code from my authenticator app</label>
          </fieldset>
          <label className="field">
            <span className="label">{factor === "totp" ? "6-digit authenticator code" : "Recovery code"}</span>
            <input className="input" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={factor === "totp" ? "123456" : "ABCD-EFGH-JKLM-NPQR"} />
          </label>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Checking…" : "Recover my account"}</button>
          <p className="t-meta">After recovery you&apos;ll be asked to add a new passkey. Removing old sign-in methods is locked for 24 hours, and you&apos;ll get a security email. Recovery never unlocks the password vault.</p>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      <Link href="/login" className="t-small underline underline-offset-4">Back to sign in</Link>
    </div>
  );
}
