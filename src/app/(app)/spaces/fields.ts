import type { FieldDef } from "@/components/OpForm";
import { BUILTIN_SECTIONS, NEW_SECTION, SPACE_GLYPHS } from "@/lib/spaces";

/** Form for adding or editing a space. `custom` = sections the owner already made up. */
export const spaceFields = (custom: string[]): FieldDef[] => [
  { name: "name", label: "Name", required: true, placeholder: "Reading list" },
  { name: "section", label: "Section", type: "select", required: true, options: [
    ...BUILTIN_SECTIONS.map((s) => ({ value: s, label: s })),
    ...custom.filter((c) => !(BUILTIN_SECTIONS as readonly string[]).includes(c)).map((s) => ({ value: s, label: s })),
    { value: NEW_SECTION, label: "+ New section…" },
  ] },
  { name: "newSection", label: "New section name", nullable: true, placeholder: "Home", help: "Only if you chose “+ New section…”." },
  { name: "glyph", label: "Icon", type: "select", required: true, options: SPACE_GLYPHS.map((g) => ({ value: g.value, label: g.label })) },
  { name: "description", label: "What it's for", type: "textarea", nullable: true, wide: true, placeholder: "Books I want to read this year" },
];
