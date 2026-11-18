import type { Tx } from "@/db";
import { auditEvents } from "@/db/schema";

export type Ctx = { tx: Tx; ownerId: string; tz: string; source: "manual" | "ai"; now: Date };

export async function audit(
  ctx: Ctx, category: string, action: string, entityType: string, entityId: string | null,
  summary: string, sensitive = false,
) {
  await ctx.tx.insert(auditEvents).values({
    ownerId: ctx.ownerId, category, action, entityType, entityId, summary,
    source: ctx.source, sensitive, occurredAt: ctx.now,
  });
}

export class UserError extends Error {
  constructor(message: string, public field?: string) { super(message); }
}
