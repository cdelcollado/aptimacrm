import { NextResponse } from "next/server";
import { resolveSession } from "@/server/auth/session";
import { createImportFromUpload } from "@/server/domain/imports/service";
import { canImport } from "@/server/authz/policy";
import { MAX_BYTES } from "@/server/domain/imports/csv";
import { sameOrigin } from "@/server/web/origin";
import { newRequestId, logger } from "@/server/log/logger";
import { DomainError, ValidationError } from "@/server/errors";

export const runtime = "nodejs";

/** Multipart CSV upload. Session and Origin are checked before the body is read. */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const session = await resolveSession();
  if (session.status !== "ok") {
    return NextResponse.redirect(new URL("/sign-in?next=/imports", request.url), 303);
  }
  if (!sameOrigin(request) || !canImport(session.principal)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "x-request-id": requestId } });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 413, headers: { "x-request-id": requestId } });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File) || (kind !== "contacts" && kind !== "companies")) {
    return NextResponse.redirect(new URL("/imports?err=errors.invalid", request.url), 303);
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.redirect(new URL("/imports?err=errors.too_large", request.url), 303);
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { id } = await createImportFromUpload({
      principal: session.principal,
      kind,
      fileName: file.name,
      bytes,
      requestId,
    });
    return NextResponse.redirect(new URL(`/imports/${id}?ok=imports.uploaded`, request.url), 303);
  } catch (err) {
    if (err instanceof ValidationError) {
      const code = Object.values(err.fieldErrors)[0] ?? "invalid";
      return NextResponse.redirect(new URL(`/imports?err=errors.${code}`, request.url), 303);
    }
    if (err instanceof DomainError) {
      return NextResponse.redirect(new URL("/imports?err=errors.generic", request.url), 303);
    }
    logger.error("import.upload_failed", { requestId, message: err instanceof Error ? err.message : String(err) });
    return NextResponse.redirect(new URL("/imports?err=errors.generic", request.url), 303);
  }
}
