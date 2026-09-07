const excludedInvoiceStatuses = new Set(["cancelled", "replaced", "void", "draft"]);

export function calculateDashboardInvoiceBalance(input: {
  status: string | null | undefined;
  totalAmount: number | null | undefined;
  balanceSnapshot: number | null | undefined;
  paidAllocations?: number | null;
  creditedApplications?: number | null;
  hasAppliedAllocations?: boolean;
  hasAppliedCredits?: boolean;
}) {
  if (excludedInvoiceStatuses.has(input.status ?? "")) return 0;
  const hasAppliedEntries = Boolean(input.hasAppliedAllocations || input.hasAppliedCredits);
  if (hasAppliedEntries) {
    return Math.max(
      0,
      (input.totalAmount ?? 0) - (input.paidAllocations ?? 0) - (input.creditedApplications ?? 0),
    );
  }
  if (input.balanceSnapshot !== null && input.balanceSnapshot !== undefined) {
    return Math.max(0, input.balanceSnapshot);
  }
  if (input.status === "paid") return 0;
  return Math.max(0, input.totalAmount ?? 0);
}
