import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, type Tx } from "@/db";
import { captureDrafts } from "@/db/schema";
import { getOp, allOps, defineOp, zId } from "./registry";
import { audit, UserError, type Ctx } from "../audit";
import "./finance";
import "./care";
import "./planning";
import "./admin";
import "./education";
import "./period";
import "./career";
import "./subscriptions";
import "./zakat";
import "./spaces";
import "./trash";

export { getOp, allOps };

export const draftDiscard = defineOp({
  name: "draft.discard", module: "inbox", label: "Discard draft", aiAllowed: false,
  schema: z.object({ id: zId }),
  summarize: () => "Discard draft",
  async run(ctx, i) {
    const res = await ctx.tx.update(captureDrafts).set({ status: "discarded", updatedAt: ctx.now })
      .where(and(eq(captureDrafts.id, i.id), eq(captureDrafts.ownerId, ctx.ownerId), eq(captureDrafts.status, "open"))).returning({ id: captureDrafts.id });
    if (!res.length) throw new UserError("Draft not found");
    await audit(ctx, "inbox", "discarded", "capture_draft", i.id, "Discarded a draft");
    return { id: i.id, message: "Draft discarded" };
  },
});

export type OpResult = { ok: true; id: string | null; message: string } | { ok: false; error: string; field?: string; issues?: z.ZodIssue[] };

export function validateOp(name: string, input: unknown) {
  const op = getOp(name);
  if (!op) return { ok: false as const, error: `Unknown operation ${name}` };
  const parsed = op.schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((x) => `${x.path.join(".") || "input"}: ${x.message}`).join("; "), issues: parsed.error.issues };
  return { ok: true as const, op, data: parsed.data };
}

/** Run one op inside the caller's transaction. Throws on failure so the transaction rolls back. */
export async function runOpInTx(tx: Tx, base: Omit<Ctx, "tx">, name: string, input: unknown) {
  const v = validateOp(name, input);
  if (!v.ok) throw new UserError(v.error);
  return v.op.run({ ...base, tx }, v.data);
}

/** Validate + run a single op in its own transaction. Used by manual forms. */
export async function runOp(ownerId: string, tz: string, name: string, input: unknown, opts: { allowAiOnly?: false } = {}): Promise<OpResult> {
  void opts;
  const v = validateOp(name, input);
  if (!v.ok) return v;
  try {
    const now = new Date();
    const res = await getDb().transaction((tx) => v.op.run({ tx, ownerId, tz, source: "manual", now }, v.data));
    return { ok: true, ...res };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, field: e.field };
    console.error(`[op ${name}] failed:`, (e as Error).message);
    return { ok: false, error: "Something went wrong saving this. Nothing was changed." };
  }
}
