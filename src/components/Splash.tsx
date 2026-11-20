"use client";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./LogoMark";

const SEEN = "g21-splash-seen";

/**
 * Opening screen: the logo and the mascot side by side on the plain background. After a moment each one
 * glides to its place in the header (logo top-left, mascot onto the Dark/Light switch), then the screen fades.
 * Plays once per visit; reloads in the same session only get a quick fade.
 */
export function Splash() {
  const [on, setOn] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLDivElement>(null);
  const mascot = useRef<HTMLImageElement>(null);

  const seenAtLoad = useRef<boolean | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const el = root.current;
    if (!el) return;
    // Read once per page load (React may run this effect twice in development).
    if (seenAtLoad.current === null) {
      try { seenAtLoad.current = sessionStorage.getItem(SEEN) === "1"; sessionStorage.setItem(SEEN, "1"); } catch { seenAtLoad.current = false; }
    }
    const seen = seenAtLoad.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => { html.classList.remove("splashing"); setOn(false); };

    if (seen || reduce) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? 1 : 180, fill: "forwards" }).finished.then(finish, finish);
      return;
    }
    html.classList.add("splashing");
    const fly = (from: HTMLElement | null, sel: string) => {
      const to = document.querySelector<HTMLElement>(`[data-splash="${sel}"]`);
      if (!from || !to) return Promise.resolve();
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const k = b.width / a.width;
      return from.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }],
        { duration: 750, easing: "cubic-bezier(.65,0,.25,1)", fill: "forwards" }).finished;
    };
    const t = setTimeout(() => {
      el.querySelector(".splash-bg")?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 650, fill: "forwards" });
      Promise.all([fly(logo.current, "logo"), fly(mascot.current, "mascot")]).then(finish, finish);
    }, 900);
    return () => { clearTimeout(t); html.classList.remove("splashing"); };
  }, []);

  if (!on) return null;
  return (
    <div ref={root} className="splash" aria-hidden>
      <div className="splash-bg" style={{ background: "var(--page-art), var(--paper)" }} />
      <div ref={logo} className="relative"><LogoMark size={64} /></div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={mascot} src="/mascot.png" alt="" width={72} height={96} className="relative object-contain w-[72px] h-[96px]" style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,.25))" }} />
    </div>
  );
}
