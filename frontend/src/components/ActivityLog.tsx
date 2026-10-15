import { useState } from "react";
import { AGENTS, TOOL_LABEL } from "../agents";
import { clock } from "../format";
import { argSummary, isDecision, type RunView } from "../runModel";
import type { AgentEvent } from "../types";

const HIDDEN = new Set(["ask_teammate", "final_result"]);

/** One plain-English line per agent step, with each tool's result shown underneath it. */
export default function ActivityLog({ run, live }: { run: RunView | null; live: boolean }) {
  if (!run) return <div className="empty">Starting…</div>;
  const rows = run.events.map((e, i) => <Row key={i} e={e} />);
  return (
    <div className="activity">
      {rows}
      {live && <div className="activity-live"><span className="spinner" /> Agents are working…</div>}
    </div>
  );
}

function Name({ a }: { a: AgentEvent["agent"] | undefined }) {
  if (!a) return null;
  return <b style={{ color: AGENTS[a].color }}>{AGENTS[a].label}</b>;
}

function Row({ e }: { e: AgentEvent }) {
  const time = <span className="act-time">{clock(e.ts)}</span>;
  switch (e.event) {
    case "ticket_run_start":
      return <div className="act act-mark">{time}<span>Agents started</span></div>;
    case "ticket_run_end":
      return <div className={`act act-mark ${e.error ? "bad" : "good"}`}>{time}<span>{e.error ? `Stopped: ${e.error}` : `Finished: ${e.requests} model calls, ${e.delegations} hand-offs`}</span></div>;
    case "delegation":
      return (
        <div className="act">{time}
          <div><Name a={e.agent} /> asked <Name a={e.to} /> for help
            <Expand text={e.request ?? ""} />
          </div>
        </div>
      );
    case "delegation_refused":
      return <div className="act">{time}<div><Name a={e.agent} /> couldn't ask {e.to?.replace(/_/g, " ")}: <span className="muted">{e.reason}</span></div></div>;
    case "model_response": {
      const calls = (e.tool_calls ?? []).filter((c) => !HIDDEN.has(c.tool));
      if (!calls.length && !e.text) return null;
      return (
        <div className="act">{time}
          <div>
            <Name a={e.agent} />{" "}
            {calls.map((c, i) => (
              <span key={i}>{i > 0 && ", "}{TOOL_LABEL[c.tool] ?? c.tool}{argSummary(c.tool, c.args) && <span className="muted"> ({argSummary(c.tool, c.args)})</span>}</span>
            ))}
            {e.text && <div className="act-text">{e.text}</div>}
          </div>
        </div>
      );
    }
    case "tool_results": {
      const res = (e.results ?? []).filter((r) => !HIDDEN.has(r.tool));
      if (!res.length) return null;
      return (
        <div className="act act-result">
          <span className="act-time" />
          <div>{res.map((r, i) => <Result key={i} tool={r.tool} raw={r.result} />)}</div>
        </div>
      );
    }
    case "agent_end": {
      if (!e.output) return null;
      const text = isDecision(e.output) ? e.output.decision : e.output.summary;
      return <div className="act act-report">{time}<div><Name a={e.agent} /> {e.agent === "boss" ? "decided" : "reported back"}: {text}</div></div>;
    }
  }
  return null;
}

function Expand({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="expand">
      {open ? <div className="act-text">{text}</div> : null}
      <button className="link" onClick={() => setOpen((o) => !o)}>{open ? "Hide request" : "Show request"}</button>
    </div>
  );
}

function Result({ tool, raw }: { tool: string; raw: string }) {
  let line = "";
  try {
    const d = JSON.parse(raw);
    if (d.ok === false || d.found === false) line = `Refused: ${d.error}`;
    else if (tool === "get_product_stock_and_price") line = `${d.qty_on_hand} on hand, ${d.shortfall} short`;
    else if (tool === "get_vendor_status") line = (d.vendors ?? []).map((v: { name: string; on_hold: boolean }) => `${v.name}${v.on_hold ? " (on hold: unpaid invoice)" : ""}`).join(", ");
    else if (tool === "get_rent_due") line = `$${d.monthly_rent} due ${d.next_due} (in ${d.days_until_due} days)`;
    else if (tool === "get_cash_position") line = (d.accounts ?? []).map((a: { balance: number; available_after_pending: number }) => `$${a.balance} in checking, $${a.available_after_pending} free`).join(", ");
    else if (tool === "quote_bulk_discount") line = `$${d.discounted_unit_price} each, total $${d.order_total}, ${d.margin_pct}% margin`;
    else if (tool === "request_payment_approval") line = `Payment request #${d.approval_id} for $${d.amount} sent to you for approval`;
    else if (tool === "create_purchase_order") line = `Purchase order ${d.purchase_order_id} for $${d.total_cost} sent to you for approval`;
    else if (tool === "save_draft_message") line = `Draft #${d.draft_id} saved (not sent)`;
    else if (tool === "update_ticket") line = `Ticket set to "${String(d.status).replace(/_/g, " ")}"`;
    else if (tool === "get_ticket") return null;
    else line = "done";
  } catch { line = raw.slice(0, 100); }
  return <div className={`result ${line.startsWith("Refused") ? "bad" : ""}`}>↳ {line}</div>;
}
