import type { ApiErrorDetails, MovideskTicket } from "./types.js";

const DEFAULT_BASE_URL = "https://api.movidesk.com/public/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_REQUEST_INTERVAL_MS = 6_100;

let nextRequestAt = 0;

export class MovideskApiError extends Error {
  readonly status?: number;
  readonly retryAfterSeconds?: string | null;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = "MovideskApiError";
    this.status = details.status;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

export class MovideskClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: { token: string; baseUrl?: string; timeoutMs?: number }) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getTicket(ticketId: string): Promise<MovideskTicket> {
    return this.getTicketWithFallback(ticketId, ticketExpand());
  }

  async getTicketHistory(ticketId: string): Promise<MovideskTicket> {
    return this.getTicketWithFallback(ticketId, historyExpand());
  }

  async getTicketAttachments(ticketId: string): Promise<MovideskTicket> {
    return this.getTicketWithFallback(ticketId, attachmentsExpand());
  }

  getAttachmentDownloadUrl(hash: string): string {
    const url = new URL(`${this.baseUrl}/storage/download`);
    url.searchParams.set("id", hash);
    return url.toString();
  }

  private async getTicketWithFallback(ticketId: string, expand: string): Promise<MovideskTicket> {
    try {
      return await this.getTicketByRoute("tickets", ticketId, expand);
    } catch (error) {
      if (error instanceof MovideskApiError && error.status === 404) {
        return this.getTicketByRoute("tickets/past", ticketId, expand);
      }

      throw error;
    }
  }

  private async getTicketByRoute(route: "tickets" | "tickets/past", ticketId: string, expand: string): Promise<MovideskTicket> {
    const result = await this.get<MovideskTicket>(`/${route}`, {
      id: ticketId,
      "$expand": expand
    });

    if (!result || typeof result !== "object") {
      throw new MovideskApiError({ message: `Ticket ${ticketId} not found.` });
    }

    return result;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    await waitForRateLimit();

    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("token", this.token);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });

      if (!response.ok) {
        throw await toApiError(response);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof MovideskApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new MovideskApiError({ message: `Timed out while querying the Movidesk API after ${this.timeoutMs}ms.` });
      }

      throw new MovideskApiError({ message: error instanceof Error ? error.message : "Unknown error while querying the Movidesk API." });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function ticketExpand(): string {
  return [
    "owner",
    "createdBy",
    "clients",
    "actions($select=id,type,origin,status,justification,createdDate,createdBy,description,htmlDescription,isDeleted)"
  ].join(",");
}

function historyExpand(): string {
  return [
    "actions($select=id,type,origin,status,justification,createdDate,createdBy,description,htmlDescription,isDeleted,tags)",
    "actions($expand=attachments)"
  ].join(",");
}

function attachmentsExpand(): string {
  return [
    "actions($select=id,createdDate,createdBy,description,htmlDescription)",
    "actions($expand=attachments)"
  ].join(",");
}

async function toApiError(response: Response): Promise<MovideskApiError> {
  const retryAfter = response.headers.get("retry-after");
  await safeDrainBody(response);
  const message = retryAfter
    ? `Movidesk returned HTTP ${response.status}. Try again after ${retryAfter}s.`
    : `Movidesk returned HTTP ${response.status}.`;

  return new MovideskApiError({
    status: response.status,
    message,
    retryAfterSeconds: retryAfter
  });
}

async function safeDrainBody(response: Response): Promise<void> {
  try {
    await response.text();
  } catch {
    // Ignore body read failures while preserving the HTTP status error.
  }
}

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + MIN_REQUEST_INTERVAL_MS;

  const delayMs = scheduledAt - now;

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
