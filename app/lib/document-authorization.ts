export type DocumentRole = "admin" | "operator" | "viewer";

/** Operators may create and edit business documents; viewers remain read-only. */
export function canWriteDocuments(role: DocumentRole): boolean {
  return role === "admin" || role === "operator";
}

export function documentReadOnlyResponse(): Response {
  return Response.json(
    { error: "Acceso de solo lectura." },
    { status: 403 },
  );
}
