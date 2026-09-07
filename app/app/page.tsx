import { desc, isNull } from "drizzle-orm";
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "../chatgpt-auth";
import { getDb } from "../../db";
import {
  activities,
  businesses,
  businessRecords,
  contacts,
  documents,
  leads,
  leadStatusHistory,
  opportunities,
  opportunityQuotes,
  opportunityStageHistory,
  staffUsers,
} from "../../db/schema";
import { getAuthorizedUser } from "../lib/authorization";
import { OperationsClient } from "./operations-client";
import { env } from "cloudflare:workers";
import { isInvoiceImportPhase1Enabled } from "../lib/invoice-import-feature";

export const metadata = { title: "Panel" };
export const dynamic = "force-dynamic";

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requestedParams = await searchParams;
  const initialView = Array.isArray(requestedParams.view)
    ? requestedParams.view[0]
    : requestedParams.view;
  const initialRecord = Array.isArray(requestedParams.record)
    ? requestedParams.record[0]
    : requestedParams.record;
  const identity = await getChatGPTUser();
  if (!identity) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <h1>Sesión requerida</h1>
          <p>Inicia sesión con ChatGPT para continuar.</p>
          <a className="primary-button" href={chatGPTSignInPath("/app")}>
            Iniciar sesión con ChatGPT
          </a>
        </section>
      </main>
    );
  }

  const user = await getAuthorizedUser();
  if (!user) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="login-mark">!</div>
          <p className="eyebrow">Acceso restringido</p>
          <h1>Cuenta no autorizada</h1>
          <p>
            La cuenta <strong>{identity.email}</strong> inició sesión
            correctamente, pero no pertenece a la lista de acceso de HIDACA.
          </p>
          <a className="secondary-button" href={chatGPTSignOutPath("/")}>
            Cerrar sesión
          </a>
        </section>
      </main>
    );
  }

  const db = getDb();
  const [
    records,
    storedDocuments,
    users,
    crmBusinesses,
    crmContacts,
    crmLeads,
    leadHistory,
    crmOpportunities,
    opportunityHistory,
    crmActivities,
    quoteLinks,
  ] = await Promise.all([
    db
      .select()
      .from(businessRecords)
      .where(isNull(businessRecords.archivedAt))
      .orderBy(desc(businessRecords.updatedAt))
      .limit(250),
    db.select().from(documents).orderBy(desc(documents.createdAt)).limit(250),
    user.role === "admin" ? db.select().from(staffUsers) : Promise.resolve([]),
    db
      .select()
      .from(businesses)
      .where(isNull(businesses.archivedAt))
      .orderBy(desc(businesses.updatedAt))
      .limit(500),
    db
      .select()
      .from(contacts)
      .where(isNull(contacts.archivedAt))
      .orderBy(desc(contacts.updatedAt))
      .limit(500),
    db
      .select()
      .from(leads)
      .where(isNull(leads.archivedAt))
      .orderBy(desc(leads.updatedAt))
      .limit(500),
    db
      .select()
      .from(leadStatusHistory)
      .orderBy(desc(leadStatusHistory.changedAt))
      .limit(2_000),
    db
      .select()
      .from(opportunities)
      .where(isNull(opportunities.archivedAt))
      .orderBy(desc(opportunities.updatedAt))
      .limit(500),
    db
      .select()
      .from(opportunityStageHistory)
      .orderBy(desc(opportunityStageHistory.changedAt))
      .limit(2_000),
    db
      .select()
      .from(activities)
      .where(isNull(activities.archivedAt))
      .orderBy(desc(activities.startAt))
      .limit(1_000),
    db.select().from(opportunityQuotes).limit(2_000),
  ]);

  return (
    <OperationsClient
      currentUser={user}
      initialRecords={records}
      initialDocuments={storedDocuments}
      initialUsers={users}
      initialBusinesses={crmBusinesses}
      initialContacts={crmContacts}
      initialLeads={crmLeads}
      initialLeadHistory={leadHistory}
      initialOpportunities={crmOpportunities}
      initialOpportunityHistory={opportunityHistory}
      initialActivities={crmActivities}
      initialOpportunityQuotes={quoteLinks}
      initialView={initialView}
      initialRecord={initialRecord}
      invoiceFeatureEnabled={isInvoiceImportPhase1Enabled(env)}
      signOutHref={chatGPTSignOutPath("/")}
    />
  );
}
