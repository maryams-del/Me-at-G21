"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Glyph, type GlyphKind } from "@/components/Glyph";

const PER_PAGE = 9;

/** Home's spaces, nine at a time (3 × 3). Swipe sideways for the next nine; the dots show where you are. */
export function SpacePages({ spaces }: { spaces: { key: string; name: string; href: string; glyph: GlyphKind }[] }) {
  const pages = Array.from({ length: Math.ceil(spaces.length / PER_PAGE) }, (_, i) => spaces.slice(i * PER_PAGE, (i + 1) * PER_PAGE));
  const [page, setPage] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const go = (i: number) => strip.current?.scrollTo({ left: i * strip.current.clientWidth, behavior: "smooth" });
  return (
    <>
      <div ref={strip} className="space-pages" onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {pages.map((p, pi) => (
          <ul key={pi} className="space-page grid grid-cols-3 gap-y-5" aria-label={pages.length > 1 ? `Spaces, page ${pi + 1} of ${pages.length}` : undefined}>
            {p.map((sp) => (
              <li key={sp.key} className="min-w-0">
                <Link href={sp.href} className="sp-tile"><span className="ic"><Glyph kind={sp.glyph} size={22} color="currentColor" accent="currentColor" /></span><span>{sp.name}</span></Link>
              </li>
            ))}
          </ul>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="flex justify-center gap-2 mt-4" role="tablist" aria-label="Pages of spaces">
          {pages.map((_, i) => (
            <button key={i} type="button" role="tab" aria-selected={page === i} aria-label={`Page ${i + 1}`} onClick={() => go(i)}
              className="page-dot" data-on={page === i ? "" : undefined} />
          ))}
        </div>
      )}
    </>
  );
}
