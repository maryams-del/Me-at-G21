"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Glyph, type GlyphKind } from "./Glyph";
import { CaptureSheet } from "./Capture";

type NavItem = { href: string; label: string; glyph: GlyphKind; badge?: number };

export function AppShell({ children, name, inboxCount }: { children: React.ReactNode; name: string; inboxCount: number }) {
  const path = usePathname();
  const [capture, setCapture] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: string }[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as { message: string; tone: string };
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, ...d }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
    };
    const onOpen = () => setCapture(true);
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCapture(true); } };
    window.addEventListener("ld-toast", onToast);
    window.addEventListener("ld-capture", onOpen);
    window.addEventListener("keydown", onKey);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { window.removeEventListener("ld-toast", onToast); window.removeEventListener("ld-capture", onOpen); window.removeEventListener("keydown", onKey); };
  }, []);

  const groups: { title: string; items: NavItem[] }[] = [
    { title: "", items: [{ href: "/", label: "Today", glyph: "home" }, { href: "/inbox", label: "Needs details", glyph: "inbox", badge: inboxCount }] },
    { title: "Finance", items: [{ href: "/finance/charity", label: "Charity", glyph: "charity" }, { href: "/finance/savings", label: "Savings", glyph: "savings" }, { href: "/finance/debts", label: "Lent & borrowed", glyph: "debts" }, { href: "/finance/subscriptions", label: "Subscriptions", glyph: "subscriptions" }, { href: "/finance/zakat", label: "Zakat", glyph: "zakat" }] },
    { title: "Personal care", items: [{ href: "/care/period", label: "Period log", glyph: "period" }, { href: "/care/routines", label: "Routines", glyph: "routines" }] },
    { title: "Life admin", items: [{ href: "/admin/expiries", label: "Expiries", glyph: "expiries" }, { href: "/admin/documents", label: "Documents & IDs", glyph: "documents" }] },
    { title: "Education & career", items: [{ href: "/education/applications", label: "Master's applications", glyph: "applications" }, { href: "/projects", label: "Projects & tasks", glyph: "projects" }, { href: "/education/achievements", label: "Achievements", glyph: "achievements" }] },
    { title: "Faith", items: [{ href: "/faith/fasts", label: "Make-up fasts", glyph: "fasts" }, { href: "/quran", label: "Quran class", glyph: "quran" }] },
    { title: "", items: [{ href: "/history", label: "History & search", glyph: "history" }, { href: "/vault", label: "Secure vault", glyph: "vault" }, { href: "/settings", label: "Settings", glyph: "settings" }] },
  ];
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const mobile: NavItem[] = [
    { href: "/", label: "Today", glyph: "home" }, { href: "/finance", label: "Money", glyph: "finance" },
    { href: "/care", label: "Care", glyph: "care" }, { href: "/more", label: "More", glyph: "settings", badge: inboxCount },
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <a href="#main" className="skip-link btn btn-primary">Skip to content</a>
      <aside className="hidden md:flex flex-col gap-1 border-r-[1.5px] border-ink px-4 py-5 sticky top-0 h-dvh overflow-y-auto">
        <Link href="/" className="flex items-center gap-2 px-2 pb-4 no-underline">
          <Glyph kind="home" size={28} accent="var(--mustard)" color="var(--ink)" />
          <span className="t-h3">{name || "Me @ G21"}</span>
        </Link>
        <button className="btn btn-accent mb-3 justify-start" onClick={() => setCapture(true)}>
          <Glyph kind="ai" size={20} color="var(--ink)" accent="var(--mustard)" /> Capture <span className="ml-auto t-meta" style={{ color: "inherit", opacity: 0.7 }}>⌘K</span>
        </button>
        <nav aria-label="Main" className="grid gap-4">
          {groups.map((g, i) => (
            <div key={i} className="grid gap-0.5">
              {g.title && <p className="t-meta px-3 pb-1">{g.title}</p>}
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className="nav-link" aria-current={isActive(it.href) ? "page" : undefined}>
                  <Glyph kind={it.glyph} size={18} accent="var(--rust)" />
                  <span>{it.label}</span>
                  {!!it.badge && <span className="ml-auto chip chip-mustard">{it.badge}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main id="main" className="px-4 pt-5 pb-32 md:px-10 md:py-8 max-w-[1180px] w-full">{children}</main>

      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-paper border-t-[1.5px] border-ink" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5 items-end">
          {mobile.slice(0, 2).map((it) => <MobileLink key={it.href} it={it} active={isActive(it.href)} />)}
          <div className="flex justify-center">
            <button onClick={() => setCapture(true)} aria-label="Capture with AI" className="-mt-6 w-16 h-16 rounded-full flex items-center justify-center border-[1.5px] border-ink" style={{ background: "var(--mustard)" }}>
              <Glyph kind="ai" size={30} color="var(--ink)" accent="var(--mustard)" />
            </button>
          </div>
          {mobile.slice(2).map((it) => <MobileLink key={it.href} it={it} active={isActive(it.href) || (it.href === "/more" && ["/more", "/faith", "/quran", "/projects", "/inbox", "/history", "/settings", "/vault", "/admin", "/education"].some((p) => path.startsWith(p)))} />)}
        </div>
      </nav>

      <CaptureSheet open={capture} onClose={() => setCapture(false)} />

      <div aria-live="polite" className="fixed z-[60] bottom-24 md:bottom-6 right-4 left-4 md:left-auto grid gap-2 md:w-96">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="panel px-4 py-3 preview-enter" style={{ background: t.tone === "error" ? "var(--tint-rust)" : "var(--ink)", color: t.tone === "error" ? "var(--ink)" : "var(--paper)", borderColor: "var(--ink)" }}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileLink({ it, active }: { it: NavItem; active: boolean }) {
  return (
    <Link href={it.href} aria-current={active ? "page" : undefined} className="flex flex-col items-center gap-1 py-2 min-h-[56px] no-underline relative" style={{ color: active ? "var(--ink)" : "var(--ink-3)" }}>
      <Glyph kind={it.glyph} size={22} accent={active ? "var(--rust)" : "currentColor"} />
      <span className="text-[0.72rem] font-medium">{it.label}</span>
      {!!it.badge && <span className="absolute top-1 right-[22%] w-2.5 h-2.5 rounded-full" style={{ background: "var(--rust)" }} aria-label={`${it.badge} need details`} />}
    </Link>
  );
}

export function OpenCaptureButton({ label = "Capture", className = "btn btn-accent" }: { label?: string; className?: string }) {
  return <button className={className} onClick={() => window.dispatchEvent(new Event("ld-capture"))}>{label}</button>;
}
