import { getD1 } from "../../db";
import { toFtsQuery } from "./crm";

export type SearchDocumentInput = {
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string;
  searchText?: string;
  ownerEmail?: string;
  updatedAt: string;
};

export type SearchResult = {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string;
  rank: number;
};

export function searchDocumentStatement(
  input: SearchDocumentInput,
): D1PreparedStatement {
  return getD1()
    .prepare(
      `INSERT INTO search_documents
        (entity_type, entity_id, title, subtitle, search_text, owner_email, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        title = excluded.title,
        subtitle = excluded.subtitle,
        search_text = excluded.search_text,
        owner_email = excluded.owner_email,
        updated_at = excluded.updated_at`,
    )
    .bind(
      input.entityType,
      input.entityId,
      input.title,
      input.subtitle ?? "",
      input.searchText ?? "",
      input.ownerEmail ?? "",
      input.updatedAt,
    );
}

export function deleteSearchDocumentStatement(
  entityType: string,
  entityId: string,
): D1PreparedStatement {
  return getD1()
    .prepare(
      "DELETE FROM search_documents WHERE entity_type = ? AND entity_id = ?",
    )
    .bind(entityType, entityId);
}

export async function upsertSearchDocument(input: SearchDocumentInput) {
  await searchDocumentStatement(input).run();
}

export async function deleteSearchDocument(
  entityType: string,
  entityId: string,
) {
  await deleteSearchDocumentStatement(entityType, entityId).run();
}

export async function searchBusinessData(
  query: string,
  limit = 40,
): Promise<SearchResult[]> {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];

  const result = await getD1()
    .prepare(
      `SELECT
        d.entity_type AS entityType,
        d.entity_id AS entityId,
        d.title,
        d.subtitle,
        bm25(search_documents_fts) AS rank
       FROM search_documents_fts
       JOIN search_documents d ON d.row_id = search_documents_fts.rowid
       WHERE search_documents_fts MATCH ?
       ORDER BY rank, d.updated_at DESC
       LIMIT ?`,
    )
    .bind(ftsQuery, Math.min(Math.max(limit, 1), 60))
    .all<SearchResult>();

  return result.results;
}
