import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { routines, savingsGoals, debts, expiryItems } from "@/db/schema";
import { pageOwner, attentionItems } from "@/server/queries";
import Link from "next/link";
import { PageHeader, Empty } from "@/components/ui";
import { OpForm, OpButton, type FieldDef } from "@/components/OpForm";
import { charityFields, currencyField } from "@/components/fields";
import { todayLocal } from "@/lib/time";
import { fmtDateTime } from "@/lib/format";

export default async function InboxPage() {
  const o = await pageOwner();
  const db = getDb();
  const { items, drafts } = await attentionItems(o);
  const notices = items.filter((x) => x.kind !== "missing");
  const [rs, gs, ds, es] = await Promise.all([
    db.select().from(routines).where(eq(routines.ownerId, o.id)),
    db.select().from(savingsGoals).where(and(eq(savingsGoals.ownerId, o.id), eq(savingsGoals.status, "active"))),
    db.select().from(debts).where(and(eq(debts.ownerId, o.id), eq(debts.status, "open"))),
    db.select().from(expiryItems).where(and(eq(expiryItems.ownerId, o.id), eq(expiryItems.status, "active"))),
  ]);
  const today = todayLocal(o.timezone);
  const formFor = (action: string): FieldDef[] | null => {
    switch (action) {
      case "charity.create": return charityFields(o.defaultCurrency);
      case "debt.create": return [
        { name: "direction", label: "Type", type: "select", required: true, options: [{ value: "lent", label: "I lent" }, { value: "borrowed", label: "I borrowed" }] },
        { name: "counterparty", label: "Person", required: true }, { name: "amount", label: "Amount", type: "amount", required: true }, currencyField(o.defaultCurrency),
        { name: "onDate", label: "Date", type: "date", required: true }, { name: "dueDate", label: "Due date", type: "date", nullable: true }];
      case "fasts.complete": return [{ name: "onDate", label: "Date fasted", type: "date", required: true }];
      case "waxing.complete": case "dental.complete": return [{ name: "completedOn", label: "Date", type: "date", required: true }];
      case "routine.log": return [{ name: "routineId", label: "Routine", type: "select", required: true, options: rs.map((r) => ({ value: r.id, label: r.name })) },
        { name: "type", label: "What happened", type: "select", required: true, options: [{ value: "completed", label: "Done" }, { value: "first_use", label: "Started a new one" }] },
        { name: "onDate", label: "Date", type: "date", required: true }];
      case "savings.deposit": case "savings.withdraw": return [{ name: "goalId", label: "Goal", type: "select", required: true, options: gs.map((g) => ({ value: g.id, label: g.name })) },
        { name: "amount", label: "Amount", type: "amount", required: true }, { name: "onDate", label: "Date", type: "date", required: true }];
      case "debt.repay": return [{ name: "debtId", label: "Record", type: "select", required: true, options: ds.map((d) => ({ value: d.id, label: d.counterparty })) },
        { name: "amount", label: "Amount", type: "amount", required: true }, { name: "onDate", label: "Date", type: "date", required: true }];
      case "task.create": return [{ name: "title", label: "Task", required: true, wide: true }, { name: "dueOn", label: "Due date", type: "date", nullable: true }, { name: "dueTime", label: "Time", type: "time", nullable: true }];
      case "homework.create": return [{ name: "title", label: "Homework", required: true, wide: true }, { name: "reference", label: "Surah / verses", nullable: true }];
      case "project.create": return [{ name: "name", label: "Project", required: true }, { name: "targetDate", label: "Target date", type: "date", nullable: true }];
      case "expiry.create": return [{ name: "label", label: "Item", required: true }, { name: "expiresOn", label: "Expiry date", type: "date", required: true }];
      case "expiry.renew": return [{ name: "itemId", label: "Item", type: "select", required: true, options: es.map((e) => ({ value: e.id, label: e.label })) },
        { name: "renewedOn", label: "Renewed on", type: "date", required: true }, { name: "newExpiresOn", label: "New expiry date", type: "date", required: true }];
      case "savings.goal.create": return [{ name: "name", label: "Goal", required: true }, { name: "target", label: "Target", type: "amount", required: true }, currencyField(o.defaultCurrency)];
      default: return null;
    }
  };

  return (
    <>
      <PageHeader glyph="inbox" title="Attention needed" />
      {items.length === 0 && <Empty>All clear. Anything overdue, missing information or running out will show up here.</Empty>}
      {notices.length > 0 && (
        <ul className="list panel px-4 mb-6">
          {notices.map((x) => (
            <li key={x.key}>
              <Link href={x.href} className="py-3 flex items-center gap-3 no-underline" style={{ color: "inherit" }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: x.kind === "storage" ? "var(--mustard)" : "var(--rust)" }} aria-hidden />
                <span className="min-w-0 flex-1"><span className="block font-semibold">{x.label}</span><span className="t-meta">{x.detail}</span></span>
                <span className="t-meta shrink-0" aria-hidden>›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {drafts.length > 0 && (
        <ul className="grid gap-4">
          {drafts.map((d) => {
            const fields = formFor(d.action);
            const payload = d.payload as Record<string, unknown>;
            const initial = { paidOn: today, onDate: today, completedOn: today, renewedOn: today, status: "completed", currency: o.defaultCurrency, ...payload };
            return (
              <li key={d.id} className="panel p-4 grid gap-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="t-h3">“{d.sourceText}” has missing information</p>
                  <p className="t-meta">{fmtDateTime(d.createdAt, o.timezone)}</p>
                </div>
                <p className="t-small"><span className="chip chip-mustard">Missing: {d.missingFields.join(", ")}</span></p>
                {fields ? <OpForm op={d.action} endpoint="/api/drafts/resolve" nestKey="input" nestExtra={{ id: d.id }} nestBase={payload} fields={fields} initial={initial} submitLabel="Save entry" /> : <p className="t-small">Open the matching tracker to add this manually.</p>}
                <OpButton op="draft.discard" input={{ id: d.id }} label="Discard" className="btn btn-sm btn-ghost justify-self-start" confirmText="Discard this?" />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
