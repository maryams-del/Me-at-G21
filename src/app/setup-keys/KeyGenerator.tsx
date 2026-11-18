"use client";
import { useState } from "react";

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

type Key = { name: string; value: string; note: string };

export function KeyGenerator() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    setKeys([
      { name: "DATA_ENCRYPTION_KEY", value: b64(rand(32)), note: "Encrypts authenticator secrets at rest" },
      { name: "AUTH_PEPPER", value: b64(rand(32)), note: "Protects stored sign-in codes and sessions" },
      { name: "CRON_SECRET", value: b64url(rand(24)), note: "Also paste into cron-job.org as the Authorization header: Bearer <value>" },
      { name: "VAPID_PUBLIC_KEY", value: b64url(pub), note: "Push notifications (public half)" },
      { name: "VAPID_PRIVATE_KEY", value: jwk.d!, note: "Push notifications (private half)" },
    ]);
  }

  return (
    <div className="mt-6 grid gap-4">
      {!keys && <button className="btn btn-primary justify-self-start" onClick={generate}>Generate keys</button>}
      {keys?.map((k) => (
        <div key={k.name} className="panel p-4 grid gap-2">
          <div className="flex justify-between gap-3 items-center">
            <p className="font-medium">{k.name}</p>
            <button className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(k.value); setCopied(k.name); }}>{copied === k.name ? "Copied" : "Copy value"}</button>
          </div>
          <code className="t-small break-all select-all">{k.value}</code>
          <p className="t-meta">{k.note}</p>
        </div>
      ))}
      {keys && <p className="t-small prose-w">Keep the CRON_SECRET handy for cron-job.org. You don&apos;t need to save the others anywhere else once they&apos;re in Vercel.</p>}
    </div>
  );
}
