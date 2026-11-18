import { OpForm, OpButton, Reveal } from "@/components/OpForm";

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

/** Manage the family members documents and expiries can belong to. */
export function PeopleManager({ people }: { people: Person[] }) {
  return (
    <Reveal label={`Family members${people.length ? ` (${people.length})` : ""}`}>
      <div className="grid gap-4">
        <p className="t-small text-ink-2 prose-w">Add your spouse, children, parents or anyone whose documents you keep. Reminders will say whose they are, for example “Ali&apos;s passport expires in 30 days”.</p>
        {people.length > 0 && (
          <ul className="list">
            {people.map((p) => (
              <li key={p.id} className="py-2 grid gap-2">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <span className="font-medium">{p.name} <span className="t-meta font-normal">{RELATION_OPTIONS.find((r) => r.value === p.relation)?.label}</span></span>
                  <OpButton op="person.delete" input={{ id: p.id }} label="Remove" className="btn btn-sm btn-ghost" confirmText={`Remove ${p.name}? Their documents and expiries stay, but will show as yours.`} />
                </div>
                <details><summary className="t-meta cursor-pointer">Edit</summary>
                  <div className="mt-2"><OpForm op="person.update" fixed={{ id: p.id }} initial={p} submitLabel="Save" compact fields={[
                    { name: "name", label: "Name", required: true }, { name: "relation", label: "Relation", type: "select", required: true, options: RELATION_OPTIONS }]} /></div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <OpForm op="person.create" initial={{ relation: "child" }} submitLabel="Add person" fields={[
          { name: "name", label: "Name", required: true, placeholder: "Ali" }, { name: "relation", label: "Relation", type: "select", required: true, options: RELATION_OPTIONS }]} />
      </div>
    </Reveal>
  );
}
