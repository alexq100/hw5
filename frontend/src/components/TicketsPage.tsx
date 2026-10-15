import { useEffect, useState } from "react";
import { STATUS_META, TICKET_TYPE } from "../agents";
import type { RunView } from "../runModel";
import type { Ticket, TicketDetail } from "../types";
import TicketDetailView from "./TicketDetail";

interface Props {
  tickets: Ticket[];
  selected: number | null;
  setSelected: (id: number) => void;
  detail: TicketDetail | null;
  run: RunView | null;
  liveTicket: number | null;
  pendingCount: number;
  onRun: (id: number) => void;
  onResolve: (id: number, note: string) => Promise<boolean>;
  loggedIn: boolean;
  onLogin: () => void;
  goApprovals: () => void;
}

/** What the person should do next with each ticket, in plain words. */
export function nextAction(t: Ticket, live: boolean): string {
  if (live) return "Agents working…";
  if (t.status === "resolved") return "Done";
  if (t.pending_approvals > 0) return "Approve payments";
  if (t.status === "escalated") return "Review & decide";
  if (t.status === "open") return "Run agents";
  return "Review";
}

export default function TicketsPage(p: Props) {
  const { tickets, selected, setSelected, liveTicket, pendingCount } = p;

  // Default to the first ticket that still needs something.
  useEffect(() => {
    if (selected == null && tickets.length) {
      setSelected((tickets.find((t) => t.status === "open") ?? tickets.find((t) => t.is_open) ?? tickets[0]).id);
    }
  }, [tickets, selected, setSelected]);

  const current = tickets.find((t) => t.id === selected) ?? null;
  const notRun = tickets.filter((t) => t.status === "open");
  const escalated = tickets.filter((t) => t.status === "escalated");

  // One sentence telling the person what to do next.
  let banner: { text: string; action?: { label: string; onClick: () => void } };
  if (liveTicket != null) banner = { text: `Agents are working on ticket #${liveTicket}. You can watch their progress below.` };
  else if (pendingCount > 0) banner = { text: `${pendingCount} payment${pendingCount > 1 ? "s are" : " is"} waiting for your approval.`, action: { label: "Go to approvals", onClick: p.goApprovals } };
  else if (notRun.length) banner = { text: `Pick a ticket and click “Run agents”. The boss agent reads it and brings in the right specialists.` };
  else if (escalated.length) banner = { text: `Ticket #${escalated[0].id} needs a decision from you. Open it and read the summary.`, action: { label: `Open #${escalated[0].id}`, onClick: () => setSelected(escalated[0].id) } };
  else if (tickets.length) banner = { text: "All tickets are resolved. Nice work. Use “Start over” to reset the shop and run them again." };
  else banner = { text: "Loading tickets…" };

  return (
    <div className="tickets-page">
      <div className="banner">
        <span className="banner-icon">→</span>
        <span>{banner.text}</span>
        {banner.action && <button className="btn btn-primary btn-sm" onClick={banner.action.onClick}>{banner.action.label}</button>}
      </div>

      <div className="split">
        <section className="card ticket-list" aria-label="Tickets">
          <h2 className="card-title">Tickets</h2>
          {tickets.map((t) => {
            const live = liveTicket === t.id;
            const status = live ? { label: "Working", tone: "info" } : STATUS_META[t.status];
            const action = nextAction(t, live);
            return (
              <button key={t.id} className={`ticket-row ${selected === t.id ? "selected" : ""}`} onClick={() => setSelected(t.id)}>
                <div className="ticket-row-top">
                  <span className="ticket-id">#{t.id}{t.status === "open" && !live && <span className="new-dot" title="New: no agents have worked on it yet">New</span>}</span>
                  <span className={`badge badge-${status.tone}`}>{status.label}</span>
                </div>
                <div className="ticket-subject">{t.subject}</div>
                <div className="ticket-meta">{TICKET_TYPE[t.type] ?? t.type} · {t.requester}</div>
                <div className={`ticket-next ${action === "Done" ? "done" : ""}`}>{action === "Done" ? "✓ Done" : `Next: ${action}`}</div>
              </button>
            );
          })}
        </section>

        <section className="card detail">
          {current ? (
            <TicketDetailView
              ticket={current}
              detail={p.detail?.ticket.id === current.id ? p.detail : null}
              run={p.run}
              live={liveTicket === current.id}
              anyLive={liveTicket != null}
              onRun={p.onRun}
              onResolve={p.onResolve}
              loggedIn={p.loggedIn}
              onLogin={p.onLogin}
              goApprovals={p.goApprovals}
            />
          ) : (
            <div className="empty">Select a ticket on the left.</div>
          )}
        </section>
      </div>
    </div>
  );
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
