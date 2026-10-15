# HW5: Campus Customs Multi-Agent Shop

Five AI agents (**boss, inventory, accounting, facilities, customer service**) work the Campus Customs shop's tickets through one **MCP server**, behind a **FastAPI backend** and a **React dashboard**. Every agent runs on `gpt-6-luna` through Portkey. Agents only *prepare* payments: **only a logged-in human can approve money.** The full guide is in `output/harness.md`.

## What's in the repo

| Path | What it is |
|---|---|
| `mcp_server/server.py` | FastMCP server: every shop tool (stock, vendors, rent, cash, payment requests, purchase orders, drafts, approvals, human log-in) |
| `backend/main.py` | FastAPI routes, plus the five-agent team (PydanticAI) and its audit trail |
| `backend/models.py` | Data types (`TicketDecision`, `TeamReply`, run state) |
| `backend/prompts/` | One prompt per agent |
| `frontend/` | React + Vite + TypeScript dashboard |
| `data/campus_customs.db` | **Original** shop database. Never changed; only used to reset. |
| `data/campus_customs_new.db` | **Working copy** the app reads and writes. Committed in its final state after the official run (all 3 tickets resolved, checking $152.00). |
| `output/` | Harness, MCP smoke test, design notes, desk tickets (expected vs. actual, Cash, Reflection), resolved tickets and board, audit trail, GitHub URL |
| `AI_prompts.md` | Log of every prompt used to build this |

## One-time setup

You need Python 3.11+ and Node 18+.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd frontend && npm install && cd ..
cp .env.example .env        # then put your own PORTKEY_API_KEY in .env
```

The real `.env` is never committed (it's in `.gitignore`).

## Running it

### 1. Copy the original DB to the working copy (when you want a clean run)

```bash
cp data/campus_customs.db data/campus_customs_new.db
```

This puts all three tickets back to `open` and checking back to **$3,400.00**. (Step 5 below does the same thing from the dashboard.)

### 2. Start the MCP server

```bash
.venv/bin/python mcp_server/server.py
```

It's a **stdio** MCP server. In a terminal it just waits quietly for a client, so running it like this is a check that it starts (stop it with Ctrl+C). **The FastAPI backend starts its own copy automatically** in step 3, so you don't need to keep this one running. Claude Code can also connect to it through `.mcp.json`.

### 3. Start the FastAPI backend (http://localhost:8000)

```bash
cd backend
../.venv/bin/uvicorn main:app --reload --port 8000
```

Interactive API docs are at http://localhost:8000/docs.

### 4. Start the React board (http://localhost:5173), in a second terminal

```bash
cd frontend
npm run dev
```

This opens the board in your browser. The board calls the backend at `http://localhost:8000`.

### 5. Reset the DB before a full three-ticket run

Before you run all three tickets, reset the working database so you start clean. Any one of these works:
- On the board, click **Start over** (top right) and confirm.
- `curl -X POST http://localhost:8000/reset`
- `.venv/bin/python mcp_server/server.py --reset`
- Step 1's `cp` command (with the backend stopped)

Then, on the **Tickets** tab, click **Run agents** on **101**, **102** and **103**, one at a time. You can watch the agents work live.

### 6. Approve as a human

1. Click **Log in → Create account** (username, full name, password). Then go to the **Approvals** tab and approve:
   - **#1** invoice 501 ($840)
   - **#2** purchase order ($8), which unlocks after #1
   - **#3** rent ($2,400)
2. Open ticket **103** (escalated, because the restock can't be funded) and click **Mark resolved** with a note.

Checking should end at **$3,400 − $840 − $8 − $2,400 = $152.00**.

You can also run the agents without the board:

```bash
cd backend && ../.venv/bin/python main.py --run --reset
```

## For the TA / grader: approving payments

Approving, rejecting, and closing a ticket by hand all need a **logged-in person**. The AI agents can't sign up, log in, or approve. Please create **your own** account on the board (**Log in → Create account**). Your approvals are recorded under your name.

Accounts are saved in `data/accounts.db`. That file is created automatically, git-ignored, and holds only salted password hashes. **Start over** doesn't wipe it.

You don't need to approve anything to check the submitted run. The evidence is in the repo:
- `output/resolved_tickets.json`: outcomes, what each agent did, human approvals, and the cash check
- `output/resolved_board.html`: board screenshots of each resolved ticket (double-click to open)
- `output/desk_tickets.html`: expected vs. actual for each ticket, the Cash tab, and the Reflection
- `output/audit_trail.json`: every agent loop step (append-only)
- `data/campus_customs_new.db`: the final state (`cash_accounts.checking = 152.0`, 3 payments approved by Alex Kew)
