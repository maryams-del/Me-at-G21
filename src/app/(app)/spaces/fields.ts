import type { FieldDef } from "@/components/OpForm";
import { BUILTIN_SECTIONS, NEW_SECTION, SPACE_GLYPHS } from "@/lib/spaces";

/**
 * Form for adding or editing a space. `custom` = sections the owner already made up.
 * Name and icon share a row; the section sits under them, and a box for the new section's
 * name only appears once "+ New section…" is chosen.
 */
export const spaceFields = (custom: string[], glyphs: { value: string; label: string }[] = SPACE_GLYPHS): FieldDef[] => [
  { name: "name", label: "Name", required: true, placeholder: "Reading List", row: "name-icon", requiredMessage: "Give the space a name." },
  { name: "glyph", label: "Icon", type: "glyph", required: true, options: glyphs.map((g) => ({ value: g.value, label: g.label })), row: "name-icon" },
  { name: "section", label: "Section", type: "select", required: true, wide: true, options: [
    ...BUILTIN_SECTIONS.map((s) => ({ value: s, label: s })),
    ...custom.filter((c) => !(BUILTIN_SECTIONS as readonly string[]).includes(c)).map((s) => ({ value: s, label: s })),
    { value: NEW_SECTION, label: "+ New section…" },
  ] },
  { name: "newSection", label: "New section name", required: true, wide: true, placeholder: "Home", showIf: { field: "section", values: [NEW_SECTION] }, requiredMessage: "Name the new section." },
  { name: "description", label: "What it's for", type: "textarea", nullable: true, wide: true, placeholder: "Books I want to read this year" },
];
