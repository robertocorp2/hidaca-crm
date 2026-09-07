import { and, eq, isNull, or } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import {
  businesses,
  contacts,
  leads,
  opportunities,
} from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import {
  cleanText,
  nonNegativeNumber,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  optionalIsoDate,
  requiredLeadConversionFields,
} from "../../../../lib/crm";
import { searchDocumentStatement } from "../../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

async function activeLead(id: string) {
  const [lead] = await getDb()
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
    .limit(1);
  return lead;
}

async function completedConversion(
  lead: NonNullable<Awaited<ReturnType<typeof activeLead>>>,
) {
  if (
    !lead.convertedBusinessId ||
    !lead.convertedContactId ||
    !lead.convertedOpportunityId
  ) {
    return null;
  }

  const db = getDb();
  const [[business], [contact], [opportunity]] = await Promise.all([
    db
      .select()
      .from(businesses)
      .where(eq(businesses.id, lead.convertedBusinessId))
      .limit(1),
    db
      .select()
      .from(contacts)
      .where(eq(contacts.id, lead.convertedContactId))
      .limit(1),
    db
      .select()
      .from(opportunities)
      .where(
        or(
          eq(opportunities.id, lead.convertedOpportunityId),
          eq(opportunities.relatedLeadId, lead.id),
        ),
      )
      .limit(1),
  ]);

  return business && contact && opportunity
    ? { business, contact, opportunity, lead }
    : null;
}

async function duplicateOptions(lead: NonNullable<Awaited<ReturnType<typeof activeLead>>>) {
  const db = getDb();
  const businessMatches = await db
    .select()
    .from(businesses)
    .where(
      and(
        eq(businesses.normalizedName, normalizeText(lead.businessName)),
        isNull(businesses.archivedAt),
      ),
    )
    .limit(10);

  const contactConditions = [];
  if (lead.normalizedEmail) {
    contactConditions.push(eq(contacts.normalizedEmail, lead.normalizedEmail));
  }
  if (lead.normalizedPhone) {
    contactConditions.push(eq(contacts.normalizedPhone, lead.normalizedPhone));
  }
  const contactMatches = contactConditions.length
    ? await db
        .select()
        .from(contacts)
        .where(and(or(...contactConditions), isNull(contacts.archivedAt)))
        .limit(10)
    : [];

  return { businessMatches, contactMatches };
}

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const lead = await activeLead(id);
  if (!lead) {
    return Response.json({ error: "Lead no encontrado." }, { status: 404 });
  }
  const missingFields = requiredLeadConversionFields(lead);
  const matches = await duplicateOptions(lead);
  return Response.json({ lead, missingFields, ...matches });
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const lead = await activeLead(id);
  if (!lead) {
    return Response.json({ error: "Lead no encontrado." }, { status: 404 });
  }
  if (
    lead.status === "converted" ||
    lead.convertedAt ||
    lead.convertedOpportunityId
  ) {
    const existingConversion = await completedConversion(lead);
    if (existingConversion) {
      return Response.json(existingConversion, {
        headers: { "x-idempotent-replay": "true" },
      });
    }
    return Response.json(
      {
        error:
          "Este Lead ya fue convertido, pero no se pudieron cargar todos sus registros vinculados.",
      },
      { status: 409 },
    );
  }
  if (lead.status !== "working") {
    return Response.json(
      { error: "El Lead debe estar en Working antes de convertirlo." },
      { status: 409 },
    );
  }

  const payload = (await request.json()) as Record<string, unknown>;
  const businessMode = payload.businessMode === "existing" ? "existing" : "new";
  const contactMode = payload.contactMode === "existing" ? "existing" : "new";
  const businessName =
    cleanText(payload.businessName, 180) || lead.businessName;
  const contactName = cleanText(payload.contactName, 180) || lead.contactName;
  const contactEmail = cleanText(payload.contactEmail, 180) || lead.email;
  const contactPhone = cleanText(payload.contactPhone, 60) || lead.phone;
  const conversionData = {
    businessName,
    contactName,
    email: contactEmail,
    phone: contactPhone,
  };
  const missing = requiredLeadConversionFields(conversionData);
  const opportunityTitle = cleanText(payload.opportunityTitle, 200);
  if (!opportunityTitle) missing.push("Opportunity Title");
  if (missing.length) {
    return Response.json(
      { error: `Completa los campos requeridos: ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  const db = getDb();
  let business = null;
  if (businessMode === "existing") {
    const businessId = cleanText(payload.businessId, 80);
    [business] = await db
      .select()
      .from(businesses)
      .where(
        and(eq(businesses.id, businessId), isNull(businesses.archivedAt)),
      )
      .limit(1);
    if (!business) {
      return Response.json(
        { error: "Selecciona un Business existente válido." },
        { status: 400 },
      );
    }
  } else {
    const normalizedName = normalizeText(businessName);
    const [duplicate] = await db
      .select()
      .from(businesses)
      .where(
        and(
          eq(businesses.normalizedName, normalizedName),
          isNull(businesses.archivedAt),
        ),
      )
      .limit(1);
    if (duplicate) {
      return Response.json(
        {
          error:
            "Existe un Business probable. Selecciónalo antes de confirmar.",
          businessMatches: [duplicate],
        },
        { status: 409 },
      );
    }
  }

  let contact = null;
  if (contactMode === "existing") {
    const contactId = cleanText(payload.contactId, 80);
    [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), isNull(contacts.archivedAt)))
      .limit(1);
    if (!contact) {
      return Response.json(
        { error: "Selecciona un Contact existente válido." },
        { status: 400 },
      );
    }
    if (contact.businessId && contact.businessId !== business?.id) {
      return Response.json(
        {
          error:
            "El Contact seleccionado pertenece a otro Business. Selecciona otro Contact o crea uno nuevo.",
        },
        { status: 409 },
      );
    }
  } else {
    const normalizedEmail = normalizeEmail(contactEmail);
    const normalizedPhone = normalizePhone(contactPhone);
    const duplicateConditions = [];
    if (normalizedEmail) {
      duplicateConditions.push(eq(contacts.normalizedEmail, normalizedEmail));
    }
    if (normalizedPhone) {
      duplicateConditions.push(eq(contacts.normalizedPhone, normalizedPhone));
    }
    if (duplicateConditions.length) {
      const matches = await db
        .select()
        .from(contacts)
        .where(
          and(or(...duplicateConditions), isNull(contacts.archivedAt)),
        )
        .limit(10);
      if (matches.length) {
        return Response.json(
          {
            error:
              "Existe un Contact probable. Selecciónalo antes de confirmar.",
            contactMatches: matches,
          },
          { status: 409 },
        );
      }
    }
  }

  const now = new Date().toISOString();
  const businessId = business?.id ?? crypto.randomUUID();
  const contactId = contact?.id ?? crypto.randomUUID();
  const opportunityId = crypto.randomUUID();
  const ownerEmail =
    cleanText(payload.ownerEmail, 180) || lead.ownerEmail || auth.user.email;
  const estimatedValue = nonNegativeNumber(payload.estimatedValue);
  const expectedCloseDate = optionalIsoDate(payload.expectedCloseDate);
  const opportunityNotes = cleanText(payload.opportunityNotes, 4000);
  const d1 = getD1();
  const statements: D1PreparedStatement[] = [];

  if (!business) {
    business = {
      id: businessId,
      legacyRecordId: null,
      name: businessName,
      normalizedName: normalizeText(businessName),
      email: cleanText(payload.businessEmail, 180),
      phone: cleanText(payload.businessPhone, 60),
      address: cleanText(payload.businessAddress, 300),
      notes: cleanText(payload.businessNotes, 4000),
      ownerEmail,
      createdBy: auth.user.email,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    statements.push(
      d1
        .prepare(
          `INSERT INTO businesses (
            id, name, normalized_name, email, phone, address, notes,
            owner_email, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          business.id,
          business.name,
          business.normalizedName,
          business.email,
          business.phone,
          business.address,
          business.notes,
          business.ownerEmail,
          business.createdBy,
          now,
          now,
        ),
      searchDocumentStatement({
        entityType: "business",
        entityId: business.id,
        title: business.name,
        subtitle: business.email || business.phone,
        searchText: `${business.name} ${business.email} ${business.phone} ${business.address} ${business.notes}`,
        ownerEmail,
        updatedAt: now,
      }),
    );
  }

  if (!contact) {
    contact = {
      id: contactId,
      legacyRecordId: null,
      businessId,
      name: contactName,
      email: contactEmail,
      normalizedEmail: normalizeEmail(contactEmail),
      phone: contactPhone,
      normalizedPhone: normalizePhone(contactPhone),
      title: cleanText(payload.contactTitle, 140),
      notes: cleanText(payload.contactNotes, 4000),
      ownerEmail,
      createdBy: auth.user.email,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    statements.push(
      d1
        .prepare(
          `INSERT INTO contacts (
            id, business_id, name, email, normalized_email, phone,
            normalized_phone, title, notes, owner_email, created_by,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          contact.id,
          businessId,
          contact.name,
          contact.email,
          contact.normalizedEmail,
          contact.phone,
          contact.normalizedPhone,
          contact.title,
          contact.notes,
          contact.ownerEmail,
          contact.createdBy,
          now,
          now,
        ),
      searchDocumentStatement({
        entityType: "contact",
        entityId: contact.id,
        title: contact.name,
        subtitle: contact.email || contact.phone,
        searchText: `${contact.name} ${contact.email} ${contact.phone} ${contact.title} ${contact.notes}`,
        ownerEmail,
        updatedAt: now,
      }),
    );
  } else if (!contact.businessId) {
    contact = { ...contact, businessId, updatedAt: now };
    statements.push(
      d1
        .prepare(
          "UPDATE contacts SET business_id = ?, updated_at = ? WHERE id = ? AND business_id IS NULL",
        )
        .bind(businessId, now, contact.id),
    );
  }

  const opportunity = {
    id: opportunityId,
    title: opportunityTitle,
    businessId,
    primaryContactId: contactId,
    relatedLeadId: lead.id,
    stage: "evaluation" as const,
    outcome: null,
    estimatedValue,
    expectedCloseDate,
    lossReason: "",
    ownerEmail,
    notes: opportunityNotes,
    closedAt: null,
    closedBy: null,
    createdBy: auth.user.email,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  statements.push(
    d1
      .prepare(
        `INSERT INTO opportunities (
          id, title, business_id, primary_contact_id, related_lead_id, stage,
          estimated_value, expected_close_date, owner_email, notes, created_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'evaluation', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        opportunity.id,
        opportunity.title,
        businessId,
        contactId,
        lead.id,
        estimatedValue,
        expectedCloseDate,
        ownerEmail,
        opportunityNotes,
        auth.user.email,
        now,
        now,
      ),
    d1
      .prepare(
        `UPDATE leads SET
          status = 'converted',
          converted_business_id = ?,
          converted_contact_id = ?,
          converted_opportunity_id = ?,
          converted_at = ?,
          converted_by = ?,
          updated_at = ?
         WHERE id = ? AND status = 'working' AND converted_at IS NULL`,
      )
      .bind(
        businessId,
        contactId,
        opportunityId,
        now,
        auth.user.email,
        now,
        lead.id,
      ),
    d1
      .prepare(
        `INSERT INTO lead_status_history
          (lead_id, from_status, to_status, changed_by, changed_at, note)
         VALUES (?, 'working', 'converted', ?, ?, 'Lead convertido')`,
      )
      .bind(lead.id, auth.user.email, now),
    d1
      .prepare(
        `INSERT INTO opportunity_stage_history
          (opportunity_id, from_stage, to_stage, changed_by, changed_at, note)
         VALUES (?, NULL, 'evaluation', ?, ?, 'Opportunity creada por conversión')`,
      )
      .bind(opportunityId, auth.user.email, now),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'convert', 'lead', ?, ?, ?)`,
      )
      .bind(
        auth.user.email,
        lead.id,
        `business=${businessId};contact=${contactId};opportunity=${opportunityId}`,
        now,
      ),
    searchDocumentStatement({
      entityType: "opportunity",
      entityId: opportunityId,
      title: opportunityTitle,
      subtitle: business.name,
      searchText: `${opportunityTitle} ${business.name} ${contact.name} ${opportunityNotes} Evaluation`,
      ownerEmail,
      updatedAt: now,
    }),
    searchDocumentStatement({
      entityType: "lead",
      entityId: lead.id,
      title: lead.businessName,
      subtitle: `${lead.contactName} ${lead.email || lead.phone}`.trim(),
      searchText: `${lead.businessName} ${lead.contactName} ${lead.email} ${lead.phone} ${lead.source} ${lead.notes} Converted`,
      ownerEmail: lead.ownerEmail,
      updatedAt: now,
    }),
  );

  try {
    await d1.batch(statements);
  } catch {
    const updatedLead = await activeLead(id);
    const existingConversion = updatedLead
      ? await completedConversion(updatedLead)
      : null;
    if (existingConversion) {
      return Response.json(existingConversion, {
        headers: { "x-idempotent-replay": "true" },
      });
    }
    return Response.json(
      {
        error:
          "No se completó la conversión. Ningún registro fue creado; revisa duplicados e inténtalo de nuevo.",
      },
      { status: 409 },
    );
  }

  return Response.json({
    business,
    contact,
    opportunity,
    lead: {
      ...lead,
      status: "converted",
      convertedBusinessId: businessId,
      convertedContactId: contactId,
      convertedOpportunityId: opportunityId,
      convertedAt: now,
      convertedBy: auth.user.email,
      updatedAt: now,
    },
  });
}
