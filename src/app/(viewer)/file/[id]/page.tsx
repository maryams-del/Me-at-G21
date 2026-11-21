import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { pageOwner } from "@/server/queries";
import { getDb } from "@/db";
import { documentFiles } from "@/db/schema";

/**
 * Opens one document file in its own tab. The file itself sits inside this page, so the tab carries
 * the site's name and logo (a bare PDF tab shows whatever icon the browser cached for the site).
 */
async function fileFor(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const o = await pageOwner();
  const [f] = await getDb().select({ id: documentFiles.id, filename: documentFiles.filename, contentType: documentFiles.contentType })
    .from(documentFiles).where(and(eq(documentFiles.id, id), eq(documentFiles.ownerId, o.id), isNull(documentFiles.deletedAt)));
  return f ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const f = await fileFor((await params).id);
  return { title: f ? `${f.filename} · Me @ G21` : "Me @ G21" };
}

export default async function FileViewer({ params }: { params: Promise<{ id: string }> }) {
  const f = await fileFor((await params).id);
  if (!f) notFound();
  const src = `/api/documents/file/${f.id}?view=1`;
  return (
    <main style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "var(--paper)" }}>
      {f.contentType === "application/pdf"
        ? <iframe src={src} title={f.filename} style={{ width: "100%", height: "100%", border: 0 }} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={src} alt={f.filename} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
    </main>
  );
}
