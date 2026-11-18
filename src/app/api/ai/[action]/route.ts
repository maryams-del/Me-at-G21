import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, rateLimit } from "@/server/auth/core";
import { interpret, correct, confirm, cancel, loadPreview, searchDirect, choose } from "@/server/ai/service";
import { json } from "@/server/http";
import { AuthError } from "@/server/auth/core";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const body = await req.json().catch(() => ({}));
  return json(async () => {
    const s = await requireUser();
    const owner = { id: s.user.id, timezone: s.user.timezone, defaultCurrency: s.user.defaultCurrency };
    if (["capture", "correct", "search"].includes(action) && !(await rateLimit(`ai:${s.user.id}`, 60, 3600))) throw new AuthError(429, "AI rate limit reached. Try again later or use the forms.");
    switch (action) {
      case "capture": {
        const { text, mode } = z.object({ text: z.string().min(1).max(2000), mode: z.enum(["text", "voice"]).default("text") }).parse(body);
        return interpret(owner, text, mode);
      }
      case "correct": {
        const { proposalId, text } = z.object({ proposalId: z.string().uuid(), text: z.string().min(1).max(1000) }).parse(body);
        return { kind: "proposal", proposal: await correct(owner, proposalId, text) };
      }
      case "choose": {
        const { proposalId, position, field, value } = z.object({ proposalId: z.string().uuid(), position: z.number().int().min(0).max(20), field: z.string().regex(/^[a-zA-Z]{1,40}$/), value: z.string().max(10) }).parse(body);
        return { kind: "proposal", proposal: await choose(s.user, proposalId, position, field, value) };
      }
      case "confirm": {
        const { proposalId, version, selections } = z.object({
          proposalId: z.string().uuid(), version: z.number().int().min(1),
          selections: z.array(z.object({ position: z.number().int().min(0), mode: z.enum(["apply", "draft", "skip"]) })).min(1).max(20),
        }).parse(body);
        return confirm(owner, proposalId, version, selections);
      }
      case "cancel": {
        const { proposalId } = z.object({ proposalId: z.string().uuid() }).parse(body);
        return cancel(s.user.id, proposalId);
      }
      case "get": {
        const { proposalId } = z.object({ proposalId: z.string().uuid() }).parse(body);
        return loadPreview(s.user.id, proposalId);
      }
      case "search": {
        const { text } = z.object({ text: z.string().min(1).max(500) }).parse(body);
        return searchDirect(owner, text);
      }
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  });
}
