"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CaptureSheet } from "./Capture";
import { ThemeToggle } from "./ThemeToggle";
import { LogoMark } from "./LogoMark";
import { recordVisit } from "@/lib/visits";
import { BackButton, trackPath } from "./BackButton";
import { DebugSizer } from "./DebugSizer";

type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

const ICONS = {
  today: "M4 11 12 4l8 7v9H4z",
  spaces: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  history: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 8v4l3 2",
  inbox: "M5 5h10l4 4v10H5zM9 13h6M9 16h4",
  settings: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
};
/** Main tabs: reachable from the nav at all times, so they get no Back button. */
const TOP_LEVEL = ["/", "/more", "/history", "/inbox", "/settings"];

export const SPARKLE = "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z";

function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

/** Opens the AI capture sheet from anywhere. `text` pre-fills it; `voice` starts dictation. */
export function openCapture(detail: { text?: string; voice?: boolean } = {}) {
  window.dispatchEvent(new CustomEvent("ld-capture", { detail }));
}

export function AppShell({ children, inboxCount, dateLine }: { children: React.ReactNode; name: string; inboxCount: number; dateLine: string }) {
  const path = usePathname();
  const [capture, setCapture] = useState<{ open: boolean; key: number; text: string; voice: boolean }>({ open: false, key: 0, text: "", voice: false });
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: string }[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as { message: string; tone: string };
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, ...d }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
    };
    const onOpen = (e: Event) => {
      const d = ((e as CustomEvent).detail ?? {}) as { text?: string; voice?: boolean };
      setCapture((c) => ({ open: true, key: c.key + 1, text: d.text ?? "", voice: !!d.voice }));
    };
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCapture(); } };
    window.addEventListener("ld-toast", onToast);
    window.addEventListener("ld-capture", onOpen);
    window.addEventListener("keydown", onKey);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { window.removeEventListener("ld-toast", onToast); window.removeEventListener("ld-capture", onOpen); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => { recordVisit(path); trackPath(path); }, [path]);

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const spacesPaths = ["/more", "/finance", "/care", "/faith", "/quran", "/projects", "/admin", "/vault", "/education", "/spaces"];
  const top: NavItem[] = [
    { href: "/", label: "Today", icon: "today" }, { href: "/more", label: "Spaces", icon: "spaces" },
    { href: "/history", label: "History", icon: "history" }, { href: "/inbox", label: "Inbox", icon: "inbox", badge: inboxCount },
    { href: "/settings", label: "Settings", icon: "settings" },
  ];
  const bottomLeft: NavItem[] = [{ href: "/", label: "Today", icon: "today" }, { href: "/more", label: "Spaces", icon: "spaces" }];
  const bottomRight: NavItem[] = [{ href: "/inbox", label: "Inbox", icon: "inbox", badge: inboxCount }, { href: "/settings", label: "Settings", icon: "settings" }];
  const current = (it: NavItem) => isActive(it.href) || (it.href === "/more" && spacesPaths.some((p) => path.startsWith(p)));

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link btn btn-primary">Skip to content</a>
      <div className="max-w-[1320px] mx-auto px-[18px] md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-4 md:pt-6">
          <Link href="/" className="min-w-0 no-underline pb-1" aria-label="Me @ G21, home">
            <LogoMark className="w-[44px] h-[44px] md:w-[56px] md:h-[56px] shrink-0" />
            <span className="block mt-2 text-[12px] md:text-[13px] font-semibold leading-snug text-ink-3">{dateLine}</span>
          </Link>
          <nav aria-label="Main" className="hidden md:flex top-nav glass rounded-full items-center gap-1 p-[5px] order-none">
            {top.map((it) => (
              <Link key={it.href} href={it.href} aria-current={current(it) ? "page" : undefined}>
                {it.label}{!!it.badge && <span className="chip chip-mustard" style={{ padding: "0 .45rem" }}>{it.badge}</span>}
              </Link>
            ))}
            <button type="button" onClick={() => openCapture()} className="btn-accent" style={{ background: "var(--accent-grad)", color: "#1E2418" }}>
              <Icon d={SPARKLE} size={16} /> Ask AI
            </button>
          </nav>
          <ThemeToggle />
        </header>
        <div className="wave-line mt-3" aria-hidden>
          <svg width="2340" height="16" viewBox="0 0 2340 16"><path d={"M0 8 " + Array.from({ length: 24 }, (_, i) => (i === 0 ? "Q48.75 16 97.5 8" : `T${97.5 * (i + 1)} 8`)).join(" ")} fill="none" stroke="var(--slate)" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </div>

        <main id="main" className="pt-5 pb-36 md:pt-8 md:pb-14">{!TOP_LEVEL.includes(path) && <BackButton path={path} />}{children}</main>
      </div>

      <nav aria-label="Main" className="md:hidden bottom-nav">
        {bottomLeft.map((it) => <MobileLink key={it.href} it={it} active={current(it)} />)}
        <button type="button" onClick={() => openCapture()} aria-label="Ask AI" className="capture-orb"><Icon d={SPARKLE} size={24} /></button>
        {bottomRight.map((it) => <MobileLink key={it.href} it={it} active={current(it)} />)}
      </nav>

      <DebugSizer />

      <CaptureSheet key={capture.key} open={capture.open} initialText={capture.text} startVoice={capture.voice} onClose={() => setCapture((c) => ({ ...c, open: false }))} />

      <div aria-live="polite" className="fixed z-[60] bottom-28 md:bottom-6 right-4 left-4 md:left-auto grid gap-2 md:w-96">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="glass px-4 py-3 preview-enter" style={{ background: t.tone === "error" ? "var(--tint-rust)" : "var(--btn-primary-bg)", color: t.tone === "error" ? "var(--ink)" : "var(--btn-primary-ink)" }}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileLink({ it, active }: { it: NavItem; active: boolean }) {
  return (
    <Link href={it.href} aria-current={active ? "page" : undefined}>
      <Icon d={ICONS[it.icon]} />
      <span>{it.label}</span>
      {!!it.badge && <span className="absolute top-1 right-[18%] min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold leading-[18px] text-center" style={{ background: "var(--rust)", color: "#fff" }} aria-label={`${it.badge} need attention`}>{it.badge > 99 ? "99+" : it.badge}</span>}
    </Link>
  );
}

export function OpenCaptureButton({ label = "Ask AI", className = "btn btn-accent" }: { label?: string; className?: string }) {
  return <button className={className} onClick={() => openCapture()}>{label}</button>;
}
