import { pageOwner, subscriptionsState } from "@/server/queries";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, EditPanel, type FieldDef } from "@/components/OpForm";
import { CURRENCIES, formatMoney, fromMinor } from "@/lib/money";
import { fmtDate, relDays } from "@/lib/format";
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
  { name: "beforeDays", sendAs: "reminderOffsetsDays", label: "Remind me this many days before each charge", type: "intlist", negative: true, includeZero: true, help: "e.g. 3. You are also reminded on the day." },
  { name: "reminderTime", label: "Reminder time", type: "time", required: true },
  { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
  { name: "notes", label: "Notes", type: "textarea", nullable: true },
];

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const s = await subscriptionsState(o);
  const f = fields(o.defaultCurrency);
  const totals = Object.entries(s.totals);
  const monthEnd = addDays(s.today, 30);
  const upcoming = s.upcoming.filter((u) => u.date <= monthEnd);

  return (
    <>
      <PageHeader glyph="subscriptions" title="Subscriptions" />

      <div className="money-tiles mb-6">
        <div className="tile mustard min-h-0"><p className="t-small">Per month (average)</p><p className="t-num text-[2.4rem] mt-2">{totals.length ? totals.map(([c, v]) => formatMoney(v.monthly, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</p><p className="t-small mt-1">{s.active.length} active</p></div>
        <div className="tile min-h-0"><p className="t-small text-ink-2">Per year</p><p className="t-num text-[2.4rem] mt-2">{totals.length ? totals.map(([c, v]) => formatMoney(v.yearly, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</p></div>
      </div>

      <div className="mb-8"><Reveal label="Add subscription" open={sp.add === "1"}>
        <OpForm op="subscription.create" fields={f} initial={{ currency: o.defaultCurrency, cadence: "monthly", renewal: "auto", intervalValue: 1, intervalUnit: "month", beforeDays: [3], reminderTime: "09:00", remindersEnabled: true }} submitLabel="Save subscription" />
      </Reveal></div>

      <Section title="All subscriptions">
        {s.rows.length === 0 ? <Empty>No subscriptions yet. Add streaming, cloud storage, phone plans, gym memberships, anything that charges you on a schedule.</Empty> : (
          <ul className="grid gap-4 md:grid-cols-2">
            {s.rows.map(({ sub: x, next, daysLeft, monthlyMinor }) => (
              <li key={x.id} className="panel p-4 grid gap-2 content-start" style={{ opacity: x.status === "cancelled" ? 0.7 : 1, boxShadow: daysLeft !== null && daysLeft <= 3 ? "inset 6px 0 0 var(--mustard)" : undefined }}>
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="t-h3">{x.name} {x.status === "cancelled" && <span className="chip chip-fill">cancelled {x.cancelledOn ? fmtDate(x.cancelledOn) : ""}</span>}</h2>
                    <p className="t-meta">{[x.category, x.cadence === "custom" ? `Every ${x.intervalValue} ${x.intervalUnit}s` : CADENCE[x.cadence], x.renewal === "manual" ? "renews manually" : null].filter(Boolean).join(", ")}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="t-h3">{formatMoney(x.amountMinor, x.currency)}</p>
                    {x.cadence !== "monthly" && <p className="t-meta">≈ {formatMoney(monthlyMinor, x.currency)}/month</p>}
                  </div>
                </div>
                {next && <p className="t-small">Next charge {fmtDate(next)} ({relDays(daysLeft)})</p>}
                {x.notes && <p className="t-small text-ink-2">{x.notes}</p>}
                <div className="flex flex-wrap gap-2">
                  {x.status === "active"
                    ? <OpButton op="subscription.cancel" input={{ id: x.id, cancelledOn: s.today }} label="I cancelled it" className="btn btn-sm" confirmText={`Record that you cancelled ${x.name} today? This doesn't cancel it with the provider.`} />
                    : <OpButton op="subscription.reactivate" input={{ id: x.id, nextBillingDate: s.today }} label="Reactivate (charged today)" className="btn btn-sm" />}
                  <OpButton op="subscription.delete" input={{ id: x.id }} label="Delete" className="btn btn-sm btn-ghost" confirmText={`Delete ${x.name}? Its reminders stop.`} />
                  <EditPanel>
                    <OpForm op="subscription.update" fields={f} fixed={{ id: x.id, trialEndsOn: null, trialOffsetsDays: [] }} compact submitLabel="Save changes"
                      initial={{ ...x, amount: fromMinor(x.amountMinor, x.currency), nextBillingDate: next ?? x.anchorDate, beforeDays: x.reminderOffsetsDays.map((n) => -n).filter(Boolean) }} />
                  </EditPanel>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Next 30 days">
        {upcoming.length === 0 ? <Empty>No charges in the next 30 days.</Empty> : (
          <div className="panel p-4">
            <ul className="list">
              {upcoming.map((u) => (
                <li key={`${u.id}${u.date}`} className="py-2 flex justify-between gap-3 t-small">
                  <span><span className="t-num inline-block w-16">{fmtDate(u.date).replace(/ \d{4}$/, "")}</span>{u.name}{u.renewal === "manual" && <span className="chip ml-2">renew manually</span>}</span>
                  <span className="whitespace-nowrap">{formatMoney(u.amountMinor, u.currency)}</span>
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
