import { pageOwner, debtsState } from "@/server/queries";
import { PageHeader, Section, Empty } from "@/components/ui";
import { OpForm, Reveal, type FieldDef } from "@/components/OpForm";
import { EntryCard } from "@/components/EntryCard";
import { countdown, daysBetween, reminderLine } from "@/lib/countdown";
import { currencyField } from "@/components/fields";
import { formatMoney } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import { fmtDate } from "@/lib/format";

export default async function DebtsPage() {
  const o = await pageOwner();
  const rows = await debtsState(o);
  const today = todayLocal(o.timezone);
  const open = rows.filter((r) => r.debt.status === "open");
  const owedToMe = open.filter((r) => r.debt.direction === "lent");
  const iOwe = open.filter((r) => r.debt.direction === "borrowed");
  const sum = (xs: typeof rows) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.debt.currency, (m.get(x.debt.currency) ?? 0) + x.outstanding);
    return m.size ? [...m].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, o.defaultCurrency);
  };

  return (
    <>
      <PageHeader glyph="debts" title="Lent & borrowed" />
      <div className="money-tiles mb-8">
        <div className="tile slate min-h-0"><p className="t-small">Owed to me (I need to collect)</p><p className="t-num text-[2.2rem] mt-2">{sum(owedToMe)}</p></div>
        <div className="tile rust min-h-0"><p className="t-small">I owe (I need to repay)</p><p className="t-num text-[2.2rem] mt-2">{sum(iOwe)}</p></div>
      </div>
      <div className="mb-8">
        <Reveal label="Add a record" buttonClass="btn btn-primary">
          <OpForm op="debt.create" submitLabel="Save record" initial={{ onDate: today, currency: o.defaultCurrency, direction: "lent", remindersEnabled: true, reminderOffsetsDays: "1", overdueRepeatDays: 3, reminderTime: "09:00" }}
            fields={[
              { name: "direction", label: "Type", type: "select", required: true, options: [{ value: "lent", label: "I lent (they owe me)" }, { value: "borrowed", label: "I borrowed (I owe them)" }] },
              { name: "counterparty", label: "Person", required: true },
              { name: "amount", label: "Amount", type: "amount", required: true },
              currencyField(o.defaultCurrency),
              { name: "onDate", label: "Date", type: "date", required: true },
              { name: "dueDate", label: "Due date", type: "date", nullable: true },
              { name: "reminderOffsetsDays", label: "Remind me this many days before due", type: "intlist", negative: true, includeZero: true, presets: [14, 7, 3, 1], maxDays: 60, maxCount: 6 },
              { name: "reminderTime", label: "Reminder time", type: "time", required: true },
              { name: "overdueRepeatDays", label: "If overdue, remind every N days", type: "int" },
              { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
              { name: "notes", label: "Note", type: "textarea", nullable: true },
            ]} />
        </Reveal>
      </div>
      <Section title="Open">
        {open.length === 0 ? <Empty>No open records. Try “I lent Sara 200 SAR yesterday, she will repay Friday” in Capture.</Empty> : <DebtList rows={open} today={today} />}
      </Section>
      {rows.some((r) => r.debt.status === "settled") && (
        <Section title="Settled"><DebtList rows={rows.filter((r) => r.debt.status === "settled")} today={today} /></Section>
      )}
    </>
  );
}

const editFields: FieldDef[] = [
  { name: "counterparty", label: "Person", required: true },
  { name: "onDate", label: "Date", type: "date", required: true },
  { name: "dueDate", label: "Due date", type: "date", nullable: true },
  { name: "reminderOffsetsDays", label: "Remind me this many days before due", type: "intlist", negative: true, includeZero: true, presets: [14, 7, 3, 1], maxDays: 60, maxCount: 6 },
  { name: "overdueRepeatDays", label: "If overdue, remind every N days", type: "int" },
  { name: "reminderTime", label: "Reminder time", type: "time", required: true },
  { name: "remindersEnabled", label: "Reminders on", type: "checkbox" },
  { name: "notes", label: "Note", type: "textarea", nullable: true },
];

function DebtList({ rows, today }: { rows: Awaited<ReturnType<typeof debtsState>>; today: string }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {rows.map(({ debt: d, outstanding, pays, overdue }) => {
        const isOpen = d.status === "open";
        const left = isOpen && d.dueDate ? daysBetween(today, d.dueDate) : null;
        return (
          <EntryCard key={d.id} title={d.direction === "lent" ? `${d.counterparty} owes you` : `You owe ${d.counterparty}`}
            badge={!isOpen ? <span className="chip chip-pine">settled</span> : undefined}
            subtitle={`${formatMoney(outstanding, d.currency)} outstanding · ${d.direction === "lent" ? "lent" : "borrowed"} ${formatMoney(d.originalMinor, d.currency)} on ${fmtDate(d.onDate)}`}
            count={countdown(left, "due")} countSub={left !== null ? fmtDate(d.dueDate) : undefined}
            reminder={isOpen && d.dueDate ? reminderLine({ enabled: d.remindersEnabled, date: d.dueDate, offsets: d.reminderOffsetsDays, time: d.reminderTime, today }) + (overdue && d.remindersEnabled && d.overdueRepeatDays ? ` · every ${d.overdueRepeatDays} days while overdue` : "") : null}
            action={isOpen ? (
              <Reveal label="Repaid" icon="cash" buttonClass="pill-action">
                <OpForm op="debt.repay" fixed={{ debtId: d.id }} initial={{ onDate: today }} submitLabel="Save repayment" fields={[
                  { name: "amount", label: "Amount", type: "amount", required: true }, { name: "onDate", label: "Date", type: "date", required: true }, { name: "notes", label: "Note", nullable: true }]} />
              </Reveal>
            ) : undefined}
            edit={
              <div className="grid gap-4">
                {isOpen && (
                  <Reveal label="Correct the amount" icon="edit" buttonClass="pill-action">
                    <OpForm op="debt.adjust" fixed={{ debtId: d.id }} initial={{ onDate: today }} submitLabel="Save correction" fields={[
                      { name: "delta", label: "Change to outstanding (+/−)", required: true, placeholder: "-20" }, { name: "onDate", label: "Date", type: "date", required: true },
                      { name: "notes", label: "Reason (kept in the audit log)", required: true, wide: true }]} />
                  </Reveal>
                )}
                <OpForm op="debt.update" fields={editFields} fixed={{ id: d.id }} compact submitLabel="Save changes"
                  initial={{ ...d, reminderTime: d.reminderTime ?? "09:00" }}
                  deleteAction={{ op: "debt.delete", input: { id: d.id }, confirm: "Delete this record and its reminders?" }} />
              </div>
            }>
            {pays.length > 0 && (
              <ul className="list">{pays.map((p) => (
                <li key={p.id} className="py-1.5 flex justify-between t-small"><span>{fmtDate(p.onDate)} {p.type === "adjustment" ? `adjustment: ${p.notes}` : "repayment"}</span><span>{p.type === "adjustment" ? (p.amountMinor > 0 ? "+" : "") : "−"}{formatMoney(Math.abs(p.amountMinor), d.currency)}</span></li>
              ))}</ul>
            )}
          </EntryCard>
        );
      })}
    </ul>
  );
}
