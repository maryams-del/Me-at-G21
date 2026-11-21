"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dropdown } from "@/components/GlyphSelect";

/** "By month" and "Pending" tabs under the This month / total boxes. */
export function CharityTabs({ pendingCount, months, pending, startOn = "months" }: { pendingCount: number; months: React.ReactNode; pending: React.ReactNode; startOn?: "months" | "pending" }) {
  const [tab, setTab] = useState<"months" | "pending">(startOn);
  return (
    <div className="grid gap-5">
      <div className="seg-tabs charity-tabs" role="tablist" aria-label="Donations">
        <button type="button" role="tab" id="ct-months" aria-selected={tab === "months"} aria-controls="cp-months" onClick={() => setTab("months")}>By month</button>
        <button type="button" role="tab" id="ct-pending" aria-selected={tab === "pending"} aria-controls="cp-pending" onClick={() => setTab("pending")}>
          Pending{pendingCount ? <span className="tab-count">{pendingCount}</span> : null}
        </button>
      </div>
      <div id="cp-months" role="tabpanel" aria-labelledby="ct-months" hidden={tab !== "months"}>{months}</div>
      <div id="cp-pending" role="tabpanel" aria-labelledby="ct-pending" hidden={tab !== "pending"}>{pending}</div>
    </div>
  );
}

/** Year switcher beside "By month". */
export function YearPicker({ year, years }: { year: string; years: string[] }) {
  const router = useRouter();
  return <Dropdown size="sm" ariaLabel="Year" value={year} options={years.map((y) => ({ value: y, label: y }))} onChange={(y) => router.push(`/finance/charity?year=${y}`)} />;
}
