import { AGENTS, AGENT_ORDER } from "../agents";
import type { RunView } from "../runModel";
import type { AgentName } from "../types";

// Positions in a 240 x 100 box: boss on top, specialists around it.
const W = 240, H = 100;
const POS: Record<AgentName, [number, number]> = {
  boss: [120, 24],
  inventory: [42, 50],
  customer_service: [198, 50],
  accounting: [86, 80],
  facilities: [154, 80],
};

/** Live map of the team: agents light up while working, a speech bubble says what they're doing,
 *  and a dot travels along the line when one agent hands work to another. */
export default function AgentMap({ run, live }: { run: RunView; live: boolean }) {
  const latest = run.edges[run.edges.length - 1];
  const route = routeText(run);

  return (
    <div className="map-wrap">
      <div className="map" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="map-lines" aria-hidden="true">
          {run.edges.map((e, i) => {
            const [x1, y1] = POS[e.from];
            const [x2, y2] = POS[e.to];
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className={`edge ${e.active ? "edge-active" : "edge-done"}`}
                  style={{ stroke: e.active ? AGENTS[e.from].color : undefined }} />
                {e.active && (
                  <circle r="2.2" fill={AGENTS[e.from].color}>
                    <animateMotion dur="1.1s" repeatCount="indefinite" path={`M${x1},${y1} L${x2},${y2}`} />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {AGENT_ORDER.map((name) => {
          const st = run.crew[name];
          const [x, y] = POS[name];
          const working = live && (st.status === "thinking" || st.status === "tool");
          const waiting = live && st.status === "waiting";
          const pings = run.edges.filter((e) => e.to === name).length;
          const cls = !st.involved ? (run.finished ? "unused" : "idle") : working ? "working" : waiting ? "waiting" : st.status === "done" ? "done" : "idle";
          return (
            <div key={name} className={`node node-${cls}`} style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, "--agent": AGENTS[name].color } as React.CSSProperties}>
              {(working || waiting) && <div className={`bubble ${waiting ? "bubble-wait" : ""}`}>{st.detail}</div>}
              <div className="node-circle">
                {pings > 0 && <span key={pings} className="ping" />}
                {st.status === "done" && st.involved ? "✓" : AGENTS[name].initials}
              </div>
              <div className="node-name">{AGENTS[name].label}</div>
            </div>
          );
        })}
      </div>

      <div className="map-caption">
        {live && latest ? (
          <span key={run.edges.length} className="handoff-flash">
            <b style={{ color: AGENTS[latest.from].color }}>{AGENTS[latest.from].label}</b> → <b style={{ color: AGENTS[latest.to].color }}>{AGENTS[latest.to].label}</b>
            <span className="muted"> {shorten(latest.request)}</span>
          </span>
        ) : live ? (
          <span className="muted">The boss is reading the ticket…</span>
        ) : route ? (
          <span><span className="muted">Route:</span> {route}</span>
        ) : null}
      </div>
    </div>
  );
}

function shorten(s: string, n = 80) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `“${one.slice(0, n)}…”` : `“${one}”`;
}

/** "Boss → Inventory → Accounting → Customer Service", following the hand-offs in order. */
function routeText(run: RunView) {
  if (!run.edges.length) return run.finished ? "The boss handled this one alone." : "";
  const seen: AgentName[] = [run.edges[0].from];
  for (const e of run.edges) if (!seen.includes(e.to)) seen.push(e.to);
  return seen.map((a) => AGENTS[a].label).join(" → ");
}
