/**
 * C2: Shared UI utilities extracted from citizen Dashboard.tsx / App.tsx / ApplicationDetail.tsx
 * Usage: import { formatDate, getStatusBadgeClass, getStatusLabel, getServiceDisplayName } from "@puda/shared/utils";
 */

export function getStatusBadgeClass(stateId: string): string {
  const statusMap: Record<string, string> = {
    DRAFT: "badge-draft",
    SUBMITTED: "badge-submitted",
    IN_PROGRESS: "badge-in-progress",
    PENDING_AT_CLERK: "badge-in-progress",
    PENDING_AT_SR_ASSISTANT_ACCOUNTS: "badge-in-progress",
    PENDING_AT_ACCOUNT_OFFICER: "badge-in-progress",
    PENDING_AT_JUNIOR_ENGINEER: "badge-in-progress",
    PENDING_AT_SDO: "badge-in-progress",
    PENDING_AT_DRAFTSMAN: "badge-in-progress",
    QUERY_PENDING: "badge-query",
    RESUBMITTED: "badge-submitted",
    APPROVED: "badge-approved",
    REJECTED: "badge-rejected",
    CLOSED: "badge-closed",
  };
  return statusMap[stateId] || "badge-default";
}

export function getStatusLabel(stateId: string): string {
  const labelMap: Record<string, string> = {
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    IN_PROGRESS: "In Progress",
    PENDING_AT_CLERK: "Pending at Clerk",
    PENDING_AT_SR_ASSISTANT_ACCOUNTS: "Pending at Sr. Assistant",
    PENDING_AT_ACCOUNT_OFFICER: "Pending at Account Officer",
    PENDING_AT_JUNIOR_ENGINEER: "Pending at Jr. Engineer",
    PENDING_AT_SDO: "Pending at SDO",
    PENDING_AT_DRAFTSMAN: "Pending at Draftsman",
    QUERY_PENDING: "Query Pending",
    RESUBMITTED: "Resubmitted",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    CLOSED: "Closed",
  };
  return labelMap[stateId] || stateId.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export function formatDate(dateStr: string | Date, dateFormat?: "DD/MM/YYYY" | "YYYY-MM-DD"): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  if (isNaN(date.getTime())) return "—";

  if (dateFormat === "YYYY-MM-DD") {
    return date.toISOString().slice(0, 10);
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(dateStr: string | Date, dateFormat?: "DD/MM/YYYY" | "YYYY-MM-DD"): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  if (isNaN(date.getTime())) return "—";
  if (dateFormat === "YYYY-MM-DD") {
    const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    return `${date.toISOString().slice(0, 10)} ${time}`;
  }
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function getServiceDisplayName(serviceKey: string): string {
  const nameMap: Record<string, string> = {
    no_due_certificate: "No Due Certificate",
    registration_of_architect: "Architect Registration",
    sanction_of_water_supply: "Water Supply Connection",
    sanction_of_sewerage_connection: "Sewerage Connection",
  };
  return nameMap[serviceKey] || serviceKey.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}
