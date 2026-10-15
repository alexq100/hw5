import type { AgentEvent, Approval, Cash, Health, RunState, Ticket, TicketDetail } from "./types";

/** The FastAPI backend from Problem 7. */
export const API_URL = "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "Can't reach the backend at localhost:8000. Is uvicorn running?");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    throw new ApiError(res.status, detail);
  }
  return body as T;
}

export const api = {
  health: () => request<Health>("/health"),
  tickets: () => request<{ date_today: string; tickets: Ticket[] }>("/tickets"),
  ticket: (id: number) => request<TicketDetail>(`/tickets/${id}`),
  runTicket: (id: number) => request<RunState>(`/tickets/${id}/run`, { method: "POST" }),
  runStatus: (id: number) => request<RunState>(`/tickets/${id}/run`),
  resolveTicket: (id: number, token: string, note: string) =>
    request<{ ok: boolean; status: string; resolved_by: string }>(`/tickets/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }, token),
  events: (ticketId: number, after?: string) =>
    request<{ count: number; latest_ts: string | null; events: AgentEvent[] }>(
      `/events?ticket_id=${ticketId}&limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    ),
  approvals: (status: "pending" | "approved" | "rejected" | "all" = "all") =>
    request<{ count: number; cash_balance: number; approvals: Approval[] }>(`/approvals?status=${status}`),
  signup: (username: string, display_name: string, password: string) =>
    request<{ ok: boolean; username: string; display_name: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, display_name, password }),
    }),
  login: (username: string, password: string) =>
    request<{ ok: boolean; session_token: string; username: string; display_name: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: (token: string) => request<{ ok: boolean }>("/auth/logout", { method: "POST" }, token),
  me: (token: string) => request<{ ok: boolean; display_name: string }>("/auth/me", {}, token),
  approve: (id: number, token: string, note = "") =>
    request<{ ok: boolean; new_balance: number; ticket_status: string | null }>(`/approvals/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }, token),
  reject: (id: number, token: string, note = "") =>
    request<{ ok: boolean; ticket_status: string | null }>(`/approvals/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }, token),
  cash: () => request<Cash>("/cash"),
  reset: () => request<{ ok: boolean }>("/reset", { method: "POST" }),
};
