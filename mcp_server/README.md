# Campus Customs MCP Server

## What it is for

This is a [FastMCP](https://gofastmcp.com) server that gives the Campus Customs agent team (boss, inventory, accounting, facilities and customer service) their shop tools. It is the **only** way into the shop data. The agent backend reaches the database through this server, and so does the runner when it resets the database or checks results. The tools only return what is in the database, plus simple arithmetic on it. They never make up stock, prices, vendors, dates or amounts.

## Database files

| File | How the server uses it |
|---|---|
| `data/campus_customs_new.db` | **Working copy.** Every tool reads and writes this file. |
| `data/campus_customs.db` | **Original.** Only read, when resetting. Never written. |

On the working copy, the server also creates four workflow tables: `approvals`, `purchase_orders`, `drafts` and `ticket_notes`. A reset removes them again. You can point the server at a different file with the `CAMPUS_CUSTOMS_DB` environment variable. "Today" for the shop is `desk.date_today` (2026-08-31), not the real date.

## Tools

**Read tools**

| Tool | Reads | Returns |
|---|---|---|
| `get_product_stock_and_price(sku, size, qty_needed=1)` | inventory, pricing | Quantity on hand, shortfall, cost, list price, margin, and restock cost |
| `get_vendor_status(vendor_id=None)` | vendors, invoices, desk | Lead days, open invoices with days overdue, on-hold flag, earliest arrival |
| `get_rent_due(lease_id)` | leases, desk, cash_accounts | Rent, due date, days until due, and whether each account can cover it |
| `list_open_tickets()` | tickets, desk | Every ticket that isn't resolved yet |
| `get_ticket(ticket_id)` | tickets, ticket_notes, approvals, purchase_orders, drafts | One ticket plus all work already done on it |
| `get_cash_position()` | cash_accounts, approvals, invoices, vendors, leases | Balance, pending requests, what's available after them, open invoices, rent |
| `quote_bulk_discount(sku, qty, discount_pct)` | pricing | Discounted price, margin, order total, and a below-cost flag |

**Agent write tools** (these only queue or draft; they never move money or contact anyone)

| Tool | Writes | Does |
|---|---|---|
| `update_ticket(ticket_id, status, note, author)` | tickets, ticket_notes | Sets the status and adds a note. Won't mark a ticket `resolved` while approvals are pending. |
| `request_payment_approval(kind, ref_id, ticket_id, reason, requested_by, account)` | approvals | Queues an invoice or rent payment. The amount comes from the database. Refuses duplicates and anything cash can't cover. |
| `create_purchase_order(vendor_id, sku, size, qty, ticket_id, reason, requested_by, account)` | purchase_orders, approvals | Drafts a restock costed from `pricing` and queues it for approval |
| `save_draft_message(ticket_id, recipient, recipient_type, subject, body, drafted_by)` | drafts | Saves a message on the board. It is never sent. |

**Human-only tools** (the backend never gives these to an agent; money and manual closes also need a logged-in person)

| Tool | Does |
|---|---|
| `list_approvals(status)` | Shows the approval queue for the dashboard |
| `decide_approval(approval_id, decision, session_token, note)` | A **logged-in person** approves (and pays) or rejects a request in one transaction. Refuses without a valid session and refuses negative cash. Refuses a purchase order while its vendor has an unpaid invoice. Records the person's account name and updates `cash_accounts`, `payments`, and the invoice, lease or purchase order. |
| `resolve_ticket_as_person(ticket_id, session_token, note)` | A logged-in person closes a ticket by hand with a note |
| `create_account`, `log_in`, `log_out`, `who_is_logged_in` | Human accounts for the dashboard (`data/accounts.db`). Passwords and session tokens are stored only as hashes. |
| `list_tickets`, `list_drafts` | Read-only views for the dashboard |
| `reset_working_database()` | Copies the original database over the working copy |

## Running it

```bash
.venv/bin/pip install -r requirements.txt
.venv/bin/python mcp_server/server.py           # stdio MCP server
.venv/bin/python mcp_server/server.py --reset   # reset the working copy
```

Claude Code connects through `.mcp.json`. The agent backend (`backend/main.py`, section 3) starts the server over stdio and gives each agent only the tools it needs.
