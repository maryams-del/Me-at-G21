"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The site's own "Are you sure?" popup, used everywhere instead of the browser's plain confirm box.
 * Call `askConfirm(...)` from anywhere on the client; it resolves true (go ahead) or false (keep it).
 * <ConfirmHost /> is mounted once in the app shell and draws the popup.
 */
export type ConfirmOptions = {
  title?: string;
  /** smaller line under the message */
  note?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** red confirm button (deleting, replacing, removing) */
  danger?: boolean;
};
type Ask = ConfirmOptions & { message: string; resolve: (ok: boolean) => void };

let hostMounted = false;

export function askConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!hostMounted) return Promise.resolve(window.confirm(message)); // outside the app shell (e.g. sign-in pages)
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent("ld-confirm", { detail: { message, ...opts, resolve } satisfies Ask })));
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    hostMounted = true;
    const on = (e: Event) => { opener.current = document.activeElement; setAsk((e as CustomEvent<Ask>).detail); };
    window.addEventListener("ld-confirm", on);
    return () => { hostMounted = false; window.removeEventListener("ld-confirm", on); };
  }, []);

  const done = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
    (opener.current as HTMLElement | null)?.focus?.();
  };

  useEffect(() => {
    if (!ask) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); done(false); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ask) return null;
  const danger = ask.danger ?? false;
  return (
    <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center p-3" role="alertdialog" aria-modal="true" aria-labelledby="ld-confirm-msg" aria-describedby={ask.note ? "ld-confirm-note" : undefined}>
      <div className="absolute inset-0 confirm-scrim" onClick={() => done(false)} />
      <div className={`relative confirm-dialog preview-enter ${danger ? "danger" : ""}`}>
        {ask.title && <p className="t-h3 mb-1">{ask.title}</p>}
        <p id="ld-confirm-msg" className="font-semibold">{ask.message}</p>
        {ask.note && <p id="ld-confirm-note" className="t-small text-ink-2 mt-1">{ask.note}</p>}
        <div className="flex gap-2 mt-4">
          <button type="button" className="btn flex-1" onClick={() => done(false)} autoFocus>{ask.cancelLabel ?? (danger ? "Keep it" : "Cancel")}</button>
          <button type="button" className={`btn flex-1 ${danger ? "btn-delete" : "btn-primary"}`} onClick={() => done(true)}>{ask.confirmLabel ?? (danger ? "Yes, delete" : "Continue")}</button>
        </div>
      </div>
    </div>
  );
}

const RISKY = /\b(delete|remove|replace|discard|clear|reset|revoke|undo|unpin)\b/i;
/** For generic confirm texts: words like delete/remove/replace make it a red "Yes, delete"-style popup. */
export function askConfirmFor(message: string, opts: ConfirmOptions = {}) {
  const verb = message.match(RISKY)?.[1]?.toLowerCase();
  return askConfirm(message, verb ? { danger: true, confirmLabel: `Yes, ${verb}`, ...opts } : opts);
}
