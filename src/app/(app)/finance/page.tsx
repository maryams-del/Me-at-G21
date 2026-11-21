import { SpaceHub } from "@/components/SpaceHub";

export default async function FinanceIndex({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const items = [
    { href: "/finance/charity", label: "Charity", glyph: "charity" as const },
    { href: "/finance/savings", label: "Savings", glyph: "savings" as const },
    { href: "/finance/debts", label: "Lent & borrowed", glyph: "debts" as const },
    { href: "/finance/subscriptions", label: "Subscriptions", glyph: "subscriptions" as const },
    { href: "/finance/zakat", label: "Zakat", glyph: "zakat" as const },
  ];
  return <SpaceHub title="Money" glyph="finance" items={items} fromHome={from === "home"} />;
}
