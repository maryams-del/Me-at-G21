import { FamilyMenu } from "./FamilyMenu";

export const RELATION_OPTIONS = [
  { value: "spouse", label: "Spouse" }, { value: "child", label: "Child" }, { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" }, { value: "other", label: "Other" },
];
export type Person = { id: string; name: string; relation: string };

export function personLabel(people: Person[], id: string | null | undefined) {
  if (!id) return "Me";
  return people.find((p) => p.id === id)?.name ?? "Me";
}

export const personOptions = (people: Person[]) => people.map((p) => ({ value: p.id, label: `${p.name} (${RELATION_OPTIONS.find((r) => r.value === p.relation)?.label.toLowerCase() ?? p.relation})` }));

/** Family button: a small dropdown with the members and add / edit / delete icons. */
export function PeopleManager({ people }: { people: Person[] }) {
  return <FamilyMenu people={people.map(({ id, name, relation }) => ({ id, name, relation }))} relations={RELATION_OPTIONS} />;
}
