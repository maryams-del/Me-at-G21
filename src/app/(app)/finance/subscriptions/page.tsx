import { pageOwner, subscriptionsState } from "@/server/queries";
import { SpaceHeader } from "@/components/SpaceHeader";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { PageHeader, Section, Empty, SearchPill, FilterTags, withoutParam } from "@/components/ui";
import { FilterPanel, FilterSelect } from "@/components/FilterPanel";
import { OpForm, OpButton, Reveal, type FieldDef } from "@/components/OpForm";
import { EntryCard } from "@/components/EntryCard";
import { countdown, relativeReminderLine } from "@/lib/countdown";
import { CURRENCIES, formatMoney, fromMinor } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { addDays } from "@/lib/time";

const CADENCE: Record<string, string> = { monthly: "Monthly", yearly: "Yearly", weekly: "Weekly", custom: "Custom timing" };
const fields = (currency: string): FieldDef[] => [
  { name: "name", label: "Service", required: true, placeholder: "Spotify" },
  { name: "category", label: "Category", nullable: true, placeholder: "Music, cloud storage…" },
  { name: "amount", label: "Cost per charge", type: "amount", required: true },
  { name: "currency", label: "Currency", type: "select", required: true, options: [currency, ...CURRENCIES.filter((c) => c !== currency)].map((c) => ({ value: c, label: c })) },
  { name: "cadence", label: "Billed", type: "select", required: true, options: Object.entries(CADENCE).map(([value, label]) => ({ value, label })) },
  { name: "nextBillingDate", label: "Next charge date", type: "date", required: true },
  { name: "intervalValue", unitName: "intervalUnit", label: "Every", type: "interval", showIf: { field: "cadence", values: ["custom"] },
    options: [{ value: "day", label: "days" }, { value: "week", label: "weeks" }, { value: "month", label: "calendar months" }] },
  { name: "renewal", label: "Renews", type: "select", required: true, options: [{ value: "auto", label: "Automatically" }, { value: "manual", label: "Only if I renew it" }] },
  { name: "beforeDays", sendAs: "reminderOffsetsDays", label: "Remind me this many days before each charge", type: "intlist", negative: true, includeZero: true, presets: [14, 7, 3, 2, 1], maxDays: 60, maxCount: 6 },
  { name: "reminderTime", label: "Reminder time", type: "time", required: true },
  { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
  { name: "notes", label: "Notes", type: "textarea", nullable: true },
];

const STATUS = [{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "cancelled", label: "Cancelled" }];
const PATH = "/finance/subscriptions";

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ add?: string; q?: string; status?: string; cadence?: string; category?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const s = await subscriptionsState(o);
  const f = fields(o.defaultCurrency);
  const totals = Object.entries(s.totals);
  const monthEnd = addDays(s.today, 30);
  const upcoming = s.upcoming.filter((u) => u.date <= monthEnd);
  // Search and filters for "All subscriptions".
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const status = STATUS.some((x) => x.value && x.value === sp.status) ? sp.status : undefined;
  const cadence = sp.cadence && sp.cadence in CADENCE ? sp.cadence : undefined;
  const categories = [...new Set(s.rows.map((r) => r.sub.category).filter((c): c is string => !!c))].sort();
  const category = sp.category && categories.includes(sp.category) ? sp.category : undefined;
  const shown = s.rows.filter(({ sub: x }) => (!q || `${x.name} ${x.category ?? ""} ${x.notes ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    && (!status || x.status === status) && (!cadence || x.cadence === cadence) && (!category || x.category === category));
  const params = { q, status, cadence, category };

  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1"}>
      <SpaceHeader href="/finance/subscriptions"><PageAddButton label="Add subscription" /></SpaceHeader>
      <PageAddPanel title="Add subscription">
        <OpForm op="subscription.create" fields={f} initial={{ currency: o.defaultCurrency, cadence: "monthly", renewal: "auto", intervalValue: 1, intervalUnit: "month", beforeDays: [3], reminderTime: "09:00", remindersEnabled: true }} submitLabel="Save subscription" />
      </PageAddPanel>
      </PageAddProvider>

      <div className="money-tiles mb-6">
        <div className="tile mustard min-h-0"><p className="t-small">Per month (average)</p><p className="t-num text-[1.9rem] md:text-[2.4rem] mt-2">{totals.length ? totals.map(([c, v]) => formatMoney(v.monthly, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</p><p className="t-small mt-1">{s.active.length} active</p></div>
        <div className="tile min-h-0"><p className="t-small text-ink-2">Per year</p><p className="t-num text-[1.9rem] md:text-[2.4rem] mt-2">{totals.length ? totals.map(([c, v]) => formatMoney(v.yearly, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</p></div>
      </div>

      <div className="mb-2" />

      <Section title="All subscriptions">
        {s.rows.length > 0 && (
          <>
            <div className="toolbar">
              <SearchPill q={q} placeholder="Search subscriptions" keep={{ status, cadence, category }} />
              <FilterPanel active={!!(status || cadence || category)}>
                <form className="panel p-3 flex flex-wrap gap-3 items-end">
                  {q && <input type="hidden" name="q" value={q} />}
                  <FilterSelect label="Status" name="status" value={status} options={STATUS} />
                  <FilterSelect label="Billed" name="cadence" value={cadence} options={[{ value: "", label: "Any" }, ...Object.entries(CADENCE).map(([value, label]) => ({ value, label }))]} />
                  {categories.length > 0 && <FilterSelect label="Category" name="category" value={category} options={[{ value: "", label: "All" }, ...categories.map((c) => ({ value: c, label: c }))]} />}
                  <button className="btn">Apply</button>
                </form>
              </FilterPanel>
            </div>
            <FilterTags clearHref={PATH} tags={[
              ...(q ? [{ label: `“${q}”`, href: withoutParam(PATH, params, "q") }] : []),
              ...(status ? [{ label: STATUS.find((x) => x.value === status)!.label, href: withoutParam(PATH, params, "status") }] : []),
              ...(cadence ? [{ label: CADENCE[cadence], href: withoutParam(PATH, params, "cadence") }] : []),
              ...(category ? [{ label: category, href: withoutParam(PATH, params, "category") }] : []),
            ]} />
            <div className="mb-5" />
          </>
        )}
        {s.rows.length === 0 ? <Empty>No subscriptions yet. Add streaming, cloud storage, phone plans, gym memberships, anything that charges you on a schedule.</Empty>
        : shown.length === 0 ? <Empty>No subscriptions match.</Empty> : (
          <ul className="entry-grid">
            {shown.map(({ sub: x, next, daysLeft, monthlyMinor }) => {
              const active = x.status === "active";
              const how = x.cadence === "custom" ? `Every ${x.intervalValue} ${x.intervalUnit}s` : CADENCE[x.cadence];
              return (
                <EntryCard key={x.id} icon="card" countLabel="Next charge" title={x.name} dim={!active}
                  badge={!active ? <span className="chip chip-fill">cancelled {x.cancelledOn ? fmtDate(x.cancelledOn) : ""}</span> : undefined}
                  subtitle={[`${formatMoney(x.amountMinor, x.currency)} · ${how}`, x.cadence !== "monthly" ? `≈ ${formatMoney(monthlyMinor, x.currency)}/month` : null, x.category, x.renewal === "manual" ? "renews manually" : null].filter(Boolean).join(" · ")}
                  count={active ? countdown(daysLeft, "charge") : null} countSub={active && next ? fmtDate(next) : undefined}
                  reminder={active ? relativeReminderLine({ enabled: x.remindersEnabled, offsets: x.reminderOffsetsDays, time: x.reminderTime }) : null}
                  action={active
                    ? <OpButton op="subscription.cancel" input={{ id: x.id, cancelledOn: s.today }} label="Cancelled" icon="stop" className="pill-action" confirmText={`Record that you cancelled ${x.name} today? This doesn't cancel it with the provider.`} />
                    : <OpButton op="subscription.reactivate" input={{ id: x.id, nextBillingDate: s.today }} label="Reactivate" icon="play" className="pill-action" confirmText={`Reactivate ${x.name}? The next charge is counted from today.`} />}
                  edit={
                    <OpForm op="subscription.update" fields={f} fixed={{ id: x.id, trialEndsOn: null, trialOffsetsDays: [] }} compact submitLabel="Save changes"
                      initial={{ ...x, amount: fromMinor(x.amountMinor, x.currency), nextBillingDate: next ?? x.anchorDate, beforeDays: x.reminderOffsetsDays.map((n) => -n).filter(Boolean) }}
                      deleteAction={{ op: "subscription.delete", input: { id: x.id }, confirm: `Delete “${x.name}”? Its reminders stop.` }} />
                  }>
                  {x.notes && <p className="t-small text-ink-2">{x.notes}</p>}
                </EntryCard>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Next 30 days">
        {upcoming.length === 0 ? <Empty>No charges in the next 30 days.</Empty> : (
          <div className="panel p-4">
            <ul className="list">
              {upcoming.map((u) => (
                <li key={`${u.id}${u.date}`} className="py-2.5 flex items-center gap-4 t-small">
                  <span className="t-num shrink-0 w-12 text-ink-2">{fmtDate(u.date).slice(0, 5)}</span>
                  <span className="flex-1 min-w-0 truncate">{u.name}{u.renewal === "manual" && <span className="chip ml-2">renew manually</span>}</span>
                  <span className="whitespace-nowrap shrink-0">{formatMoney(u.amountMinor, u.currency)}</span>
                </li>
              ))}
            </ul>
            <p className="t-meta mt-2">Total {Object.entries(upcoming.reduce<Record<string, number>>((a, u) => ({ ...a, [u.currency]: (a[u.currency] ?? 0) + u.amountMinor }), {})).map(([c, v]) => formatMoney(v, c)).join(" + ")}</p>
          </div>
        )}
      </Section>
    </>
  );
}
