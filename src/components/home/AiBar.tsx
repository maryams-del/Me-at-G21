"use client";
import { useState } from "react";
import { openCapture, SPARKLE } from "@/components/AppShell";

/** "Ask AI": type or speak — add something, go somewhere, do something, or ask a question. */
export function AiBar() {
  const [text, setText] = useState("");
  return (
    <form className="glass flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4"
      onSubmit={(e) => { e.preventDefault(); openCapture({ text: text.trim() }); setText(""); }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mustard)" strokeWidth="1.9" aria-hidden><path d={SPARKLE} /></svg>
      <label htmlFor="ai-bar" className="sr-only">Ask AI</label>
      <input id="ai-bar" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask AI: add, find, go to, or do anything…" autoComplete="off"
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[15px]" style={{ color: "inherit", font: "inherit" }} />
      <button type="button" aria-label="Speak" onClick={() => openCapture({ text: text.trim(), voice: true })}
        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-ink)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
      </button>
      <button type="submit" aria-label="Send to AI" className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--accent-grad)", color: "#1E2418" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </form>
  );
}
