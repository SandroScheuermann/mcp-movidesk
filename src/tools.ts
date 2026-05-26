import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MovideskApiError, MovideskClient } from "./movideskClient.js";
import type { JsonObject, MovideskAction, MovideskAttachment, MovideskTicket } from "./types.js";

type TicketInput = { ticketId: string };
type ImageInput = { hash: string };
type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type ToolRegistrar = {
  tool<TArgs>(
    name: string,
    description: string,
    paramsSchema: Record<string, z.ZodTypeAny>,
    cb: (args: TArgs) => Promise<{ isError?: boolean; content: ToolContent[] }>
  ): unknown;
};

const TicketInputShape: { ticketId: z.ZodType<string> } = {
  ticketId: z.string().trim().regex(/^\d{1,30}$/, "ticketId must contain only numbers")
};

const ImageInputShape: { hash: z.ZodType<string> } = {
  hash: z.string().trim().regex(/^[A-Za-z0-9._-]{1,200}$/, "hash must be a Movidesk storage identifier")
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
    async (input: TicketInput) => asToolResult(async () => summarizeTicket(await client.getTicket(input.ticketId), client))
  );

  registrar.tool(
    "get_ticket_history",
    "Read-only lookup for Movidesk ticket history, comments, inline comment images, statuses, and interactions. Rate limit: use one call at a time; avoid bulk history scans.",
    TicketInputShape,
    async (input: TicketInput) => asToolResult(async () => summarizeHistory(await client.getTicketHistory(input.ticketId), client))
  );

  registrar.tool(
    "get_ticket_attachments",
    "Read-only lookup for Movidesk ticket attachments and inline comment images, with metadata, hashes, and tokenless download URLs. Rate limit: use one call at a time.",
    TicketInputShape,
    async (input: TicketInput) => asToolResult(async () => summarizeAttachments(await client.getTicketAttachments(input.ticketId), client))
  );

  registrar.tool(
    "get_ticket_inline_image",
    "Read-only download for a Movidesk inline comment image by storage hash. Uses the server-side Movidesk token and returns image content without exposing the token. Rate limit: use one call at a time.",
    ImageInputShape,
    async (input: ImageInput) => asImageToolResult(async () => client.downloadStorageFile(input.hash))
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

async function asImageToolResult(read: () => Promise<{ data: string; mimeType: string; size: number }>) {
  try {
    const image = await read();

    return {
      content: [
        { type: "image" as const, data: image.data, mimeType: image.mimeType },
        { type: "text" as const, text: JSON.stringify({ ok: true, rateLimit: RATE_LIMIT_NOTICE, data: { mimeType: image.mimeType, size: image.size } }, null, 2) }
      ]
    };
  } catch (error) {
    const data = formatError(error);

    return {
      isError: true,
      content: [{ type: "text" as const, text: JSON.stringify({ ok: false, rateLimit: RATE_LIMIT_NOTICE, error: data }, null, 2) }]
    };
  }
}

function summarizeTicket(ticket: MovideskTicket, client: MovideskClient): JsonObject {
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
    recentActions: actions.slice(-5).map((action) => summarizeAction(action, client)),
    note: actions.length > 5 ? `Returned the 5 most recent actions out of ${actions.length}. Use get_ticket_history for more context, but avoid unnecessary calls because of the Movidesk rate limit.` : undefined
  });
}

function summarizeHistory(ticket: MovideskTicket, client: MovideskClient): JsonObject {
  const actions = Array.isArray(ticket.actions) ? ticket.actions : [];
  const visibleActions = actions.slice(-MAX_ACTIONS);

  return cleanObject({
    ticketId: ticket.id,
    subject: truncate(ticket.subject),
    status: ticket.status,
    totalActions: actions.length,
    returnedActions: visibleActions.length,
    truncated: actions.length > visibleActions.length,
    actions: visibleActions.map((action) => summarizeAction(action, client))
  });
}

function summarizeAttachments(ticket: MovideskTicket, client: MovideskClient): JsonObject {
  const actions = Array.isArray(ticket.actions) ? ticket.actions : [];
  const attachments = actions.flatMap((action) =>
    (action.attachments ?? []).map((attachment) => summarizeAttachment(attachment, action, client))
  );
  const inlineImages = actions.flatMap((action) => summarizeActionInlineImages(action, client));

  return cleanObject({
    ticketId: ticket.id,
    subject: truncate(ticket.subject),
    totalAttachments: attachments.length,
    totalInlineImages: inlineImages.length,
    attachments,
    inlineImages
  });
}

function summarizeAction(action: MovideskAction, client: MovideskClient): JsonObject {
  const inlineImages = extractInlineImages(action.htmlDescription ?? action.description ?? "", client);

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
    inlineImageCount: inlineImages.length,
    inlineImages: inlineImages.length > 0 ? inlineImages : undefined,
    tags: action.tags
  });
}

function summarizeActionInlineImages(action: MovideskAction, client: MovideskClient): JsonObject[] {
  return extractInlineImages(action.htmlDescription ?? action.description ?? "", client).map((image) =>
    cleanObject({
      ...image,
      actionId: action.id,
      actionCreatedDate: action.createdDate,
      actionCreatedBy: summarizePerson(action.createdBy)
    })
  );
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

function extractInlineImages(html: string, client: MovideskClient): JsonObject[] {
  const images: JsonObject[] = [];

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = readHtmlAttribute(tag, "src") ?? readHtmlAttribute(tag, "data-src");

    if (!src) {
      continue;
    }

    const hash = extractStorageHash(src);
    const sourceUrl = sanitizeImageSourceUrl(src);
    const embeddedData = src.trim().toLowerCase().startsWith("data:");

    images.push(cleanObject({
      hash,
      downloadUrl: hash ? client.getAttachmentDownloadUrl(hash) : undefined,
      sourceUrl: hash ? undefined : sourceUrl,
      downloadRequiresToken: hash ? true : undefined,
      embeddedData: embeddedData ? true : undefined,
      mimeType: embeddedData ? extractDataImageMimeType(src) : undefined,
      alt: readHtmlAttribute(tag, "alt"),
      title: readHtmlAttribute(tag, "title")
    }));
  }

  return images;
}

function readHtmlAttribute(tag: string, attribute: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>]+))`, "i"));
  const value = match?.[1] ?? match?.[2] ?? match?.[3];

  return value ? decodeHtml(value).trim() : undefined;
}

function extractStorageHash(src: string): string | undefined {
  const normalized = src.trim();

  try {
    const url = new URL(normalized, "https://api.movidesk.com");
    const hash = url.searchParams.get("id") ?? url.searchParams.get("hash") ?? url.searchParams.get("path");

    if (hash?.trim()) {
      return hash.trim();
    }
  } catch {
    // Fall back to regex extraction below.
  }

  const queryMatch = normalized.match(/[?&](?:id|hash|path)=([^&#]+)/i);
  const pathMatch = normalized.match(/\/(?:storage\/download|movidesk-files)\/([^/?#]+)/i);
  const hash = queryMatch?.[1] ?? pathMatch?.[1];

  return hash ? decodeURIComponent(hash).trim() : undefined;
}

function sanitizeImageSourceUrl(src: string): string | undefined {
  const normalized = src.trim();

  if (!normalized || normalized.toLowerCase().startsWith("data:")) {
    return undefined;
  }

  try {
    const url = new URL(normalized, "https://api.movidesk.com");
    url.searchParams.delete("token");

    return /^[a-z][a-z\d+.-]*:/i.test(normalized) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return normalized.replace(/([?&])token=[^&#]*&?/i, "$1").replace(/[?&]$/, "");
  }
}

function extractDataImageMimeType(src: string): string | undefined {
  const match = src.match(/^data:([^;,]+)[;,]/i);

  return match?.[1];
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
  return decodeHtml(value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " "));
}

function decodeHtml(value: string): string {
  return value
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
