import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageContext } from "@/server/web/context";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/notice";
import { readFlash } from "@/server/web/flash";
import { canManageStages } from "@/server/authz/policy";
import { loadStages } from "@/server/queries/dashboard";
import { saveStagesAction, moveStageAction, addStageAction, deleteStageAction } from "@/app/(app)/admin/actions";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const EXPORTS = ["contacts", "companies", "deals", "activities"] as const;

export default async function AdminPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await props.searchParams;
  const { principal, locale } = await pageContext("/admin");
  if (!canManageStages(principal)) notFound();
  const flash = readFlash(sp, locale);
  const stages = await loadStages();

  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "admin.title")} intro={t(locale, "admin.intro")} />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}

      <section className="card" aria-labelledby="stages-title" style={{ marginBottom: 16 }}>
        <h2 id="stages-title">{t(locale, "admin.stages")}</h2>
        <p className="muted small-text">{t(locale, "admin.stagesHelp")}</p>
        <form action={saveStagesAction} className="stack" aria-label={t(locale, "admin.stages")}>
          <ul className="list">
            {stages.map((s, index) => (
              <li key={s.id}>
                <input type="hidden" name="stageId" value={s.id} />
                <div className="form-grid two">
                  <div className="field">
                    <label htmlFor={`name_${s.id}`}>{t(locale, "admin.stageName")}</label>
                    <input id={`name_${s.id}`} name={`name_${s.id}`} type="text" defaultValue={s.name} maxLength={60} required />
                  </div>
                  <div className="field">
                    <label htmlFor={`kind_${s.id}`}>{t(locale, "admin.stageKind")}</label>
                    <select id={`kind_${s.id}`} name={`kind_${s.id}`} defaultValue={s.kind}>
                      <option value="open">{t(locale, "admin.kind.open")}</option>
                      <option value="won">{t(locale, "admin.kind.won")}</option>
                      <option value="lost">{t(locale, "admin.kind.lost")}</option>
                    </select>
                  </div>
                </div>
                <div className="inline-form" style={{ marginTop: 8 }}>
                  <span className="muted small-text">#{index + 1}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="submit" className="btn">{t(locale, "common.save")}</button>
          </div>
        </form>

        <div className="actions" style={{ marginTop: 16 }}>
          {stages.map((s, index) => (
            <span key={`mv-${s.id}`} className="inline-form">
              <span className="small-text">{s.name}</span>
              <form action={moveStageAction}>
                <input type="hidden" name="stageId" value={s.id} />
                <input type="hidden" name="direction" value="up" />
                <button type="submit" className="btn secondary small" disabled={index === 0} aria-label={`${t(locale, "admin.moveUp")}: ${s.name}`}>↑</button>
              </form>
              <form action={moveStageAction}>
                <input type="hidden" name="stageId" value={s.id} />
                <input type="hidden" name="direction" value="down" />
                <button type="submit" className="btn secondary small" disabled={index === stages.length - 1} aria-label={`${t(locale, "admin.moveDown")}: ${s.name}`}>↓</button>
              </form>
              <form action={deleteStageAction}>
                <input type="hidden" name="stageId" value={s.id} />
                <button type="submit" className="btn secondary small">{t(locale, "admin.delete")}: {s.name}</button>
              </form>
            </span>
          ))}
        </div>

        <form action={addStageAction} className="form-grid two" style={{ marginTop: 16 }} aria-label={t(locale, "admin.addStage")}>
          <div className="field">
            <label htmlFor="new-name">{t(locale, "admin.stageName")}</label>
            <input id="new-name" name="name" type="text" maxLength={60} required />
          </div>
          <div className="field">
            <label htmlFor="new-kind">{t(locale, "admin.stageKind")}</label>
            <select id="new-kind" name="kind" defaultValue="open">
              <option value="open">{t(locale, "admin.kind.open")}</option>
              <option value="won">{t(locale, "admin.kind.won")}</option>
              <option value="lost">{t(locale, "admin.kind.lost")}</option>
            </select>
          </div>
          <div className="actions"><button type="submit" className="btn secondary">{t(locale, "admin.addStage")}</button></div>
        </form>
      </section>

      <section className="card" aria-labelledby="exports-title">
        <h2 id="exports-title">{t(locale, "admin.exports")}</h2>
        <p className="muted small-text">{t(locale, "admin.exportsHelp")}</p>
        <ul className="actions" style={{ listStyle: "none", padding: 0 }}>
          {EXPORTS.map((kind) => (
            <li key={kind}>
              <a className="btn secondary" href={`/api/exports/full?kind=${kind}`}>
                {t(locale, `admin.export${kind[0]!.toUpperCase()}${kind.slice(1)}` as MessageKey)}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
