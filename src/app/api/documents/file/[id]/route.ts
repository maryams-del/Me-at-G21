import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/server/auth/core";
import { readDocumentFile } from "@/server/documents";
import { UserError } from "@/server/audit";

/** Authenticated, owner-checked download. There is no public or permanent URL for any file. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireUser();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { file, bytes } = await readDocumentFile(s.user.id, id);
    const inline = new URL(req.url).searchParams.get("view") === "1";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff", // only sniff-verified PDF/JPEG/PNG/HEIC/WebP are ever stored
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof UserError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[documents] download failed", (e as Error).message);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
