"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Glyph } from "@/components/Glyph";
import { frequent, VISITABLE } from "@/lib/visits";

/** Up to three small shortcuts to the pages opened most often on this device. Starts with Documents & IDs. */
export function FrequentlyVisited() {
  const [items, setItems] = useState(() => VISITABLE.filter((s) => s.href === "/admin/documents"));
  useEffect(() => setItems(frequent()), []);
  return (
    <nav aria-label="Frequently visited" className="flex flex-wrap justify-center gap-1.5 mt-3">
      {items.map((s) => (
        <Link key={s.href} href={s.href} className="qchip">
          <Glyph kind={s.glyph} size={13} color="var(--accent-ink)" /> {s.label}
        </Link>
      ))}
    </nav>
  );
}
