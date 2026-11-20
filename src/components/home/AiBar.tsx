"use client";
import { useState } from "react";
import { openCapture, SPARKLE } from "@/components/AppShell";

/** "Ask me anything": type or speak — add something, go somewhere, do something, or ask a question. */
export function AiBar() {
  const [text, setText] = useState("");
  return (
    <div className="ask">
      <form role="search" onSubmit={(e) => { e.preventDefault(); openCapture({ text: text.trim() }); setText(""); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ink)" strokeWidth="1.9" strokeLinejoin="round" aria-hidden className="shrink-0"><path d={SPARKLE} /></svg>
        <label htmlFor="ai-bar" className="sr-only">Ask AI</label>
        <input id="ai-bar" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask me anything" autoComplete="off" enterKeyHint="send" />
        <button type="button" aria-label="Speak" className="ask-btn" onClick={() => openCapture({ text: text.trim(), voice: true })}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
      </form>
    </div>
  );
}
