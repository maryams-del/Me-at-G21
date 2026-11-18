"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, toast } from "./api";
import { Glyph } from "./Glyph";

type PreviewOp = {
  position: number; op: string; label: string; module: string; summary: string;
  display: Record<string, string>; missing: string[]; assumed: string[]; valid: boolean; error: string | null;
};
type Proposal = { id: string; version: number; status: string; questions: string[]; operations: PreviewOp[]; provider: string };
type SearchResult = { answer: string; sources: { label: string; date: string; href: string }[]; calculation?: string };
type Mode = "apply" | "draft" | "skip";

const FIELD_LABELS: Record<string, string> = {
  paidOn: "Date", recipient: "Recipient", cause: "Cause", amount: "Amount", currency: "Currency", status: "Status",
  completedOn: "Date", onDate: "Date", dueDate: "Due", dueOn: "Due", dueTime: "Time", counterparty: "Person",
  direction: "Type", routineId: "Routine", goalId: "Goal", type: "Action", title: "Title", reference: "Surah / verses",
  projectId: "Project", name: "Name", reminderOffsetsDays: "Reminder days before",
  label: "Item", expiresOn: "Expires", newExpiresOn: "New expiry", itemId: "Item", renewedOn: "Renewed",
};
const MODULE_GLYPH: Record<string, Parameters<typeof Glyph>[0]["kind"]> = {
  charity: "charity", debts: "debts", fasts: "fasts", routines: "routines", waxing: "waxing", dental: "dental",
  savings: "savings", projects: "projects", quran: "quran", expiries: "expiries",
};

// Minimal typing for the Web Speech API (not in TS DOM lib everywhere)
type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function CaptureSheet({ open, onClose, initialText = "" }: { open: boolean; onClose: () => void; initialText?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [choices, setChoices] = useState<Record<number, Mode>>({});
  const [fix, setFix] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function reset() {
    setText(""); setProposal(null); setSearch(null); setChoices({}); setFix(""); setError(null); setMode("text"); setVoiceNote(null);
  }
  async function close() {
    recRef.current?.stop();
    if (proposal && proposal.status === "pending") api("/api/ai/cancel", { proposalId: proposal.id }).catch(() => {});
    reset(); onClose();
  }

  function adopt(p: Proposal) {
    setProposal(p);
    setChoices(Object.fromEntries(p.operations.map((o) => [o.position, o.valid ? "apply" : "draft"])));
  }

  async function send() {
    if (!text.trim()) return;
    setBusy(true); setError(null); setSearch(null);
    try {
      const r = await api<{ kind: "proposal"; proposal: Proposal } | ({ kind: "search" } & SearchResult)>("/api/ai/capture", { text, mode });
      if (r.kind === "search") setSearch(r); else adopt(r.proposal);
    } catch (e) { setError(e instanceof ApiError ? e.message : "The assistant didn't respond. Nothing was saved."); }
    finally { setBusy(false); }
  }

  async function applyFix() {
    if (!proposal || !fix.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ proposal: Proposal }>("/api/ai/correct", { proposalId: proposal.id, text: fix });
      adopt(r.proposal); setFix("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't update the preview."); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!proposal) return;
    setBusy(true); setError(null);
    try {
      const selections = proposal.operations.map((o) => ({ position: o.position, mode: choices[o.position] ?? "skip" }));
      const r = await api<{ outcomes: { status: string; message: string }[] }>("/api/ai/confirm", { proposalId: proposal.id, version: proposal.version, selections });
      const saved = r.outcomes.filter((o) => o.status === "applied").length;
      const drafted = r.outcomes.filter((o) => o.status === "drafted").length;
      toast([saved && `Saved ${saved} entr${saved === 1 ? "y" : "ies"}`, drafted && `${drafted} sent to Needs details`].filter(Boolean).join(", ") || "Nothing saved");
      setProposal(null); reset(); onClose(); router.refresh();
    } catch (e) { setError(e instanceof ApiError ? `${e.message} Nothing was saved.` : "Saving failed. Nothing was saved."); }
    finally { setBusy(false); }
  }

  function toggleMic() {
    if (listening) { recRef.current?.stop(); return; }
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setVoiceNote("Voice input isn't available in this browser. Tap the microphone on your keyboard to dictate instead."); inputRef.current?.focus(); return; }
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US"; rec.interimResults = true; rec.continuous = false;
    const base = text ? text.trimEnd() + " " : "";
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setText(base + t); setMode("voice");
    };
    rec.onerror = (e) => setVoiceNote(e.error === "not-allowed" ? "Microphone permission was denied. You can allow it in your browser settings." : "Voice input stopped. You can keep typing.");
    rec.onend = () => { setListening(false); setVoiceNote("Check the transcript, edit anything, then send."); };
    recRef.current = rec;
    setVoiceNote(null);
    rec.start(); setListening(true);
  }

  if (!open) return null;
  const selected = proposal?.operations.filter((o) => choices[o.position] !== "skip") ?? [];
  const applyCount = proposal?.operations.filter((o) => choices[o.position] === "apply").length ?? 0;
  const draftCount = proposal?.operations.filter((o) => choices[o.position] === "draft").length ?? 0;

  return (
    <>
      <div className="sheet-backdrop" onClick={close} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <div className="flex items-center justify-between gap-3 px-5 py-4 rule-b">
          <h2 id="capture-title" className="t-h2 flex items-center gap-2"><Glyph kind="ai" accent="var(--mustard)" size={22} /> Capture</h2>
          <button className="btn btn-ghost btn-sm" onClick={close}>Close</button>
        </div>

        <div className="p-5 grid gap-4">
          {!proposal && (
            <>
              <label htmlFor="capture-text" className="sr-only">What happened, or what do you want to find?</label>
              <textarea id="capture-text" ref={inputRef} className="textarea" style={{ minHeight: "7rem", fontSize: "1.05rem" }}
                placeholder={"I donated 100 SAR via Ehsan today and changed my bedsheets\nWhen did I last get dental scaling?"}
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} maxLength={2000} />
              {voiceNote && <p className="t-meta" role="status">{voiceNote}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary" onClick={send} disabled={busy || !text.trim()}>{busy ? "Reading…" : "Preview"}</button>
                <button className={`btn ${listening ? "btn-accent" : ""}`} onClick={toggleMic} aria-pressed={listening}>
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden><rect x="8" y="2" width="8" height="13" rx="4" fill="currentColor" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                  {listening ? "Stop" : "Dictate"}
                </button>
              </div>
              <p className="t-meta prose-w">Nothing is saved until you review the preview and press Save. Period details, documents and passwords are never sent to the assistant.</p>
            </>
          )}

          {error && <p role="alert" className="error">{error}</p>}

          {search && (
            <div className="panel p-4 preview-enter" aria-live="polite">
              <p className="t-h3">{search.answer}</p>
              {search.calculation && <p className="t-meta mt-1">{search.calculation}</p>}
              {search.sources.length > 0 && (
                <ul className="mt-3 list">
                  {search.sources.map((s, i) => (
                    <li key={i} className="py-2 flex justify-between gap-3 t-small">
                      <Link href={s.href} onClick={close} className="underline underline-offset-4">{s.label}</Link>
                      <span className="t-meta whitespace-nowrap">{s.date}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button className="btn btn-sm mt-3" onClick={() => { setSearch(null); }}>Ask something else</button>
            </div>
          )}

          {proposal && (
            <div className="grid gap-4 preview-enter" key={proposal.version} aria-live="polite">
              <p className="t-meta">From: “{text}”</p>
              {proposal.operations.length === 0 && <p>I couldn&apos;t find anything to save.</p>}
              <ul className="grid gap-3">
                {proposal.operations.map((o) => {
                  const mode = choices[o.position];
                  return (
                    <li key={o.position} className="panel p-4" style={{ opacity: mode === "skip" ? 0.55 : 1 }}>
                      <div className="flex items-start gap-3">
                        <Glyph kind={MODULE_GLYPH[o.module] ?? "inbox"} size={26} accent="var(--mustard)" />
                        <div className="flex-1 min-w-0">
                          <p className="t-h3">{o.label}</p>
                          <p className="t-small text-ink-2">{o.summary}</p>
                          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 t-small">
                            {Object.entries(o.display).filter(([k]) => FIELD_LABELS[k]).map(([k, v]) => (
                              <div key={k} className="contents">
                                <dt className="text-ink-3">{FIELD_LABELS[k]}</dt>
                                <dd>{v}{o.assumed.some((a) => a === k || (a === "date" && /On$|Date$/.test(k))) && <span className="chip chip-mustard ml-2">assumed</span>}</dd>
                              </div>
                            ))}
                          </dl>
                          {!o.valid && <p className="error mt-2">{o.missing.length ? `Missing: ${o.missing.map((m) => FIELD_LABELS[m] ?? m).join(", ")}` : o.error}</p>}
                        </div>
                      </div>
                      <fieldset className="mt-3 flex flex-wrap gap-2">
                        <legend className="sr-only">What to do with “{o.label}”</legend>
                        {(o.valid ? (["apply", "draft", "skip"] as Mode[]) : (["draft", "skip"] as Mode[])).map((m) => (
                          <label key={m} className={`btn btn-sm ${mode === m ? "btn-primary" : ""}`}>
                            <input type="radio" className="sr-only" name={`op-${o.position}`} checked={mode === m} onChange={() => setChoices({ ...choices, [o.position]: m })} />
                            {m === "apply" ? "Save" : m === "draft" ? "Fill details later" : "Don't save"}
                          </label>
                        ))}
                      </fieldset>
                    </li>
                  );
                })}
              </ul>
              {proposal.questions.length > 0 && (
                <div className="panel p-4" style={{ background: "var(--tint-mustard)" }}>
                  {proposal.questions.map((q, i) => <p key={i} className="t-small">{q}</p>)}
                </div>
              )}
              <div className="grid gap-2">
                <label htmlFor="fix" className="t-small text-ink-2">Correct anything in your own words</label>
                <div className="flex gap-2">
                  <input id="fix" className="input" value={fix} onChange={(e) => setFix(e.target.value)} placeholder="e.g. make that 150 SAR, or: no, next Thursday"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyFix(); } }} />
                  <button className="btn" onClick={applyFix} disabled={busy || !fix.trim()}>Update</button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 rule-b pb-4" style={{ borderBottom: "none", borderTop: "1.5px solid var(--rule)", paddingTop: "1rem" }}>
                <button className="btn btn-accent" onClick={confirm} disabled={busy || selected.length === 0}>
                  {busy ? "Saving…" : applyCount && draftCount ? `Save ${applyCount} + ${draftCount} draft${draftCount === 1 ? "" : "s"}` : applyCount ? `Save ${applyCount} entr${applyCount === 1 ? "y" : "ies"}` : draftCount ? `Save ${draftCount} draft${draftCount === 1 ? "" : "s"}` : "Save"}
                </button>
                <button className="btn" onClick={() => { api("/api/ai/cancel", { proposalId: proposal.id }).catch(() => {}); setProposal(null); }}>Start over</button>
                <span className="t-meta">Version {proposal.version}{proposal.provider === "offline" ? ", read by the offline parser" : ""}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
