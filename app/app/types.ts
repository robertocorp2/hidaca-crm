import type {
  ActivityStatus,
  LeadStatus,
  OpportunityOutcome,
  OpportunityStage,
} from "../lib/crm";

export type RecordRow = {
  id: string;
  module: string;
  title: string;
  status: string;
  customerName: string;
  contact: string;
  amount: number;
  balance: number;
  dueDate: string | null;
  notes: string;
  metadata: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type DocumentRow = {
  id: string;
  recordId: string | null;
  name: string;
  objectKey: string;
  contentType: string;
  size: number;
  createdBy: string;
  createdAt: string;
};

export type StaffUser = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BusinessRow = {
  id: string;
  legacyRecordId: string | null;
  name: string;
  normalizedName: string;
  customerType: "organization" | "individual";
  rnc: string;
  normalizedRnc: string;
  email: string;
  phone: string;
  mobilePhone: string;
  address: string;
  notes: string;
  sourceMetadata: string;
  ownerEmail: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ContactRow = {
  id: string;
  legacyRecordId: string | null;
  businessId: string | null;
  name: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  mobilePhone: string;
  normalizedMobilePhone: string;
  title: string;
  notes: string;
  sourceMetadata: string;
  ownerEmail: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type LeadRow = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  source: string;
  status: LeadStatus;
  ownerEmail: string;
  notes: string;
  convertedBusinessId: string | null;
  convertedContactId: string | null;
  convertedOpportunityId: string | null;
  convertedAt: string | null;
  convertedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type LeadHistoryRow = {
  id: number;
  leadId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string;
  changedAt: string;
  note: string;
};

export type OpportunityRow = {
  id: string;
  title: string;
  businessId: string;
  primaryContactId: string | null;
  relatedLeadId: string | null;
  stage: OpportunityStage;
  outcome: OpportunityOutcome | null;
  estimatedValue: number;
  expectedCloseDate: string | null;
  lossReason: string;
  ownerEmail: string;
  notes: string;
  closedAt: string | null;
  closedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type OpportunityHistoryRow = {
  id: number;
  opportunityId: string;
  fromStage: string | null;
  toStage: string;
  outcome: string | null;
  changedBy: string;
  changedAt: string;
  note: string;
};

export type ActivityRow = {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  status: ActivityStatus;
  ownerEmail: string;
  attendees: string;
  location: string;
  relatedType: string | null;
  relatedId: string | null;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type OpportunityQuoteLink = {
  opportunityId: string;
  quoteRecordId: string;
  createdBy: string;
  createdAt: string;
};
