import { money, shopDate as fmtDate } from "../format";
import type { Session } from "./AccountDialog";

export type Page = "tickets" | "approvals" | "cash";

interface Props {
  page: Page;
  setPage: (p: Page) => void;
  pendingCount: number;
  balance: number | null;
  shopDate: string;
  busy: boolean;
  onReset: () => void;
  session: Session | null;
  onLogin: () => void;
  onLogout: () => void;
}

export default function Header({ page, setPage, pendingCount, balance, shopDate, busy, onReset, session, onLogin, onLogout }: Props) {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="logo">
          <span className="logo-mark">CC</span>
          <div>
            <div className="logo-name">Campus Customs</div>
            <div className="logo-sub">Agent Desk</div>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          <button className={page === "tickets" ? "active" : ""} onClick={() => setPage("tickets")}>Tickets</button>
          <button className={page === "approvals" ? "active" : ""} onClick={() => setPage("approvals")}>
            Approvals {pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </button>
          <button className={page === "cash" ? "active" : ""} onClick={() => setPage("cash")}>Cash</button>
        </nav>

        <div className="header-right">
          <button className="balance" onClick={() => setPage("cash")} title="Checking account balance">
            <span>Checking</span>
            <strong>{balance == null ? "…" : money(balance, true)}</strong>
          </button>
          {shopDate && <span className="shop-date" title="The shop's 'today' (desk.date_today)">{fmtDate(shopDate)}</span>}
          <button className="text-btn" onClick={onReset} disabled={busy}>Start over</button>
          {session ? (
            <div className="account">
              <span className="avatar-circle">{session.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
              <div className="account-text"><b>{session.name}</b><button className="link small" onClick={onLogout}>Log out</button></div>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={onLogin}>Log in</button>
          )}
        </div>
      </div>
    </header>
  );
}
