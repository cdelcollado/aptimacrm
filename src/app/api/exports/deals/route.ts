import { NextResponse } from "next/server";
import { resolveSession } from "@/server/auth/session";
import { dealSnapshotCsv } from "@/server/queries/exports";
import { newRequestId, logger } from "@/server/log/logger";

export const runtime = "nodejs";

/** Deal pipeline snapshot. Managers and admins only. Honours the board filters. Audited per request. */
export async function GET(request: Request) {
  const requestId = newRequestId();
  const session = await resolveSession();
  if (session.status !== "ok") return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  const url = new URL(request.url);
  const result = await dealSnapshotCsv(
    session.principal,
    { ownerId: url.searchParams.get("owner"), stageId: url.searchParams.get("stage"), status: url.searchParams.get("status") },
    requestId,
  );
  if (!result) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "x-request-id": requestId } });
  logger.info("export.deals", { rows: result.rows, requestId });
  return csvResponse(result.csv, result.filename, requestId);
}

export function csvResponse(body: string, filename: string, requestId: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
