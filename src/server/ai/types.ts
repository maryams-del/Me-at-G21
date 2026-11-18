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

/** "Go to <page>": only catalogue page ids; person/target are context aliases ("@f1") or "me". */
export type NavRequest = { page: string; q?: string; person?: string; kind?: string; year?: string; target?: string };
/** App commands from a fixed catalogue; they always wait for Proceed. */
export type CommandRequest = { command: string; module?: string };

export type Interpretation = {
  intent: "capture" | "search" | "navigate" | "command" | "unsupported";
  navigate?: NavRequest;
  command?: CommandRequest;
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
  applications: { alias: string; university: string; program: string; status: string }[];
  subscriptions: { alias: string; name: string; status: string }[];
  achievements: { alias: string; title: string }[];
  hobbies: { alias: string; name: string }[];
  /** the owner's own spaces (lists) and their open items */
  spaces: { alias: string; name: string; section: string }[];
  spaceItems: { alias: string; text: string; space: string; done: boolean }[];
};

export interface AiProvider {
  name: string;
  interpret(args: { text: string; ctx: AiContext; previous?: { text: string; operations: ProposedOp[] }[] }): Promise<Interpretation>;
}
