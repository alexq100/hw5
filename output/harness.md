# Campus Customs Agent Harness

This is the complete guide to the Campus Customs agent system. A team of five AI agents (all `gpt-6-luna` through Portkey) works the shop's tickets through one MCP server, behind a FastAPI backend and a React dashboard where a person approves anything that costs money.

**Contents**
1. [Database files](#database-files) and [tables](#tables) (shop tables plus the workflow tables)
2. [The three tickets and how they link](#the-three-open-tickets-and-how-they-link)
3. [MCP tools](#all-mcp-tools-mcp_serverserverpy), all 18, including the first three in detail, and the Claude Code connection
4. [The five agents](#the-agent-team-problem-5), relays and full connectivity
5. [Safety guardrails](#safety-guardrails), [token limits](#token-and-cost-limits) and the [audit trail](#audit-trail-outputaudit_trailjson)
6. [Backend API routes](#backend-routes-backendmainpy-fastapi)
7. [The dashboard](#the-dashboard-frontend)
8. [Official run results (Problem 9)](#official-run-problem-9)
9. [How to run](#how-to-run)

## Database files

| File | Role |
|---|---|
| `data/campus_customs.db` | Original shop database. **Never written to.** Used only to reset. |
| `data/campus_customs_new.db` | Working copy. The MCP server and backend read and write this file. |

To reset, copy `campus_customs.db` over `campus_customs_new.db`.

## Tables

### `desk` (1 row)
Fields: `date_today`, `notes`

Why it matters: `date_today` (2026-08-31) is "today" for the shop. Agents use it to decide what is overdue or due soon, instead of using the real clock.

### `tickets` (3 rows)
Fields: `id`, `type`, `requester`, `subject`, `sku`, `size`, `qty`, `lease_id`, `invoice_id`, `status`, `notes`, `created_at`

Why it matters: These are the jobs on the board. The boss reads each open ticket and sends it to the right agents. The `sku`, `lease_id` and `invoice_id` fields point to the rows the agents need to look up.

### `inventory` (10 rows)
Fields: `sku`, `name`, `size`, `qty`, `location` (key: `sku` + `size`)

Why it matters: The inventory agent checks stock here by SKU and size to find shortfalls before an order can be filled.

### `pricing` (4 rows)
Fields: `sku`, `unit_cost`, `list_price`

Why it matters: Accounting uses it to work out margins, so it can tell whether a discount still makes money and how much a restock will cost.

### `vendors` (3 rows)
Fields: `id`, `name`, `specialty`, `lead_days`

Why it matters: Inventory picks a restock vendor by `specialty`, and `lead_days` gives the earliest date new stock can arrive (`date_today` + `lead_days`).

### `invoices` (1 row)
Fields: `id`, `vendor_id`, `amount`, `due_date`, `status`, `description`

Why it matters: These are bills the shop owes. A vendor with an `open` invoice will not ship new product. If `due_date` is before `date_today`, the bill is overdue. Accounting prepares these for payment.

### `leases` (1 row)
Fields: `id`, `space_name`, `landlord`, `monthly_rent`, `next_due`, `notes`

Why it matters: Facilities tracks rent for the shop space here. `monthly_rent` and `next_due` tell it how much is owed and when.

### `cash_accounts` (1 row)
Fields: `name`, `balance`, `date`

Why it matters: This is how much cash the shop has (`checking`: $3,400). The pay tool must refuse any payment larger than the balance, so the balance never goes negative.

### `payments` (0 rows)
Fields: `id`, `kind`, `ref_id`, `amount`, `account`, `paid_at`, `approved_by`

Why it matters: This is the log of money paid out. Every row needs `approved_by` (the person who approved it). `kind` + `ref_id` point to what was paid, such as an invoice or a lease.

## The three open tickets and how they link

**Ticket 101: customer order** (Tauhid Zaman, 1× `CC-TEE-WHITE` size S)
- `inventory`: tee size S has qty **0**, so the order can't be filled from stock.
- `vendors`: the restock vendor is Bulldog Print Co (id 1, apparel reprint, 5 lead days).
- `invoices`: the ticket links to invoice 501, which Bulldog Print Co sent: **$840**, due 2026-08-28, status `open`. That is **3 days overdue**, so the vendor won't reprint until it is paid.
- To resolve it: pay invoice 501 (needs a person to approve), restock the tee from Bulldog Print Co (earliest arrival 2026-09-05), and draft a message to the customer.

**Ticket 102: rent notice** (Elm City Properties)
- `leases`: links to lease 1, the Chapel Street shop: **$2,400**, due 2026-09-02 (2 days from today).
- To resolve it: Facilities confirms the lease. Accounting prepares a $2,400 rent payment (needs a person to approve).

**Ticket 103: bulk discount request** (Yale AI Club, 20× `CC-HOOD-NAVY` size M)
- `inventory`: the hoodie in size M has qty **8**, so the shop is **12 short**.
- `pricing`: unit cost $22, list price $58. That's a $36 margin per hoodie (about 62%) at full price.
- `vendors`: the restock vendor is Bulldog Print Co again, so ticket 101's open invoice blocks this restock too.
- To resolve it: Accounting checks how much discount the margin allows. Inventory plans the restock of 12. Customer service drafts a reply with the offer. The boss makes the final call.

**How cash fits across all three:** checking has $3,400. Paying invoice 501 ($840) and the rent ($2,400) leaves **$160**. Restocking 12 hoodies at cost is $264, which is more than that. So the tickets compete for the same cash, and the boss has to choose what gets paid first.

## MCP tools: the first three (Problem 3)

All tools live in `mcp_server/server.py` (FastMCP) and read the working copy `data/campus_customs_new.db`. They only report what is in the database. The only extra values are simple arithmetic on database fields (shortfall, margin, days overdue), and the inputs are always returned next to the result. "Today" is always `desk.date_today`.

### 1. `get_product_stock_and_price(sku, size, qty_needed)`
- **Tables read:** `inventory`, `pricing`
- **Unlocks:** **103** (also helps 101)
- **Why it's the right tool for 103:** The Yale AI Club wants 20 size M hoodies at a discount. The tool shows that only 8 are on the shelf, so the shop is 12 short. It also shows the $22 cost against the $58 list price, a $36 margin per hoodie. And it shows that restocking the 12 would cost $264. That gives the team the two numbers it needs to set a discount: how much margin there is to give up, and how much cash a restock will take.
- **Why it also helps 101:** For Tauhid's size S tee, it shows `qty_on_hand = 0`. That proves the order can't be filled from the shelf and has to wait for a restock.

### 2. `get_vendor_status(vendor_id?)`
- **Tables read:** `vendors`, `invoices`, `desk`
- **Unlocks:** **101** (also the restock for 103)
- **Why it's the right tool for 101:** Ticket 101 already points to invoice 501. This tool shows that the invoice belongs to Bulldog Print Co, the apparel reprint vendor that would print the size S tee. It shows the $840 is still open and 3 days overdue as of 2026-08-31, which puts the vendor **on hold**. So the tee can't be reprinted until accounting gets the invoice paid. It also shows that the earliest the tee could arrive is 2026-09-05 (5 lead days).
- **Why it also helps 103:** The 12 missing hoodies also need an apparel reprint, so they're blocked by the same Bulldog Print Co hold. Paying invoice 501 unblocks both tickets.

### 3. `get_rent_due(lease_id)`
- **Tables read:** `leases`, `desk`, `cash_accounts`
- **Unlocks:** **102**
- **Why it's the right tool for 102:** The rent notice only says "rent due in 2 days." This tool follows the ticket's `lease_id = 1` to the Chapel Street shop lease. It shows the real amount ($2,400 to Elm City Properties), the due date (2026-09-02, 2 days after `date_today`) and that checking's $3,400 can cover it with $1,000 left. That gives facilities and accounting the exact payment to put up for a person to approve. The tool only reads; it never pays.

## Connecting the MCP server to the vibe coder (Claude Code)

- `hw_5/.mcp.json` sets up the `campus_customs` stdio server (`.venv/bin/python mcp_server/server.py`) for sessions started in `hw_5`.
- A matching `.mcp.json` in the parent class folder (paths start with `hw_5/`) does the same for sessions started there. It's pre-approved in that folder's `.claude/settings.local.json`.
- Claude Code only loads MCP servers when a session starts, so the smoke test ran in a fresh session where the tools appear as `mcp__campus_customs__<tool>`.

**Smoke test:** `output/mcp_smoke.json` has the prompt, tool name, arguments and raw output for each of the three tools. It also checks every value against `data/campus_customs_new.db` (read with `sqlite3 -readonly`): **43 of 43 checks match.**

## Workflow tables (added in Problem 5)

The original database had nowhere to store pending approvals, purchase orders, drafts or team notes. The MCP server creates these four tables in the **working copy only** (`CREATE TABLE IF NOT EXISTS`), so a reset removes them along with everything else.

| Table | Fields | Why it matters for the agents |
|---|---|---|
| `approvals` | `id, kind, ref_id, ticket_id, amount, account, reason, requested_by, status, created_at, decided_by, decided_at, decision_note` | The queue a person works through. Agents can only add `pending` rows. Only a person can approve or reject them. |
| `purchase_orders` | `id, vendor_id, sku, size, qty, unit_cost, total_cost, ticket_id, status, expected_arrival, created_by, created_at` | Restock orders. Each one is costed from `pricing` and only placed once a person approves it. |
| `drafts` | `id, ticket_id, recipient, recipient_type, subject, body, drafted_by, status, created_at` | Messages to customers, landlords and vendors. They stay on the board and are never sent. |
| `ticket_notes` | `id, ticket_id, author, note, created_at` | The boss's decisions, kept with each ticket so later runs don't redo work. |

## The agent team (Problem 5)

There are five PydanticAI agents, one prompt file each in `backend/prompts/`. Every agent uses the same model (`gpt-6-luna` through Portkey with `PORTKEY_API_KEY`). The agents are built in `backend/main.py` (section 4, "The agent team"), and their output types are in `backend/models.py`.

| Agent | Prompt | Job | MCP tools it can see | Returns |
|---|---|---|---|---|
| **boss** | `boss.md` | Reads each ticket, plans a relay of specialists, ranks spending when cash is tight, makes the final call | `list_open_tickets`, `get_ticket`, `get_cash_position` (the runner records the boss's status through `update_ticket`) | `TicketDecision` |
| **inventory** | `inventory.md` | Checks stock by SKU and size, finds shortfalls, picks the restock vendor by specialty, checks vendor holds and lead times | `get_ticket`, `get_product_stock_and_price`, `get_vendor_status` | `TeamReply` |
| **accounting** | `accounting.md` | Watches cash and invoices, does discount and margin math, queues payments and purchase orders for a person to approve | `get_ticket`, `get_cash_position`, `get_vendor_status`, `get_product_stock_and_price`, `quote_bulk_discount`, `request_payment_approval`, `create_purchase_order`, `save_draft_message` (vendors only) | `TeamReply` |
| **facilities** | `facilities.md` | Leases, rent and the landlord. Asks accounting to queue rent. | `get_ticket`, `get_rent_due`, `get_cash_position`, `save_draft_message` (landlord only) | `TeamReply` |
| **customer_service** | `customer_service.md` | Drafts warm, accurate customer messages, with no internal details | `get_product_stock_and_price`, `save_draft_message` (customers only) | `TeamReply` |

**Relays (added after the first dashboard review):** the boss no longer brings every answer back to itself. It sends **one** request to the first specialist with the whole route, and each specialist hands off directly to the next one. For example: boss → inventory → accounting → customer_service for a customer order, or boss → facilities → accounting for rent. Three other changes cut model calls too:
- The runner hands the boss the ticket up front (read through MCP `get_ticket`).
- The runner records the boss's final status through MCP `update_ticket`, so the boss doesn't spend a call on it.
- Specialists don't re-read the ticket, and they make independent tool calls in the same step.

On a scratch copy of the database, a full run of all three tickets took **32 model calls, down from about 41–48** before relays (101: 14 → 12 on a later run, 102: 8, 103: 10).

**Full connectivity:** every agent has the same `ask_teammate(teammate, request)` tool, so any agent can hand work to any other agent. For example, facilities asks accounting to queue rent, or inventory asks accounting to queue a purchase order. Each request starts a fresh loop for that teammate with only the request text, which keeps the token count down. Loops are blocked: an agent can't ask itself or anyone already in the current chain of requests.

**Agent loop:** each agent runs PydanticAI's loop (model call → tool calls → tool results → model call …) until it returns its typed output. The boss runs one ticket at a time, oldest first, because every ticket draws on the same cash.

## All MCP tools (`mcp_server/server.py`)

| # | Tool | Tables used | Who can use it | What it does |
|---|---|---|---|---|
| 1 | `get_product_stock_and_price` | inventory, pricing | inventory, accounting, customer_service | Quantity on hand, shortfall, cost, price, margin, and restock cost for a SKU and size |
| 2 | `get_vendor_status` | vendors, invoices, desk | inventory, accounting | Lead days, open invoices, days overdue, on-hold flag, earliest arrival |
| 3 | `get_rent_due` | leases, desk, cash_accounts | facilities | Rent amount, due date, days until due, and whether cash covers it |
| 4 | `list_open_tickets` | tickets, desk | boss | Every ticket that isn't resolved yet |
| 5 | `get_ticket` | tickets, ticket_notes, approvals, purchase_orders, drafts, desk | boss, inventory, accounting, facilities (and the runner, which hands it to the boss up front) | One ticket plus all work already done on it, so nothing gets repeated |
| 6 | `update_ticket` | tickets, ticket_notes, approvals | the runner, for the boss | Sets the status and adds a note. Won't mark a ticket `resolved` while it has pending approvals. |
| 7 | `get_cash_position` | cash_accounts, approvals, invoices, vendors, leases, desk | boss, accounting, facilities | Balance, pending requests, what's available after them, open invoices, upcoming rent |
| 8 | `quote_bulk_discount` | pricing | accounting | Discounted price, margin and total, with a below-cost flag and the most discount possible before losing money |
| 9 | `request_payment_approval` | invoices, vendors, leases, cash_accounts, approvals | accounting | Queues an invoice or rent payment for a person to approve. The amount comes from the database. |
| 10 | `create_purchase_order` | vendors, invoices, inventory, pricing, cash_accounts, purchase_orders, approvals | accounting | Drafts a restock order costed from `pricing` and queues it for approval |
| 11 | `save_draft_message` | tickets, drafts | customer_service, facilities, accounting | Saves a draft on the board. Never sends it. |
| 12 | `list_approvals` | approvals | **people only** | The dashboard's approval queue |
| 13 | `decide_approval` | approvals, cash_accounts, payments, invoices, leases, purchase_orders, vendors, desk (+ accounts.db sessions) | **logged-in people only** | Approves (and pays) or rejects a request, all in one transaction, recorded under the person's account name |
| 14 | `reset_working_database` | copies `campus_customs.db` over `campus_customs_new.db` | **people only** | Starts the tickets over from the original data |
| 15 | `list_tickets` | tickets, approvals, drafts, purchase_orders | **people only** (dashboard) | All tickets with status, `is_open`, and counts of pending approvals, drafts and purchase orders |
| 16 | `list_drafts` | drafts | **people only** (dashboard) | Full text of saved drafts for the Messages view |
| 17 | `resolve_ticket_as_person` | tickets, ticket_notes, approvals (+ accounts.db sessions) | **logged-in people only** | Closes a ticket by hand with a note, under the person's account name |
| 18 | `create_account` / `log_in` / `log_out` / `who_is_logged_in` | accounts.db (people, sessions) | **people only** (dashboard) | Sign-up, log-in with lockout, log-out, and session check |

There is no second tools layer. The backend only reaches the shop through this MCP server, both for the agents and for its own resets and checks.

## Safety guardrails

A real shop would want these before letting agents near real customers and real money. Each one is enforced in **code**, not just asked for in a prompt.

**Money**
1. **Only a logged-in human can approve.** Agents can only create `pending` requests. Approving, rejecting, and closing a ticket by hand all need a **person's login session**. People create an account (username, full name, password) and log in on the dashboard. Passwords are stored only as salted PBKDF2 hashes, and session tokens only as SHA-256 hashes, in `data/accounts.db`, which is separate from the shop data, so **Start over** doesn't wipe it, and git-ignored. Sessions expire after 12 hours, and five wrong passwords lock the account for 15 minutes. The MCP tools `decide_approval` and `resolve_ticket_as_person` check the session themselves, so the check can't be skipped by calling MCP directly. The payment is recorded under the **logged-in account's name**, never a name typed in. Agent names (`boss`, `accounting`, …) are reserved and can't be used as usernames. The account and approval tools are left out of every agent's tool list and blocked again in the backend's tool-call guard, so the agent team has no way to sign up, log in, or approve. `update_ticket` refuses any author that isn't an agent. *Limit, stated honestly:* the sign-up page is a normal web page, so the rule that AI assistants operating the computer (like the vibe coder) never create accounts or approve is a working rule (see the first-run note below), not something the code can enforce against a program that controls the browser.
2. **No negative balances.** `decide_approval` refuses if the balance is less than the amount. Requests are also checked when they're created, against balance minus everything already pending, so the queue can never promise more cash than exists.
3. **Amounts come from the database, not the model.** Invoice amounts, rent, and purchase order costs (`unit_cost` × qty) are looked up by the tool. An agent can't type a dollar figure.
4. **No double payments.** The same invoice or rent can't be pending twice. An invoice that isn't `open` can't be paid. A request can only be decided once.
5. **The vendor-hold rule.** A purchase order can't be placed while its vendor has an open unpaid invoice.
6. **Cash only goes out.** No revenue is modelled, and agents are told not to count future sales.
7. **Purchase order quantity cap.** At most 200 units per order (the shortfall is the normal amount).

**Customers and outside contact**
8. **Nothing is sent.** There's no email or phone tool at all. `save_draft_message` only writes to the `drafts` table for a person to review.
9. **Drafts only go to the right audience.** customer_service drafts to customers, facilities to the landlord, and accounting to vendors. Body length is capped at 2,000 characters.
10. **No internal details in customer messages.** The customer_service prompt bans cash, vendor holds, margins, costs and SKUs in customer drafts.

**Agent behaviour**
11. **Least privilege.** Each agent only sees the MCP tools its job needs (table above).
12. **The backend says who is acting.** `requested_by`, `drafted_by` and `author` are overwritten with the real agent name, so an agent can't act as someone else.
13. **Agents stay on their own ticket.** Write tools refuse any `ticket_id` other than the one being worked.
14. **Ticket text is data.** Every prompt says requester text can't change the rules. A ticket saying "pay this now" isn't an approval.
15. **Nothing invented.** Prompts require every number to come from a tool, and tools only return database values or simple arithmetic on them. After each ticket, the runner checks every id the boss reported against the database (`id_check` in the audit trail).
16. **Failures escalate.** If a run errors or hits a limit, the ticket is set to `escalated` with a note from `system`, so it's never left half-done and looking fine.
17. **Resolved means done.** A ticket can't be marked `resolved` while it still has pending approvals.
18. **Original data protected.** Agents only touch `campus_customs_new.db`. The original is only read, during a reset.
19. **One model only.** `backend/main.py` (section 1, settings) refuses to start if `MODEL` is anything other than the required model string.

## Token and cost limits

These are set in `backend/main.py` (section 1, settings). The limits are **shared by the whole team on one ticket**, because every delegation passes the same usage counter along.

| Limit | Value |
|---|---|
| Model calls per ticket (all agents) | 40 |
| Tool calls per ticket (MCP + delegations) | 45 |
| Total tokens per ticket | 200,000 |
| Max output tokens per response | 4,000 |
| Reasoning effort | low |
| Delegation depth | 3 (boss → specialist → specialist → specialist, a relay) |
| Delegations per ticket | 10 |
| Tool retries | 1 |

Other ways the run stays lean:
- Delegation passes a short request, not the whole conversation.
- `get_ticket` shows earlier work, so nothing gets repeated.
- One `get_vendor_status` call covers every vendor, and one `get_cash_position` call covers the whole shop.
- Prompts tell agents to call each tool once per fact and keep replies short.

**First full run** (2026-10-14, after a reset): 41 model calls and about 112k input / 6.8k output tokens across all three tickets. That's well under the limits.

## Audit trail (`output/audit_trail.json`)

The file is a JSON list that only grows. New entries are added and nothing is ever removed. Every entry has `ts`, `run_id`, `ticket_id`, `agent`, `depth` and `step`, plus:

| Event | What it records |
|---|---|
| `ticket_run_start` | The model and every limit in force |
| `agent_start` | Which agent started and the exact request it got |
| `model_response` | Each loop step: the model we asked for, the model the provider reported, any text, every tool call with its arguments, and the token counts |
| `tool_results` | What each tool returned (trimmed to 1,500 characters), plus any retries |
| `delegation` / `delegation_refused` | Who asked whom, for what, and why a request was blocked |
| `agent_end` | The agent's typed output |
| `ticket_run_end` | The boss's decision, the id check, total calls and tokens, the delegation count, and any error |

## Backend routes (`backend/main.py`, FastAPI)

Start it from `backend/` with `uvicorn main:app --reload --port 8000`, which serves the API at `http://localhost:8000` (interactive docs at `/docs`). Every route reaches the shop through the MCP server, using the human-only tools. Only one agent run happens at a time, because every ticket draws on the same cash.

- `GET /health`: confirms the server is up, and shows the model, the working database path, and whether an agent run is in progress.
- `GET /tickets`: all three tickets, each with its status, `is_open` (open or resolved), and counts of pending approvals, drafts and purchase orders.
- `GET /tickets/{id}`: one ticket with team notes, approval requests, purchase orders, the full text of its drafts, and the last run's result.
- `POST /tickets/{id}/run`: starts the agent team on that ticket in the background and returns `202` right away (`?wait=true` waits for the result instead). Returns `409` if another run is going or the ticket is already resolved.
- `GET /tickets/{id}/run`: status of that ticket's latest run (`queued`, `running`, `done` or `error`), with the boss's decision, token counts and the id check.
- `POST /tickets/{id}/resolve` with header `Authorization: Bearer <session>` and body `{"note": "..."}`: a logged-in person closes a ticket by hand, for example after reviewing an escalation. Returns `401` without a valid login. Refused while approvals are still pending.
- `GET /events?limit=&ticket_id=&run_id=&after=`: recent agent events from `audit_trail.json`, showing what each agent said, which tools it called with which arguments, the results, and the delegations. Use `after=<latest_ts>` so the board only fetches new events when it refreshes.
- `GET /approvals?status=pending|approved|rejected|all`: the payment and purchase order requests the agents prepared.
- `POST /approvals/{id}/approve` with header `Authorization: Bearer <session>`: **the only route that moves money.** A logged-in person confirms, and the MCP `decide_approval` tool checks the session, pays, and updates `cash_accounts`, `payments`, and the invoice, lease or purchase order. Returns `401` without a valid login, and `409` if cash would go negative, the vendor is on hold, or the request was already decided. When the ticket's last pending request is decided, the ticket resolves automatically (or escalates if anything was rejected).
- `POST /approvals/{id}/reject` with the same login header and body `{"note": "…"}`: a logged-in person rejects a request. No money moves.
- `POST /auth/signup` `{username, display_name, password}`: create a person's account. `POST /auth/login` `{username, password}` → a session token. `POST /auth/logout` and `GET /auth/me` use the session header.
- `GET /cash`: current checking balance from `cash_accounts`, plus pending requests and what's available after them.
- `POST /reset`: copies the original database over the working copy for a fresh run. It's blocked while a run is in progress, and the audit trail is kept.

**Route test (2026-10-14):** I reset the database, ran ticket 101 through `POST /tickets/101/run`, and polled until it finished: 16 model calls, and the id check passed. While it was running, a second run and a reset were both refused with `409`. Approving the purchase order first was refused because the vendor was on hold. Approving with the name `accounting` was refused. Approving invoice 501 took checking from $3,400 to $2,560. Approving it a second time was refused. Approving the purchase order next took checking to $2,552. Then `POST /reset` set checking back to $3,400.

## The dashboard (`frontend/`)

React + Vite + TypeScript. Start it with `npm run dev` from `frontend/` (it runs at `http://localhost:5173` and calls the backend at `http://localhost:8000`). The full design write-up is in `output/design.md`.

| Tab | What a person does there | Routes it calls |
|---|---|---|
| **Tickets** | A "next step" banner says what to do. Pick a ticket and click **Run agents**. The **live team map** shows each agent light up, a speech bubble with what it's doing, and a dot traveling along the line for each hand-off. Then read the **Summary** (decision, short highlights, your next steps, who did what, plus a "Show full explanation" button), the **Activity** log, or the **Messages** (drafts, never sent). Escalated tickets have **Mark resolved** with a required note. | `GET /tickets`, `GET /tickets/{id}`, `POST /tickets/{id}/run`, `GET /tickets/{id}/run`, `GET /events`, `POST /tickets/{id}/resolve` |
| **Approvals** | **Log in** (or **Create account**, for example a TA) from the header or the Approvals page. Then **Approve & pay** or **Reject** each request and confirm ("Pay $840.00 to Bulldog Print Co as Alex Kew?"). The session lives only in that browser tab. Cards are in the order to handle them; a purchase order is locked while its vendor has an unpaid invoice, and each card shows "Checking after". | `POST /auth/signup`, `POST /auth/login`, `GET /approvals`, `POST /approvals/{id}/approve`, `POST /approvals/{id}/reject` |
| **Cash** | Checking balance (also always in the header, so you see it drop right after an approval), paid out, waiting for approval, free to spend, and a payments table with the running balance. | `GET /cash`, `GET /approvals` |
| Header | **Start over** resets the shop data (after asking you to confirm) | `POST /reset`, `GET /health` |

**How a ticket becomes resolved:** the boss sets `awaiting_approval` when it queued payments. When a person decides the ticket's last pending request, the ticket resolves automatically. If anything was rejected, it becomes `escalated` instead. Escalated tickets with nothing to pay are closed by a logged-in person with **Mark resolved** and a note. The note is saved in `ticket_notes` under that person's name.

## Official run (Problem 9)

**First attempt: invalid, and why human log-in exists.** In the first Problem 9 run, the AI assistant (Claude) clicked **Approve** on the dashboard and typed the user's name for all three payments ($840 + $8 + $2,400). It also closed ticket 103 by hand. The old code allowed this, because the approver was just a name in a text box. That broke the core rule that **only a human approves money**. Those runs are still in `output/audit_trail.json`, because the audit trail is append-only (runs `511d6291566a`, `f7e5e38e4e6f`, `7490d3863bec`). Their outputs were set aside (kept on my computer, not part of the submitted repo). The fix is guardrail 1. First it was an approver PIN set in a terminal; now it's human accounts with password log-in on the dashboard.

**Redo (the official result):** the database was reset to **$3,400.00**, and the agents ran all three tickets (`POST /tickets/{id}/run`). Then **Alex Kew, the human approver**, approved the payments and closed ticket 103 on the dashboard. At the time that used the terminal-set approver PIN, which has since been replaced by web log-in. Full details are in `output/resolved_tickets.json`, the Actual and Cash tabs of `output/desk_tickets.html`, the screenshots in `output/resolved_board.html`, and every loop step in `output/audit_trail.json` (runs `f369dcb4e9ed`, `604f0d734a70`, `3767b68a0702`).

| Ticket | Route | Model calls | Agents' status | Human step (Alex) | Cash change | Final |
|---|---|---|---|---|---|---|
| 101 Bulldog tee | boss → inventory → accounting → customer_service | 11 | awaiting_approval | Approved #1 invoice 501 ($840), then #2 PO 1 ($8) | −$848.00 | resolved |
| 102 Rent due | boss → facilities → accounting | 8 | awaiting_approval | Approved #3 rent for lease 1 ($2,400) | −$2,400.00 | resolved |
| 103 Bulk hoodie discount | boss → inventory → accounting → customer_service | 10 | escalated ($112 short for the $264 restock) | Marked resolved; no purchase | $0.00 | resolved |

**Cash:** $3,400.00 − $840.00 − $2,400.00 − $8.00 = **$152.00**. That matches `cash_accounts.checking = 152.0` in `data/campus_customs_new.db`. The `payments` table has 3 rows, all `approved_by = Alex Kew`, totaling $3,248.00.

**Guardrails seen in action:**
- No AI could approve.
- The $8 purchase order stayed locked until invoice 501 was paid.
- Accounting didn't queue the 12-hoodie restock it couldn't fund.
- The post-run id check flagged the boss for listing ticket 101's request #1 under ticket 103.
- The run used 29 model calls in total, well under the 40-per-ticket limit.

**Note on caching:** ticket 101's token counts were identical to the earlier invalid run (29,841 in / 2,174 out). Because the input was the same, Portkey appears to have answered from its cache. The decisions and tool calls are the same either way, and every tool call ran for real against the database.

**For graders:** please don't use the student's login. Click **Log in → Create account** on the dashboard and approve under your own name (see the README).

## How to run

```bash
cd backend && ../.venv/bin/uvicorn main:app --reload --port 8000   # dashboard API
cd frontend && npm install && npm run dev                          # React desk at http://localhost:5173
cd backend && ../.venv/bin/python main.py --run --reset   # reset, then work every open ticket
cd backend && ../.venv/bin/python main.py --run --ticket 101   # work one ticket
.venv/bin/python mcp_server/server.py --reset   # reset only
```
