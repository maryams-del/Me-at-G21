"use client";
import { useRouter } from "next/navigation";

/** Where "Back" goes when there is no earlier page in this tab (e.g. opened from a link or a notification). */
export function parentOf(path: string) {
  if (path.startsWith("/spaces/") || path.startsWith("/faith")) return "/more";
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";
}

/**
 * In-app trail of pages visited in this tab. `document.referrer` can't be used for this:
 * it never changes after client-side navigation and is always empty in the Home Screen app,
 * so "Back" used to jump to the parent page instead of where you actually came from.
 */
const TRAIL_KEY = "g21-trail";
function readTrail(): string[] {
  try { return JSON.parse(sessionStorage.getItem(TRAIL_KEY) || "[]") as string[]; } catch { return []; }
}
function writeTrail(t: string[]) {
  try { sessionStorage.setItem(TRAIL_KEY, JSON.stringify(t.slice(-50))); } catch { /* private mode */ }
}
/** Call on every path change. Going back to the previous entry pops it; anything else pushes. */
export function trackPath(path: string) {
  const t = readTrail();
  if (t[t.length - 1] === path) return;
  if (t[t.length - 2] === path) t.pop(); else t.push(path);
  writeTrail(t);
}

/** Small glass "Back" pill shown at the top of every page except Today. */
export function BackButton({ path }: { path: string }) {
  const router = useRouter();
  return (
    <button type="button" className="btn btn-sm mb-4" style={{ minHeight: 34, paddingInline: "0.8rem 1rem" }}
      onClick={() => {
        if (readTrail().length > 1) router.back();
        else { writeTrail([]); router.replace(parentOf(path)); }
      }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
      Back
    </button>
  );
}
