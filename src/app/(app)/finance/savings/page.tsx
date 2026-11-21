import { pageOwner, savingsState } from "@/server/queries";
import { SpaceHeader } from "@/components/SpaceHeader";
import { PageAddProvider, PageAddButton, PageAddPanel } from "@/components/PageAdd";
import { PageHeader, Empty } from "@/components/ui";
import { OpForm, Reveal, ItemRow } from "@/components/OpForm";
import { currencyField } from "@/components/fields";
import { formatMoney, fromMinor } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { fmtDate } from "@/lib/format";
import type { FieldDef } from "@/components/OpForm";

const goalFields = (cur: string): FieldDef[] => [
  { name: "name", label: "Goal name", required: true, placeholder: "Emergency fund" },
  { name: "target", label: "Target amount", type: "amount", required: true },
  currencyField(cur),
  { name: "targetDate", label: "Target date", type: "date", nullable: true },
  { name: "openingBalance", label: "Already saved", type: "amount", placeholder: "0" },
  { name: "plannedMonthly", label: "Planned monthly contribution", type: "amount", nullable: true, help: "A plan only. It never counts as saved money." },
  { name: "reminderDayOfMonth", label: "Remind me on day of month", type: "int", nullable: true },
  { name: "remindersEnabled", label: "Monthly contribution reminder", type: "checkbox" },
];

export default async function SavingsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const sp = await searchParams;
  const o = await pageOwner();
  const goals = await savingsState(o);
  const today = todayLocal(o.timezone);
  const active = goals.filter((g) => g.goal.status === "active");

  return (
    <>
      <PageAddProvider initialOpen={sp.add === "1" ? (active.length ? "deposit" : "goal") : null}>
      <SpaceHeader href="/finance/savings">
        <PageAddButton label="Add" choices={[...(active.length ? [{ key: "deposit", label: "Add savings" }] : []), { key: "goal", label: "New goal" }]} />
      </SpaceHeader>
      {active.length > 0 && (
        <PageAddPanel id="deposit" title="Add savings">
          <OpForm op="savings.deposit" submitLabel="Save deposit" initial={{ onDate: today }} fields={[
              { name: "goalId", label: "Goal", type: "select", required: true, options: active.map((g) => ({ value: g.goal.id, label: g.goal.name })) },
              { name: "amount", label: "Amount", type: "amount", required: true },
              { name: "onDate", label: "Date", type: "date", required: true },
              { name: "notes", label: "Note", nullable: true },
            ]} />
        </PageAddPanel>
      )}
      <PageAddPanel id="goal" title="New goal">
        <OpForm op="savings.goal.create" fields={goalFields(o.defaultCurrency)} initial={{ currency: o.defaultCurrency, openingBalance: "0" }} submitLabel="Create goal" />
      </PageAddPanel>
      </PageAddProvider>
      <div className="mb-8" />

      {goals.length === 0 && <Empty>No goals yet. Create one for each thing you&apos;re saving towards — they run side by side.</Empty>}

      <div className="grid gap-6">
        {goals.map(({ goal: g, balance, pct, txs, byMonth }) => (
          <article key={g.id} className="panel p-4 sm:p-5" style={{ opacity: g.status === "archived" ? 0.6 : 1 }}>
            <ItemRow name={g.name}
              head={<><h2 className="t-h2">{g.name} {g.status !== "active" && <span className="chip chip-pine">{g.status}</span>}</h2>
                <p className="t-small text-ink-2">{g.targetDate ? `Target ${fmtDate(g.targetDate)}` : "No target date"}</p></>}
              edit={<OpForm op="savings.goal.update" fixed={{ id: g.id }} submitLabel="Save goal" fields={[...goalFields(g.currency), { name: "status", label: "Status", type: "select", required: true, options: [{ value: "active", label: "Active" }, { value: "achieved", label: "Achieved" }, { value: "archived", label: "Archived" }] }]}
                  initial={{ ...g, target: fromMinor(g.targetMinor, g.currency), openingBalance: fromMinor(g.openingBalanceMinor, g.currency), plannedMonthly: g.plannedMonthlyMinor ? fromMinor(g.plannedMonthlyMinor, g.currency) : "" }} />} />
            <div className="mt-4 grid gap-1">
              <div className="flex justify-between items-end"><span className="t-num text-[1.7rem] sm:text-[2.4rem]">{formatMoney(balance, g.currency)}</span><span className="t-small">{pct}% of {formatMoney(g.targetMinor, g.currency)}</span></div>
              <div className="bar" style={{ height: 14 }}><i style={{ width: `${pct}%` }} /></div>
              <div className="flex justify-between t-meta"><span>{[25, 50, 75].filter((m) => pct >= m).map((m) => `${m}%`).join(", ") || "No milestones yet"}{pct >= 25 ? " reached" : ""}</span><span>{formatMoney(Math.max(0, g.targetMinor - balance), g.currency)} to go</span></div>
              {g.plannedMonthlyMinor && <p className="t-meta">Plan: {formatMoney(g.plannedMonthlyMinor, g.currency)} a month{g.remindersEnabled && g.reminderDayOfMonth ? `, reminder on day ${g.reminderDayOfMonth}` : ""}</p>}
            </div>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="t-h3 mb-2">Transactions</h3>
                {txs.length ? <ul className="list">{txs.slice(0, 12).map((x) => (
                  <li key={x.id} className="py-2 flex justify-between gap-3 t-small" style={{ textDecoration: x.voidedAt ? "line-through" : undefined }}>
                    <span>{fmtDate(x.onDate)}{x.notes ? `, ${x.notes}` : ""}</span>
                    <span>{x.type === "deposit" ? "+" : "−"}{formatMoney(x.amountMinor, g.currency)}</span>
                  </li>))}</ul> : <p className="t-meta">No transactions yet.</p>}
              </div>
              <div>
                <h3 className="t-h3 mb-2">By month</h3>
                {byMonth.length ? <ul className="list">{byMonth.map(([m, v]) => <li key={m} className="py-2 flex justify-between t-small"><span>{m}</span><span>{formatMoney(v, g.currency)}</span></li>)}</ul> : <p className="t-meta">Nothing yet.</p>}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Reveal label="Withdraw" buttonClass="btn btn-sm">
                <OpForm op="savings.withdraw" fixed={{ goalId: g.id }} initial={{ onDate: today }} submitLabel="Save withdrawal" fields={[
                  { name: "amount", label: "Amount", type: "amount", required: true }, { name: "onDate", label: "Date", type: "date", required: true }, { name: "notes", label: "Note", nullable: true }]} />
              </Reveal>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
