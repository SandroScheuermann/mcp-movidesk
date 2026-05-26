export type JsonObject = Record<string, unknown>;

export type MovideskPerson = {
  id?: string;
  personType?: number;
  profileType?: number;
  businessName?: string;
  email?: string;
  phone?: string;
};

export type MovideskAttachment = {
  fileName?: string;
  path?: string;
  createdBy?: MovideskPerson;
  createdDate?: string;
};

export type MovideskDownloadedFile = {
  data: string;
  mimeType: string;
  size: number;
};

export type MovideskAction = {
  id?: number;
  type?: number;
  origin?: number;
  description?: string | null;
  htmlDescription?: string | null;
  status?: string | null;
  justification?: string | null;
  createdDate?: string;
  createdBy?: MovideskPerson;
  isDeleted?: boolean;
  attachments?: MovideskAttachment[];
  tags?: string[];
};

export type MovideskTicket = {
  id?: number | string;
  protocol?: string | null;
  type?: number;
  subject?: string | null;
  category?: string | null;
  urgency?: string | null;
  status?: string | null;
  baseStatus?: string | null;
  justification?: string | null;
  origin?: number;
  createdDate?: string;
  owner?: MovideskPerson | null;
  ownerTeam?: string | null;
  createdBy?: MovideskPerson | null;
  serviceFull?: string[];
  tags?: string[];
  resolvedIn?: string | null;
  reopenedIn?: string | null;
  closedIn?: string | null;
  lastActionDate?: string | null;
  actionCount?: number;
  lastUpdate?: string | null;
  actions?: MovideskAction[];
  clients?: MovideskPerson[];
  [key: string]: unknown;
};

export type ApiErrorDetails = {
  status?: number;
  message: string;
  retryAfterSeconds?: string | null;
};
