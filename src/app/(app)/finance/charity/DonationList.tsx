import { OpForm, OpButton, ItemRow } from "@/components/OpForm";
import { charityFields } from "@/components/fields";
import { formatMoney, fromMinor } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { dmy } from "@/lib/time";
import type { charityState } from "@/server/queries";

type Row = Awaited<ReturnType<typeof charityState>>["rows"][number];

/** Donation entries: name, date and amount, with the pencil on the name line. Delete lives inside the edit panel. */
export function DonationList({ rows, currency, today, suggest }: { rows: Row[]; currency: string; today: string; suggest: { recipients: string[]; causes: string[] } }) {
  return (
    <ul className="list panel px-4">
      {rows.map((r) => (
        <li key={r.id} className="py-3 grid gap-1">
          <ItemRow name={`donation to ${r.recipient}`}
            below={r.status === "planned" ? <OpButton op="charity.update" className="btn btn-sm" label="Mark paid" input={{ ...r, id: r.id, amount: fromMinor(r.amountMinor, r.currency), status: "completed", paidOn: today, cause: r.cause, notes: r.notes }} confirmText={`Mark as paid today (${dmy(today)})?`} /> : undefined}
            head={<><p className="font-medium">{r.recipient}{r.cause && <span className="text-ink-2 font-normal">, {r.cause}</span>}</p>
              <p className="t-meta">{fmtDate(r.paidOn)}{r.recurring ? ", recurring" : ""}{r.source === "ai" ? ", captured with AI" : ""}</p></>}
            stack aside={<p className="t-num text-xl text-right">{formatMoney(r.amountMinor, r.currency)}</p>}
            edit={<OpForm op="charity.update" fields={charityFields(currency, suggest)} fixed={{ id: r.id, recurring: r.recurring }} submitLabel="Save changes" compact
              initial={{ ...r, amount: fromMinor(r.amountMinor, r.currency) }}
              deleteAction={{ op: "charity.delete", input: { id: r.id }, confirm: "Delete this donation?", note: "It will be removed from your totals.", label: "Delete" }} />}>
            {r.notes && <p className="t-small text-ink-2">{r.notes}</p>}
          </ItemRow>
        </li>
      ))}
    </ul>
  );
}

export const monthName = (m: string, withYear = false) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(m + "-01"));
