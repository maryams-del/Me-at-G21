import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/core";
import { runOp } from "@/server/ops";
import { json } from "@/server/http";

/** Manual forms → validated op. Same code path the AI confirm step uses. */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = await req.json().catch(() => ({}));
  return json(async () => {
    const s = await requireUser();
    const res = await runOp(s.user.id, s.user.timezone, name, body);
    if (!res.ok) return NextResponse.json(res, { status: 400 });
    return res;
  });
}
