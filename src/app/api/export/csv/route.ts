import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/server/auth/core";
import { CSV_MODULES, toCsv } from "@/server/csv";

/** GET ?module=<key>. The private period log also needs &private=1 (the page asks first). */
export async function GET(req: Request) {
  try {
    const s = await requireUser();
    const url = new URL(req.url);
    const mod = CSV_MODULES.find((x) => x.key === url.searchParams.get("module"));
    if (!mod) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
    if (mod.private && url.searchParams.get("private") !== "1") return NextResponse.json({ error: "Confirm to export private data" }, { status: 400 });
    const { header, rows } = await mod.build(s.user.id, s.user.timezone);
    return new NextResponse(toCsv(header, rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="me-at-g21-${mod.key}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[csv] export failed:", (e as Error).message);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
