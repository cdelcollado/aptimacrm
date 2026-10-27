"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moveDealClientAction, moveDealFormAction } from "@/app/(app)/deals/actions";
import type { ActionResult } from "@/server/web/action-result";

export interface BoardCardView {
  id: string;
  title: string;
  amount: string;
  version: number;
  stageId: string;
  ownerName: string;
  companyName: string;
  nextTask: string | null;
  nextTaskOverdue: boolean;
  overdueLabel: string;
}

export interface BoardColumnView {
  id: string;
  name: string;
  total: string;
  cards: BoardCardView[];
}

export interface BoardLabels {
  dropHere: string;
  dragHint: string;
  moveTo: string;
  moveButton: string;
  moving: string;
  nextTask: string;
  emptyStage: string;
  stageLabel: string;
  moved: string;
  failed: string;
  unchanged: string;
  conflict: string;
  stageOptions: Array<{ id: string; name: string }>;
  openDeal: string;
}

/**
 * Pipeline board. Drag-and-drop is an enhancement: every card also has a stage select and button
 * that submit a plain form, so the move works from the keyboard and without JavaScript.
 */
export function PipelineBoard(props: { columns: BoardColumnView[]; labels: BoardLabels }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragging = useRef<{ dealId: string; version: number; fromStageId: string } | null>(null);
  const { labels } = props;

  function onDragStart(e: DragEvent<HTMLElement>, card: BoardCardView) {
    dragging.current = { dealId: card.id, version: card.version, fromStageId: card.stageId };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.id);
  }

  function onDrop(e: DragEvent<HTMLElement>, stageId: string, stageName: string) {
    e.preventDefault();
    setDragOver(null);
    const info = dragging.current;
    dragging.current = null;
    if (!info || info.fromStageId === stageId) return;
    const fd = new FormData();
    fd.set("dealId", info.dealId);
    fd.set("stageId", stageId);
    fd.set("version", String(info.version));
    startTransition(async () => {
      const result: ActionResult = await moveDealClientAction(fd);
      setAnnounce({
        ok: result.ok,
        text: result.ok ? labels.moved.replace("{stage}", stageName) : labels.failed.replace("{reason}", result.message),
      });
      router.refresh();
    });
  }

  return (
    <>
      <p className="muted small-text" id="board-hint">{labels.dragHint}</p>
      <div role="status" aria-live="polite" className={announce ? (announce.ok ? "notice ok" : "notice error") : "sr-only"} style={announce ? { marginBottom: 12 } : undefined}>
        {announce ? announce.text : ""}
      </div>
      <div className="board" aria-describedby="board-hint" aria-busy={pending || undefined}>
        {props.columns.map((col) => (
          <section
            key={col.id}
            aria-label={`${col.name}, ${col.total}`}
            className={`stage-col${dragOver === col.id ? " drop-target" : ""}`}
            onDragOver={(e) => {
              if (dragging.current) {
                e.preventDefault();
                setDragOver(col.id);
              }
            }}
            onDragLeave={() => setDragOver((cur) => (cur === col.id ? null : cur))}
            onDrop={(e) => onDrop(e, col.id, col.name)}
          >
            <h2>
              <span>{col.name}</span>
              <span className="total">{col.total}</span>
            </h2>
            {dragOver === col.id && <p className="small-text" style={{ margin: 0 }}>{labels.dropHere.replace("{stage}", col.name)}</p>}
            {col.cards.length === 0 && <p className="muted small-text" style={{ margin: 0 }}>{labels.emptyStage}</p>}
            {col.cards.map((card) => (
              <article
                key={card.id}
                className={`deal-card${dragging.current?.dealId === card.id ? " dragging" : ""}`}
                draggable
                onDragStart={(e) => onDragStart(e, card)}
                onDragEnd={() => setDragOver(null)}
              >
                <Link className="title" href={`/deals/${card.id}`}>{card.title}</Link>
                <span className="amount">{card.amount}</span>
                <span className="meta">{card.companyName} · {card.ownerName}</span>
                {card.nextTask && (
                  <span className="meta">
                    {labels.nextTask}: {card.nextTask}
                    {card.nextTaskOverdue && <span className="pill overdue" style={{ marginLeft: 6 }}>{card.overdueLabel}</span>}
                  </span>
                )}
                <form action={moveDealFormAction} aria-label={`${labels.moveTo} · ${card.title}`}>
                  <input type="hidden" name="dealId" value={card.id} />
                  <input type="hidden" name="version" value={card.version} />
                  <input type="hidden" name="next" value="/pipeline" />
                  <label htmlFor={`move-${card.id}`} className="sr-only">{labels.moveTo}</label>
                  <select id={`move-${card.id}`} name="stageId" defaultValue={card.stageId}>
                    {labels.stageOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <button type="submit" className="btn secondary">{labels.moveButton}</button>
                </form>
              </article>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
