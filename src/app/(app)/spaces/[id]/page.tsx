import { notFound, redirect } from "next/navigation";
import { pageOwner, customSpaceDetail, customSpacesState } from "@/server/queries";
import { Section, Empty } from "@/components/ui";
import { OpButton } from "@/components/OpForm";
import { SpaceView } from "./SpaceView";
import { isSpaceGlyph } from "@/lib/spaces";
import { spaceFields } from "../fields";

export default async function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await pageOwner();
  const d = await customSpaceDetail(o, id);
  if (!d) notFound();
  if (d.space.deletedAt) redirect("/more");
  const { space: s, items } = d;
  const sections = [...new Set((await customSpacesState(o)).map((x) => x.space.section))];
  const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);

  return (
    <SpaceView space={{ id: s.id, name: s.name, description: s.description, section: s.section, glyph: s.glyph }}
      glyph={isSpaceGlyph(s.glyph) ? s.glyph : "projects"} fields={spaceFields(sections)}>
      <Section title={`To do · ${open.length}`}>
        {open.length === 0 ? <Empty>Nothing here yet. Tap + above to add the first item.</Empty> : (
          <ul className="panel list px-4">
            {open.map((it) => (
              <li key={it.id} className="py-2.5 flex items-center gap-3">
                <OpButton op="spaceItem.toggle" input={{ id: it.id, done: true }} label="" ariaLabel={`Tick “${it.text}”`} className="w-6 h-6 rounded-full shrink-0 cursor-pointer border-2 border-[color:var(--slate)] bg-transparent" />
                <span className="flex-1 t-small">{it.text}</span>
                <OpButton op="spaceItem.delete" input={{ id: it.id }} label="Remove" className="btn btn-sm btn-ghost" ariaLabel={`Remove “${it.text}”`} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {done.length > 0 && (
        <Section title={`Done · ${done.length}`}>
          <ul className="panel list px-4">
            {done.map((it) => (
              <li key={it.id} className="py-2.5 flex items-center gap-3">
                <OpButton op="spaceItem.toggle" input={{ id: it.id, done: false }} label="✓" ariaLabel={`Untick “${it.text}”`} className="w-6 h-6 rounded-full shrink-0 cursor-pointer text-[13px] font-bold border-0 bg-[color:var(--slate)] text-[color:var(--on-slate)]" />
                <span className="flex-1 t-small line-through text-ink-3">{it.text}</span>
                <OpButton op="spaceItem.delete" input={{ id: it.id }} label="Remove" className="btn btn-sm btn-ghost" ariaLabel={`Remove “${it.text}”`} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </SpaceView>
  );
}
