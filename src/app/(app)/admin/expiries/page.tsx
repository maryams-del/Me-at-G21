import { pageOwner, expiriesState, remindersFor, peopleList } from "@/server/queries";
import { PeopleManager } from "../People";
import { PageHeader, Section, Empty, ReminderList, SearchPill } from "@/components/ui";
import { OpForm, Reveal, type FieldDef } from "@/components/OpForm";
import { EntryCard } from "@/components/EntryCard";
import { countdown, reminderLine } from "@/lib/countdown";
import { fmtDate } from "@/lib/format";
import { FilterPanel } from "@/components/FilterPanel";

const KINDS = [{ value: "passport", label: "Passport" }, { value: "national_id", label: "National ID / Iqama" }, { value: "license", label: "Driving licence" }, { value: "bank_card", label: "Bank card" }, { value: "membership", label: "Membership" }, { value: "custom", label: "Other" }];

export default async function ExpiriesPage({ searchParams }: { searchParams: Promise<{ add?: string; kind?: string; sort?: string; reminders?: string; q?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const kind = KINDS.some((k) => k.value === sp.kind) ? sp.kind : undefined;
  const sort = sp.sort === "latest" ? "latest" : "soonest";
  const people = await peopleList(o.id);
  const reminders = sp.reminders === "on" || sp.reminders === "off" ? sp.reminders : undefined;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const filtering = !!(kind || reminders || q);
  const s = await expiriesState(o, { kind, sort, reminders, q });
  const rem = await remindersFor(o.id, "expiry", s.items.map((x) => x.item.id));
  const fields: FieldDef[] = [
    { name: "label", label: "What is it?", required: true, placeholder: "Passport" },
    { name: "kind", label: "Type", type: "select", required: true, options: KINDS },
    { name: "expiresOn", label: "Expiry date", type: "date", required: true },
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
      <PageHeader glyph="expiries" title="Expiries & renewals" />
      <div className="toolbar mb-8">
        <SearchPill q={q} placeholder="Search expiries" keep={{ kind, reminders, sort: sort === "latest" ? sort : undefined }} />
        <FilterPanel active={!!(kind || reminders) || sort === "latest"}>
          <form className="panel p-3 flex flex-wrap gap-3 items-end" role="search" aria-label="Filter and sort">
            {q && <input type="hidden" name="q" value={q} />}
            <label className="field"><span className="label">Type</span>
              <select name="kind" defaultValue={kind ?? ""} className="select"><option value="">All types</option>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
            <label className="field"><span className="label">Reminders</span>
              <select name="reminders" defaultValue={reminders ?? ""} className="select"><option value="">All</option><option value="on">On</option><option value="off">Off</option></select></label>
            <label className="field"><span className="label">Sort</span>
              <select name="sort" defaultValue={sort} className="select"><option value="soonest">Closest expiry first</option><option value="latest">Farthest expiry first</option></select></label>
            <button className="btn">Apply</button>
            {(filtering || sort === "latest") && <a href="/admin/expiries" className="btn btn-ghost">Clear</a>}
          </form>
        </FilterPanel>
        <Reveal label="Track something" iconOnly open={sp.add === "1"}>
          <OpForm op="expiry.create" fields={fields} initial={{ kind: "passport", reminderOffsetsDays: [-90, -30, -7], reminderTime: "09:00", remindersEnabled: true }} submitLabel="Start tracking" />
        </Reveal>
        <PeopleManager people={people} />
      </div>
      {active.length === 0 && filtering ? <Empty>No tracked items of this type.</Empty> : active.length === 0 ? <Empty>Nothing tracked yet. Add your passport, ID or licence, or say “my passport expires on 3 March 2029” in Capture.</Empty> : (
        <ul className="entry-grid">
          {active.map(({ item: it, daysLeft, renewals }) => {
            const kindLabel = KINDS.find((k) => k.value === it.kind)?.label;
            return (
              <EntryCard key={it.id} icon="idcard" countLabel="Expires" title={it.label} subtitle={kindLabel !== it.label ? kindLabel : undefined}
                count={countdown(daysLeft, "expiry")} countSub={fmtDate(it.expiresOn)}
                reminder={reminderLine({ enabled: it.remindersEnabled, date: it.expiresOn, offsets: it.reminderOffsetsDays, time: it.reminderTime, today: s.today })}
                action={
                  <Reveal label="Renewed" icon="renew" buttonClass="pill-action">
                    <OpForm op="expiry.renew" fixed={{ itemId: it.id }} initial={{ renewedOn: s.today }} submitLabel="Save renewal" fields={[
                      { name: "renewedOn", label: "Renewed on", type: "date", required: true }, { name: "newExpiresOn", label: "New expiry date", type: "date", required: true }, { name: "notes", label: "Note", nullable: true, wide: true }]} />
                  </Reveal>
                }
                edit={
                  <OpForm op="expiry.update" fixed={{ id: it.id, personId: it.personId, issuer: it.issuer }} initial={it} submitLabel="Save changes" compact fields={fields}
                    deleteAction={{ op: "expiry.delete", input: { id: it.id }, confirm: `Delete “${it.label}”? Its reminders will be cancelled.` }} />
                }>
                {renewals.length > 0 && <p className="t-meta">Renewal history: {renewals.map((r) => `${fmtDate(r.renewedOn)} (was ${fmtDate(r.previousExpiresOn)}, now ${fmtDate(r.newExpiresOn)})`).join("; ")}</p>}
              </EntryCard>
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
