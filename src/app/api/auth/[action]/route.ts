import { NextResponse } from "next/server";
import { authHandlers } from "@/server/auth/actions";
import { json } from "@/server/http";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const h = Object.hasOwn(authHandlers, action) ? authHandlers[action] : undefined;
  if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  return json(() => h(body));
}
