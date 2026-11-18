import { z } from "zod";
import { requireUser, hasFreshStepUp, AuthError, rateLimit } from "@/server/auth/core";
import { revealProtectedId } from "@/server/documents";
import { json } from "@/server/http";

/** Reveal a full ID number: requires a passkey check within the last 10 minutes. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return json(async () => {
    const s = await requireUser();
    if (!hasFreshStepUp(s)) throw new AuthError(403, "step_up_required");
    if (!(await rateLimit(`reveal:${s.user.id}`, 30, 3600))) throw new AuthError(429, "Too many reveals. Try again later.");
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(body);
    return { value: await revealProtectedId(s.user.id, documentId) };
  });
}
