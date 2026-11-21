import { pageOwner, expiriesState, remindersFor, peopleList } from "@/server/queries";
import { SpaceHeader } from "@/components/SpaceHeader";
import { PeopleManager } from "../People";
import { PageHeader, Section, Empty, ReminderList, SearchPill, FilterTags, withoutParam } from "@/components/ui";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { OpForm, Reveal, type FieldDef } from "@/components/OpForm";
import { EntryCard } from "@/components/EntryCard";
import { countdown, reminderLine } from "@/lib/countdown";
import { fmtDate } from "@/lib/format";
import { FilterPanel, FilterSelect } from "@/components/FilterPanel";

/** Example names for "Whose is it?" — one is picked at random as the hint. */
const SAMPLE_NAMES = ["Sara", "Omar", "Layla", "Yusuf", "Noura", "Ahmed", "Mariam", "Khalid", "Huda", "Faisal"];
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
  const params = { q, kind, reminders, sort: sort === "latest" ? sort : undefined };
  const s = await expiriesState(o, { kind, sort, reminders, q });
  const rem = await remindersFor(o.id, "expiry", s.items.map((x) => x.item.id));
  const fields: FieldDef[] = [
    { name: "label", label: "Whose is it?", required: true, placeholder: SAMPLE_NAMES[Math.floor(Math.random() * SAMPLE_NAMES.length)], requiredMessage: "Add whose it is." },
    { name: "kind", label: "Type", type: "select", required: true, options: KINDS },
    { name: "expiresOn", label: "Expiry date", type: "date", required: true, requiredMessage: "Add the expiry date." },
    { name: "documentId", label: "Linked document", type: "select", nullable: true, options: s.docs.map((d) => ({ value: d.id, label: d.title })) },
    { name: "reminderOffsetsDays", label: "Remind me", type: "intlist", negative: true },
    { name: "reminderTime", label: "Reminder time", type: "time", required: true },
    { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
    { name: "notes", label: "Notes", type: "textarea", nullable: true },
  ];
  const active = s.items.filter((x) => x.item.status === "active");
  const archived = s.items.filter((x) => x.item.status !== "active");
  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1"}>
      <SpaceHeader href="/admin/expiries"><PageAddButton label="Track something" /></SpaceHeader>
      <div className="toolbar">
        <SearchPill q={q} placeholder="Search expiries" keep={{ kind, reminders, sort: sort === "latest" ? sort : undefined }} />
        <FilterPanel active={!!(kind || reminders) || sort === "latest"}>
          <form className="panel p-3 flex flex-wrap gap-3 items-end" role="search" aria-label="Filter and sort">
            {q && <input type="hidden" name="q" value={q} />}
            <FilterSelect label="Type" name="kind" value={kind} options={[{ value: "", label: "All types" }, ...KINDS]} />
            <FilterSelect label="Reminders" name="reminders" value={reminders} options={[{ value: "", label: "All" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} />
            <FilterSelect label="Sort" name="sort" value={sort} options={[{ value: "soonest", label: "Closest expiry first" }, { value: "latest", label: "Farthest expiry first" }]} />
            <button className="btn">Apply</button>
          </form>
        </FilterPanel>
        <PeopleManager people={people} />
      </div>
      <FilterTags clearHref="/admin/expiries" tags={[
        ...(q ? [{ label: `“${q}”`, href: withoutParam("/admin/expiries", params, "q") }] : []),
        ...(kind ? [{ label: KINDS.find((k) => k.value === kind)?.label ?? kind, href: withoutParam("/admin/expiries", params, "kind") }] : []),
        ...(reminders ? [{ label: `Reminders ${reminders}`, href: withoutParam("/admin/expiries", params, "reminders") }] : []),
        ...(sort === "latest" ? [{ label: "Farthest expiry first", href: withoutParam("/admin/expiries", params, "sort") }] : []),
      ]} />
      <PageAddPanel title="Track something">
        <OpForm op="expiry.create" fields={fields} initial={{ kind: "passport", reminderOffsetsDays: [-30, -7], reminderTime: "09:00", remindersEnabled: true }} submitLabel="Start tracking" />
      </PageAddPanel>
      </PageAddProvider>
      <div className="mb-8" />
      {active.length === 0 && filtering ? <Empty>No tracked items of this type.</Empty> : active.length === 0 ? <Empty>Nothing tracked yet. Add your passport, ID or licence, or say “my passport expires on 3 March 2029” in Capture.</Empty> : (
        <ul className="entry-grid">
          {active.map(({ item: it, daysLeft, renewals }) => {
            const kindLabel = KINDS.find((k) => k.value === it.kind)?.label;
            return (
              <EntryCard del={{ op: "expiry.delete", input: { id: it.id }, confirm: `Delete “${it.label}”?`, note: "Its reminders will be cancelled." }} key={it.id} icon="idcard" countLabel="Expires" title={it.label} subtitle={kindLabel !== it.label ? kindLabel : undefined}
                count={countdown(daysLeft, "expiry")} countSub={fmtDate(it.expiresOn)}
                reminder={reminderLine({ enabled: it.remindersEnabled, date: it.expiresOn, offsets: it.reminderOffsetsDays, time: it.reminderTime, today: s.today })}
                action={
                  <Reveal label="Renewed" title="Log the renewal" icon="renew" buttonClass="pill-action">
                    <OpForm op="expiry.renew" fixed={{ itemId: it.id }} initial={{ renewedOn: s.today }} submitLabel="Save renewal" fields={[
                      { name: "renewedOn", label: "Renewed on", type: "date", required: true }, { name: "newExpiresOn", label: "New expiry date", type: "date", required: true }, { name: "notes", label: "Note", nullable: true, wide: true }]} />
                  </Reveal>
                }
                edit={
                  <OpForm op="expiry.update" fixed={{ id: it.id, personId: it.personId, issuer: it.issuer }} initial={it} submitLabel="Save changes" compact fields={fields}
                    deleteAction={{ op: "expiry.delete", input: { id: it.id }, confirm: `Delete “${it.label}”?`, note: "Its reminders will be cancelled." }} />
                }>
                {renewals.length > 0 && <p className="t-meta">Renewal history: {renewals.map((r) => `${fmtDate(r.renewedOn)} (was ${fmtDate(r.previousExpiresOn)}, now ${fmtDate(r.newExpiresOn)})`).join("; ")}</p>}
              </EntryCard>
            );
          })}
        </ul>
      )}
      <div className="mt-9 grid gap-8">
        <Section title="Upcoming reminders"><ReminderList items={rem.slice(0, 8)} tz={o.timezone} /></Section>
        {archived.length > 0 && <Section title="Archived"><ul className="list">{archived.map(({ item: it }) => <li key={it.id} className="py-2 t-small flex justify-between"><span>{it.label}</span><span className="t-meta">{fmtDate(it.expiresOn)}</span></li>)}</ul></Section>}
      </div>
    </>
  );
}
