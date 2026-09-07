# Plan de importación idempotente de facturas HIDACA

## Objetivo

Extender el flujo existente de importación para descubrir, extraer, normalizar, revisar, aceptar, reconciliar y revertir lotes de facturación sin crear estado canónico parcial ni duplicado. Este documento es un contrato futuro; esta fase de discovery no ejecuta importaciones ni migraciones.

## Flujo de extremo a extremo

```mermaid
flowchart LR
    A["Descubrimiento y manifiesto"] --> B["Hash y almacenamiento privado"]
    B --> C["Extracción cruda append-only"]
    C --> D["Clasificación del documento"]
    D --> E["Normalización con proveniencia"]
    E --> F["Validación y reconciliación"]
    F --> G["Matching exacto y candidatos"]
    G --> H["Dry-run determinista"]
    H --> I["Revisión humana"]
    I --> J["Aceptación atómica D1"]
    J --> K["Reconciliación posterior"]
    K --> L["Reversión controlada del lote"]
```

## Etapas

### 1. Descubrimiento

- Registrar ruta original, nombre, tamaño, timestamp, extensión, hash SHA-256 y estado de descarga.
- Incluir archivos irrelevantes/unsupported con motivo; nunca ejecutar `.lnk`, macros ni código embebido.
- Mantener un snapshot inicial y otro final del origen vivo.
- Clasificar deltas: `unchanged`, `added`, `changed`, `removed`, `inaccessible`.

### 2. Ingesta segura

- Crear `import_batch` en `pending/processing`.
- Subir el original sin cambios a R2 privado.
- Crear `documents`, `import_files` y `import_batch_sources`.
- Bloquear archivos vacíos, sobre límite o con tipo/extensión inconsistente.
- Un SHA-256 idéntico produce `duplicate_file`; no se vuelve a parsear ni aceptar automáticamente.
- Un PDF y XLSX del mismo documento no comparten hash: se vinculan como representaciones mediante identidad/evidencia.

### 3. Extracción

- Excel: cada hoja, visibilidad, rango, celda, valor crudo, fórmula, resultado cacheado, formato, merges, validaciones, comentarios y filtros.
- PDF: texto nativo por página; OCR solo en páginas sin capa útil.
- OCR: guardar motor/versión, confianza, bounding boxes cuando estén disponibles y estado `partial` si la confianza no permite aceptación.
- Persistir extracción completa en R2 y una vista limitada en D1.

### 4. Clasificación

`documentKind`:

- `invoice`
- `receipt`
- `payment_evidence`
- `credit_note`
- `invoice_register`
- `other`

La clasificación conserva evidencias y confianza. `unknown`/baja confianza requiere revisión.

### 5. Staging y normalización

- Una factura produce una cabecera provisional y N líneas.
- Matrices producen una fila de staging por fila operativa.
- Valores crudos y normalizados se guardan por separado en `source_field_values`.
- Los estados `blank`, `zero`, `not_applicable`, `not_calculated`, `value` e `invalid` no son intercambiables.
- La fuente emitida tiene autoridad sobre sus propios datos; la matriz crea comparación/snapshot.

### 6. Identidad y versiones

Clave provisional:

```text
business_exact_id
+ invoice_number_normalized
+ issue_year_or_date
+ ncf_normalized
+ document_version
+ cancellation/replacement role
```

Reglas:

- NCF exacto único válido es la señal más fuerte.
- Número + negocio + año solo produce candidato si falta NCF.
- Una fila anulada y una sustituta con NCF distinto nunca se colapsan.
- Un archivo con mismo nombre pero hash distinto se trata como posible revisión, no reemplazo silencioso.
- El número en nombre de archivo es señal débil; si contradice el contenido, gana el documento y se crea issue.

### 7. Matching

Autoenlace permitido solo cuando el identificador exacto es válido y único:

- RNC/Cédula normalizado.
- NCF/e-NCF.
- SHA-256.
- Código estable de fuente.
- Referencia transaccional de pago, cuando sea única.

Siempre candidato/revisión:

- nombre normalizado;
- contacto, teléfono o correo no únicos;
- dirección;
- proyecto;
- fecha/monto;
- similitud textual/fuzzy.

Una señal fuzzy nunca cambia estado canónico automáticamente.

### 8. Validación

Validaciones bloqueantes o de revisión:

- identificadores ausentes/invalidos;
- fechas imposibles o año `1900` por fórmula sobre vacío;
- NCF duplicado;
- factura anulada sin relación o sustituta ambigua;
- discrepancia de subtotal/impuesto/total;
- tratamiento fiscal no explicable;
- saldo negativo;
- `paid + balance != total`;
- pago/asignación sin evidencia;
- nota de crédito huérfana;
- documento/celda/página sin proveniencia;
- conflicto documento emitido vs matriz.

No asumir una tasa de 18 %. La validación usa la tasa/tratamiento declarado o una configuración fiscal vigente y trazable.

### 9. Dry-run

El dry-run escribe staging, issues, candidatos y preview; no crea ni modifica facturas, pagos, asignaciones, créditos o snapshots canónicos.

Propiedades:

- misma entrada + misma configuración → mismas huellas, decisiones e issues;
- orden de archivos no cambia identidades;
- todas las decisiones incluyen regla y evidencia;
- la vista muestra creación, enlace, duplicado, versión, sustitución, exclusión o revisión.

### 10. Revisión

El operador puede:

- seleccionar un candidato existente;
- crear un nuevo negocio/contacto/proyecto;
- confirmar identidad de factura;
- relacionar anulada/sustituta;
- resolver conflicto documento/matriz;
- corregir normalización sin alterar el valor crudo;
- excluir con motivo.

Cada corrección actualiza `source_field_values.mapping_status`, issue/resolution y auditoría.

### 11. Aceptación atómica

Una aceptación por lote usa una transacción D1:

1. Verificar que el lote sigue revisable y que sus hashes/configuración no cambiaron.
2. Revalidar restricciones únicas.
3. Crear/enlazar entidades en orden de dependencia.
4. Crear documentos/vínculos, facturas, líneas, snapshots, pagos documentados, asignaciones y créditos.
5. Crear `entity_history` y `audit_log`.
6. Marcar filas/archivos/lote aceptados.

Si una operación falla, toda la transacción canónica hace rollback. Los originales en R2 y staging permanecen para diagnóstico.

### 12. Reconciliación posterior

Generar `ImportReconciliationResult` con:

- totales esperados/descubiertos/aceptados/revisados/fallidos;
- sumas de factura, impuestos, créditos, pagos documentados, asignaciones y saldos;
- huérfanos y conflictos abiertos;
- IDs creados vs enlazados;
- evidencia sin entidad y entidad sin evidencia.

### 13. Reversión

- Solo `admin`.
- El lote registra ownership de cada fila canónica creada.
- La reversión crea estados/eventos compensatorios y deshace vínculos creados por el lote.
- No elimina negocios/documentos preexistentes ni cambios manuales posteriores.
- Si existe dependencia posterior, la reversión se bloquea y genera una lista de acciones necesarias.
- R2 y evidencia cruda no se eliminan.

## Contratos TypeScript futuros

```ts
export type InvoiceSourceManifestEntry = {
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  sourceModifiedAt: string | null;
  sha256: string;
  downloadStatus: "downloaded" | "inaccessible";
  deltaStatus: "unchanged" | "added" | "changed" | "removed" | "inaccessible";
  parseStatus: "parsed" | "partial" | "unreadable" | "unsupported" | "irrelevant";
  parserName: string;
  parserVersion: string;
  warnings: string[];
};

export type InvoiceStagingRow = {
  identityFingerprint: string;
  documentKind:
    | "invoice"
    | "receipt"
    | "payment_evidence"
    | "credit_note"
    | "invoice_register"
    | "other";
  rawValues: Record<string, unknown>;
  normalizedValues: Record<string, unknown>;
  sourceReferences: Array<{
    documentId: string;
    sheet?: string;
    page?: number;
    row?: number;
    cell?: string;
    rawValue: string;
    displayValue: string;
    formula?: string;
  }>;
};

export type InvoiceMatchDecision = {
  decision:
    | "create"
    | "link"
    | "duplicate"
    | "new_version"
    | "cancelled_replaced"
    | "manual_review"
    | "exclude";
  targetEntityType: string;
  targetEntityId: string | null;
  confidence: "exact_unique" | "candidate" | "manual";
  rule: string;
  evidence: string[];
};

export type PaymentAllocationDraft = {
  paymentStagingId: string;
  invoiceStagingId: string;
  amount: number;
  currency: string;
  allocationDate: string | null;
  evidenceDocumentId: string;
  decision: "ready" | "manual_review" | "blocked";
};

export type InvoiceImportPreview = {
  batchId: string;
  files: InvoiceSourceManifestEntry[];
  invoices: InvoiceStagingRow[];
  decisions: InvoiceMatchDecision[];
  allocations: PaymentAllocationDraft[];
  issues: Array<{ type: string; severity: string; sourceLocation: string }>;
  reconciliation: ImportReconciliationResult;
};

export type ImportReconciliationResult = {
  expectedFiles: number;
  parsedFiles: number;
  partialFiles: number;
  unreadableFiles: number;
  invoiceCount: number;
  duplicateCount: number;
  reviewCount: number;
  createdCount: number;
  linkedCount: number;
  totals: Record<string, number | null>;
  openIssuesByType: Record<string, number>;
  balanced: boolean;
};
```

## APIs futuras

| Método y ruta | Propósito | Permiso |
|---|---|---|
| `POST /api/imports/invoices/dry-run` | Crear lote/manifiesto y preview. | operator/admin |
| `GET /api/imports/:id` | Reutilizar detalle con resumen de factura. | viewer+ |
| `PATCH /api/imports/:id/review` | Reutilizar revisión/corrección. | operator/admin |
| `POST /api/imports/:id/accept` | Extender aceptación por tipo de lote. | operator/admin según resolución |
| `POST /api/imports/:id/reverse` | Revertir lo creado por el lote. | admin |
| `GET /api/invoices` / `GET /api/invoices/:id` | Lista/detalle normalizado. | viewer+ |
| `GET/POST /api/payments` | Transacciones documentadas. | viewer+ / operator+ |
| `POST /api/payments/:id/allocations` | Aplicar pago con evidencia. | operator+ |
| `GET /api/credit-notes` / `GET /api/credit-notes/:id` | Lista/detalle. | viewer+ |
| `POST /api/credit-notes/:id/applications` | Aplicar crédito. | operator+ |
| `GET /api/receivables` | Saldos/envejecimiento. | viewer+ |
| `GET/POST /api/collection-activities` | Seguimiento de cobro. | viewer+ / operator+ |

Todas las respuestas de mutación incluyen `batchId`, IDs creados/enlazados, issues y reconciliación. Los reintentos usan idempotency key + hash/configuración.

## Garantías de idempotencia

- Huella de archivo: SHA-256 del binario.
- Huella de fila/cabecera: JSON canónico de fuente + ubicación.
- Huella de identidad: campos exactos normalizados y rol de versión/anulación.
- Claves únicas en D1 protegen contra reintentos concurrentes.
- Aceptación verifica `accepted_at`/estado y devuelve el resultado existente.
- Asignaciones/créditos usan claves únicas y reversiones append-only.

## Rollback operativo

1. Desactivar rutas nuevas mediante feature flag.
2. Mantener lectura heredada de `business_records`.
3. Revertir el lote seleccionado con preview de impacto.
4. Confirmar que documentos/staging/auditoría permanecen.
5. Ejecutar reconciliación posterior y conservar el reporte.
