export type DocumentUploadKeyState = { signature: string; key: string } | null;

export function documentUploadKeyFor(
  current: DocumentUploadKeyState,
  file: Pick<File, "name" | "size" | "type" | "lastModified">,
  recordId: string,
  createKey: () => string = () => crypto.randomUUID(),
) {
  const signature = JSON.stringify([
    file.name,
    file.size,
    file.type,
    file.lastModified,
    recordId,
  ]);
  return current?.signature === signature
    ? current
    : { signature, key: createKey() };
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
