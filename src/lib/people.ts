/** "Whose is it?" choices: you first (value ""), then everyone you've added under Family. */
export function personOptions(selfName: string, people: { id: string; name: string }[]) {
  return [{ value: "", label: selfName }, ...people.map((p) => ({ value: p.id, label: p.name }))];
}
/** The name shown for an entry that belongs to someone (or to you when personId is null). */
export function personName(personId: string | null | undefined, selfName: string, people: { id: string; name: string }[]) {
  return personId ? people.find((p) => p.id === personId)?.name ?? selfName : selfName;
}
export const selfNameOf = (o: { displayName: string | null }) => o.displayName?.trim() || "Me";
