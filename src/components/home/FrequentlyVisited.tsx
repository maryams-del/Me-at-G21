"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Glyph } from "@/components/Glyph";
import { frequent, VISITABLE } from "@/lib/visits";

/** Up to three shortcuts to the pages opened most often on this device. Starts with Documents & IDs. */
export function FrequentlyVisited() {
  const [items, setItems] = useState(() => VISITABLE.filter((s) => s.href === "/admin/documents"));
  useEffect(() => setItems(frequent()), []);
  return (
    <nav aria-labelledby="freq-h">
      <h2 id="freq-h" className="t-label mb-2">Frequently visited</h2>
      <ul className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {items.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="btn btn-sm">
              <Glyph kind={s.glyph} size={16} accent="var(--mustard)" /> {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
