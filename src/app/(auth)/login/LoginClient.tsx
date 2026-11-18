"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api, ApiError } from "@/components/api";

export function LoginClient({ setupAvailable }: { setupAvailable: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function signIn() {
    setBusy(true); setError(null);
    try {
      const opts = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/login-options");
      const response = await startAuthentication({ optionsJSON: opts });
      const r = await api<{ next: string }>("/api/auth/login-verify", { response });
      window.location.href = r.next;
    } catch (e) {
      const name = (e as Error).name;
      setError(name === "NotAllowedError" ? "Sign-in was cancelled or timed out. Try again." : e instanceof ApiError ? e.message : "Couldn't sign in with a passkey on this device.");
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-5">
      <p className="text-ink-2 prose-w">Use your passkey. Your device will ask for Face ID, Touch ID or your device passcode.</p>
      {supported === false && <p className="panel p-3 t-small" style={{ background: "var(--tint-rust)" }}>This browser doesn&apos;t support passkeys. Use a current version of Safari, Chrome, Edge or Firefox, or recover access below.</p>}
      <button className="btn btn-primary" onClick={signIn} disabled={busy || supported === false}>{busy ? "Waiting for your device…" : "Sign in with passkey"}</button>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="rule-b" />
      <div className="grid gap-2 t-small">
        <Link href="/recover" className="underline underline-offset-4">Lost your phone or passkey?</Link>
        {setupAvailable && <Link href="/onboarding" className="underline underline-offset-4">First time here? Set up your account</Link>}
      </div>
    </div>
  );
}
