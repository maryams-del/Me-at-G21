/**
 * Operation registry: the ONLY write path for user records.
 *
 * Manual forms and confirmed AI proposals both call `runOp`, so validation, reminders and
 * audit logging are identical regardless of source. AI code never imports services directly;
 * it can only produce *proposals* naming an op from this registry, and `runOp` is invoked for
 * them exclusively by the confirm endpoint after the owner presses Confirm.
 */
import { z } from "zod";
import type { Ctx } from "../audit";

export type OpDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  module: string;
  label: string;
  /** May the AI propose this op? (Deletes and security ops are never AI-proposable.) */
  aiAllowed: boolean;
  schema: S;
  /** Fields that may be missing in a draft ("Fill details later"). */
  draftable?: string[];
  summarize: (input: z.infer<S>) => string;
  run: (ctx: Ctx, input: z.infer<S>) => Promise<{ id: string | null; message: string }>;
};

const registry = new Map<string, OpDef>();

export function defineOp<S extends z.ZodTypeAny>(def: OpDef<S>): OpDef<S> {
  if (registry.has(def.name)) throw new Error(`Duplicate op ${def.name}`);
  registry.set(def.name, def as unknown as OpDef);
  return def;
}

export function getOp(name: string): OpDef | undefined {
  return registry.get(name);
}

export function allOps(): OpDef[] {
  return [...registry.values()];
}

/* shared field schemas */
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
export const zAmount = z.string().regex(/^\d+(\.\d{1,3})?$/, "Enter a positive amount like 150 or 150.50");
export const zCurrency = z.string().regex(/^[A-Z]{3}$/).default("SAR");
export const zId = z.string().uuid();
export const zText = (max = 500) => z.string().trim().min(1).max(max);
export const zOptText = (max = 2000) => z.string().trim().max(max).optional().nullable()
  .transform((v) => (v ? v : null));
