"use client";
import { useEffect, useState } from "react";
import { MASCOTS, MASCOT_COOKIE, type MascotKind } from "@/lib/invites";

/** Sign-in page mascot: the cat for everyone, or the family mascot on a device a family member has signed in on. */
export function AuthMascot() {
  const [kind, setKind] = useState<MascotKind | null>(null);
  useEffect(() => setKind(document.cookie.split("; ").includes(`${MASCOT_COOKIE}=family`) ? "family" : "cat"), []);
  if (!kind) return <span style={{ width: MASCOTS.cat.auth.w, height: MASCOTS.family.auth.h }} />;
  const m = MASCOTS[kind];
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={m.src} alt="" width={m.auth.w} height={m.auth.h} className="relative object-contain" style={{ width: `${m.auth.w}px`, height: `${m.auth.h}px` }} />;
}
