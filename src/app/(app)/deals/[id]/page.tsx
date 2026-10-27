import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageContext } from "@/server/web/context";
import { getDealDetail } from "@/server/queries/deal-detail";
import { listContactsForCompany, listOwnerOptions } from "@/server/queries/directory";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/notice";
import { readFlash } from "@/server/web/flash";
import { ActionForm } from "@/components/action-form";
import { TextField, SelectField, TextAreaField } from "@/components/fields";
import {
  updateDealAction, logActivityAction, createTaskAction, correctActivityAction,
  completeTaskFormAction, moveDealFormAction, setDealArchivedAction,
} from "@/app/(app)/deals/actions";
import { canReopen, canReassign } from "@/server/authz/policy";
import { isUuid } from "@/server/security/guards";
import { formatDate, formatDateTime } from "@/components/format";
import { formatEuro } from "@/server/domain/metrics";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: "Deal" };
export const dynamic = "force-dynamic";

export default async function DealDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { principal, locale, tag } = await pageContext(`/deals/${id}`);
  if (!isUuid(id)) notFound();
  const deal = await getDealDetail(principal, id);
  if (!deal) notFound();
  const flash = readFlash(sp, locale);
  const d = deal.deal;
  const archived = Boolean(d.archivedAt);
  const isClosed = deal.stageKind !== "open";
  const owners = canReassign(principal) ? (await listOwnerOptions()).map((o) => ({ value: o.id, label: o.name })) : null;
  const contacts = (await listContactsForCompany(principal, d.companyId)).map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`.trim() }));
  const stageOptions = deal.stageNames.map((s) => ({ value: s.id, label: s.name }));
  const openTasks = deal.tasks.filter((x) => x.status === "open");
  const doneTasks = deal.tasks.filter((x) => x.status === "completed");
  const correctedIds = new Set(deal.timeline.map((a) => a.correctsActivityId).filter(Boolean) as string[]);
  const captureDisabled = deal.emailCaptureStatus !== "ready";

  return (
    <main id="main" className="page">
      <PageHeader
        title={d.title}
        intro={[deal.companyName, deal.contact?.name, `${t(locale, "deal.owner")}: ${deal.ownerName}`].filter(Boolean).join(" · ")}
        actions={
          <>
            <span className={`pill ${deal.stageKind}`}>{deal.stageName}</span>
            <Link className="btn secondary" href="/pipeline">{t(locale, "nav.pipeline")}</Link>
          </>
        }
      />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}
      {archived && <Notice kind="info">{t(locale, "deal.archivedOk")}</Notice>}
      {!deal.companyVisible && <Notice kind="info">{t(locale, "deal.restricted")}</Notice>}

      <div className="grid grid-2">
        <div className="stack">
          <section className="card" aria-labelledby="summary-title">
            <h2 id="summary-title">{t(locale, "deal.value")}</h2>
            <dl className="small-text" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
              <dt className="muted">{t(locale, "deal.value")}</dt><dd style={{ margin: 0, fontWeight: 700 }}>{formatEuro(d.amountCents, tag)}</dd>
              <dt className="muted">{t(locale, "deal.inStageSince")}</dt>
              <dd style={{ margin: 0 }}>{formatDate(d.stageEnteredAt.toISOString().slice(0, 10), tag)}</dd>
              <dt className="muted">{t(locale, "deal.expectedClose")}</dt><dd style={{ margin: 0 }}>{formatDate(d.expectedCloseOn, tag)}</dd>
              {isClosed && d.closedAt && (<><dt className="muted">{t(locale, "deal.closed")}</dt><dd style={{ margin: 0 }}>{formatDateTime(d.closedAt, tag)}</dd></>)}
            </dl>

            {deal.canMutate && !archived && (
              <form action={moveDealFormAction} className="stack" style={{ marginTop: 16 }} aria-label={t(locale, "deal.moveStage")}>
                <input type="hidden" name="dealId" value={d.id} />
                <input type="hidden" name="version" value={d.version} />
                <input type="hidden" name="next" value={`/deals/${d.id}`} />
                <div className="inline-form">
                  <label htmlFor="stage-select" className="sr-only">{t(locale, "deal.moveStage")}</label>
                  <select id="stage-select" name="stageId" defaultValue={d.stageId} style={{ flex: "1 1 200px" }}>
                    {stageOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button type="submit" className="btn secondary">{t(locale, "deal.move")}</button>
                </div>
                {isClosed && canReopen(principal) && (
                  <div className="field">
                    <label htmlFor="reopen-reason">{t(locale, "deal.reopenReason")}</label>
                    <span className="hint">{t(locale, "deal.reopenHelp")}</span>
                    <input id="reopen-reason" name="reason" type="text" maxLength={500} />
                  </div>
                )}
              </form>
            )}
          </section>

          {deal.canMutate && !archived && (
            <section className="card" aria-labelledby="edit-title">
              <h2 id="edit-title">{t(locale, "common.edit")}</h2>
              <ActionForm action={updateDealAction.bind(null, d.id)} ariaLabel={t(locale, "common.edit")} className="form-grid" onSuccess="refresh">
                <input type="hidden" name="version" value={d.version} />
                <TextField name="title" label={t(locale, "deal.title")} required defaultValue={d.title} maxLength={200} />
                <div className="form-grid two">
                  <TextField name="amount" label={t(locale, "deal.amount")} inputMode="decimal" defaultValue={(d.amountCents / 100).toFixed(2)} />
                  <TextField name="expectedCloseOn" label={t(locale, "deal.expectedClose")} type="date" defaultValue={d.expectedCloseOn} />
                </div>
                <SelectField name="primaryContactId" label={t(locale, "deal.contact")} options={contacts} defaultValue={d.primaryContactId ?? ""} emptyLabel={t(locale, "deal.noContact")} />
                {owners && <SelectField name="ownerId" label={t(locale, "deal.owner")} options={owners} defaultValue={d.ownerId} />}
                <div className="actions"><button type="submit" className="btn">{t(locale, "common.save")}</button></div>
              </ActionForm>
            </section>
          )}

          <section className="card" aria-labelledby="log-title">
            <h2 id="log-title">{t(locale, "deal.logActivity")}</h2>
            {deal.canMutate && !archived ? (
              <ActionForm action={logActivityAction.bind(null, d.id)} ariaLabel={t(locale, "deal.logActivity")} className="form-grid" resetOnSuccess onSuccess="refresh">
                <div className="form-grid two">
                  <SelectField name="kind" label={t(locale, "deal.kind")} defaultValue="call" options={[
                    { value: "call", label: t(locale, "deal.kind.call") },
                    { value: "note", label: t(locale, "deal.kind.note") },
                    { value: "email", label: t(locale, "deal.kind.email") },
                  ]} />
                  <TextField name="occurredLocal" label={t(locale, "deal.occurred")} type="datetime-local" hint={t(locale, "deal.occurredHelp")} />
                </div>
                <TextAreaField name="body" label={t(locale, "deal.body")} required rows={4} maxLength={5000} />
                <div className="actions"><button type="submit" className="btn">{t(locale, "deal.logActivity")}</button></div>
              </ActionForm>
            ) : (
              <p className="muted">{t(locale, "forbidden.body")}</p>
            )}
          </section>

          <section className="card" aria-labelledby="timeline-title">
            <h2 id="timeline-title">{t(locale, "deal.timeline")}</h2>
            <p className="muted small-text">{t(locale, "deal.timelineHelp")}</p>
            {deal.timeline.length === 0 ? (
              <p className="muted">{t(locale, "deal.timelineEmpty")}</p>
            ) : (
              <ul className="timeline">
                {deal.timeline.map((a) => {
                  const isCorrection = a.kind === "correction";
                  const isStage = a.kind === "stage_change";
                  return (
                    <li key={a.id} className={a.kind}>
                      <div className="meta">
                        <span>{t(locale, `activity.kind.${a.kind}` as MessageKey)}</span>
                        {" · "}
                        <time dateTime={new Date(a.occurredAt).toISOString()}>{formatDateTime(a.occurredAt, tag)}</time>
                        {a.actorName ? ` · ${a.actorName}` : ""}
                        {a.source === "bcc" ? ` · ${t(locale, "email.title")}` : ""}
                        {correctedIds.has(a.id) ? ` · ${t(locale, "deal.correctedBadge")}` : ""}
                      </div>
                      {isStage && a.fromStageId && a.toStageId && (
                        <div className="body">
                          {stageName(deal.stageNames, a.fromStageId)} → {stageName(deal.stageNames, a.toStageId)}
                          {a.body ? ` — ${a.body}` : ""}
                        </div>
                      )}
                      {isCorrection && (
                        <>
                          <div className="body">{a.body}</div>
                          <div className="original">
                            <strong>{t(locale, "deal.originalValue")}:</strong>
                            <div>{a.originalBody}</div>
                            <div className="meta">{t(locale, "deal.correctionReason")}: {a.correctionReason}</div>
                          </div>
                        </>
                      )}
                      {!isCorrection && !isStage && a.kind !== "system" && a.kind !== "merge" && <div className="body">{a.body}</div>}
                      {a.kind === "system" && <div className="body muted">{t(locale, "deal.timelineHelp")}</div>}
                      {!isCorrection && !isStage && !correctedIds.has(a.id) && deal.canMutate && !archived && ["note", "call", "email"].includes(a.kind) && (
                        <details style={{ marginTop: 6 }}>
                          <summary className="btn ghost small" style={{ display: "inline-flex", cursor: "pointer" }}>
                            {t(locale, "deal.correct")}
                          </summary>
                          <div className="card" style={{ marginTop: 8 }}>
                            <h3>{t(locale, "deal.correctTitle")}</h3>
                            <ActionForm action={correctActivityAction.bind(null, d.id)} ariaLabel={t(locale, "deal.correctTitle")} className="form-grid" onSuccess="refresh">
                              <input type="hidden" name="activityId" value={a.id} />
                              <TextAreaField name="newBody" label={t(locale, "deal.body")} defaultValue={a.body} required rows={3} maxLength={5000} />
                              <TextField name="reason" label={t(locale, "deal.correctionReason")} required maxLength={300} />
                              <div className="actions"><button type="submit" className="btn small">{t(locale, "common.save")}</button></div>
                            </ActionForm>
                          </div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="tasks-title">
            <h2 id="tasks-title">{t(locale, "deal.tasks")}</h2>
            <h3>{t(locale, "deal.openTasks")}</h3>
            {openTasks.length === 0 ? <p className="muted small-text">{t(locale, "deal.noTasks")}</p> : (
              <ul className="list">
                {openTasks.map((task) => {
                  const overdue = new Date(task.dueAt).getTime() < Date.now();
                  return (
                    <li key={task.id}>
                      <div className="row">
                        <div>
                          <div className="title">{task.title}</div>
                          <div className="meta">
                            <span>{t(locale, "tasks.due", { date: formatDate(task.dueOn, tag) })}</span>
                            {overdue && <span className="pill overdue">{t(locale, "tasks.overdueTag")}</span>}
                          </div>
                        </div>
                        {deal.canMutate && (
                          <form action={completeTaskFormAction}>
                            <input type="hidden" name="taskId" value={task.id} />
                            <input type="hidden" name="next" value={`/deals/${d.id}`} />
                            <button type="submit" className="btn secondary small">{t(locale, "deal.complete")}</button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {doneTasks.length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>{t(locale, "deal.doneTasks")}</h3>
                <ul className="list">
                  {doneTasks.map((task) => (
                    <li key={task.id} className="muted">{task.title}</li>
                  ))}
                </ul>
              </>
            )}
            {deal.canMutate && !archived && (
              <details style={{ marginTop: 12 }}>
                <summary className="btn secondary" style={{ display: "inline-flex", cursor: "pointer" }}>{t(locale, "deal.addTask")}</summary>
                <div style={{ marginTop: 10 }}>
                  <ActionForm action={createTaskAction.bind(null, d.id)} ariaLabel={t(locale, "deal.addTask")} className="form-grid" resetOnSuccess onSuccess="refresh">
                    <TextField name="title" label={t(locale, "deal.taskTitle")} required maxLength={200} />
                    <TextField name="dueOn" label={t(locale, "deal.taskDue")} type="date" required />
                    <div className="actions"><button type="submit" className="btn">{t(locale, "deal.addTask")}</button></div>
                  </ActionForm>
                </div>
              </details>
            )}
          </section>

          <section className="card" aria-labelledby="capture-title">
            <h2 id="capture-title">{t(locale, "deal.emailCapture")}</h2>
            <p className="small-text muted">{t(locale, "deal.bccHelp")}</p>
            <p><code style={{ overflowWrap: "anywhere" }}>{deal.bccAddress}</code></p>
            {captureDisabled ? (
              <Notice kind="info">{t(locale, "deal.captureNoContact")}</Notice>
            ) : deal.captured.length === 0 ? (
              <p className="muted small-text">{t(locale, "deal.noCapture")}</p>
            ) : (
              <p className="small-text">{t(locale, "deal.captured", { count: deal.captured.length, date: formatDateTime(deal.captured[0]!.receivedAt, tag) })}</p>
            )}
          </section>

          {deal.canMutate && (
            <section className="card" aria-labelledby="archive-title">
              <h2 id="archive-title">{archived ? t(locale, "deal.restoreDeal") : t(locale, "deal.archive")}</h2>
              <form action={setDealArchivedAction}>
                <input type="hidden" name="dealId" value={d.id} />
                <input type="hidden" name="archive" value={archived ? "0" : "1"} />
                <button type="submit" className="btn secondary" disabled={archived && !canReopen(principal)}>
                  {archived ? t(locale, "deal.restoreDeal") : t(locale, "deal.archive")}
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function stageName(stages: Array<{ id: string; name: string }>, id: string) {
  return stages.find((s) => s.id === id)?.name ?? "";
}
