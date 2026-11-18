import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError, assertSameOrigin } from "./auth/core";
import { UserError } from "./audit";

/** Wrap a JSON route: same-origin check for mutations, consistent errors, no stack/secret leakage. */
export async function json(handler: () => Promise<unknown>, opts: { mutation?: boolean } = { mutation: true }) {
  try {
    if (opts.mutation !== false) await assertSameOrigin();
    const data = await handler();
    return NextResponse.json(data ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof UserError) return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
    console.error("[api] unexpected error:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
  }
}
