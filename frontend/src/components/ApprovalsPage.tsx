import { useState } from "react";
import { AGENTS } from "../agents";
import { ago, money } from "../format";
import type { Approval, Cash } from "../types";
import type { Session } from "./AccountDialog";

interface Props {
  approvals: Approval[];
  cash: Cash | null;
  session: Session | null;
  onLogin: () => void;
  onDecide: (a: Approval, d: "approve" | "reject", note?: string) => Promise<boolean>;
  openTicket: (id: number) => void;
}

const KIND: Record<Approval["kind"], string> = { invoice: "Vendor invoice", rent: "Rent", purchase_order: "Purchase order" };

export default function ApprovalsPage({ approvals, cash, session, onLogin, onDecide, openTicket }: Props) {
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState<{ id: number; action: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");

  const pending = approvals
    .filter((a) => a.status === "pending")
    .sort((a, b) => (a.blocked_by_open_invoices.length ? 1 : 0) - (b.blocked_by_open_invoices.length ? 1 : 0) || a.id - b.id);
  const decided = approvals.filter((a) => a.status !== "pending").sort((a, b) => (b.decided_at ?? "").localeCompare(a.decided_at ?? ""));
  const balance = cash?.balance ?? 0;

  const start = (id: number, action: "approve" | "reject") => {
    if (!session) { onLogin(); return; }
    setOpen({ id, action }); setNote("");
  };
  const submit = async (a: Approval) => {
    if (!open) return;
    setBusy(a.id);
    const ok = await onDecide(a, open.action, note);
    setBusy(null);
    if (ok) setOpen(null);
  };

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="muted">Agents only prepare payments. A logged-in person approves each one, and approving takes the money out of checking right away.</p>
        </div>
        {session ? (
          <div className="approver-chip ok">Approving as <b>{session.name}</b></div>
        ) : (
          <button className="btn btn-primary" onClick={onLogin}>Log in to approve</button>
        )}
      </div>

      {!session && pending.length > 0 && (
        <div className="alert alert-warn">
          <b>Log in to approve or reject.</b> New here (for example a TA)? Click <b>Log in to approve</b>, then <b>Create account</b>. Your name is recorded on every approval. The AI agents can't log in or approve.
        </div>
      )}

      {pending.length === 0 ? (
        <div className="card empty-card">
          <div className="big-check">✓</div>
          <h3>Nothing to approve</h3>
          <p className="muted">When agents prepare a payment or a purchase order, it shows up here.</p>
        </div>
      ) : (
        <div className="approval-list">
          {pending.map((a, idx) => {
            const blocked = a.blocked_by_open_invoices.length > 0;
            const short = a.amount > balance;
            const blocker = approvals.find((x) => x.status === "pending" && x.kind === "invoice" && a.blocked_by_open_invoices.includes(x.ref_id));
            const isOpen = open?.id === a.id;
            return (
              <article key={a.id} className={`card approval ${blocked ? "is-blocked" : ""}`}>
                <div className="approval-top">
                  <div>
                    <div className="approval-kind">{idx === 0 && !blocked ? "Start here · " : ""}{KIND[a.kind]} · request #{a.id}</div>
                    <h3 className="approval-title">Pay {a.payee}</h3>
                    <div className="muted">{a.what}{a.due ? ` · due ${a.due}` : ""}</div>
                  </div>
                  <div className="approval-amount">{money(a.amount, true)}</div>
                </div>

                <p className="approval-reason">“{a.reason}”</p>

                <div className="approval-facts">
                  <span>Requested by <b style={{ color: AGENTS[a.requested_by]?.color }}>{AGENTS[a.requested_by]?.label}</b> {ago(a.created_at)}</span>
                  {a.ticket_id && <button className="link" onClick={() => openTicket(a.ticket_id!)}>for ticket #{a.ticket_id}</button>}
                  <span>Checking after: <b className={short ? "text-danger" : ""}>{money(balance - a.amount, true)}</b></span>
                </div>

                {blocked && (
                  <div className="alert alert-warn">
                    This vendor won't ship until invoice {a.blocked_by_open_invoices.join(", ")} is paid.
                    {blocker ? <> Approve <b>request #{blocker.id}</b> first.</> : null}
                  </div>
                )}
                {short && <div className="alert alert-danger">There isn't enough cash in checking for this payment.</div>}

                {isOpen ? (
                  <form className="pin-form" onSubmit={(e) => { e.preventDefault(); submit(a); }}>
                    <div className="pin-row">
                      <span className="confirm-text">
                        {open.action === "approve"
                          ? <>Pay <b>{money(a.amount, true)}</b> to {a.payee} as <b>{session?.name}</b>?</>
                          : <>Reject request #{a.id} as <b>{session?.name}</b>?</>}
                      </span>
                      {open.action === "reject" && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" />}
                      <button autoFocus className={`btn ${open.action === "approve" ? "btn-success" : "btn-danger"} btn-sm`} disabled={busy === a.id}>
                        {busy === a.id ? "Working…" : open.action === "approve" ? "Yes, pay it" : "Yes, reject"}
                      </button>
                      <button type="button" className="text-btn" onClick={() => setOpen(null)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="approval-buttons">
                    <button className="btn btn-success" disabled={blocked || short} onClick={() => start(a.id, "approve")}>
                      {session ? `Approve & pay ${money(a.amount)}` : "Log in to approve"}
                    </button>
                    <button className="btn btn-secondary" onClick={() => start(a.id, "reject")}>Reject</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {decided.length > 0 && (
        <section className="history">
          <h2 className="section-title">Already decided</h2>
          <div className="card table-card">
            {decided.map((a) => (
              <div key={a.id} className="history-row">
                <span className={`badge ${a.status === "approved" ? "badge-ok" : "badge-neutral"}`}>{a.status === "approved" ? "Paid" : "Rejected"}</span>
                <span className="grow">{a.payee} <span className="muted">· {a.what}</span></span>
                <span className="muted">by {a.decided_by}</span>
                <span className="num">{money(a.amount, true)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
