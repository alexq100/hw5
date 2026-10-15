import { useEffect, useState } from "react";
import { AGENTS, AGENT_ORDER, STATUS_META, TICKET_TYPE } from "../agents";
import { duration } from "../format";
import type { RunView } from "../runModel";
import type { Ticket, TicketDetail as Detail } from "../types";
import ActivityLog from "./ActivityLog";
import AgentMap from "./AgentMap";
import Summary from "./Summary";
import { useNow } from "./TicketsPage";

interface Props {
  ticket: Ticket;
  detail: Detail | null;
  run: RunView | null;
  live: boolean;
  anyLive: boolean;
  onRun: (id: number) => void;
  onResolve: (id: number, note: string) => Promise<boolean>;
  loggedIn: boolean;
  onLogin: () => void;
  goApprovals: () => void;
}

type View = "summary" | "activity" | "messages";

export default function TicketDetail({ ticket, detail, run, live, anyLive, onRun, onResolve, goApprovals, loggedIn, onLogin }: Props) {
  const [view, setView] = useState<View>("summary");
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const now = useNow(live);

  useEffect(() => { setView(live ? "activity" : "summary"); }, [ticket.id, live]);
  useEffect(() => { setResolving(false); setNote(""); }, [ticket.id]);

  const status = live ? { label: "Working", tone: "info" } : STATUS_META[ticket.status];
  const drafts = detail?.drafts ?? [];
  const hasRun = !!run;
  const elapsed = run ? (run.endedAt ? new Date(run.endedAt).getTime() : now) - new Date(run.startedAt).getTime() : 0;

  // The single most useful button for this ticket right now.
  let primary: { label: string; onClick: () => void; disabled?: boolean } | null = null;
  if (live) primary = null;
  else if (ticket.pending_approvals > 0) primary = { label: `Review ${ticket.pending_approvals} payment${ticket.pending_approvals > 1 ? "s" : ""}`, onClick: goApprovals };
  else if (ticket.status === "open") primary = { label: "Run agents", onClick: () => onRun(ticket.id), disabled: anyLive };
  else if (ticket.status === "escalated" || ticket.status === "in_progress")
    primary = loggedIn ? { label: "Mark resolved", onClick: () => setResolving(true) } : { label: "Log in to resolve", onClick: onLogin };

  return (
    <div className="detail-inner">
      {/* Header */}
      <div className="detail-head">
        <div>
          <div className="detail-kicker">#{ticket.id} · {TICKET_TYPE[ticket.type] ?? ticket.type} · from {ticket.requester}</div>
          <h1 className="detail-title">{ticket.subject}</h1>
          {ticket.notes && <p className="detail-note">“{ticket.notes}”</p>}
        </div>
        <div className="detail-actions">
          <span className={`badge badge-${status.tone} badge-lg`}>{status.label}</span>
          {live && <span className="working"><span className="spinner" /> Working · {duration(elapsed)}</span>}
          {primary && <button className="btn btn-primary" disabled={primary.disabled} onClick={primary.onClick}>{primary.label}</button>}
          {!live && hasRun && ticket.is_open && ticket.status !== "open" && (
            <button className="text-btn" disabled={anyLive} onClick={() => onRun(ticket.id)}>Run agents again</button>
          )}
        </div>
      </div>

      {resolving && (
        <form className="resolve" onSubmit={async (e) => {
          e.preventDefault();
          if (note.trim()) { const ok = await onResolve(ticket.id, note.trim()); if (ok) setResolving(false); }
        }}>
          <label>Why is this ticket finished? It's saved to the ticket under your name.</label>
          <div className="resolve-row">
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sold the 8 hoodies in stock; club will reorder later." />
            <button className="btn btn-primary btn-sm" disabled={!note.trim()}>Resolve</button>
            <button type="button" className="text-btn" onClick={() => setResolving(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Before any run: explain what will happen */}
      {!hasRun && !live && (
        <div className="first-run">
          <h3>No agents have worked on this ticket yet</h3>
          <p>Click <b>Run agents</b>. The <b>boss</b> agent reads the ticket and asks only the specialists it needs. Anything that costs money comes back to you for approval. Nothing is paid or sent automatically.</p>
          <ol className="how">
            <li><span><b>Run agents</b> and watch their progress here</span></li>
            <li><span><b>Read the summary</b> of what they found and decided</span></li>
            <li><span><b>Approve or reject</b> any payments on the Approvals tab</span></li>
          </ol>
        </div>
      )}

      {/* Live map of the team */}
      {run && (
        <>
          <AgentMap run={run} live={live} />
          {run.finished && (
            <div className="not-needed">
              Not needed this time: {AGENT_ORDER.filter((a) => !run.crew[a].involved).map((a) => AGENTS[a].label).join(", ") || "none"}
            </div>
          )}
        </>
      )}

      {/* Views */}
      {(hasRun || live) && (
        <>
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={view === "summary"} className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>Summary</button>
            <button role="tab" aria-selected={view === "activity"} className={view === "activity" ? "active" : ""} onClick={() => setView("activity")}>Activity{live ? " (live)" : ""}</button>
            <button role="tab" aria-selected={view === "messages"} className={view === "messages" ? "active" : ""} onClick={() => setView("messages")}>Messages{drafts.length ? ` (${drafts.length})` : ""}</button>
          </div>

          <div className="view">
            {view === "summary" && <Summary run={run} live={live} notes={detail?.team_notes ?? []} />}
            {view === "activity" && <ActivityLog run={run} live={live} />}
            {view === "messages" && (
              <div className="messages">
                {drafts.length === 0 && <div className="empty">No message drafts for this ticket.</div>}
                {drafts.map((d) => (
                  <article key={d.id} className="message">
                    <div className="message-head">
                      <div>
                        <div className="message-to">To {d.recipient} <span className="muted">({d.recipient_type})</span></div>
                        <div className="message-subject">{d.subject}</div>
                      </div>
                      <div className="message-tools">
                        <span className="badge badge-neutral">Draft · not sent</span>
                        <button className="text-btn" onClick={() => navigator.clipboard.writeText(`${d.subject}\n\n${d.body}`)}>Copy</button>
                      </div>
                    </div>
                    <p className="message-body">{d.body}</p>
                    <div className="muted small">Written by {AGENTS[d.drafted_by]?.label ?? d.drafted_by}. A person decides whether to send it.</div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
