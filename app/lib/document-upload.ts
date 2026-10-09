export type DocumentUploadKeyState = { file: Pick<File, "name" | "size" | "type" | "lastModified">; recordId: string; key: string } | null;

export function documentUploadKeyFor(
  current: DocumentUploadKeyState,
  file: Pick<File, "name" | "size" | "type" | "lastModified">,
  recordId: string,
  createKey: () => string = () => crypto.randomUUID(),
) {
  return current?.file === file && current.recordId === recordId
    ? current
    : { file, recordId, key: createKey() };
}

export function postDocumentUpload(
  formData: FormData,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
) {
  return fetcher("/api/documents", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: formData,
  });
}
