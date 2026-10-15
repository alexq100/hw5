"""Campus Customs backend: the five-agent team and the FastAPI routes for the dashboard.

Start the API (from the backend/ folder):

    uvicorn main:app --reload --port 8000

Or run the team from the command line, without the dashboard:

    python main.py --run                 # work every open ticket
    python main.py --run --ticket 101    # work one ticket
    python main.py --run --reset         # reset the working DB first (before a full run)

Sections in this file:
  1. Settings (model, Portkey, paths, limits)
  2. Audit trail (append-only output/audit_trail.json)
  3. MCP connection (which MCP tools each agent may use, plus guardrails)
  4. The agent team (five PydanticAI agents, relays, audited agent loops)
  5. FastAPI routes (tickets, runs, events, approvals, cash, reset, human log-in)
  6. Command line

Every shop read and write goes through the MCP server (mcp_server/server.py).
Data types live in models.py, and the agent prompts in prompts/.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, get_args

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastmcp import Client
from fastmcp.client.transports import PythonStdioTransport
from fastmcp.exceptions import ToolError
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from pydantic_ai import Agent, CallToolsNode, ModelRequestNode, RunContext, UserPromptNode
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.messages import RetryPromptPart, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.openai import OpenAIResponsesModel, OpenAIResponsesModelSettings
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import RunUsage, UsageLimits

from models import AgentName, TeamDeps, TeamReply, TicketDecision, TicketRunResult, TicketRunState



# ============================================================================
# 1. Settings
# ============================================================================

PROJECT_DIR = Path(__file__).resolve().parent.parent

# PORTKEY_API_KEY: hw5/.env first (copy .env.example), then the folder above it.
load_dotenv(PROJECT_DIR / ".env")
load_dotenv(PROJECT_DIR.parent / ".env")
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

# ---- Model -----------------------------------------------------------------
# Plain name, no provider prefix: prefixed strings fall back to gpt-5.6-luna on Portkey.
REQUIRED_MODEL = "gpt-6-luna"
MODEL_NAME = os.environ.get("MODEL", REQUIRED_MODEL)
if MODEL_NAME != REQUIRED_MODEL:
    raise RuntimeError(
        f"MODEL is {MODEL_NAME!r}, but this homework must use {REQUIRED_MODEL!r} for every agent."
    )
PORTKEY_BASE_URL = "https://api.portkey.ai/v1"


def portkey_api_key() -> str:
    key = os.environ.get("PORTKEY_API_KEY")
    if not key:
        raise RuntimeError("PORTKEY_API_KEY is not set. Copy .env.example to .env and add your key.")
    return key


# ---- Paths -----------------------------------------------------------------
MCP_SERVER_SCRIPT = PROJECT_DIR / "mcp_server" / "server.py"
# Overridable for testing against a scratch copy; the defaults are the real homework files.
WORKING_DB = Path(os.environ.get("CAMPUS_CUSTOMS_DB", PROJECT_DIR / "data" / "campus_customs_new.db"))
AUDIT_TRAIL = Path(os.environ.get("CAMPUS_CUSTOMS_AUDIT", PROJECT_DIR / "output" / "audit_trail.json"))
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"

# ---- Token and loop limits (shared by the whole team on one ticket) ---------
TICKET_REQUEST_LIMIT = 40        # model calls per ticket, all agents combined
TICKET_TOOL_CALL_LIMIT = 45      # MCP + delegation calls per ticket
TICKET_TOTAL_TOKENS_LIMIT = 200_000
MAX_OUTPUT_TOKENS = 4_000        # per model response (includes reasoning tokens)
REASONING_EFFORT = "low"         # these are lookup-and-decide jobs, not puzzles
MAX_DELEGATION_DEPTH = 3         # boss -> specialist -> specialist -> specialist (a relay)
MAX_DELEGATIONS_PER_TICKET = 10
AUDIT_TEXT_LIMIT = 1_500         # characters kept per text field in the audit trail


# ============================================================================
# 2. Audit trail
# ============================================================================

_lock = threading.Lock()


def _trim(value: Any) -> Any:
    if isinstance(value, str):
        return value if len(value) <= AUDIT_TEXT_LIMIT else value[:AUDIT_TEXT_LIMIT] + "...[trimmed]"
    if isinstance(value, dict):
        return {k: _trim(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_trim(v) for v in value]
    return value


def audit_append(event: str, *, run_id: str, ticket_id: int | None, agent: str | None = None,
           step: int | None = None, depth: int | None = None, **details: Any) -> None:
    """Add one entry to the audit trail (never overwrites earlier entries)."""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "run_id": run_id,
        "ticket_id": ticket_id,
        "agent": agent,
        "depth": depth,
        "step": step,
        "event": event,
        **_trim(details),
    }
    with _lock:
        AUDIT_TRAIL.parent.mkdir(parents=True, exist_ok=True)
        entries: list = []
        if AUDIT_TRAIL.exists() and AUDIT_TRAIL.stat().st_size:
            try:
                entries = json.loads(AUDIT_TRAIL.read_text())
            except json.JSONDecodeError:
                # Never lose old evidence: keep the unreadable file and start a new list.
                AUDIT_TRAIL.rename(AUDIT_TRAIL.with_suffix(f".corrupt-{int(datetime.now().timestamp())}.json"))
        entries.append(entry)
        tmp = AUDIT_TRAIL.with_suffix(".tmp")
        tmp.write_text(json.dumps(entries, indent=1, default=str))
        os.replace(tmp, AUDIT_TRAIL)


# ============================================================================
# 3. MCP connection and per-agent guardrails
# ============================================================================

# Least privilege: each agent only sees the MCP tools its job needs.
AGENT_TOOLS: dict[str, set[str]] = {
    "boss": {"list_open_tickets", "get_ticket", "get_cash_position"},
    "inventory": {"get_ticket", "get_product_stock_and_price", "get_vendor_status"},
    "accounting": {
        "get_ticket", "get_cash_position", "get_vendor_status", "get_product_stock_and_price",
        "quote_bulk_discount", "request_payment_approval", "create_purchase_order", "save_draft_message",
    },
    "facilities": {"get_ticket", "get_rent_due", "get_cash_position", "save_draft_message"},
    "customer_service": {"get_product_stock_and_price", "save_draft_message"},
}

# Never given to any agent: a person uses these from the dashboard.
HUMAN_ONLY_TOOLS = {
    "create_account", "log_in", "log_out", "who_is_logged_in",
    "decide_approval", "resolve_ticket_as_person",
    "list_approvals", "list_tickets", "list_drafts", "reset_working_database",
}

# The backend, not the model, fills in who is acting.
IDENTITY_ARG = {
    "request_payment_approval": "requested_by",
    "create_purchase_order": "requested_by",
    "save_draft_message": "drafted_by",
    "update_ticket": "author",
}

# Write tools may only touch the ticket the team is working on.
TICKET_SCOPED_WRITES = set(IDENTITY_ARG)

# Who may draft to whom.
DRAFT_RECIPIENTS = {
    "customer_service": {"customer"},
    "facilities": {"landlord"},
    "accounting": {"vendor"},
}


def _mcp_client() -> Client:
    env = {"CAMPUS_CUSTOMS_DB": str(WORKING_DB), "FASTMCP_LOG_LEVEL": "WARNING"}
    if os.environ.get("CAMPUS_CUSTOMS_ACCOUNTS"):  # tests point accounts at a scratch file too
        env["CAMPUS_CUSTOMS_ACCOUNTS"] = os.environ["CAMPUS_CUSTOMS_ACCOUNTS"]
    transport = PythonStdioTransport(MCP_SERVER_SCRIPT, env=env)
    return Client(transport)


async def _guard_tool_call(ctx: RunContext[TeamDeps], call_tool: Any, name: str, args: dict[str, Any]) -> Any:
    """Runs before every MCP call an agent makes. Refusals go back to the model as tool results."""
    deps = ctx.deps
    if name in HUMAN_ONLY_TOOLS or name not in AGENT_TOOLS[deps.agent]:
        return {"ok": False, "error": f"{deps.agent} is not allowed to use {name}."}
    args = dict(args)
    if name in TICKET_SCOPED_WRITES and args.get("ticket_id") != deps.state.ticket_id:
        return {
            "ok": False,
            "error": f"This run is for ticket {deps.state.ticket_id}; write tools cannot touch ticket {args.get('ticket_id')}.",
        }
    if name == "save_draft_message" and args.get("recipient_type") not in DRAFT_RECIPIENTS.get(deps.agent, set()):
        return {"ok": False, "error": f"{deps.agent} may not draft messages to a {args.get('recipient_type')}."}
    if name in IDENTITY_ARG:
        args[IDENTITY_ARG[name]] = deps.agent
    return await call_tool(name, args)


def build_shop_toolset() -> MCPToolset:
    """One MCP connection shared by the whole team."""
    return MCPToolset(_mcp_client(), process_tool_call=_guard_tool_call, max_retries=1)


def toolset_for(shop: MCPToolset, agent: str):
    """The slice of the MCP server that one agent is allowed to see."""
    allowed = AGENT_TOOLS[agent]
    return shop.filtered(lambda ctx, tool_def: tool_def.name in allowed)


def operator_client() -> Client:
    """MCP client for the runner and dashboard (reset, approvals, checks). Never given to an agent."""
    return _mcp_client()


# ============================================================================
# 4. The agent team
# ============================================================================

ROSTER: dict[str, str] = {
    "boss": "Reads each ticket, assigns the work, weighs the findings, and makes the final call.",
    "inventory": "Checks stock by SKU and size, finds shortfalls, and picks which vendor can restock and how fast.",
    "accounting": "Watches cash and invoices, checks margins and discounts, and queues payments and purchase orders for a person to approve.",
    "facilities": "Handles the shop space: leases, rent, and landlord messages.",
    "customer_service": "Drafts warm, accurate messages to customers. Drafts are never sent automatically.",
}


def build_model() -> OpenAIResponsesModel:
    """The single model every agent uses, through Portkey.

    Uses the Responses API: Azure only allows tools together with reasoning there.
    """
    key = portkey_api_key()
    client = AsyncOpenAI(
        base_url=PORTKEY_BASE_URL, api_key=key, default_headers={"x-portkey-api-key": key}
    )
    settings = OpenAIResponsesModelSettings(
        max_tokens=MAX_OUTPUT_TOKENS, openai_reasoning_effort=REASONING_EFFORT
    )
    return OpenAIResponsesModel(MODEL_NAME, provider=OpenAIProvider(openai_client=client), settings=settings)


def _instructions(name: str) -> str:
    """The agent's prompt file plus a generated note on its teammates."""
    body = (PROMPTS_DIR / f"{name}.md").read_text()
    team = "\n".join(
        f"- **{other}**: {desc} (tools: {', '.join(sorted(AGENT_TOOLS[other]))})"
        for other, desc in ROSTER.items() if other != name
    )
    return (
        f"{body}\n\n## Your teammates\n\nUse `ask_teammate` to hand work to any of them. Give one "
        f"self-contained request with the ticket id and every detail they need. They see only what "
        f"you send. You cannot ask someone who is already in the current chain of requests.\n\n{team}\n"
    )


class CampusCustomsTeam:
    def __init__(self) -> None:
        self.model = build_model()
        self.shop = build_shop_toolset()
        self.limits = UsageLimits(
            request_limit=TICKET_REQUEST_LIMIT,
            tool_calls_limit=TICKET_TOOL_CALL_LIMIT,
            total_tokens_limit=TICKET_TOTAL_TOKENS_LIMIT,
        )
        self.agents: dict[str, Agent[TeamDeps, Any]] = {
            name: Agent(
                self.model,
                name=name,
                deps_type=TeamDeps,
                output_type=TicketDecision if name == "boss" else TeamReply,
                instructions=_instructions(name),
                toolsets=[toolset_for(self.shop, name)],
                tools=[self._ask_teammate_tool()],
                retries=1,
            )
            for name in ROSTER
        }

    # ---- Delegation (full connectivity) --------------------------------------

    def _ask_teammate_tool(self):
        team = self

        async def ask_teammate(ctx: RunContext[TeamDeps], teammate: AgentName, request: str) -> dict:
            """Hand a piece of work to a teammate and get their reply.

            Args:
                teammate: boss, inventory, accounting, facilities, or customer_service.
                request: A self-contained request: the ticket id, the facts they need, and exactly what you want back.
            """
            deps = ctx.deps
            state = deps.state
            refusal = None
            if teammate == deps.agent:
                refusal = "You cannot delegate to yourself."
            elif teammate in deps.chain:
                refusal = f"{teammate} is already working on this request chain ({' -> '.join(deps.chain)}). Answer with what you have."
            elif deps.depth >= MAX_DELEGATION_DEPTH:
                refusal = "Delegation depth limit reached. Use your own tools or report what you have."
            elif state.delegations >= MAX_DELEGATIONS_PER_TICKET:
                refusal = "This ticket has used its delegation budget. Wrap up with what you have."
            if refusal:
                audit_append("delegation_refused", run_id=state.run_id, ticket_id=state.ticket_id,
                             agent=deps.agent, depth=deps.depth, step=state.next_step(),
                             to=teammate, reason=refusal)
                return {"ok": False, "error": refusal}

            state.delegations += 1
            audit_append("delegation", run_id=state.run_id, ticket_id=state.ticket_id, agent=deps.agent,
                         depth=deps.depth, step=state.next_step(), to=teammate, request=request)
            sub_deps = TeamDeps(agent=teammate, state=state, depth=deps.depth + 1, chain=[*deps.chain, teammate])
            prompt = f"Ticket {state.ticket_id}. Request from {deps.agent}:\n{request}"
            reply = await team._run_agent(teammate, prompt, sub_deps, ctx.usage)
            return reply.model_dump()

        return ask_teammate

    # ---- One agent loop, fully audited ---------------------------------------

    async def _run_agent(self, name: str, prompt: str, deps: TeamDeps, usage: RunUsage):
        state = deps.state
        log = dict(run_id=state.run_id, ticket_id=state.ticket_id, agent=name, depth=deps.depth)
        agent = self.agents[name]
        async with agent.iter(prompt, deps=deps, usage=usage, usage_limits=self.limits) as run:
            async for node in run:
                if isinstance(node, UserPromptNode):
                    audit_append("agent_start", step=state.next_step(), prompt=prompt, **log)
                elif isinstance(node, ModelRequestNode):
                    returns = [
                        {"tool": p.tool_name, "result": p.model_response_str()}
                        for p in node.request.parts if isinstance(p, ToolReturnPart)
                    ]
                    retries = [
                        {"tool": p.tool_name, "error": p.model_response()}
                        for p in node.request.parts if isinstance(p, RetryPromptPart)
                    ]
                    if returns or retries:
                        audit_append("tool_results", step=state.next_step(), results=returns, retries=retries, **log)
                elif isinstance(node, CallToolsNode):
                    resp = node.model_response
                    audit_append(
                        "model_response",
                        step=state.next_step(),
                        model_requested=MODEL_NAME,
                        model_reported=resp.model_name,
                        text=" ".join(p.content for p in resp.parts if isinstance(p, TextPart)) or None,
                        tool_calls=[
                            {"tool": p.tool_name, "args": p.args_as_dict()}
                            for p in resp.parts if isinstance(p, ToolCallPart)
                        ],
                        input_tokens=resp.usage.input_tokens,
                        output_tokens=resp.usage.output_tokens,
                        **log,
                    )
            output = run.result.output
        audit_append("agent_end", step=state.next_step(), output=output.model_dump(), **log)
        return output

    # ---- Public entry points -------------------------------------------------

    async def run_ticket(self, ticket_id: int) -> TicketRunResult:
        """The boss works one ticket, delegating as needed."""
        state = TicketRunState(run_id=uuid.uuid4().hex[:12], ticket_id=ticket_id)
        usage = RunUsage()
        audit_append("ticket_run_start", run_id=state.run_id, ticket_id=ticket_id, model=MODEL_NAME,
                     limits=dict(requests=TICKET_REQUEST_LIMIT, tool_calls=TICKET_TOOL_CALL_LIMIT,
                                 total_tokens=TICKET_TOTAL_TOKENS_LIMIT, delegations=MAX_DELEGATIONS_PER_TICKET,
                                 depth=MAX_DELEGATION_DEPTH))
        decision, error = None, None
        deps = TeamDeps(agent="boss", state=state, depth=0, chain=["boss"])
        try:
            # Hand the boss the ticket up front (read through MCP) so it can start the relay right away.
            async with operator_client() as client:
                ticket = (await client.call_tool("get_ticket", {"ticket_id": ticket_id})).data
            brief = json.dumps({k: ticket[k] for k in ("date_today", "ticket", "team_notes", "approval_requests",
                                                       "purchase_orders", "drafts")}, default=str)
            decision = await self._run_agent(
                "boss", f"Work ticket {ticket_id}. Here is the ticket and any earlier work, from get_ticket:\n{brief}",
                deps, usage,
            )
            await self._record_decision(ticket_id, decision, state.run_id)
        except UsageLimitExceeded as exc:
            error = f"Stopped: usage limit reached ({exc})."
        except Exception as exc:  # keep the board consistent even if a run fails
            error = f"Stopped: {type(exc).__name__}: {exc}"

        id_check = await self._check_ids(ticket_id, decision) if decision else {}
        if error:
            await self._escalate(ticket_id, error)
        audit_append("ticket_run_end", run_id=state.run_id, ticket_id=ticket_id, error=error,
                     decision=decision.model_dump() if decision else None, id_check=id_check,
                     requests=usage.requests, input_tokens=usage.input_tokens,
                     output_tokens=usage.output_tokens, delegations=state.delegations)
        return TicketRunResult(ticket_id, state.run_id, decision, error, usage.requests,
                               usage.input_tokens, usage.output_tokens, id_check)

    async def _record_decision(self, ticket_id: int, decision: TicketDecision, run_id: str) -> None:
        """Write the boss's status and decision to the ticket through MCP (saves the boss a model call)."""
        async with operator_client() as client:
            result = (await client.call_tool("update_ticket", {
                "ticket_id": ticket_id, "status": decision.status,
                "note": decision.decision[:900], "author": "boss",
            })).data
        audit_append("ticket_updated", run_id=run_id, ticket_id=ticket_id, agent="boss", result=result)

    async def _check_ids(self, ticket_id: int, decision: TicketDecision) -> dict:
        """Compare the ids the boss reported with what is really in the database."""
        async with operator_client() as client:
            ticket = (await client.call_tool("get_ticket", {"ticket_id": ticket_id})).data
        real = {
            "approval_request_ids": {a["id"] for a in ticket["approval_requests"]},
            "purchase_order_ids": {p["id"] for p in ticket["purchase_orders"]},
            "draft_ids": {d["id"] for d in ticket["drafts"]},
        }
        unknown = {k: sorted(set(getattr(decision, k)) - v) for k, v in real.items()}
        return {
            "ok": not any(unknown.values()),
            "ids_not_in_database": {k: v for k, v in unknown.items() if v},
            "status_in_database": ticket["ticket"]["status"],
        }

    async def _escalate(self, ticket_id: int, reason: str) -> None:
        async with operator_client() as client:
            await client.call_tool("update_ticket", {
                "ticket_id": ticket_id, "status": "escalated",
                "note": f"Agent run did not finish. {reason[:300]}", "author": "system",
            })

    async def run_open_tickets(self) -> list[TicketRunResult]:
        """Work every open ticket, oldest first, one at a time (they share the same cash)."""
        async with operator_client() as client:
            tickets = (await client.call_tool("list_open_tickets", {})).data["tickets"]
        results = []
        async with self.shop:
            for t in tickets:
                results.append(await self.run_ticket(t["id"]))
        return results

    async def run_one(self, ticket_id: int) -> TicketRunResult:
        async with self.shop:
            return await self.run_ticket(ticket_id)


async def reset_working_database() -> dict:
    """Copy the original database over the working copy, through the MCP server."""
    async with operator_client() as client:
        return (await client.call_tool("reset_working_database", {})).data


assert set(get_args(AgentName)) == set(ROSTER) == set(AGENT_TOOLS)


# ============================================================================
# 5. FastAPI routes for the dashboard
# ============================================================================

# One agent run at a time: every ticket draws on the same cash.
RUN_LOCK = asyncio.Lock()
RUNS: dict[int, dict[str, Any]] = {}
_TASKS: set[asyncio.Task] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.team = CampusCustomsTeam()
    app.state.mcp = operator_client()
    async with app.state.mcp, app.state.team.shop:
        yield


app = FastAPI(title="Campus Customs Agent Desk", version="1.0", lifespan=lifespan)
# The React desk runs on Vite at http://localhost:5173; allow it (and other local ports) to call these routes.
VITE_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=VITE_ORIGINS,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


async def mcp(tool: str, args: dict | None = None) -> dict:
    """Call one MCP tool as the operator (never as an agent)."""
    try:
        result = await app.state.mcp.call_tool(tool, args or {})
    except ToolError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result.data


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---- Request bodies ------------------------------------------------------------

class Decision(BaseModel):
    note: str = ""


class Resolution(BaseModel):
    note: str = Field(min_length=1, max_length=1000)


class SignUp(BaseModel):
    username: str
    display_name: str
    password: str


class LogIn(BaseModel):
    username: str
    password: str


def _session(authorization: str | None) -> str:
    """The person's session token from 'Authorization: Bearer <token>'. Agents never have one."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Log in on the dashboard first. Only a logged-in person can do this.")
    return authorization.split(" ", 1)[1].strip()


def _human_check(result: dict) -> dict:
    """Turn an MCP refusal into an HTTP error: 401 for login problems, 409 for anything else."""
    if result.get("ok"):
        return result
    err = result.get("error", "Refused.")
    code = 401 if ("Log in" in err or "login" in err.lower()) else 409
    raise HTTPException(status_code=code, detail=err)


# ---- Routes --------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    return {"ok": True, "model": MODEL_NAME, "working_db": str(WORKING_DB), "run_in_progress": RUN_LOCK.locked()}


# ---- People: sign up, log in, log out ---------------------------------------

@app.post("/auth/signup")
async def signup(body: SignUp) -> dict:
    """Create a person's account (username, full name, password). The password is stored only as a salted hash."""
    result = await mcp("create_account", body.model_dump())
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@app.post("/auth/login")
async def login(body: LogIn) -> dict:
    """Log a person in. Returns a session token the dashboard sends with approvals."""
    result = await mcp("log_in", body.model_dump())
    if not result.get("ok"):
        raise HTTPException(status_code=401, detail=result.get("error"))
    return result


@app.post("/auth/logout")
async def logout(authorization: str | None = Header(default=None)) -> dict:
    return await mcp("log_out", {"session_token": _session(authorization)})


@app.get("/auth/me")
async def me(authorization: str | None = Header(default=None)) -> dict:
    """Who is logged in with this session."""
    return _human_check(await mcp("who_is_logged_in", {"session_token": _session(authorization)}))


@app.get("/tickets")
async def list_tickets() -> dict:
    """All tickets with status and whether each is still open."""
    return await mcp("list_tickets")


@app.get("/tickets/{ticket_id}")
async def ticket_detail(ticket_id: int) -> dict:
    """One ticket with notes, approval requests, purchase orders, and full draft text."""
    detail = await mcp("get_ticket", {"ticket_id": ticket_id})
    if not detail.get("found"):
        raise HTTPException(status_code=404, detail=detail.get("error"))
    detail["drafts"] = (await mcp("list_drafts", {"ticket_id": ticket_id}))["drafts"]
    detail["last_run"] = _run_view(ticket_id)
    return detail


async def _run_ticket(ticket_id: int) -> None:
    async with RUN_LOCK:
        RUNS[ticket_id].update(state="running", started_at=_now())
        try:
            result = await app.state.team.run_ticket(ticket_id)
            RUNS[ticket_id].update(
                state="error" if result.error else "done",
                run_id=result.run_id,
                error=result.error,
                decision=result.decision.model_dump() if result.decision else None,
                model_calls=result.requests,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                id_check=result.id_check,
            )
        except Exception as exc:
            RUNS[ticket_id].update(state="error", error=f"{type(exc).__name__}: {exc}")
        RUNS[ticket_id]["finished_at"] = _now()


def _run_view(ticket_id: int) -> dict | None:
    run = RUNS.get(ticket_id)
    return {k: v for k, v in run.items() if k != "task"} if run else None


@app.post("/tickets/{ticket_id}/run", status_code=202)
async def run_ticket(ticket_id: int, wait: bool = False) -> dict:
    """Start the agent team on one ticket. Poll GET /tickets/{id}/run or /events for progress."""
    if RUN_LOCK.locked():
        raise HTTPException(status_code=409, detail="Another agent run is in progress. Try again when it finishes.")
    detail = await mcp("get_ticket", {"ticket_id": ticket_id})
    if not detail.get("found"):
        raise HTTPException(status_code=404, detail=detail.get("error"))
    if detail["ticket"]["status"] == "resolved":
        raise HTTPException(status_code=409, detail=f"Ticket {ticket_id} is already resolved.")
    RUNS[ticket_id] = {"ticket_id": ticket_id, "state": "queued", "queued_at": _now()}
    task = asyncio.create_task(_run_ticket(ticket_id))
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)
    if wait:
        await task
    return _run_view(ticket_id)


@app.get("/tickets/{ticket_id}/run")
async def run_status(ticket_id: int) -> dict:
    """Status of the latest agent run on a ticket (queued, running, done, or error)."""
    view = _run_view(ticket_id)
    if view is None:
        raise HTTPException(status_code=404, detail=f"No run started for ticket {ticket_id} since the server started.")
    return view


@app.post("/tickets/{ticket_id}/resolve")
async def resolve_ticket(ticket_id: int, body: Resolution, authorization: str | None = Header(default=None)) -> dict:
    """A logged-in person closes a ticket by hand (e.g. after an escalation)."""
    return _human_check(await mcp("resolve_ticket_as_person", {
        "ticket_id": ticket_id, "session_token": _session(authorization), "note": body.note,
    }))


@app.get("/events")
async def events(
    limit: int = Query(100, ge=1, le=500),
    ticket_id: int | None = None,
    run_id: str | None = None,
    after: str | None = Query(None, description="Only events with ts after this ISO timestamp."),
) -> dict:
    """Recent agent events from output/audit_trail.json: what each agent said and which tools it used."""
    if not AUDIT_TRAIL.exists():
        return {"count": 0, "events": []}
    try:
        entries = json.loads(AUDIT_TRAIL.read_text())
    except json.JSONDecodeError:
        raise HTTPException(status_code=503, detail="Audit trail is being written; try again.")
    if ticket_id is not None:
        entries = [e for e in entries if e.get("ticket_id") == ticket_id]
    if run_id:
        entries = [e for e in entries if e.get("run_id") == run_id]
    if after:
        entries = [e for e in entries if e.get("ts", "") > after]
    entries = entries[-limit:]
    return {"count": len(entries), "latest_ts": entries[-1]["ts"] if entries else after, "events": entries}


@app.get("/approvals")
async def approvals(status: str = Query("pending", pattern="^(pending|approved|rejected|all)$")) -> dict:
    """Approval requests the agents prepared (pending by default)."""
    return await mcp("list_approvals", {"status": status})


async def _decide(approval_id: int, decision: str, body: Decision, authorization: str | None) -> dict:
    return _human_check(await mcp("decide_approval", {
        "approval_id": approval_id, "decision": decision, "session_token": _session(authorization), "note": body.note,
    }))


@app.post("/approvals/{approval_id}/approve")
async def approve(approval_id: int, body: Decision, authorization: str | None = Header(default=None)) -> dict:
    """A logged-in person approves a payment or purchase order. The only route that moves cash."""
    return await _decide(approval_id, "approve", body, authorization)


@app.post("/approvals/{approval_id}/reject")
async def reject(approval_id: int, body: Decision, authorization: str | None = Header(default=None)) -> dict:
    """A logged-in person rejects a request. No money moves."""
    return await _decide(approval_id, "reject", body, authorization)


@app.get("/cash")
async def cash() -> dict:
    """Current checking balance from cash_accounts, plus what is spoken for by pending requests."""
    pos = await mcp("get_cash_position")
    checking = next((a for a in pos["accounts"] if a["account"] == "checking"), None)
    if checking is None:
        raise HTTPException(status_code=404, detail="No checking account.")
    return {"date_today": pos["date_today"], **checking, "pending_requests": pos["pending_requests"]}


@app.post("/reset")
async def reset() -> dict:
    """Copy the original database over the working copy for a fresh run. The audit trail is kept."""
    if RUN_LOCK.locked():
        raise HTTPException(status_code=409, detail="An agent run is in progress. Reset when it finishes.")
    result = await mcp("reset_working_database")
    RUNS.clear()
    return result


# ============================================================================
# 6. Command line
# ============================================================================

async def cli() -> None:
    parser = argparse.ArgumentParser(description="Run the Campus Customs agent team from the command line.")
    parser.add_argument("--ticket", type=int, help="Work only this ticket id.")
    parser.add_argument("--reset", action="store_true", help="Copy the original DB over the working copy first.")
    args = parser.parse_args()

    if args.reset:
        print("Reset:", await reset_working_database())

    team = CampusCustomsTeam()
    results = [await team.run_one(args.ticket)] if args.ticket else await team.run_open_tickets()

    for r in results:
        print(f"\n=== Ticket {r.ticket_id} (run {r.run_id}) ===")
        print(f"model calls: {r.requests}, tokens in/out: {r.input_tokens}/{r.output_tokens}")
        if r.error:
            print("ERROR:", r.error)
        if r.decision:
            print(json.dumps(r.decision.model_dump(), indent=2))
        if r.id_check:
            print("id check:", r.id_check)




if __name__ == "__main__":
    import sys
    if "--run" in sys.argv:
        sys.argv.remove("--run")
        asyncio.run(cli())
    else:
        print("Start the API with:  uvicorn main:app --reload --port 8000")
        print("Or run the agents:   python main.py --run [--reset] [--ticket 101]")
