import { pageOwner, customSpacesState } from "@/server/queries";
import { builtinSpace, builtinGlyphOptions, spaceOverridesOf, BUILTIN_SPACES } from "@/lib/spaces";
import { spaceFields } from "@/app/(app)/spaces/fields";
import { PageHeader } from "./ui";
import { OpForm } from "./OpForm";
import { SpaceEditScope, SpaceEditButton, SpaceEditPanel } from "./PageAdd";

const NOTE = "Nothing inside it is deleted.";

/**
 * Title line of a built-in space: its icon and name (as the owner set them), any page actions (e.g. +),
 * then edit (name, icon, section, what it's for). Delete is inside the edit panel (removes it from Spaces; the data stays).
 */
export async function SpaceHeader({ href, children }: { href: string; children?: React.ReactNode }) {
  const o = await pageOwner();
  const sp = builtinSpace(href, o.settings);
  if (!sp) return <PageHeader title="Space">{children}</PageHeader>;
  const base = BUILTIN_SPACES.find((s) => s.href === href)!;
  const sections = [...new Set([
    ...(await customSpacesState(o)).map((c) => c.space.section),
    ...Object.values(spaceOverridesOf(o.settings)).map((x) => x.section).filter((x): x is string => !!x),
  ])];
  return (
    <SpaceEditScope>
      <PageHeader glyph={sp.glyph} title={sp.label} intro={sp.note ?? undefined}>
        {children}
        <SpaceEditButton />
      </PageHeader>
      <SpaceEditPanel>
        <OpForm op="space.builtin.update" fixed={{ href }} compact submitLabel="Save"
          fields={spaceFields(sections, builtinGlyphOptions(base))}
          initial={{ name: sp.label, glyph: sp.glyph, section: sp.section, description: sp.note }}
          deleteAction={{ op: "space.builtin.hide", input: { href }, asButton: true, label: "Delete space", redirectTo: "/more",
            confirm: `This will remove “${sp.label}” from your Spaces.`, note: NOTE }} />
      </SpaceEditPanel>
    </SpaceEditScope>
  );
}
