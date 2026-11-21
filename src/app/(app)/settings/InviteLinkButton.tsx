"use client";
import { useState } from "react";
import { api, ApiError, toast } from "@/components/api";

/** Makes a fresh one-time invite link and opens the share sheet (or copies it). Each new link replaces the last. */
export function InviteLinkButton({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    try {
      const r = await api<{ url: string }>("/api/ops/invite.link", { email });
      setUrl(r.url);
      const text = `You're invited to Me @ G21. Open this link to create your account (it works once and expires in 7 days):`;
      if (navigator.share) { try { await navigator.share({ title: "Me @ G21 invite", text, url: r.url }); return; } catch { /* closed the sheet: fall back to copy */ } }
      await navigator.clipboard?.writeText(r.url).then(() => toast("Invite link copied"), () => {});
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't make the link", "error"); }
    finally { setBusy(false); }
  }
  return (
    <span className="grid gap-1 justify-items-end">
      <button type="button" className="btn btn-sm" disabled={busy} onClick={go}>{busy ? "Making link…" : "Share link"}</button>
      {url && <input className="input t-meta" style={{ minHeight: 32, fontSize: 12, width: "16rem" }} readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={`Invite link for ${email}`} />}
    </span>
  );
}
