import { pageOwner, subscriptionsState } from "@/server/queries";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, OpButton, Reveal, type FieldDef } from "@/components/OpForm";
import { CURRENCIES, formatMoney, fromMinor } from "@/lib/money";
import { fmtDate, relDays } from "@/lib/format";

const CADENCE: Record<string, string> = { monthly: "Monthly", yearly: "Yearly", weekly: "Weekly", custom: "Custom" };
const fields = (currency: string): FieldDef[] => [
  { name: "name", label: "Service", required: true, placeholder: "Spotify" },
  { name: "category", label: "Category", nullable: true, placeholder: "Music, cloud storage…" },
  { name: "amount", label: "Cost per charge", type: "amount", required: true },
  { name: "currency", label: "Currency", type: "select", required: true, options: [currency, ...CURRENCIES.filter((c) => c !== currency)].map((c) => ({ value: c, label: c })) },
  { name: "cadence", label: "Billed", type: "select", required: true, options: Object.entries(CADENCE).map(([value, label]) => ({ value, label })) },
  { name: "nextBillingDate", label: "Next charge date", type: "date", required: true },
  { name: "intervalValue", label: "Custom: every", type: "int", help: "Only used when Billed is Custom" },
  { name: "intervalUnit", label: "Custom: unit", type: "select", options: [{ value: "day", label: "days" }, { value: "week", label: "weeks" }, { value: "month", label: "calendar months" }] },
  { name: "renewal", label: "Renews", type: "select", required: true, options: [{ value: "auto", label: "Automatically" }, { value: "manual", label: "Only if I renew it" }] },
  { name: "trialEndsOn", label: "Free trial ends", type: "date", nullable: true },
  { name: "paymentLabel", label: "Paid with (label only)", nullable: true, placeholder: "Visa ending 4821", help: "Never a full card number." },
  { name: "url", label: "Account link", nullable: true, placeholder: "https://" },
  { name: "beforeDays", sendAs: "reminderOffsetsDays", label: "Remind me this many days before each charge", type: "intlist", negative: true, includeZero: true, help: "e.g. 3. You are also reminded on the day." },
  { name: "trialDays", sendAs: "trialOffsetsDays", label: "Remind me this many days before the trial ends", type: "intlist", negative: true, includeZero: true },
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
  const byMonth = new Map<string, typeof s.upcoming>();
  for (const u of s.upcoming) { const k = u.date.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), u]); }
  const monthName = (k: string) => new Date(`${k}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader glyph="subscriptions" title="Subscriptions" />

      <div className="grid gap-3 sm:grid-cols-2 mb-6">
        <div className="tile mustard min-h-0"><p className="t-small">Per month (average)</p><p className="t-num text-[2.4rem] mt-2">{totals.length ? totals.map(([c, v]) => formatMoney(v.monthly, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</p><p className="t-small mt-1">{s.active.length} active</p></div>
        <div className="tile min-h-0"><p className="t-small text-ink-2">Per year</p><p className="t-num text-[2.4rem] mt-2">{totals.length ? totals.map(([c, v]) => formatMoney(v.yearly, c)).join(" + ") : formatMoney(0, o.defaultCurrency)}</p><p className="t-small text-ink-2 mt-1">Yearly plans are spread over 12 months</p></div>
      </div>

      <div className="mb-8"><Reveal label="Add subscription" open={sp.add === "1"}>
        <OpForm op="subscription.create" fields={f} initial={{ currency: o.defaultCurrency, cadence: "monthly", renewal: "auto", intervalValue: 1, intervalUnit: "month", beforeDays: [3], trialDays: [3, 1], reminderTime: "09:00", remindersEnabled: true }} submitLabel="Save subscription" />
      </Reveal></div>

      <Section title="Next 60 days">
        {s.upcoming.length === 0 ? <Empty>No charges coming up in the next 60 days.</Empty> : (
          <div className="grid gap-5 md:grid-cols-2">
            {[...byMonth].map(([k, items]) => (
              <div key={k} className="panel p-4">
                <p className="t-small font-medium mb-2">{monthName(k)}</p>
                <ul className="list">
                  {items.map((u) => (
                    <li key={`${u.id}${u.date}`} className="py-2 flex justify-between gap-3 t-small">
                      <span><span className="t-num inline-block w-8">{Number(u.date.slice(8))}</span>{u.name}{u.renewal === "manual" && <span className="chip ml-2">renew manually</span>}</span>
                      <span className="whitespace-nowrap">{formatMoney(u.amountMinor, u.currency)}</span>
                    </li>
                  ))}
                </ul>
                <p className="t-meta mt-2">Total {Object.entries(items.reduce<Record<string, number>>((a, u) => ({ ...a, [u.currency]: (a[u.currency] ?? 0) + u.amountMinor }), {})).map(([c, v]) => formatMoney(v, c)).join(" + ")}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="All subscriptions">
        {s.rows.length === 0 ? <Empty>No subscriptions yet. Add streaming, cloud storage, phone plans, gym memberships, anything that charges you on a schedule.</Empty> : (
          <ul className="grid gap-4 md:grid-cols-2">
            {s.rows.map(({ sub: x, next, daysLeft, monthlyMinor, inTrial }) => (
              <li key={x.id} className="panel p-4 grid gap-2 content-start" style={{ opacity: x.status === "cancelled" ? 0.7 : 1, boxShadow: daysLeft !== null && daysLeft <= 3 ? "inset 6px 0 0 var(--mustard)" : undefined }}>
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="t-h3">{x.name} {x.status === "cancelled" && <span className="chip chip-fill">cancelled {x.cancelledOn ? fmtDate(x.cancelledOn) : ""}</span>} {inTrial && <span className="chip chip-mustard">trial until {fmtDate(x.trialEndsOn)}</span>}</h2>
                    <p className="t-meta">{[x.category, x.cadence === "custom" ? `Every ${x.intervalValue} ${x.intervalUnit}s` : CADENCE[x.cadence], x.renewal === "manual" ? "renews manually" : null, x.paymentLabel].filter(Boolean).join(", ")}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="t-h3">{formatMoney(x.amountMinor, x.currency)}</p>
                    {x.cadence !== "monthly" && <p className="t-meta">≈ {formatMoney(monthlyMinor, x.currency)}/month</p>}
                  </div>
                </div>
                {next && <p className="t-small">Next charge {fmtDate(next)} ({relDays(daysLeft)})</p>}
                {x.url && <a className="t-small" href={x.url} target="_blank" rel="noopener noreferrer">Manage account</a>}
                {x.notes && <p className="t-small text-ink-2">{x.notes}</p>}
                <div className="flex flex-wrap gap-2">
                  {x.status === "active"
                    ? <OpButton op="subscription.cancel" input={{ id: x.id, cancelledOn: s.today }} label="I cancelled it" className="btn btn-sm" confirmText={`Record that you cancelled ${x.name} today? This doesn't cancel it with the provider.`} />
                    : <OpButton op="subscription.reactivate" input={{ id: x.id, nextBillingDate: s.today }} label="Reactivate (charged today)" className="btn btn-sm" />}
                </div>
                <details>
                  <summary className="t-small cursor-pointer">Edit</summary>
                  <div className="mt-3 grid gap-3">
                    <OpForm op="subscription.update" fields={f} fixed={{ id: x.id }} compact submitLabel="Save"
                      initial={{ ...x, amount: fromMinor(x.amountMinor, x.currency), nextBillingDate: next ?? x.anchorDate, beforeDays: x.reminderOffsetsDays.map((n) => -n).filter(Boolean), trialDays: x.trialOffsetsDays.map((n) => -n).filter(Boolean) }} />
                    <OpButton op="subscription.delete" input={{ id: x.id }} label="Delete" className="btn btn-sm btn-ghost justify-self-start" confirmText={`Delete ${x.name}? Its reminders stop.`} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
