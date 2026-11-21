"use client";
import { useEffect } from "react";

/** Locks zoom while the home screen is open; restores normal zoom when you leave it. */
export function HomeNoZoom() {
  useEffect(() => {
    const html = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const before = meta?.getAttribute("content") ?? null;
    html.classList.add("no-zoom");
    if (meta && before && !/maximum-scale/.test(before)) meta.setAttribute("content", `${before}, maximum-scale=1, user-scalable=no`);
    // iOS Safari ignores user-scalable=no, so block its pinch gesture directly.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop, { passive: false });
    document.addEventListener("gesturechange", stop, { passive: false });
    return () => {
      html.classList.remove("no-zoom");
      if (meta && before !== null) meta.setAttribute("content", before);
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
    };
  }, []);
  return null;
}
