import { useEffect, useRef, useState } from "react";
import { money } from "../format";
import type { Approval, Cash } from "../types";

/** Count the balance down smoothly when a payment goes through. */
function useTween(target: number, ms = 800) {
  const [v, setV] = useState(target);
  const from = useRef<number | null>(null);
  useEffect(() => {
    if (from.current == null || from.current === 0) { from.current = target; setV(target); return; }
    const a = from.current, start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(a + (target - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);
  return v;
}

export default function CashPage({ cash, approvals }: { cash: Cash | null; approvals: Approval[] }) {
  const balance = cash?.balance ?? 0;
  const shown = useTween(balance);
  const paid = approvals.filter((a) => a.status === "approved").sort((a, b) => (a.decided_at ?? "").localeCompare(b.decided_at ?? ""));
  const totalPaid = paid.reduce((s, a) => s + a.amount, 0);
  const opening = balance + totalPaid;
  const waiting = cash?.pending_requests_total ?? 0;
  const free = cash?.available_after_pending ?? 0;
  const pct = (n: number) => `${Math.max(0, (n / Math.max(opening, 1)) * 100)}%`;
  let running = opening;

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>Cash</h1>
          <p className="muted">The shop's checking account. Money only goes out, and only when a person approves a payment.</p>
        </div>
      </div>

      <div className="card cash-card">
        <div className="muted">Checking balance</div>
        <div className="cash-big">{money(shown, true)}</div>
        <div className="cash-bar">
          <span className="bar-paid" style={{ width: pct(totalPaid) }} />
          <span className="bar-waiting" style={{ width: pct(Math.min(waiting, balance)) }} />
          <span className="bar-free" style={{ width: pct(free) }} />
        </div>
        <div className="cash-stats">
          <div><span><i className="dot dot-paid" />Paid out</span><b>{money(totalPaid, true)}</b></div>
          <div><span><i className="dot dot-waiting" />Waiting for approval</span><b>{money(waiting, true)}</b></div>
          <div><span><i className="dot dot-free" />Free to spend</span><b>{money(free, true)}</b></div>
        </div>
      </div>

      <h2 className="section-title">Payments</h2>
      <div className="card table-card">
        <div className="history-row head"><span className="grow">Starting balance</span><span className="num">{money(opening, true)}</span></div>
        {paid.length === 0 && <div className="history-row"><span className="muted grow">No payments yet.</span></div>}
        {paid.map((a) => {
          running -= a.amount;
          return (
            <div key={a.id} className="history-row">
              <span className="grow">{a.payee} <span className="muted">· {a.what} · approved by {a.decided_by}</span></span>
              <span className="num text-danger">−{money(a.amount, true)}</span>
              <span className="num">{money(running, true)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
