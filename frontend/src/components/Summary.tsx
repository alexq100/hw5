import { useState } from "react";
import { AGENTS } from "../agents";
import { isDecision, type RunView } from "../runModel";
import type { TeamReply } from "../types";

interface Props {
  run: RunView | null;
  live: boolean;
  notes: { author: string; note: string; created_at: string }[];
}

/** Older runs have no highlights, so fall back to the rationale's first few sentences. */
function bullets(highlights: string[] | undefined, rationale: string) {
  if (highlights?.length) return highlights;
  return rationale.split(/(?<=[.;])\s+(?=[A-Z$0-9])/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
}

function firstSentence(s: string) {
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
}

export default function Summary({ run, live, notes }: Props) {
  const [full, setFull] = useState(false);
  if (!run || (live && !run.finished)) {
    return <div className="empty">The summary appears when the agents finish. Watch them work in <b>Activity</b>.</div>;
  }
  const d = run.decision;
  const specialists = run.reports.filter((r) => r.agent !== "boss" && !isDecision(r.output));
  const humanNotes = notes.filter((n) => !(n.author in AGENTS));

  return (
    <div className="summary">
      {run.error && <div className="alert alert-danger">The run stopped early. The ticket was escalated so you can pick it up.</div>}

      {d && (
        <div className="decision">
          <div className="label">Decision</div>
          <p className="decision-text">{d.decision}</p>
          <ul className="bullets">{bullets(d.highlights, d.rationale).map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}

      {d && d.human_next_steps.length > 0 && (
        <div className="todo">
          <div className="label">Your next steps</div>
          <ol>{d.human_next_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      )}

      {specialists.length > 0 && (
        <div>
          <div className="label">Who did what</div>
          <ul className="who-did">
            {specialists.map((r, i) => (
              <li key={i}>
                <span className="dot-agent" style={{ background: AGENTS[r.agent].color }} />
                <b style={{ color: AGENTS[r.agent].color }}>{AGENTS[r.agent].label}</b>
                <span>{firstSentence((r.output as TeamReply).summary)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="more-btn" onClick={() => setFull((f) => !f)} aria-expanded={full}>
        {full ? "Hide full explanation ▲" : "Show full explanation ▼"}
      </button>

      {full && (
        <div className="full">
          {d && (
            <section>
              <h4>Boss's reasoning</h4>
              <p>{d.rationale}</p>
            </section>
          )}
          {specialists.map((r, i) => {
            const out = r.output as TeamReply;
            return (
              <section key={i}>
                <h4 style={{ color: AGENTS[r.agent].color }}>{AGENTS[r.agent].label}{r.askedBy ? <span className="muted"> · asked by {AGENTS[r.askedBy].label}</span> : null}</h4>
                <p>{out.summary}</p>
                {out.facts.length > 0 && <><div className="mini-label">Facts used</div><ul>{out.facts.map((f, j) => <li key={j}>{f}</li>)}</ul></>}
                {out.actions_taken.length > 0 && <><div className="mini-label">Actions</div><ul>{out.actions_taken.map((f, j) => <li key={j}>{f}</li>)}</ul></>}
                {out.blockers.length > 0 && <><div className="mini-label">Blockers</div><ul>{out.blockers.map((f, j) => <li key={j}>{f}</li>)}</ul></>}
              </section>
            );
          })}
          {humanNotes.length > 0 && (
            <section>
              <h4>Notes from people</h4>
              <ul>{humanNotes.map((n, i) => <li key={i}><b>{n.author}:</b> {n.note}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
