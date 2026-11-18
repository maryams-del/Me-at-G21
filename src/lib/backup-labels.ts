/** What a backup contains, in plain words (shared by the server summary and the browser). */
export const BACKUP_LABELS: Record<string, string> = {
  charity_payments: "charity entries", savings_goals: "savings goals", savings_transactions: "savings deposits/withdrawals", debts: "lent/borrowed records",
  routines: "routines", routine_events: "routine log entries", fast_ledger_events: "fast ledger entries", projects: "projects", tasks: "tasks",
  expiry_items: "expiries", documents: "documents", document_files: "document files", masters_applications: "applications", achievements: "achievements", hobbies: "hobbies",
  subscriptions: "subscriptions", zakat_calculations: "zakat estimates", zakat_payments: "zakat payments", period_cycles: "period entries",
  people: "family members", recurring_events: "recurring events", homework_tasks: "homework items", capture_drafts: "drafts", reminders: "reminders",
};
export const backupItems = (counts: Record<string, number>) =>
  Object.entries(BACKUP_LABELS).map(([k, label]) => ({ label, count: counts[k] ?? 0 })).filter((x) => x.count > 0);
