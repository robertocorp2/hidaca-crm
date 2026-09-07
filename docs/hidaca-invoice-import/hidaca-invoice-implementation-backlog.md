# Backlog de implementación de facturación HIDACA

## Orden bloqueado

| Fase | Resultado | Dependencias | Prioridad | Riesgo |
|---|---|---|---|---|
| 1. Schema and migrations | Modelo normalizado y contratos | Discovery aprobado | P0 | Alto |
| 2. Web-app forms and views | UI española detrás de feature flag | Fase 1 | P1 | Alto |
| 3. Staging and import engine | Parser, identidad, matching y evidencia | Fases 1–2 | P0 | Crítico |
| 4. Dry-run and data cleanup | Preview determinista y cola de revisión | Fase 3 | P0 | Alto |
| 5. Test import | Piloto controlado y reversible | Fases 1–4 | P0 | Crítico |
| 6. Reconciliation | Comparación financiera/documental completa | Fase 5 | P0 | Crítico |
| 7. Production import | Importación autorizada por lotes | Fases 1–6 + aprobación | P0 | Crítico |
| 8. Post-import validation | Validación, monitoreo y cierre | Fase 7 | P0 | Alto |

## Fase 1 — Schema and migrations

**Tarea:** agregar el modelo aditivo y contratos sin importar datos.

**Razón:** `business_records` no representa líneas, NCF, versiones, asignaciones, créditos ni saldos históricos.

**Dependencias:** modelo/mapeo aprobados.

**Archivos probables:** `db/schema.ts`, `drizzle/*`, `app/lib/importers/types.ts`, nuevo módulo de dominio y tests.

Trabajo:

- Implementar `invoices`, `invoice_lines`, `payment_allocations`, `credit_notes`, `credit_note_lines`, `credit_note_applications`, `receivable_snapshots`, `collection_activities`, `products_services` y `tax_configurations`.
- Extender `payments`, import issues/candidates y roles documentales solo según el modelo.
- Agregar `legacy_record_id`, índices y constraints.
- Agregar los seis contratos futuros del plan.
- Feature flag; no retirar rutas/tablas heredadas.

**Aceptación:** migración forward sobre base limpia y copia de staging; ningún `business_records` cambia; constraints y tipos coinciden con el modelo; typecheck/tests/build pasan.

**Validación:** pruebas de FK, índices únicos parciales, enums, nullabilidad y compatibilidad.

**Rollback:** desactivar feature flag. No hacer `DROP`; las tablas aditivas pueden permanecer inactivas.

**Prioridad:** P0.

## Fase 2 — Web-app forms and views

**Tarea:** crear listas, detalles y formularios en español para Facturas, Pagos/asignaciones, Notas de crédito, Cuentas por cobrar y Cobranza.

**Razón:** las vistas genéricas actuales no muestran identidad fiscal, líneas, evidencia ni relaciones.

**Dependencias:** Fase 1.

**Archivos probables:** `app/app/*`, `app/api/invoices/*`, `app/api/payments/*`, `app/api/credit-notes/*`, `app/api/receivables/*`, `app/lib/modules.ts`, componentes/tests.

**Aceptación:** filtros/búsquedas/estados/relaciones del modelo visibles; permisos `viewer/operator/admin`; fuente/autoridad siempre visibles; registros heredados etiquetados sin doble conteo.

**Validación:** pruebas de rutas/permisos, accesibilidad, responsive y cálculos; suite existente.

**Rollback:** feature flag devuelve módulos `facturas`/`pagos` a vistas heredadas.

**Prioridad:** P1.

## Fase 3 — Staging and import engine

**Tarea:** extender el importador con manifiesto, parser/clasificador de facturas, identidad, validación y matching.

**Razón:** se necesita proveniencia por hoja/página/celda y decisiones conservadoras.

**Dependencias:** Fases 1–2.

**Archivos probables:** `app/lib/importers/*`, `app/lib/import-service.ts`, `/api/imports/*`, R2/D1 helpers, fixtures/tests.

Trabajo:

- `documentKind` para factura, recibo, pago, crédito, matriz y otros.
- PDF/XLSX, OCR por página, fórmula/resultado y emparejamiento de representaciones.
- Huellas de archivo/fila/identidad.
- Autoenlace solo por exactos únicos.
- Anulada/sustituta/versiones y autoridad documento > matriz.
- Pagos solo desde evidencia; `Avance/Pendiente` como snapshots.

**Aceptación:** fixtures trazan a fuente; parcial permanece parcial; nombre de archivo no prevalece; fuzzy nunca autoacepta.

**Validación:** golden tests 2021–2026, PDF sin texto, NCF duplicado, tratamiento fiscal no estándar, errores de fórmula y seguridad.

**Rollback:** dispatch por `documentKind`; el parser anterior de cotizaciones permanece.

**Prioridad:** P0.

## Fase 4 — Dry-run and data cleanup

**Tarea:** implementar dry-run invoice-aware, revisión y corrección no destructiva.

**Razón:** los conflictos reales, placeholders y errores no pueden resolverse automáticamente.

**Dependencias:** Fase 3.

**Archivos probables:** `/api/imports/invoices/dry-run`, `/api/imports/[id]/*`, `imports-view.tsx`, review components/tests.

Trabajo:

- Preview con create/link/duplicate/version/cancelled-replaced/review/exclude.
- Cola para los conflictos, OCR, placeholders, fórmulas y filenames.
- Correcciones con valor crudo intacto.
- Reconciliación previa y export.

**Aceptación:** dos dry-runs iguales producen huellas/decisiones/issues iguales; orden de archivos no cambia identidades; no se crea estado canónico.

**Validación:** snapshots API/UI, tests de idempotencia, permisos y checklist de calidad.

**Rollback:** cancelar lote no aceptado; staging owned por lote puede limpiarse sin tocar canónico.

**Prioridad:** P0.

## Fase 5 — Test import

**Tarea:** aceptar un piloto pequeño en ambiente no productivo.

**Razón:** probar escritura atómica, asignaciones y compatibilidad antes de escala.

**Dependencias:** Fases 1–4.

**Archivos probables:** acceptance service/API, migrations, pilot fixtures, tests/runbook.

El piloto incluye:

- factura normal;
- anulada + sustituta;
- nota de crédito;
- tratamiento fiscal no 18 %;
- pago documentado parcial/múltiple;
- snapshot discrepante;
- archivo con error/partial.

**Aceptación:** reintento no duplica; fallo intermedio hace rollback D1; R2/staging/auditoría permanecen; `Avance` no crea pago.

**Validación:** fallos inyectados, concurrencia, idempotency keys, export before/after y revisión contable.

**Rollback:** endpoint/operación de reversión del lote piloto; no borrar evidencia.

**Prioridad:** P0.

## Fase 6 — Reconciliation

**Tarea:** reconciliar piloto contra documento emitido, matriz, pagos, créditos y linaje.

**Razón:** aceptación técnica no demuestra exactitud financiera.

**Dependencias:** Fase 5.

**Archivos probables:** reconciliation service/API, report/export, tests.

**Aceptación:** conteos esperados/aceptados/revisados/fallidos; sumas de subtotal/impuesto/total/pagos/créditos/saldo; cero huérfanos no explicados; cada entidad traza a lote/archivo/ubicación.

**Validación:** `ImportReconciliationResult`, checklist firmado por operación/contabilidad y repetición de dry-run sin cambios.

**Rollback:** si no reconcilia, revertir lote piloto y conservar issues/evidencia.

**Prioridad:** P0.

## Fase 7 — Production import

**Tarea:** importar producción por lotes pequeños y controlados.

**Razón:** reducir radio de impacto y permitir reconciliación/reversión por lote.

**Dependencias:** Fases 1–6 completas, backup probado, autorización explícita y ventana operativa.

**Archivos probables:** configuración/runbook/observabilidad; no requiere cambiar reglas aprobadas.

**Aceptación:** cada lote dry-run → revisión → aprobación → aceptación → reconciliación; sin issues bloqueantes; contadores y saldos concuerdan.

**Validación:** monitoreo, muestreo estratificado, comparación con matriz/documentos y export de auditoría.

**Rollback:** detener lotes siguientes y revertir únicamente el lote afectado. Restauración de backup si el runbook lo exige.

**Prioridad:** P0. No ejecutar en esta fase de discovery.

## Fase 8 — Post-import validation

**Tarea:** validar integridad, UI, permisos, búsqueda, AR/cobranza y legado después de producción.

**Razón:** detectar brechas posteriores y cerrar convivencia sin pérdida.

**Dependencias:** Fase 7.

**Archivos probables:** tests, dashboards/reports, runbook y documentación.

**Aceptación:** cero duplicados por reintento; cero doble conteo legacy/canónico; saldos y estados explicables; documentos accesibles con permisos; auditoría completa; issues residuales asignados.

**Validación:** checklist completo, typecheck/tests/build, consultas de integridad, revisión contable y simulacro final de reversión.

**Rollback:** mantener legacy read-through y feature flag hasta aprobación formal; no retirar `business_records` en esta fase.

**Prioridad:** P0.

## Prompt exacto para el próximo Codex — Fase 1

```text
Implement Phase 1 (Schema and migrations) from docs/hidaca-invoice-import/hidaca-invoice-implementation-backlog.md in the HIDACA CRM repository.

Read these artifacts first:
- docs/hidaca-invoice-import/hidaca-invoice-data-model.md
- docs/hidaca-invoice-import/hidaca-invoice-gap-analysis.md
- docs/hidaca-invoice-import/hidaca-invoice-field-mapping.xlsx
- docs/hidaca-invoice-import/hidaca-invoice-import-plan.md
- docs/hidaca-invoice-import/hidaca-invoice-implementation-backlog.md

Scope:
1. Add additive Drizzle/D1 schema and migrations for invoices, invoice lines, payment allocations, credit notes and applications, receivable snapshots, collection activities, products/services, and tax configurations.
2. Extend existing payments/import/issues/candidates structures only where the approved model requires it.
3. Add InvoiceSourceManifestEntry, InvoiceImportPreview, InvoiceStagingRow, InvoiceMatchDecision, PaymentAllocationDraft, and ImportReconciliationResult.
4. Preserve all current business_records, routes, data, authentication, and UI behavior behind a disabled-by-default feature flag.
5. Do not import production data and do not deploy.
6. Add focused schema/constraint/contract tests and run typecheck, all tests, and production build.

Use English snake_case/code identifiers and Spanish user-facing labels. Keep the migration additive; do not drop or rewrite legacy tables. Finish with an implementation summary, test results, migration notes, and rollback procedure.
```
