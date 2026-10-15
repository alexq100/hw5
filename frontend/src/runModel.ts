import { AGENT_ORDER, TOOL_LABEL } from "./agents";
import type { AgentEvent, AgentName, TeamReply, TicketDecision } from "./types";

export type CrewStatus = "standby" | "thinking" | "tool" | "waiting" | "done";

export interface CrewState {
  status: CrewStatus;
  detail: string;
  toolCalls: number;
  tokens: number;
  involved: boolean;
}

export interface AgentReport {
  agent: AgentName;
  depth: number;
  askedBy: AgentName | null;
  request: string | null;
  output: TeamReply | TicketDecision;
  tools: string[];
}

export interface Edge {
  from: AgentName;
  to: AgentName;
  request: string;
  active: boolean;
  ts: string;
}

export interface RunView {
  runId: string;
  events: AgentEvent[];
  startedAt: string;
  endedAt: string | null;
  finished: boolean;
  error: string | null;
  decision: TicketDecision | null;
  crew: Record<AgentName, CrewState>;
  reports: AgentReport[];
  delegations: { from: AgentName; to: AgentName; request: string; refused?: string }[];
  edges: Edge[];
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
}

const INTERNAL_TOOLS = new Set(["ask_teammate", "final_result"]);

/** Group a ticket's audit events by run and return the runs, oldest first. */
export function splitRuns(events: AgentEvent[]): string[] {
  const ids: string[] = [];
  for (const e of events) if (e.event === "ticket_run_start" && !ids.includes(e.run_id)) ids.push(e.run_id);
  return ids;
}

export function buildRun(all: AgentEvent[], runId: string): RunView {
  const events = all.filter((e) => e.run_id === runId);
  const crew = Object.fromEntries(
    AGENT_ORDER.map((a) => [a, { status: "standby", detail: "Standing by", toolCalls: 0, tokens: 0, involved: false }]),
  ) as Record<AgentName, CrewState>;
  const reports: AgentReport[] = [];
  const delegations: RunView["delegations"] = [];
  const edges: Edge[] = [];
  const pendingAsk: { to: AgentName; from: AgentName; request: string }[] = [];
  const toolsUsed: Partial<Record<AgentName, string[]>> = {};
  let modelCalls = 0, toolCalls = 0, inputTokens = 0, outputTokens = 0;
  let decision: TicketDecision | null = null, error: string | null = null, endedAt: string | null = null;
  let model: string | null = null;

  for (const e of events) {
    const a = e.agent;
    switch (e.event) {
      case "ticket_run_start":
        model = e.model ?? null;
        break;
      case "agent_start":
        if (a) {
          crew[a] = { ...crew[a], status: "thinking", detail: "Reading the request", involved: true };
          toolsUsed[a] = [];
        }
        break;
      case "model_response": {
        if (!a) break;
        modelCalls += 1;
        inputTokens += e.input_tokens ?? 0;
        outputTokens += e.output_tokens ?? 0;
        const calls = e.tool_calls ?? [];
        const real = calls.filter((c) => !INTERNAL_TOOLS.has(c.tool));
        toolCalls += real.length;
        crew[a].tokens += (e.input_tokens ?? 0) + (e.output_tokens ?? 0);
        crew[a].toolCalls += real.length;
        toolsUsed[a] = [...(toolsUsed[a] ?? []), ...real.map((c) => c.tool)];
        const asks = calls.filter((c) => c.tool === "ask_teammate");
        if (calls.some((c) => c.tool === "final_result")) crew[a] = { ...crew[a], status: "thinking", detail: "Writing up the report" };
        else if (asks.length) {
          const names = asks.map((c) => String(c.args.teammate)).join(" & ");
          crew[a] = { ...crew[a], status: "waiting", detail: `Waiting on ${names.replace(/_/g, " ")}` };
        } else if (real.length) {
          crew[a] = { ...crew[a], status: "tool", detail: real.map((c) => TOOL_LABEL[c.tool] ?? c.tool).join(", ") };
        } else crew[a] = { ...crew[a], status: "thinking", detail: "Thinking it through" };
        break;
      }
      case "tool_results":
        if (a && crew[a].status === "tool") crew[a] = { ...crew[a], status: "thinking", detail: "Reviewing results" };
        break;
      case "delegation":
        if (a && e.to) {
          edges.push({ from: a, to: e.to, request: e.request ?? "", active: true, ts: e.ts });
          delegations.push({ from: a, to: e.to, request: e.request ?? "" });
          pendingAsk.push({ from: a, to: e.to, request: e.request ?? "" });
        }
        break;
      case "delegation_refused":
        if (a && e.to) delegations.push({ from: a, to: e.to, request: "", refused: e.reason });
        break;
      case "agent_end":
        if (a) {
          const open = [...edges].reverse().find((x) => x.to === a && x.active);
          if (open) open.active = false;
        }
        if (a && e.output) {
          crew[a] = { ...crew[a], status: "done", detail: "Report filed" };
          const askIdx = pendingAsk.findIndex((p) => p.to === a);
          const ask = askIdx >= 0 ? pendingAsk.splice(askIdx, 1)[0] : null;
          reports.push({
            agent: a, depth: e.depth ?? 0, askedBy: ask?.from ?? null, request: ask?.request ?? null,
            output: e.output, tools: toolsUsed[a] ?? [],
          });
        }
        break;
      case "ticket_run_end":
        endedAt = e.ts;
        decision = e.decision ?? null;
        error = e.error ?? null;
        break;
    }
  }

  if (endedAt) {
    for (const x of edges) x.active = false;
    for (const a of AGENT_ORDER) {
      if (crew[a].involved && crew[a].status !== "done") crew[a] = { ...crew[a], status: "done", detail: error ? "Stopped" : "Report filed" };
    }
  }

  return {
    runId, events, startedAt: events[0]?.ts ?? "", endedAt, finished: !!endedAt, error, decision,
    crew, reports, delegations, edges, modelCalls, toolCalls, inputTokens, outputTokens, model,
  };
}

export function isDecision(o: TeamReply | TicketDecision): o is TicketDecision {
  return (o as TicketDecision).ticket_id !== undefined;
}

/** Short human-readable version of a tool's arguments. */
export function argSummary(tool: string, args: Record<string, unknown>): string {
  const g = (k: string) => (args[k] === undefined || args[k] === null ? "" : String(args[k]));
  switch (tool) {
    case "get_product_stock_and_price": return `${g("sku")} · ${g("size")} · ×${g("qty_needed") || 1}`;
    case "get_vendor_status": return g("vendor_id") ? `vendor ${g("vendor_id")}` : "all vendors";
    case "get_rent_due": return `lease ${g("lease_id")}`;
    case "get_ticket": return `#${g("ticket_id")}`;
    case "quote_bulk_discount": return `${g("sku")} ×${g("qty")} @ ${g("discount_pct")}% off`;
    case "request_payment_approval": return `${g("kind")} ${g("ref_id")}`;
    case "create_purchase_order": return `vendor ${g("vendor_id")} · ${g("sku")} ${g("size")} ×${g("qty")}`;
    case "save_draft_message": return `to ${g("recipient")}`;
    case "update_ticket": return `→ ${g("status").replace(/_/g, " ")}`;
    default: return "";
  }
}
