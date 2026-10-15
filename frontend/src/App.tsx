import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { buildRun, splitRuns } from "./runModel";
import type { AgentEvent, Approval, Cash, Health, RunState, Ticket, TicketDetail } from "./types";
import Header, { type Page } from "./components/Header";
import TicketsPage from "./components/TicketsPage";
import ApprovalsPage from "./components/ApprovalsPage";
import CashPage from "./components/CashPage";
import AccountDialog, { type Session } from "./components/AccountDialog";

export interface Toast { id: number; tone: "ok" | "warn" | "danger" | "info"; text: string }

const FAST = 1200; // while agents are working
const SLOW = 5000; // background refresh

export default function App() {
  const [page, setPage] = useState<Page>("tickets");
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState(true);
  const [shopDate, setShopDate] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [cash, setCash] = useState<Cash | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [events, setEvents] = useState<Record<number, AgentEvent[]>>({});
  const [runs, setRuns] = useState<Record<number, RunState>>({});
  // The logged-in person, kept only for this browser tab (sessionStorage), never for the agents.
  const [session, setSession] = useState<Session | null>(() => {
    try { return JSON.parse(sessionStorage.getItem("cc-session") ?? "null"); } catch { return null; }
  });
  const [showLogin, setShowLogin] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastTs = useRef<Record<number, string>>({});

  // Clear any approver name an older version of the desk saved in the browser.
  useEffect(() => { localStorage.removeItem("cc-approver"); localStorage.removeItem("cc-operator"); }, []);

  useEffect(() => {
    if (session) sessionStorage.setItem("cc-session", JSON.stringify(session));
    else sessionStorage.removeItem("cc-session");
  }, [session]);

  // Drop a session the backend no longer accepts (expired or logged out elsewhere).
  useEffect(() => {
    if (session) api.me(session.token).catch(() => setSession(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs, { id, tone, text }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);

  // ---- loading -----------------------------------------------------------------
  const refreshBoard = useCallback(async () => {
    try {
      const [h, t, a, c] = await Promise.all([api.health(), api.tickets(), api.approvals("all"), api.cash()]);
      setHealth(h); setTickets(t.tickets); setShopDate(t.date_today); setApprovals(a.approvals); setCash(c);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  const refreshDetail = useCallback(async (id: number) => {
    try {
      const d = await api.ticket(id);
      setDetail((cur) => (!cur || cur.ticket.id === id ? d : cur));
      if (d.last_run) setRuns((r) => ({ ...r, [id]: d.last_run! }));
    } catch { /* connectivity shown by refreshBoard */ }
  }, []);

  const pullEvents = useCallback(async (id: number, full = false) => {
    try {
      const res = await api.events(id, full ? undefined : lastTs.current[id]);
      if (res.latest_ts) lastTs.current[id] = res.latest_ts;
      setEvents((ev) => ({ ...ev, [id]: full ? res.events : [...(ev[id] ?? []), ...res.events] }));
    } catch { /* retry next poll */ }
  }, []);

  useEffect(() => {
    refreshBoard();
    const t = setInterval(refreshBoard, SLOW);
    return () => clearInterval(t);
  }, [refreshBoard]);

  useEffect(() => {
    if (selected == null) return;
    setDetail(null);
    lastTs.current[selected] = "";
    pullEvents(selected, true);
    refreshDetail(selected);
  }, [selected, pullEvents, refreshDetail]);

  const liveTicket = useMemo(
    () => Object.values(runs).find((x) => x.state === "queued" || x.state === "running")?.ticket_id ?? null,
    [runs],
  );

  useEffect(() => {
    if (liveTicket == null) return;
    const t = setInterval(async () => {
      await pullEvents(liveTicket);
      try {
        const st = await api.runStatus(liveTicket);
        setRuns((r) => ({ ...r, [liveTicket]: st }));
        if (st.state === "done" || st.state === "error") {
          await Promise.all([refreshBoard(), refreshDetail(liveTicket), pullEvents(liveTicket)]);
          if (st.state === "done") toast("ok", `Ticket #${liveTicket} is done. Read the summary to see what the agents decided.`);
          else toast("danger", `Ticket #${liveTicket} stopped early: ${st.error ?? "unknown error"}`);
        }
      } catch { /* keep polling */ }
    }, FAST);
    return () => clearInterval(t);
  }, [liveTicket, pullEvents, refreshBoard, refreshDetail, toast]);

  // ---- actions -----------------------------------------------------------------
  const runAgents = async (id: number) => {
    try {
      const st = await api.runTicket(id);
      setRuns((r) => ({ ...r, [id]: { ...st, state: "running" } }));
      setSelected(id);
    } catch (e) {
      toast("danger", (e as Error).message);
    }
  };

  // Approving, rejecting, and closing a ticket need a logged-in person.
  const needLogin = () => { toast("warn", "Log in first. Only a logged-in person can approve or close tickets."); setShowLogin(true); };

  const authFailed = (e: unknown) => {
    const err = e as ApiError;
    if (err.status === 401) { setSession(null); setShowLogin(true); }
    toast("danger", err.message);
  };

  const decide = async (a: Approval, decision: "approve" | "reject", note = ""): Promise<boolean> => {
    if (!session) { needLogin(); return false; }
    let ok = false;
    try {
      if (decision === "approve") {
        const res = await api.approve(a.id, session.token, note);
        toast("ok", `Paid ${a.payee} $${a.amount.toLocaleString()}. Checking is now $${res.new_balance.toLocaleString()}.${res.ticket_status === "resolved" ? ` Ticket #${a.ticket_id} is resolved.` : ""}`);
      } else {
        await api.reject(a.id, session.token, note);
        toast("info", `Rejected request #${a.id}. No money moved.`);
      }
      ok = true;
    } catch (e) {
      authFailed(e);
    }
    await refreshBoard();
    if (selected != null) refreshDetail(selected);
    return ok;
  };

  const resolve = async (id: number, note: string): Promise<boolean> => {
    if (!session) { needLogin(); return false; }
    let ok = false;
    try {
      const res = await api.resolveTicket(id, session.token, note);
      toast("ok", `Ticket #${id} resolved by ${res.resolved_by}.`);
      ok = true;
    } catch (e) {
      authFailed(e);
    }
    await refreshBoard();
    refreshDetail(id);
    return ok;
  };

  const logout = async () => {
    if (session) await api.logout(session.token).catch(() => undefined);
    setSession(null);
    toast("info", "Logged out.");
  };

  const reset = async () => {
    if (!window.confirm("Start over? This puts the shop database back to its original values (cash, tickets, approvals). The audit log is kept.")) return;
    try {
      await api.reset();
      setRuns({});
      toast("info", "Shop reset to the original data.");
    } catch (e) {
      toast("danger", (e as Error).message);
    }
    await refreshBoard();
    if (selected != null) { refreshDetail(selected); pullEvents(selected, true); }
  };

  // ---- derived -------------------------------------------------------------------
  const ticketEvents = selected != null ? events[selected] ?? [] : [];
  const runIds = splitRuns(ticketEvents);
  const run = runIds.length ? buildRun(ticketEvents, runIds[runIds.length - 1]) : null;
  const pending = approvals.filter((a) => a.status === "pending");

  return (
    <div className="app">
      <Header
        page={page}
        setPage={setPage}
        pendingCount={pending.length}
        balance={cash?.balance ?? null}
        shopDate={shopDate}
        busy={liveTicket != null}
        onReset={reset}
        session={session}
        onLogin={() => setShowLogin(true)}
        onLogout={logout}
      />
      {!online && (
        <div className="offline">Can't reach the backend at localhost:8000. Start it from <code>backend/</code> with <code>uvicorn main:app --reload --port 8000</code>.</div>
      )}

      <main className="page">
        {page === "tickets" && (
          <TicketsPage
            tickets={tickets}
            selected={selected}
            setSelected={setSelected}
            detail={detail}
            run={run}
            liveTicket={liveTicket}
            pendingCount={pending.length}
            onRun={runAgents}
            onResolve={resolve}
            loggedIn={!!session}
            onLogin={() => setShowLogin(true)}
            goApprovals={() => setPage("approvals")}
          />
        )}
        {page === "approvals" && (
          <ApprovalsPage
            approvals={approvals}
            cash={cash}
            session={session}
            onLogin={() => setShowLogin(true)}
            onDecide={decide}
            openTicket={(id) => { setSelected(id); setPage("tickets"); }}
          />
        )}
        {page === "cash" && <CashPage cash={cash} approvals={approvals} />}
      </main>

      <footer className="footer">
        Every agent runs on <code>{health?.model ?? "…"}</code>. Agents only prepare payments. Money moves only when a person approves it.
      </footer>

      {showLogin && (
        <AccountDialog
          onClose={() => setShowLogin(false)}
          onLoggedIn={(s) => { setSession(s); setShowLogin(false); toast("ok", `Logged in as ${s.name}.`); }}
        />
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
