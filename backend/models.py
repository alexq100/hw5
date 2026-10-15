"""Data types for the Campus Customs agent team."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

AgentName = Literal["boss", "inventory", "accounting", "facilities", "customer_service"]
TicketStatus = Literal["open", "in_progress", "awaiting_approval", "resolved", "escalated"]


# ---- What agents return ------------------------------------------------------

class TeamReply(BaseModel):
    """What a specialist hands back to whoever asked it for help."""

    summary: str = Field(description="One or two short sentences answering the request.")
    facts: list[str] = Field(
        default_factory=list,
        description="Each key number or date you relied on, with the tool it came from, "
        "e.g. 'CC-HOOD-NAVY M on hand = 8 (get_product_stock_and_price)'.",
    )
    actions_taken: list[str] = Field(
        default_factory=list,
        description="Anything you wrote, with its id, e.g. 'approval request #1 for invoice 501 ($840)'. "
        "Empty if you only looked things up.",
    )
    needs_human: list[str] = Field(
        default_factory=list, description="Decisions or approvals only a person can make."
    )
    blockers: list[str] = Field(default_factory=list, description="What stops this from moving forward.")


class TicketDecision(BaseModel):
    """The boss's final call on one ticket."""

    ticket_id: int
    status: TicketStatus = Field(description="The status for the ticket. The desk records it for you.")
    decision: str = Field(description="The call you made, in one or two plain sentences.")
    highlights: list[str] = Field(
        default_factory=list,
        description="Three to five short bullets (under 15 words each) summarizing the key facts and actions.",
    )
    rationale: str = Field(description="The fuller explanation, citing the facts the team found.")
    agents_involved: list[AgentName] = Field(default_factory=list)
    approval_request_ids: list[int] = Field(
        default_factory=list, description="Approval request ids created for this ticket (from tool results only)."
    )
    purchase_order_ids: list[int] = Field(default_factory=list)
    draft_ids: list[int] = Field(default_factory=list)
    human_next_steps: list[str] = Field(
        default_factory=list, description="What the person at the dashboard should do next, in order."
    )


# ---- Run state ---------------------------------------------------------------

@dataclass
class TicketRunState:
    """Shared by every agent working on one ticket."""

    run_id: str
    ticket_id: int
    delegations: int = 0
    step: int = 0

    def next_step(self) -> int:
        self.step += 1
        return self.step


@dataclass
class TeamDeps:
    """Dependencies passed to each agent run. A new copy is made for each delegation."""

    agent: AgentName
    state: TicketRunState
    depth: int = 0
    chain: list[str] = field(default_factory=list)


@dataclass
class TicketRunResult:
    ticket_id: int
    run_id: str
    decision: TicketDecision | None
    error: str | None
    requests: int
    input_tokens: int
    output_tokens: int
    id_check: dict
