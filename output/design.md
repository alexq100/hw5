# Campus Customs Agent Desk: Design Notes

The dashboard (`frontend/`, React + Vite + TypeScript) is where a person watches five AI agents work the shop's tickets and approves anything that costs money. It calls the FastAPI backend at `http://localhost:8000`. The backend allows the Vite page's origin, `http://localhost:5173`.

Start the backend from `backend/` with `uvicorn main:app --reload --port 8000`, then start the desk from `frontend/` with `npm run dev`.

## Design goal: clear on first look

The first version was a dark, space-themed "mission control" with everything on one screen: a crew strip, a stats bar, a dense live feed, a cash gauge and the approval queue. It looked impressive but **felt overwhelming**. A first-time user couldn't tell where to start. So the final design follows three rules:

1. **One question per page.** The desk is split into three tabs: **Tickets** (what came in, and what did the agents do?), **Approvals** (what needs my OK?) and **Cash** (how much money is there?).
2. **Always say what to do next.** A blue "next step" banner at the top of the Tickets page and a "Next:" line on every ticket tell you the next action in plain words.
3. **One main button at a time.** Each ticket shows one blue button for the most useful action right now. Anything else is a small text link.

## What I looked at

- **Support inboxes and triage queues** (split-pane help desks, Linear-style triage). They put a list on the left and the selected item on the right, with status shown as small colored labels. → The Tickets page uses that layout.
- **Agent trace views** (Sentry AI agents, Flowable). They show a timeline of each agent step and tool call. → That became the **Activity** view, rewritten as plain sentences instead of a technical trace.
- **Writing on human approval queues.** The risk is reviewers rubber-stamping, so each item needs context, its age, and the right order. → The Approvals page shows each request with its reason, who asked, its effect on cash, and a "Start here" label on the one to do first.

Sources: [Sentry AI agent dashboards](https://docs.sentry.io/ai/observability/agents/dashboards/), [Flowable agent observability](https://release.flowable.com/features/agent-observability/), [Tian Pan on approval queues](https://tianpan.co/blog/tags/observability/page/8), [Balsamiq internal ops dashboard](https://balsamiq.com/examples/internal-tools/internal-ops-dashboard/), [Relay smart inbox](https://crm.switchlabs.dev/guide/tickets/smart-inbox), [Linear-style triage inbox for Jira](https://marketplace.atlassian.com/apps/2782015515/issue-triage-inbox-for-jira).

## Layout

**Header (on every page):** the logo, the three tabs (**Approvals shows an amber count** when something is waiting), the **checking balance** (click it to open Cash), the shop date (Aug 31 2026, the date every agent uses as "today"), and a quiet **Start over** link that resets the shop data after asking you to confirm.

**Tickets page**
- **Next-step banner.** It changes with the situation:
  - "Pick a ticket and click Run agents…"
  - "Agents are working on ticket #103…"
  - "2 payments are waiting for your approval" [Go to approvals]
  - "Ticket #103 needs a decision from you" [Open #103]
  - "All tickets are resolved."
- **Left: the ticket list.** Each row shows the number, a status label, the subject, the type and requester, and a blue **"Next: Run agents / Approve payments / Review & decide"** line. It turns into a green **"✓ Done"** when the ticket is resolved.
- **Right: the selected ticket.** It has the requester's own words, a status label, and **one main button**: **Run agents**, **Review 2 payments**, or **Mark resolved**.
  - **Before any run,** it explains in three numbered steps what will happen: run the agents → read the summary → approve or reject payments.
  - **During and after a run, a live team map** sits above the tabs (see "The live team map" below). After the run it adds "Not needed this time: Facilities", so you can see the boss didn't call everyone.
  - **Three views** in a simple switcher:
    - **Summary** (the default after a run), written as **bullets, not paragraphs**: the boss's decision in one bold line, then 3–5 short **highlights** ("Size S on hand: 0; shortfall: 1", "Invoice 501 ($840) is three days overdue"), a numbered **"Your next steps"** list, and **"Who did what"** with one sentence per agent. A **Show full explanation** button opens the boss's full reasoning and each agent's facts, actions and blockers for anyone who wants the detail.
    - **Activity** (the default while a run is going): one plain-English line per step, like "Inventory checked stock & price (CC-HOOD-NAVY · M · ×20)", with the result underneath ("↳ 8 on hand, 12 short"). Hand-offs read "Boss asked Inventory for help", with a **Show request** link for the full text.
    - **Messages**: the customer and landlord drafts the agents wrote, labeled **"Draft · not sent"**, with a Copy button.

**Approvals page**
- **Log in / Create account:** a **Log in** button sits in the header. It opens a small dialog with two tabs: **Log in** (username and password) and **Create account** (username, full name, password, confirm). Once you're logged in, the header shows your initials and name with a **Log out** link, and the Approvals page shows "Approving as Alex Kew". **Approve & pay** asks for a one-line confirmation ("Pay $840.00 to Bulldog Print Co as Alex Kew?"). Logged out, every approve button says **Log in to approve**, and a short note tells first-time visitors, such as a TA, to create an account. The agents can never log in or approve.
- One card per request, sorted in the order you should handle them. The first one is labeled **"Start here"**.
- Each card reads like a sentence: **"Pay Bulldog Print Co · $840.00"**, what it's for and when it's due, the agent's reason, who asked and when, a link to the ticket, and **"Checking after: $2,560.00"**.
- Big **Approve & pay $840** (green) and **Reject** buttons.
- A purchase order whose vendor is still on hold is greyed out, with the message *"This vendor won't ship until invoice 501 is paid. Approve request #1 first."* A request that cash can't cover is blocked too.
- When the queue is empty, a friendly **"✓ Nothing to approve"** shows, followed by an **"Already decided"** list.

**Cash page**
- A big checking balance, a simple bar and three numbers: **Paid out**, **Waiting for approval** and **Free to spend**.
- A payments table that starts from the starting balance and shows each payment and the running balance.

## The live team map (the animated part)

When you click **Run agents**, a small map of the five agents shows the team working in real time. It's built from the same audit events the backend writes, polled about once a second.
- **Layout:** the boss sits at the top, with the four specialists arranged around it, each in its own color.
- **Lighting up:** the agent that's working right now fills with its color, grows a little and glows. A dark **speech bubble** above it says what it's doing in plain words ("Reading the request", "checked stock & price", "Reviewing results").
- **Waiting:** an agent that has handed work off gets a dashed outline and a light bubble ("Waiting on accounting").
- **Hand-offs:** when one agent asks another for help, a **dashed line** appears between them, a **dot travels along it** from sender to receiver, and the receiver gives off a **ping ripple**. The caption under the map shows the hand-off live, for example *Inventory → Accounting "Ticket 101, customer Tauhid Zaman. Stock check: …"*.
- **When it's finished,** the lines turn a soft gray and each agent shows a ✓. Agents who weren't needed fade out, and the caption shows the whole route: **Boss → Inventory → Accounting → Customer Service**.
- New tickets that no agent has touched yet get a pulsing blue **NEW** tag in the list, so it's obvious where to click first.

This also shows the efficiency change in the backend. Specialists now hand work **directly to each other** (a relay) instead of reporting back to the boss after every step, and the map makes that visible as a chain of hand-offs.

## How agents read differently

Each agent always has the same color: **Boss** (amber), **Inventory** (blue), **Accounting** (green), **Facilities** (orange), **Customer Service** (purple). The color only shows up in agent names and small dots, never as large blocks, so the page stays calm and you can still tell who did what at a glance. A pulsing dot means that agent is working right now.

## How resolved tickets show up

- Status labels use a few soft colors: **Open** (gray), **Working** (blue), **Needs approval** (amber), **Escalated** (red), **Resolved** (green). The ticket row's "Next:" line becomes **"✓ Done"**.
- **When a ticket resolves:** when you approve the last pending payment on a ticket, it **resolves automatically**, and the confirmation message says so. If you reject something, the ticket goes back to *escalated*. Tickets that end up escalated with nothing to pay, like a discount that couldn't be fully funded, have a **Mark resolved** button (for logged-in people) that asks for a short note. The note is saved to the ticket under your name.

## How cash shows up

- The **checking balance is always in the header**, so you see it drop the moment you approve. On the Cash page, the big number **counts down** smoothly to the new value.
- The Cash bar splits the money into **paid out**, **waiting for approval** and **free to spend**. Money that's already promised to a pending request doesn't look like free money.
- Every approval card shows **"Checking after"** before you click, so nothing comes as a surprise.

## Visual style

- **A light, neutral background** with white cards, thin gray borders and soft shadows. It's calm enough to keep open all day.
- **Inter** for all text, with tabular numbers so dollar amounts line up.
- **One blue for actions**, green for money paid and "done", amber for "needs you", and red only for real problems.
- **Small touches that make it pleasant:**
  - short confirmation messages ("Paid Bulldog Print Co $840. Checking is now $2,560.")
  - the balance counting down when you pay
  - a "✓ Nothing to approve" state when you're caught up
  - the banner always telling you what's next
- It works on a laptop screen. The ticket list stacks above the details on narrow windows.

## Backend support added for the desk

- `GET /approvals` includes the payee, a plain description, the due date, the ticket subject, and which unpaid invoice blocks a purchase order.
- Deciding the last pending request on a ticket that's waiting on approval resolves it automatically, or escalates it if anything was rejected.
- `POST /tickets/{id}/resolve` lets a person close a ticket with a note.
- CORS explicitly allows `http://localhost:5173`.
