import { OpForm, OpButton, Reveal, EditPanel } from "@/components/OpForm";
import { IconToggle } from "@/components/FilterPanel";

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

/** Manage the family members documents and expiries can belong to: a family button that opens the list. */
export function PeopleManager({ people }: { people: Person[] }) {
  return (
    <IconToggle icon="family" label="Family" count={people.length}>
      <div className="grid gap-3">
        {people.length > 0 ? (
          <ul className="list">
            {people.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap items-center gap-2">
                <span className="font-medium mr-auto">{p.name} <span className="t-meta font-normal">{RELATION_OPTIONS.find((r) => r.value === p.relation)?.label}</span></span>
                <OpButton op="person.delete" input={{ id: p.id }} label="Remove" className="btn btn-sm btn-ghost" confirmText={`Remove ${p.name}? Their documents and expiries stay, but will show as yours.`} />
                <EditPanel><OpForm op="person.update" fixed={{ id: p.id }} initial={p} submitLabel="Save" compact fields={[
                    { name: "name", label: "Name", required: true }, { name: "relation", label: "Relation", type: "select", required: true, options: RELATION_OPTIONS }]} /></EditPanel>
              </li>
            ))}
          </ul>
        ) : <p className="t-meta">No family members yet.</p>}
        <Reveal label="Add a member" buttonClass="btn btn-sm">
          <OpForm op="person.create" initial={{ relation: "child" }} submitLabel="Add member" compact fields={[
            { name: "name", label: "Name", required: true, placeholder: "Ali" }, { name: "relation", label: "Relation", type: "select", required: true, options: RELATION_OPTIONS }]} />
        </Reveal>
      </div>
    </IconToggle>
  );
}
