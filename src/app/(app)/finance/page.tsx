import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Glyph } from "@/components/Glyph";

export default function FinanceIndex() {
  const items = [
    { href: "/finance/charity", label: "Charity", glyph: "charity" as const, d: "Donations, monthly and yearly totals" },
    { href: "/finance/savings", label: "Savings", glyph: "savings" as const, d: "Goals and actual deposits" },
    { href: "/finance/debts", label: "Lent & borrowed", glyph: "debts" as const, d: "Who owes whom, repayments, reminders" },
    { href: "/finance/subscriptions", label: "Subscriptions", glyph: "subscriptions" as const, d: "Monthly cost, upcoming charges, trial ends" },
    { href: "/finance/zakat", label: "Zakat", glyph: "zakat" as const, d: "Step-by-step estimate and payments" },
  ];
  return (
    <>
      <PageHeader glyph="finance" title="Money" />
      <ul className="grid gap-3 grid-cols-2 sm:grid-cols-3">
        {items.map((i) => <li key={i.href}><Link href={i.href} className="tile min-h-0"><Glyph kind={i.glyph} size={30} accent="var(--rust)" /><p className="t-h3 mt-3">{i.label}</p></Link></li>)}
      </ul>
    </>
  );
}
