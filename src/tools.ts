import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MovideskApiError, MovideskClient } from "./movideskClient.js";
import type { JsonObject, MovideskAction, MovideskAttachment, MovideskTicket } from "./types.js";

type TicketInput = { ticketId: string };
type ToolRegistrar = {
  tool(
    name: string,
    description: string,
    paramsSchema: typeof TicketInputShape,
    cb: (args: TicketInput) => Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }>
  ): unknown;
};

const TicketInputShape: { ticketId: z.ZodType<string> } = {
  ticketId: z.string().trim().regex(/^\d{1,30}$/, "ticketId must contain only numbers")
};

const MAX_TEXT_LENGTH = 2_000;
const MAX_ACTIONS = 40;
const RATE_LIMIT_NOTICE = {
  limit: "Movidesk API allows 10 requests per minute.",
  guard: "This MCP server serializes outbound Movidesk API requests with at least 6.1 seconds between requests.",
  agentGuidance: "Do not call these tools in bulk or in parallel. Prefer one ticket lookup at a time and wait for each result before deciding the next call."
};

export function registerTools(server: McpServer, client: MovideskClient): void {
  const registrar = server as ToolRegistrar;

  registrar.tool(
    "get_ticket",
    "Read-only lookup for main Movidesk ticket data by numeric ID. Rate limit: use one call at a time; the server waits between API requests.",
    TicketInputShape,
    async (input: TicketInput) => asToolResult(async () => summarizeTicket(await client.getTicket(input.ticketId)))
  );

  registrar.tool(
    "get_ticket_history",
    "Read-only lookup for Movidesk ticket history, comments, statuses, and interactions. Rate limit: use one call at a time; avoid bulk history scans.",
    TicketInputShape,
    async (input: TicketInput) => asToolResult(async () => summarizeHistory(await client.getTicketHistory(input.ticketId)))
  );

  registrar.tool(
    "get_ticket_attachments",
    "Read-only lookup for Movidesk ticket attachments, metadata, hashes, and tokenless download URLs. Rate limit: use one call at a time.",
    TicketInputShape,
    async (input: TicketInput) => asToolResult(async () => summarizeAttachments(await client.getTicketAttachments(input.ticketId), client))
  );
}

async function asToolResult(read: () => Promise<JsonObject>) {
  try {
    const data = await read();

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: true, rateLimit: RATE_LIMIT_NOTICE, data }, null, 2) }]
    };
  } catch (error) {
    const data = formatError(error);

    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, rateLimit: RATE_LIMIT_NOTICE, error: data }, null, 2) }]
    };
  }
}

function summarizeTicket(ticket: MovideskTicket): JsonObject {
  const actions = Array.isArray(ticket.actions) ? ticket.actions : [];

  return cleanObject({
    id: ticket.id,
    protocol: ticket.protocol,
    subject: truncate(ticket.subject),
    type: ticket.type,
    status: ticket.status,
    baseStatus: ticket.baseStatus,
    justification: ticket.justification,
    category: ticket.category,
    urgency: ticket.urgency,
    origin: ticket.origin,
    createdDate: ticket.createdDate,
    lastUpdate: ticket.lastUpdate,
    lastActionDate: ticket.lastActionDate,
    actionCount: ticket.actionCount,
    ownerTeam: ticket.ownerTeam,
    owner: summarizePerson(ticket.owner),
    createdBy: summarizePerson(ticket.createdBy),
    clients: ticket.clients?.map(summarizePerson),
    serviceFull: ticket.serviceFull,
    tags: ticket.tags,
    dates: cleanObject({ resolvedIn: ticket.resolvedIn, reopenedIn: ticket.reopenedIn, closedIn: ticket.closedIn }),
    recentActions: actions.slice(-5).map(summarizeAction),
    note: actions.length > 5 ? `Returned the 5 most recent actions out of ${actions.length}. Use get_ticket_history for more context, but avoid unnecessary calls because of the Movidesk rate limit.` : undefined
  });
}

function summarizeHistory(ticket: MovideskTicket): JsonObject {
  const actions = Array.isArray(ticket.actions) ? ticket.actions : [];
  const visibleActions = actions.slice(-MAX_ACTIONS);

  return cleanObject({
    ticketId: ticket.id,
    subject: truncate(ticket.subject),
    status: ticket.status,
    totalActions: actions.length,
    returnedActions: visibleActions.length,
    truncated: actions.length > visibleActions.length,
    actions: visibleActions.map(summarizeAction)
  });
}

function summarizeAttachments(ticket: MovideskTicket, client: MovideskClient): JsonObject {
  const actions = Array.isArray(ticket.actions) ? ticket.actions : [];
  const attachments = actions.flatMap((action) =>
    (action.attachments ?? []).map((attachment) => summarizeAttachment(attachment, action, client))
  );

  return cleanObject({
    ticketId: ticket.id,
    subject: truncate(ticket.subject),
    totalAttachments: attachments.length,
    attachments
  });
}

function summarizeAction(action: MovideskAction): JsonObject {
  return cleanObject({
    id: action.id,
    type: action.type,
    origin: action.origin,
    status: action.status,
    justification: action.justification,
    createdDate: action.createdDate,
    createdBy: summarizePerson(action.createdBy),
    isDeleted: action.isDeleted,
    description: truncate(stripHtml(action.description ?? action.htmlDescription ?? "")),
    attachmentCount: action.attachments?.length ?? 0,
    attachments: action.attachments?.map((attachment) => ({
      fileName: attachment.fileName,
      path: attachment.path,
      createdDate: attachment.createdDate
    })),
    tags: action.tags
  });
}

function summarizeAttachment(attachment: MovideskAttachment, action: MovideskAction, client: MovideskClient): JsonObject {
  const hash = attachment.path?.trim();

  return cleanObject({
    fileName: attachment.fileName,
    hash,
    downloadUrl: hash ? client.getAttachmentDownloadUrl(hash) : undefined,
    downloadRequiresToken: hash ? true : undefined,
    createdDate: attachment.createdDate,
    createdBy: summarizePerson(attachment.createdBy),
    actionId: action.id,
    actionCreatedDate: action.createdDate,
    actionCreatedBy: summarizePerson(action.createdBy)
  });
}

function summarizePerson(person: unknown): JsonObject | undefined {
  if (!person || typeof person !== "object") {
    return undefined;
  }

  const value = person as Record<string, unknown>;

  return cleanObject({
    id: value.id,
    businessName: value.businessName,
    email: value.email,
    personType: value.personType,
    profileType: value.profileType
  });
}

function truncate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= MAX_TEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_TEXT_LENGTH)}... [truncated]`;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function cleanObject<T extends JsonObject>(object: T): T {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null)
  ) as T;
}

function formatError(error: unknown): JsonObject {
  if (error instanceof MovideskApiError) {
    return cleanObject({
      type: error.name,
      status: error.status,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds
    });
  }

  return {
    type: "UnexpectedError",
    message: error instanceof Error ? error.message : "Unknown error."
  };
}
