import type { FieldDef } from "@/components/OpForm";
import { APPLICATION_STATUSES } from "@/db/schema";

export const STATUS_LABEL: Record<string, string> = {
  researching: "Researching", preparing: "Preparing", submitted: "Submitted", interview: "Interview",
  decision: "Awaiting decision", accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn",
};
export const STATUS_OPTIONS = APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }));

const zones = () => {
  const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["Asia/Riyadh", "Europe/London", "America/New_York"];
  const top = ["Asia/Riyadh", "Europe/London", "Europe/Berlin", "Europe/Amsterdam", "America/New_York", "America/Los_Angeles", "America/Toronto", "Australia/Sydney", "Asia/Dubai", "Asia/Singapore"];
  return [...top, ...all.filter((z) => !top.includes(z))].map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
};

export function applicationFields(docs: { id: string; title: string }[], forEdit = false): FieldDef[] {
  return [
    { name: "university", label: "University", required: true },
    { name: "program", label: "Program", required: true, placeholder: "MSc Data Science" },
    { name: "country", label: "Country", nullable: true },
    { name: "intake", label: "Intake", nullable: true, placeholder: "Fall 2027" },
    { name: "deadlineDate", label: "Deadline date", type: "date", nullable: true, help: "Copy it from the official program page." },
    { name: "deadlineTime", label: "Deadline time", type: "time", nullable: true, help: "Leave empty for 23:59." },
    { name: "deadlineTz", label: "Deadline timezone (as the university states it)", type: "select", nullable: true, options: zones(), wide: true },
    { name: "deadlineVerified", label: "I checked this deadline on the official website", type: "checkbox", wide: true },
    { name: "url", label: "Application link", nullable: true, wide: true, placeholder: "https://" },
    { name: "fee", label: "Application fee", type: "amount", nullable: true },
    { name: "feeCurrency", label: "Fee currency", type: "select", nullable: true, options: ["SAR", "USD", "GBP", "EUR", "CAD", "AUD", "PKR"].map((c) => ({ value: c, label: c })) },
    { name: "funding", label: "Funding / scholarship", type: "textarea", nullable: true },
    { name: "contacts", label: "Contacts", type: "textarea", nullable: true, placeholder: "Admissions office, email…" },
    ...(forEdit ? [] : [{ name: "requirementsText", sendAs: "requirements", lines: true, label: "Requirements checklist (one per line)", type: "textarea", placeholder: "Transcript\nIELTS 7.0\n2 recommendation letters\nStatement of purpose" } as FieldDef]),
    ...(forEdit ? [] : [{ name: "documentIds", asArray: true, label: "Linked document", type: "select", options: docs.map((d) => ({ value: d.id, label: d.title })), help: "More can be linked on the detail page." } as FieldDef]),
    { name: "linksText", label: "Links (one per line, optionally “Label | https://…”)", type: "textarea", wide: true, nullable: true, placeholder: "Program page | https://…\nScholarship | https://…" },
    { name: "reminderOffsetsDays", label: "Remind me this many days before", type: "intlist", negative: true, help: "Default 30, 14, 7, 1" },
    { name: "remindersEnabled", label: "Deadline reminders on", type: "checkbox" },
    { name: "notes", label: "Notes", type: "textarea", nullable: true },
  ];
}
