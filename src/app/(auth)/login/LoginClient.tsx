"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api, ApiError } from "@/components/api";

export function LoginClient() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  // Fetch the sign-in options before the tap so the passkey prompt opens straight from it (Android Chrome needs this).
  type Opts = Parameters<typeof startAuthentication>[0]["optionsJSON"];
  const ready = useRef<{ opts: Opts; at: number } | null>(null);
  const prefetch = () => api<Opts>("/api/auth/login-options").then((opts) => { ready.current = { opts, at: Date.now() }; }).catch(() => { ready.current = null; });
  useEffect(() => { prefetch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function signIn() {
    setBusy(true); setError(null);
    try {
      const fresh = ready.current && Date.now() - ready.current.at < 4 * 60_000 ? ready.current.opts : null;
      ready.current = null;
      const opts = fresh ?? await api<Opts>("/api/auth/login-options");
      const response = await startAuthentication({ optionsJSON: opts });
      const r = await api<{ next: string }>("/api/auth/login-verify", { response });
      window.location.href = r.next;
    } catch (e) {
      const name = (e as Error).name;
      prefetch();
      setError(name === "NotAllowedError" ? "Sign-in was cancelled or timed out. Try again." : e instanceof ApiError ? e.message : "Couldn't sign in with a passkey on this device.");
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-5">
      <p className="text-ink-2 prose-w">Use your passkey. Your device will ask for your fingerprint, face or screen lock.</p>
      {supported === false && <p className="panel p-3 t-small" style={{ background: "var(--tint-rust)" }}>This browser doesn&apos;t support passkeys. Use a current version of Safari, Chrome, Edge or Firefox, or recover access below.</p>}
      <button className="btn btn-primary" onClick={signIn} disabled={busy || supported === false}>{busy ? "Waiting for your device…" : "Sign in with passkey"}</button>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="rule-b" />
      <div className="grid gap-2 t-small">
        <Link href="/recover" className="underline underline-offset-4">Lost your phone or passkey?</Link>
        <Link href="/onboarding" className="underline underline-offset-4">New here? Create your account</Link>
        <span className="t-meta">You can create an account if the site owner has invited your email.</span>
      </div>
    </div>
  );
}
