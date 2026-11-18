import { pageOwner, expiriesState, remindersFor, peopleList } from "@/server/queries";
import { PeopleManager, personLabel, personOptions } from "../People";
import { PageHeader, Section, Empty, ReminderList } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef } from "@/components/OpForm";
import { fmtDate, relDays } from "@/lib/format";

const KINDS = [{ value: "passport", label: "Passport" }, { value: "national_id", label: "National ID / Iqama" }, { value: "license", label: "Driving licence" }, { value: "bank_card", label: "Bank card" }, { value: "membership", label: "Membership" }, { value: "custom", label: "Other" }];

export default async function ExpiriesPage({ searchParams }: { searchParams: Promise<{ add?: string; kind?: string; sort?: string; person?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const kind = KINDS.some((k) => k.value === sp.kind) ? sp.kind : undefined;
  const sort = sp.sort === "latest" ? "latest" : "soonest";
  const people = await peopleList(o.id);
  const person = sp.person === "me" || people.some((p) => p.id === sp.person) ? sp.person : undefined;
  const s = await expiriesState(o, { kind, sort, person });
  const rem = await remindersFor(o.id, "expiry", s.items.map((x) => x.item.id));
  const fields: FieldDef[] = [
    { name: "label", label: "What is it?", required: true, placeholder: "Passport", help: "Don't type the ID or card number here; store it in Documents instead." },
    { name: "personId", label: "Belongs to", type: "select", nullable: true, options: personOptions(people) },
    { name: "kind", label: "Type", type: "select", required: true, options: KINDS },
    { name: "expiresOn", label: "Expiry date", type: "date", required: true },
    { name: "issuer", label: "Issued by", nullable: true },
    { name: "documentId", label: "Linked document", type: "select", nullable: true, options: s.docs.map((d) => ({ value: d.id, label: d.title })) },
    { name: "reminderOffsetsDays", label: "Remind me this many days before", type: "intlist", negative: true, help: "Default 90, 30, 7" },
    { name: "reminderTime", label: "Reminder time", type: "time", required: true },
    { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
    { name: "notes", label: "Notes", type: "textarea", nullable: true },
  ];
  const active = s.items.filter((x) => x.item.status === "active");
  const archived = s.items.filter((x) => x.item.status !== "active");
  return (
    <>
      <PageHeader glyph="expiries" title="Expiries & renewals" intro="Reminders say only the item name on your lock screen, never numbers." />
      <div className="mb-8 flex flex-wrap gap-3 items-start">
        <Reveal label="Track something" buttonClass="btn btn-primary" open={sp.add === "1"}>
          <OpForm op="expiry.create" fields={fields} initial={{ kind: "passport", reminderOffsetsDays: [-90, -30, -7], reminderTime: "09:00", remindersEnabled: true }} submitLabel="Start tracking" />
        </Reveal>
        <PeopleManager people={people} />
      </div>
      <form className="panel p-3 mb-6 flex flex-wrap gap-3 items-end" aria-label="Filter and sort">
        <label className="field"><span className="label">Type</span>
          <select name="kind" defaultValue={kind ?? ""} className="select"><option value="">All types</option>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
        <label className="field"><span className="label">Belongs to</span>
          <select name="person" defaultValue={person ?? ""} className="select"><option value="">Everyone</option><option value="me">Me</option>{personOptions(people).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label className="field"><span className="label">Sort</span>
          <select name="sort" defaultValue={sort} className="select"><option value="soonest">Closest expiry first</option><option value="latest">Farthest expiry first</option></select></label>
        <button className="btn">Apply</button>
        {(kind || person || sort === "latest") && <a href="/admin/expiries" className="btn btn-ghost">Clear</a>}
      </form>
      {active.length === 0 && (kind || person) ? <Empty>No tracked items of this type.</Empty> : active.length === 0 ? <Empty>Nothing tracked yet. Add your passport, ID or licence, or say “my passport expires on 3 March 2029” in Capture.</Empty> : (
        <ul className="grid gap-3">
          {active.map(({ item: it, daysLeft, renewals }) => {
            const tone = daysLeft < 0 ? "rust" : daysLeft <= 30 ? "rust" : daysLeft <= 90 ? "mustard" : "";
            return (
              <li key={it.id} className="panel p-4 grid gap-3" style={tone ? { boxShadow: `inset 6px 0 0 var(--${tone})` } : undefined}>
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h2 className="t-h3">{it.personId ? `${personLabel(people, it.personId)}'s ` : ""}{it.label} {KINDS.find((k) => k.value === it.kind)?.label !== it.label && <span className="t-meta font-normal">{KINDS.find((k) => k.value === it.kind)?.label}</span>}</h2>
                    <p className="t-small text-ink-2">{it.issuer ? `${it.issuer}. ` : ""}Reminders {it.remindersEnabled ? it.reminderOffsetsDays.map((d) => `${-d}d`).join(", ") + " before" : "off"}</p>
                  </div>
                  <div className="text-right">
                    <p className="t-h2">{fmtDate(it.expiresOn)}</p>
                    <p className="t-small" style={{ color: daysLeft < 0 ? "var(--danger)" : "var(--ink-2)" }}>{daysLeft < 0 ? `expired ${relDays(daysLeft)}` : `expires ${relDays(daysLeft)}`}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Reveal label="Record renewal" buttonClass="btn btn-sm btn-primary">
                    <OpForm op="expiry.renew" fixed={{ itemId: it.id }} initial={{ renewedOn: s.today }} submitLabel="Save renewal" fields={[
                      { name: "renewedOn", label: "Renewed on", type: "date", required: true }, { name: "newExpiresOn", label: "New expiry date", type: "date", required: true }, { name: "notes", label: "Note", nullable: true, wide: true }]} />
                  </Reveal>
                  <Reveal label="Edit" buttonClass="btn btn-sm">
                    <OpForm op="expiry.update" fixed={{ id: it.id }} initial={it} submitLabel="Save" fields={[...fields, { name: "status", label: "Status", type: "select", required: true, options: [{ value: "active", label: "Active" }, { value: "archived", label: "Archived (no reminders)" }] }]} />
                  </Reveal>
                  <OpButton op="expiry.delete" input={{ id: it.id }} label="Delete" className="btn btn-sm btn-ghost" confirmText={`Stop tracking ${it.label}? Its reminders will be cancelled.`} />
                </div>
                {renewals.length > 0 && <p className="t-meta">Renewal history: {renewals.map((r) => `${fmtDate(r.renewedOn)} (was ${fmtDate(r.previousExpiresOn)}, now ${fmtDate(r.newExpiresOn)})`).join("; ")}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-9 grid gap-8 md:grid-cols-2">
        <Section title="Upcoming reminders"><ReminderList items={rem.slice(0, 8)} tz={o.timezone} /></Section>
        {archived.length > 0 && <Section title="Archived"><ul className="list">{archived.map(({ item: it }) => <li key={it.id} className="py-2 t-small flex justify-between"><span>{it.label}</span><span className="t-meta">{fmtDate(it.expiresOn)}</span></li>)}</ul></Section>}
      </div>
    </>
  );
}
