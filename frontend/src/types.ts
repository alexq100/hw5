export type AgentName = "boss" | "inventory" | "accounting" | "facilities" | "customer_service";
export type TicketStatus = "open" | "in_progress" | "awaiting_approval" | "resolved" | "escalated";

export interface Ticket {
  id: number;
  type: string;
  requester: string;
  subject: string;
  sku: string | null;
  size: string | null;
  qty: number | null;
  lease_id: number | null;
  invoice_id: number | null;
  status: TicketStatus;
  notes: string | null;
  created_at: string;
  is_open: boolean;
  pending_approvals: number;
  drafts: number;
  purchase_orders: number;
}

export interface TicketDecision {
  ticket_id: number;
  status: TicketStatus;
  decision: string;
  highlights?: string[];
  rationale: string;
  agents_involved: AgentName[];
  approval_request_ids: number[];
  purchase_order_ids: number[];
  draft_ids: number[];
  human_next_steps: string[];
}

export interface TeamReply {
  summary: string;
  facts: string[];
  actions_taken: string[];
  needs_human: string[];
  blockers: string[];
}

export interface Draft {
  id: number;
  ticket_id: number;
  recipient: string;
  recipient_type: "customer" | "vendor" | "landlord";
  subject: string;
  body: string;
  drafted_by: AgentName;
  status: string;
  created_at: string;
}

export interface TicketDetail {
  found: boolean;
  date_today: string;
  ticket: Ticket;
  team_notes: { author: string; note: string; created_at: string }[];
  approval_requests: { id: number; kind: string; amount: number; status: string }[];
  purchase_orders: { id: number; qty: number; total_cost: number; status: string; expected_arrival: string | null }[];
  drafts: Draft[];
  last_run: RunState | null;
}

export interface RunState {
  ticket_id: number;
  state: "queued" | "running" | "done" | "error";
  run_id?: string;
  error?: string | null;
  decision?: TicketDecision | null;
  model_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  queued_at?: string;
  started_at?: string;
  finished_at?: string;
}

export interface ToolCall { tool: string; args: Record<string, unknown> }
export interface ToolResult { tool: string; result: string }

export interface AgentEvent {
  ts: string;
  run_id: string;
  ticket_id: number | null;
  agent: AgentName | null;
  depth: number | null;
  step: number | null;
  event:
    | "ticket_run_start" | "agent_start" | "model_response" | "tool_results"
    | "delegation" | "delegation_refused" | "agent_end" | "ticket_run_end" | "ticket_updated";
  prompt?: string;
  text?: string | null;
  tool_calls?: ToolCall[];
  results?: ToolResult[];
  retries?: { tool: string; error: string }[];
  to?: AgentName;
  request?: string;
  reason?: string;
  output?: TeamReply | TicketDecision;
  decision?: TicketDecision | null;
  error?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  model_requested?: string;
  model_reported?: string;
  requests?: number;
  delegations?: number;
  id_check?: { ok: boolean };
}

export interface Approval {
  id: number;
  kind: "invoice" | "rent" | "purchase_order";
  ref_id: number;
  ticket_id: number | null;
  amount: number;
  account: string;
  reason: string;
  requested_by: AgentName;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  payee: string;
  what: string;
  due: string | null;
  ticket_subject: string | null;
  blocked_by_open_invoices: number[];
}

export interface Cash {
  date_today: string;
  account: string;
  balance: number;
  balance_as_of: string;
  pending_requests_total: number;
  available_after_pending: number;
}

export interface Health {
  ok: boolean;
  model: string;
  run_in_progress: boolean;
}
