/** What a provider (LLM or offline parser) may return. Everything is re-validated server-side. */
export type ProposedOp = {
  op: string;
  input: Record<string, unknown>;
  /** fields the provider knows are missing / ambiguous */
  missing?: string[];
  /** fields the provider filled by assumption (e.g. date = today) — shown in preview */
  assumed?: string[];
};

export type SearchQuery =
  | { type: "last_event"; target: string } // waxing | dental | fasts | charity | savings | debts | routine:<alias>
  | { type: "charity_total"; from: string; to: string }
  | { type: "fast_balance" }
  | { type: "savings_status"; goal?: string }
  | { type: "debts_outstanding"; direction?: "lent" | "borrowed" }
  | { type: "next_class" }
  | { type: "text"; q: string };

export type Interpretation = {
  intent: "capture" | "search" | "unsupported";
  operations: ProposedOp[];
  questions: string[];
  query?: SearchQuery;
  note?: string;
};

/** Minimal, non-sensitive context: aliases instead of database IDs; no amounts, no health data. */
export type AiContext = {
  today: string; // YYYY-MM-DD in owner tz
  weekday: string;
  tz: string;
  currency: string;
  routines: { alias: string; name: string; kind: string }[];
  goals: { alias: string; name: string }[];
  debts: { alias: string; counterparty: string; direction: string }[];
  projects: { alias: string; name: string }[];
  tasks: { alias: string; title: string }[];
  expiries: { alias: string; label: string; kind: string }[];
  /** family members (first names only) for "Ali's passport" */
  people: { alias: string; name: string; relation: string }[];
};

export interface AiProvider {
  name: string;
  interpret(args: { text: string; ctx: AiContext; previous?: { text: string; operations: ProposedOp[] }[] }): Promise<Interpretation>;
}
