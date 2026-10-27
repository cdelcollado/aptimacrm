import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/server/web/context";
import { listOverdueTasks } from "@/server/queries/directory";
import { PageHeader, EmptyState } from "@/components/page-header";
import { completeTaskFormAction } from "@/app/(app)/deals/actions";
import { readFlash } from "@/server/web/flash";
import { Notice } from "@/components/notice";
import { formatDate } from "@/components/format";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

export default async function TasksPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await props.searchParams;
  const { principal, locale, tag } = await pageContext("/tasks");
  const filter = sp.filter === "open" || sp.filter === "completed" ? sp.filter : "overdue";
  const flash = readFlash(sp, locale);
  const rows = await listOverdueTasks(principal, filter);
  const now = Date.now();

  const tabs = [
    { key: "overdue", label: t(locale, "tasks.overdue") },
    { key: "open", label: t(locale, "tasks.open") },
    { key: "completed", label: t(locale, "tasks.completed") },
  ];

  return (
    <main id="main" className="page">
      <PageHeader title={t(locale, "tasks.title")} intro={t(locale, "tasks.intro")} />
      {flash && <Notice kind={flash.kind === "ok" ? "ok" : "error"}>{flash.text}</Notice>}

      <nav aria-label={t(locale, "tasks.title")} className="actions" style={{ marginBottom: 16 }}>
        {tabs.map((tab) => (
          <Link key={tab.key} href={`/tasks?filter=${tab.key}`} className={`btn ${filter === tab.key ? "" : "secondary"}`} aria-current={filter === tab.key ? "page" : undefined}>
            {tab.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title={t(locale, "tasks.empty")} />
      ) : (
        <div className="card card-flush">
          <ul className="list">
            {rows.map((task) => {
              const overdue = task.status === "open" && new Date(task.dueAt).getTime() < now;
              return (
                <li key={task.id}>
                  <div className="row">
                    <div>
                      <div className="title">{task.title}</div>
                      <div className="meta">
                        <span>{t(locale, "tasks.due", { date: formatDate(task.dueOn, tag) })}</span>
                        {overdue && <span className="pill overdue">{t(locale, "tasks.overdueTag")}</span>}
                        {task.dealId && <Link href={`/deals/${task.dealId}`}>{task.dealTitle}</Link>}
                        <span>{t(locale, "common.owner")}: {task.ownerName}</span>
                      </div>
                    </div>
                    {task.status === "open" && (
                      <form action={completeTaskFormAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="next" value={`/tasks?filter=${filter}`} />
                        <button type="submit" className="btn secondary small">{t(locale, "deal.complete")}</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
