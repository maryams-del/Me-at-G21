import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Glyph, type GlyphKind } from "@/components/Glyph";
import { pageOwner, attentionCount, dashboardState } from "@/server/queries";
import { builtinSpace } from "@/lib/spaces";
import { spaceNeeds } from "@/lib/spaceNeeds";

type Item = { href: string; label: string; glyph: GlyphKind };

/**
 * A section's own page (Money, Care, Life admin, Education & career).
 * Opened from a Home tile (?from=home): the tile shown large, then its spaces in the same stone panel
 * and icon grid as Home, with a dot where something needs you. From the header: the plain tile list.
 */
export async function SpaceHub({ title, glyph, items, fromHome }: { title: string; glyph: GlyphKind; items: Item[]; fromHome: boolean }) {
  const o = await pageOwner();
  // Built-in spaces follow the owner's own names and icons, and removed ones stay hidden.
  const list = items.flatMap((i) => {
    const b = builtinSpace(i.href, o.settings);
    if (!b) return [i];
    return b.hidden ? [] : [{ href: i.href, label: b.label, glyph: b.glyph }];
  });

  if (!fromHome) {
    return (
      <>
        <PageHeader glyph={glyph} title={title} />
        <ul className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          {list.map((i) => <li key={i.href}><Link href={i.href} className="tile min-h-0"><Glyph kind={i.glyph} size={30} accent="var(--rust)" /><p className="t-h3 mt-3">{i.label}</p></Link></li>)}
        </ul>
      </>
    );
  }

  const [s, n] = await Promise.all([dashboardState(o), attentionCount(o)]);
  const needs = spaceNeeds(s, n);
  return (
    <div className="space-hub">
      <header className="space-hero">
        <span className="space-hero-ic" aria-hidden><Glyph kind={glyph} size={40} color="currentColor" accent="currentColor" /></span>
        <h1 className="space-hero-title">{title}</h1>
      </header>
      <section aria-label={`${title} spaces`} className="home-spaces space-hub-panel">
        <ul className="space-hub-grid">
          {list.map((i) => (
            <li key={i.href} className="min-w-0">
              <Link href={i.href} className="sp-tile">
                <span className="ic"><Glyph kind={i.glyph} size={22} color="currentColor" accent="currentColor" />{needs[i.href] && <span className="need-dot" />}</span>
                <span>{i.label}{needs[i.href] && <span className="sr-only"> (needs you)</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
