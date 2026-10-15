import { useState } from "react";
import { api } from "../api";

export interface Session { token: string; name: string; username: string }

interface Props {
  onClose: () => void;
  onLoggedIn: (s: Session) => void;
}

/** Log in, or create a human account. Only people use this; the agent team has no way to reach it. */
export default function AccountDialog({ onClose, onLoggedIn }: Props) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "signup" && password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      if (mode === "signup") await api.signup(username, name, password);
      const res = await api.login(username, password);
      onLoggedIn({ token: res.session_token, name: res.display_name, username: res.username });
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Log in</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
        </div>
        <h2 id="account-title">{mode === "login" ? "Welcome back" : "Create your approver account"}</h2>
        <p className="muted small">
          {mode === "login"
            ? "Log in to approve payments and close tickets. Every approval is recorded under your name."
            : "For people only (the shop owner, a TA). The AI agents can never log in or approve."}
        </p>

        <form onSubmit={submit} className="account-form" autoComplete="on">
          <label>Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required placeholder="e.g. alexkew" />
          </label>
          {mode === "signup" && (
            <label>Full name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="Shown on every approval" />
            </label>
          )}
          <label>Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required placeholder={mode === "signup" ? "At least 8 characters" : ""} />
          </label>
          {mode === "signup" && (
            <label>Confirm password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
          )}
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="text-btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? "…" : mode === "login" ? "Log in" : "Create account & log in"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
