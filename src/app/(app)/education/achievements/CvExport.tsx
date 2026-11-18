"use client";
import { useState } from "react";

/** Copy or download the filtered achievements as CV/portfolio bullets (built only from your saved fields). */
export function CvExport({ text, filename }: { text: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-3">
      <textarea readOnly className="textarea t-small" rows={Math.min(14, Math.max(4, text.split("\n").length + 1))} value={text} aria-label="CV bullets" />
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={copy}>{copied ? "Copied" : "Copy bullets"}</button>
        <button type="button" className="btn btn-sm" onClick={download}>Download .txt</button>
      </div>
    </div>
  );
}
