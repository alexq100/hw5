import type { AgentName, TicketStatus } from "./types";

export interface AgentMeta {
  name: AgentName;
  label: string;
  callsign: string;
  role: string;
  initials: string;
  color: string;
}

/** Each agent keeps the same color and initials everywhere on the desk. */
export const AGENTS: Record<AgentName, AgentMeta> = {
  boss: {
    name: "boss", label: "Boss", callsign: "Flight Director", initials: "BS", color: "#b45309",
    role: "Reads the ticket, assigns the crew, makes the final call",
  },
  inventory: {
    name: "inventory", label: "Inventory", callsign: "Cargo", initials: "IN", color: "#2563eb",
    role: "Stock by SKU and size, shortfalls, restock vendor",
  },
  accounting: {
    name: "accounting", label: "Accounting", callsign: "Fuel", initials: "AC", color: "#059669",
    role: "Cash, invoices, margins; queues payments for you",
  },
  facilities: {
    name: "facilities", label: "Facilities", callsign: "Hangar", initials: "FA", color: "#ea580c",
    role: "Lease, rent, and the shop space",
  },
  customer_service: {
    name: "customer_service", label: "Customer Service", callsign: "Comms", initials: "CS", color: "#7c3aed",
    role: "Drafts customer messages (never sent automatically)",
  },
};

export const AGENT_ORDER: AgentName[] = ["boss", "inventory", "accounting", "facilities", "customer_service"];

export const STATUS_META: Record<TicketStatus, { label: string; tone: string }> = {
  open: { label: "Open", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  awaiting_approval: { label: "Needs approval", tone: "warn" },
  escalated: { label: "Escalated", tone: "danger" },
  resolved: { label: "Resolved", tone: "ok" },
};

export const TICKET_TYPE: Record<string, string> = {
  customer_order: "Customer order",
  rent_notice: "Rent notice",
  price_override: "Discount request",
};

/** Plain-English labels for MCP tools, so the feed reads like a crew log. */
export const TOOL_LABEL: Record<string, string> = {
  get_ticket: "read the ticket",
  list_open_tickets: "scanned the board",
  get_cash_position: "checked the cash position",
  get_product_stock_and_price: "checked stock & price",
  get_vendor_status: "checked vendor status",
  get_rent_due: "looked up the lease",
  quote_bulk_discount: "priced a discount",
  request_payment_approval: "queued a payment for approval",
  create_purchase_order: "drafted a purchase order",
  save_draft_message: "saved a message draft",
  update_ticket: "updated the ticket",
  ask_teammate: "asked a teammate",
  final_result: "filed a report",
};
