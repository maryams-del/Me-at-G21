import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { pageOwner } from "@/server/queries";
import { getDb } from "@/db";
import { documentFiles } from "@/db/schema";
import { Icon } from "@/components/icons";
import { ShareFile } from "@/app/(app)/admin/documents/DocClient";
import { ViewerBack } from "./ViewerBack";
import { ConfirmHost } from "@/components/ConfirmDialog";

/**
 * Opens one document file in its own tab. The file itself sits inside this page, so the tab carries
 * the site's name and logo (a bare PDF tab shows whatever icon the browser cached for the site).
 */
async function fileFor(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const o = await pageOwner();
  const [f] = await getDb().select({ id: documentFiles.id, documentId: documentFiles.documentId, filename: documentFiles.filename, contentType: documentFiles.contentType })
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
  // Back at the top; the file in the middle; download and share underneath.
  return (
    <main style={{ position: "fixed", inset: 0, display: "grid", gridTemplateRows: "auto 1fr auto", background: "var(--paper)", color: "var(--ink)" }}>
      <header className="flex items-center gap-2 px-3 py-2" style={{ paddingTop: "max(8px, env(safe-area-inset-top))", borderBottom: "1px solid var(--hair)" }}>
        <ViewerBack fallback={`/admin/documents/${f.documentId}`} />
        <span className="t-small font-semibold truncate min-w-0">{f.filename}</span>
      </header>
      <div style={{ minHeight: 0, display: "grid", placeItems: "center", overflow: "auto" }}>
        {f.contentType === "application/pdf"
          ? <iframe src={src} title={f.filename} style={{ width: "100%", height: "100%", border: 0 }} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={src} alt={f.filename} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
      </div>
      <footer className="flex items-center justify-center gap-2 px-3 py-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))", borderTop: "1px solid var(--hair)" }}>
        <a className="btn" href={`/api/documents/file/${f.id}`} download={f.filename}><Icon name="download" size={17} />Download</a>
        <ShareFile fileId={f.id} filename={f.filename} contentType={f.contentType} className="btn" />
      </footer>
      <ConfirmHost />
    </main>
  );
}
