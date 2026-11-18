import { z } from "zod";
import { requireUser } from "@/server/auth/core";
import { uploadDocumentFile } from "@/server/documents";
import { json } from "@/server/http";
import { UserError } from "@/server/audit";

export const maxDuration = 30;

export async function POST(req: Request) {
  return json(async () => {
    const s = await requireUser();
    const form = await req.formData().catch(() => null);
    if (!form) throw new UserError("Upload failed — no file received");
    const documentId = z.string().uuid().parse(form.get("documentId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a file to upload");
    const res = await uploadDocumentFile(s.user.id, documentId, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return { ok: true, message: `Uploaded (version ${res.version})`, ...res };
  });
}
