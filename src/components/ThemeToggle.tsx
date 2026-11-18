"use client";
import { useEffect, useState } from "react";
import { THEME_COOKIE, type ThemeChoice } from "@/lib/theme";

function current(): ThemeChoice {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Dark / Light switch with the mascot sitting on top of it. The choice is kept in a cookie for a year. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice | null>(null);
  useEffect(() => setTheme(current()), []);

  function choose(t: ThemeChoice) {
    document.documentElement.dataset.theme = t;
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
    setTheme(t);
  }

  return (
    <div className="flex flex-col items-center shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mascot.png" alt="" width={56} height={75} className="relative z-[2] -mb-[13px] object-contain" style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,.3))" }} />
      <div className="seg glass" role="group" aria-label="Appearance">
        <button type="button" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>Dark</button>
        <button type="button" aria-pressed={theme === "light"} onClick={() => choose("light")}>Light</button>
      </div>
    </div>
  );
}
