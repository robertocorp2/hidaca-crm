import { getD1 } from "../../db";
import { readDashboardReceivableBalance } from "./dashboard-financial-query";

export { calculateDashboardInvoiceBalance } from "./dashboard-financial-policy";

/**
 * Returns the dashboard outstanding balance from the normalized invoice and
 * payment model. Legacy invoices are included only until they are promoted.
 */
export async function getDashboardReceivableBalance() {
  return readDashboardReceivableBalance(getD1());
}
