import type { FieldDef } from "./OpForm";
import { CURRENCIES } from "@/lib/money";

export const currencyField = (def = "SAR"): FieldDef => ({ name: "currency", label: "Currency", type: "select", required: true, options: [def, ...CURRENCIES.filter((c) => c !== def)].map((c) => ({ value: c, label: c })) });

export const charityFields = (cur: string): FieldDef[] => [
  { name: "amount", label: "Amount", type: "amount", required: true, placeholder: "100" },
  currencyField(cur),
  { name: "recipient", label: "Platform or recipient", required: true, placeholder: "Ehsan" },
  { name: "cause", label: "Cause", placeholder: "Orphan sponsorship", nullable: true },
  { name: "paidOn", label: "Date", type: "date", required: true },
  { name: "status", label: "Status", type: "select", required: true, options: [{ value: "completed", label: "Paid" }, { value: "planned", label: "Planned (not paid yet)" }] },
  { name: "recurring", label: "Recurring donation", type: "checkbox" },
  { name: "notes", label: "Note", type: "textarea", nullable: true },
];
