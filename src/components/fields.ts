import type { FieldDef } from "./OpForm";
import { CURRENCIES } from "@/lib/money";

export const currencyField = (def = "SAR"): FieldDef => ({ name: "currency", label: "Currency", type: "select", required: true, options: [def, ...CURRENCIES.filter((c) => c !== def)].map((c) => ({ value: c, label: c })) });

export const charityFields = (cur: string, o: { recipients?: string[]; causes?: string[]; repeatUpTo?: number } = {}): FieldDef[] => [
  { name: "amount", label: "Amount", type: "amount", required: true, placeholder: "100" },
  currencyField(cur),
  { name: "recipient", label: "Platform or recipient", required: true, placeholder: "Ehsan", suggestions: o.recipients },
  { name: "cause", label: "Cause", placeholder: "Orphan sponsorship", nullable: true, suggestions: o.causes },
  { name: "paidOn", label: "Date", type: "date", required: true },
  { name: "status", label: "Status", type: "select", required: true, options: [{ value: "completed", label: "Paid" }, { value: "planned", label: "Planned (not paid yet)" }] },
  ...(o.repeatUpTo !== undefined ? [{ name: "repeatMonths", label: "Add automatically for the next … months", type: "int" as const, placeholder: "0",
    suggestions: Array.from({ length: o.repeatUpTo + 1 }, (_, i) => String(i)) }] : []),
  { name: "notes", label: "Note", type: "textarea", nullable: true },
];
