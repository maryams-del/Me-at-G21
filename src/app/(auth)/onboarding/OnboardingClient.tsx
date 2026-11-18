"use client";
import { useEffect, useRef, useState } from "react";
import { startRegistration, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";
import { api, ApiError } from "@/components/api";
import { AuthFrame } from "../AuthFrame";

const STEPS = ["email", "passkey", "totp", "recovery_codes"] as const;
const LABELS = { email: "Verify email", passkey: "Passkey", totp: "Authenticator app", recovery_codes: "Recovery codes" };

export function OnboardingClient({ step: initial, email: initialEmail }: { step: string; email: string }) {
  const [step, setStep] = useState(initial === "complete" ? "email" : initial);
  const idx = Math.max(0, STEPS.indexOf(step as (typeof STEPS)[number]));
  const frame = (title: string, body: React.ReactNode) => (
    <AuthFrame title={title} step={{ n: idx + 1, of: 4, label: LABELS[STEPS[idx]] }}>{body}</AuthFrame>
  );
  if (step === "email") return frame("Set up your private dashboard", <EmailStep onDone={() => setStep("passkey")} initialEmail={initialEmail} />);
  if (step === "passkey") return frame("Create your passkey", <PasskeyStep onDone={() => setStep("totp")} />);
  if (step === "totp") return frame("Add an authenticator app", <TotpStep onDone={() => setStep("recovery_codes")} />);
  return frame("Save your recovery codes", <CodesStep />);
}

function Err({ e }: { e: string | null }) { return e ? <p role="alert" className="error">{e}</p> : null; }
const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : (e as Error)?.name === "NotAllowedError" ? "The request was cancelled or timed out. Try again." : fallback);

function EmailStep({ onDone, initialEmail }: { onDone: () => void; initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <p className="text-ink-2 prose-w">This email is used once to confirm it&apos;s you, and later for security alerts. It is never your everyday sign-in.</p>
      {!sent ? (
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError(null);
          try { await api("/api/auth/enroll-start", { email }); setSent(true); } catch (err) { setError(msg(err, "Couldn't send the code.")); } finally { setBusy(false); }
        }}>
          <label className="field"><span className="label">Email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send verification code"}</button>
        </form>
      ) : (
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError(null);
          try {
            await api("/api/auth/enroll-verify", { email, code });
            if (name.trim()) await api("/api/auth/enroll-profile", { displayName: name });
            onDone();
          } catch (err) { setError(msg(err, "Couldn't verify the code.")); } finally { setBusy(false); }
        }}>
          <p className="t-small">If <strong>{email}</strong> is the owner address, a 6-digit code is on its way. It expires in 10 minutes.</p>
          <label className="field"><span className="label">Verification code</span><input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="field"><span className="label">What should the dashboard call you? <span className="t-meta">(optional)</span></span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Verify"}</button>
          <button type="button" className="btn btn-ghost btn-sm justify-start" onClick={() => { setSent(false); setCode(""); }}>Use a different email</button>
        </form>
      )}
      <Err e={error} />
    </div>
  );
}

export function PasskeyStep({ onDone, again = false }: { onDone: () => void; again?: boolean }) {
  const [platform, setPlatform] = useState<boolean | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    platformAuthenticatorIsAvailable().then(setPlatform).catch(() => setPlatform(false));
  }, []);
  async function create() {
    setBusy(true); setError(null);
    try {
      const opts = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/auth/passkey-register-options");
      const response = await startRegistration({ optionsJSON: opts });
      await api("/api/auth/passkey-register-verify", { response, nickname: nickname || undefined });
      onDone();
    } catch (e) {
      setError((e as Error).name === "InvalidStateError" ? "This device already has a passkey for your account." : msg(e, "Couldn't create a passkey on this device."));
    } finally { setBusy(false); }
  }
  if (supported === false) return <p className="panel p-4" style={{ background: "var(--tint-rust)" }}>This browser can&apos;t create passkeys. Open this page in a current version of Safari (iPhone/Mac), Chrome or Edge to continue setup.</p>;
  return (
    <div className="grid gap-4">
      <p className="text-ink-2 prose-w">
        {platform
          ? "This device can protect your passkey with its built-in lock. Depending on the device you'll see Face ID, Touch ID or your device passcode — the browser decides which, not this app."
          : platform === false
            ? "This device has no built-in passkey lock that the browser can use. You can still create a passkey with a security key, or by scanning a QR code with your phone."
            : "Checking what this device supports…"}
      </p>
      {again && <p className="t-small">Tip: name it after the device, e.g. “MacBook” or “Spare iPhone”.</p>}
      <label className="field"><span className="label">Name <span className="t-meta">(optional)</span></span><input className="input" placeholder={platform ? "iPhone" : "Security key"} value={nickname} maxLength={60} onChange={(e) => setNickname(e.target.value)} /></label>
      <button className="btn btn-primary" onClick={create} disabled={busy || platform === null}>
        {busy ? "Waiting for your device…" : platform ? "Create passkey with Face ID / Touch ID" : "Create passkey"}
      </button>
      <Err e={error} />
    </div>
  );
}

export function TotpStep({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // one setup per mount, even under React's dev double-invoke
    started.current = true;
    api<{ id: string; qr: string; secret: string }>("/api/auth/totp-setup").then(setSetup).catch((e) => setError(msg(e, "Couldn't start setup.")));
  }, []);
  return (
    <div className="grid gap-4">
      <p className="text-ink-2 prose-w">This is your backup if a passkey isn&apos;t available. Scan the code with an authenticator app (Apple Passwords, Google Authenticator, 1Password…). If your phone is stolen, this app may go with it, so a copy on a second device is safer.</p>
      {setup && (
        <div className="panel p-4 grid gap-3 justify-items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} className="bg-white p-1" />
          <details><summary className="t-small cursor-pointer">Can&apos;t scan? Enter this key</summary><code className="t-small break-all select-all">{setup.secret}</code></details>
        </div>
      )}
      <form className="grid gap-3" onSubmit={async (e) => {
        e.preventDefault(); if (!setup) return; setBusy(true); setError(null);
        try { await api("/api/auth/totp-verify", { id: setup.id, code }); onDone(); } catch (err) { setError(msg(err, "Code didn't match.")); } finally { setBusy(false); }
      }}>
        <label className="field"><span className="label">6-digit code from the app</span><input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
        <button className="btn btn-primary" disabled={busy || code.length !== 6 || !setup}>{busy ? "Checking…" : "Verify and continue"}</button>
      </form>
      <Err e={error} />
    </div>
  );
}

export function CodesDisplay({ codes, generatedAt }: { codes: string[]; generatedAt: string }) {
  const text = `Life Dashboard — account recovery codes\nGenerated ${generatedAt}\nEach code works once. Keep these offline, away from your phone.\nThey do NOT unlock the password vault.\n\n${codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${c}`).join("\n")}\n`;
  return (
    <div className="grid gap-3">
      <ol className="panel p-4 grid grid-cols-2 gap-x-6 gap-y-1.5 font-medium tracking-wide" style={{ fontVariantNumeric: "tabular-nums" }} aria-label="Recovery codes">
        {codes.map((c, i) => <li key={c} className="t-small"><span className="text-ink-3 mr-2">{i + 1}.</span><span className="select-all">{c}</span></li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={() => {
          const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
          const a = document.createElement("a"); a.href = url; a.download = "life-dashboard-recovery-codes.txt"; a.click(); URL.revokeObjectURL(url);
        }}>Download .txt</button>
        <button className="btn btn-sm" onClick={() => {
          const w = window.open("", "_blank", "width=600,height=700");
          if (!w) return;
          const pre = w.document.createElement("pre"); pre.textContent = text; pre.style.font = "16px/1.6 monospace";
          w.document.body.appendChild(pre); w.document.title = "Recovery codes"; w.print();
        }}>Print</button>
      </div>
    </div>
  );
}

function CodesStep() {
  const [codes, setCodes] = useState<{ codes: string[]; generatedAt: string } | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <p className="text-ink-2 prose-w">If you lose every passkey, you can recover your account from another device with your verified email plus one of these codes. They are shown only once and are never emailed or texted to you.</p>
      {!codes ? (
        <button className="btn btn-primary" disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { setCodes(await api("/api/auth/recovery-codes-generate")); } catch (e) { setError(msg(e, "Couldn't generate codes.")); } finally { setBusy(false); }
        }}>Generate 10 recovery codes</button>
      ) : (
        <>
          <CodesDisplay {...codes} />
          <p className="t-small panel p-3" style={{ background: "var(--tint-mustard)" }}>Print them or save the file somewhere other than this phone and other than this app, such as a printed copy at home. Anyone with your email and one code could start a recovery.</p>
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>I&apos;ve saved these codes somewhere safe</span></label>
          <button className="btn btn-primary" disabled={!ack || busy} onClick={async () => {
            setBusy(true); setError(null);
            try { await api("/api/auth/onboarding-complete", { savedCodes: true }); window.location.href = "/?welcome=1"; } catch (e) { setError(msg(e, "Couldn't finish setup.")); } finally { setBusy(false); }
          }}>Finish setup</button>
        </>
      )}
      <Err e={error} />
    </div>
  );
}
