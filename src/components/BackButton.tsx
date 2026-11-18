"use client";
import { useRouter } from "next/navigation";

/** Where "Back" goes when there is no earlier page in this tab (e.g. opened from a link or a notification). */
export function parentOf(path: string) {
  if (path.startsWith("/spaces/") || path.startsWith("/faith")) return "/more";
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";
}

/** Small glass "Back" pill shown at the top of every page except Today. */
export function BackButton({ path }: { path: string }) {
  const router = useRouter();
  return (
    <button type="button" className="btn btn-sm mb-4" style={{ minHeight: 34, paddingInline: "0.8rem 1rem" }}
      onClick={() => {
        const cameFromHere = typeof document !== "undefined" && document.referrer.startsWith(window.location.origin);
        if (cameFromHere && window.history.length > 1) router.back(); else router.push(parentOf(path));
      }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
      Back
    </button>
  );
}
