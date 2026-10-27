
import { NextResponse } from "next/server";
import { resolveSession } from "@/server/auth/session";
import { fullExportCsv, type ExportKind } from "@/server/queries/exports";
import { newRequestId, logger } from "@/server/log/logger";
import { csvResponse } from "@/app/api/exports/deals/route";

export const runtime = "nodejs";

const KINDS: readonly ExportKind[] = ["contacts", "companies", "deals", "activities"];

/** Full CRM export. Admins only; every download is written to the audit log by the query layer. */
export async function GET(request: Request) {
  const requestId = newRequestId();
  const session = await resolveSession();
  if (session.status !== "ok") return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  const kind = new URL(request.url).searchParams.get("kind") as ExportKind | null;
  if (!kind || !KINDS.includes(kind)) return NextResponse.json({ error: "invalid_kind" }, { status: 400, headers: { "x-request-id": requestId } });
  const result = await fullExportCsv(session.principal, kind, requestId);
  if (!result) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "x-request-id": requestId } });
  logger.info("export.full", { kind, rows: result.rows, requestId });
  return csvResponse(result.csv, result.filename, requestId);
}

