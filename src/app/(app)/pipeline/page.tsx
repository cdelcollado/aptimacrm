import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/server/web/context";
import { getBoard, ownerOptions } from "@/server/queries/pipeline";
import { PageHeader, EmptyState } from "@/components/page-header";
import { PipelineBoard, type BoardColumnView } from "@/components/pipeline-board";
import { readFlash } from "@/server/web/flash";
import { Notice } from "@/components/notice";
import { formatDateTime } from "@/components/format";
import { formatEuro } from "@/server/domain/metrics";
import { isManagerOrAdmin } from "@/server/authz/policy";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await props.searchParams;
  const { principal, locale, tag } = await pageContext("/pipeline");
  const owner = typeof sp.owner === "string" && sp.owner ? sp.owner : null;
  const overdueOnly = sp.overdue === "1";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 120) : "";
  const flash = readFlash(sp, locale);

  const board = await getBoard(principal, { ownerId: owner, overdueOnly, q });
  const owners = isManagerOrAdmin(principal) ? await ownerOptions() : [];

  const columns: BoardColumnView[] = board.stages
    .filter((s) => s.kind === "open")
    .map((s) => ({
      id: s.id,
      name: s.name,
      total: t(locale, "pipeline.total", { count: s.total.count, value: formatEuro(s.total.valueCents, tag) }),
      cards: s.cards.map((c) => ({
        id: c.id,
        title: c.title,
        amount: formatEuro(c.amountCents, tag),
        version: c.version,
        stageId: c.stageId,
        ownerName: c.ownerName,
        companyName: c.companyRestricted ? t(locale, "deal.restrictedCompany") : c.companyName,
        nextTask: c.nextTaskDueOn ? formatDateTime(`${c.nextTaskDueOn}T12:00:00Z`, tag) : null,
        nextTaskOverdue: c.nextTaskOverdue,
        overdueLabel: t(locale, "pipeline.overdue"),
      })),
    }));

  const stageOptions = board.stages.map((s) => ({ id: s.id, name: s.name }));
  const anyOpen = board.openCount > 0;

  return (
    <main id="main" className="page">
      <PageHeader
        title={t(locale, "pipeline.title")}
        intro={t(locale, "pipeline.intro")}
        actions={
          <>
            {isManagerOrAdmin(principal) && (
              <a className="btn secondary" href={`/api/exports/deals?${new URLSearchParams({ ...(owner ? { owner } : {}) }).toString()}`}>
                {t(locale, "pipeline.exportSnapshot")}
              </a>
            )}
            <Link className="btn" href={`/deals/new`}>{t(locale, "pipeline.newDeal")}</Link>
          </>
        }
      />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}

      <form className="filters" method="get" role="search" aria-label={t(locale, "pipeline.apply")} style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="q">{t(locale, "pipeline.search")}</label>
          <input id="q" name="q" type="search" defaultValue={q} />
        </div>
        {owners.length > 0 && (
          <div className="field">
            <label htmlFor="owner">{t(locale, "pipeline.ownerFilter")}</label>
            <select id="owner" name="owner" defaultValue={owner ?? ""}>
              <option value="">{t(locale, "common.all")}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
        <label className="inline-form" style={{ minHeight: 44 }}>
          <input type="checkbox" name="overdue" value="1" defaultChecked={overdueOnly} style={{ width: 20, height: 20, minHeight: 0 }} />
          <span>{t(locale, "pipeline.overdueOnly")}</span>
        </label>
        <button type="submit" className="btn secondary">{t(locale, "pipeline.apply")}</button>
      </form>

      <p className="small-text" aria-live="off">
        <strong>{t(locale, "pipeline.openValue")}: {formatEuro(board.openValueCents, tag)}</strong>
      </p>

      {!anyOpen && !q && !owner && !overdueOnly ? (
        <EmptyState title={t(locale, "common.noneYet")}>
          <p className="muted">{t(locale, "pipeline.emptyAll")}</p>
          <p><Link className="btn" href="/companies">{t(locale, "nav.companies")}</Link></p>
        </EmptyState>
      ) : (
        <PipelineBoard
          columns={columns}
          labels={{
            dropHere: t(locale, "pipeline.droppedHere", { stage: "{stage}" }),
            dragHint: t(locale, "pipeline.dragHint"),
            moveTo: t(locale, "deal.moveStage"),
            moveButton: t(locale, "deal.move"),
            moving: t(locale, "pipeline.moving"),
            nextTask: t(locale, "pipeline.nextTask"),
            emptyStage: t(locale, "pipeline.empty"),
            stageLabel: t(locale, "deal.stage"),
            moved: t(locale, "pipeline.moved", { stage: "{stage}" }),
            failed: t(locale, "pipeline.moveFailed", { reason: "{reason}" }),
            unchanged: t(locale, "deal.stageUnchanged"),
            conflict: t(locale, "deal.conflict"),
            stageOptions,
            openDeal: t(locale, "nav.pipeline" as MessageKey),
          }}
        />
      )}
    </main>
  );
}
