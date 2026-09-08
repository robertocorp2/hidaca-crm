# Implementación de facturas HIDACA — Fases 2 a 8

## Estado

Las capacidades de aplicación previstas en las fases 2 a 8 quedaron
implementadas detrás de banderas desactivadas por defecto. No se importaron
datos de producción, no se habilitó ninguna bandera remota y no se desplegó.

| Fase | Implementación | Evidencia principal |
|---|---|---|
| 2 | Listas, detalles y formularios en español para facturas, partidas, pagos/asignaciones, notas/aplicaciones, cuentas por cobrar y cobranza. | `app/app/billing-view.tsx`, APIs normalizadas |
| 3 | Clasificación por contenido, identidad, autoridad, partidas, fórmulas, OCR requerido, versiones, representaciones emparejadas, evidencia y snapshots. | `app/lib/importers/invoice.ts` |
| 4 | Dry-run multiarchivo determinista, R2 privado, staging D1, revisión no destructiva, proveniencia por celda/página y export CSV. | `/api/imports/invoices/dry-run`, `invoice-import-review.tsx` |
| 5 | Aceptación piloto administrativa, atómica, estable e idempotente; líneas, pagos, asignaciones, créditos y snapshots. | `/api/imports/[id]/accept-invoices` |
| 6 | Conciliación reproducible de conteos, subtotal, impuesto, total, pagos, asignaciones, créditos, aplicaciones, saldo y huérfanos. | `invoice-reconciliation.ts` |
| 7 | Promoción con kill switch independiente, respaldo, ventana, confirmación y conciliación obligatoria; reversión por lote. | `/promote`, `/reverse`, runbook |
| 8 | Validación posterior de relaciones, NCF, R2, búsqueda, auditoría, legado y conciliación. | `/post-validation` |

## Decisiones conservadoras

- Documento emitido supera a la matriz para hechos propios de la factura.
- RNC/NCF/número/año solo autoenlazan cuando la coincidencia exacta es única.
- Los nombres y otras señales difusas nunca autoenlazan.
- Una página PDF sin texto queda bloqueada para OCR; no se presenta como
  análisis exitoso.
- Una fórmula con error visible queda bloqueada.
- `Avance` y `Pendiente` no crean pagos. Cuando la matriz se empareja con una
  factura exacta, crean un snapshot reversible.
- Un pago puede existir sin asignación, pero una asignación importada requiere
  documento, monto positivo y una factura única.
- Una anulada/sustituta o una versión relacionada exige revisión; no actualiza
  silenciosamente una factura existente.
- Los registros genéricos de `business_records` continúan visibles como
  heredados y se excluyen cuando existe un enlace normalizado.

## Banderas

```text
INVOICE_IMPORT_PHASE1_ENABLED=false
INVOICE_PRODUCTION_IMPORT_ENABLED=false
```

La primera habilita las vistas y APIs normalizadas. La segunda solo habilita el
paso crítico de promoción y nunca sustituye autenticación, rol administrador,
conciliación, respaldo, ventana y confirmación.

## Migraciones posteriores a la Fase 1

- `0008_melted_sauron.sql`: propiedad de lote para facturas, pagos y notas.
- `0009_glamorous_millenium_guard.sql`: enlace único de pagos heredados.
- `0010_light_clea.sql`: reversión no destructiva de snapshots.

Todas son aditivas. No contienen `DROP`, no reescriben `business_records` y no
realizan backfill de producción.

## Límites operativos

- Un dry-run admite hasta 10 archivos, 32 MB por archivo y 2,000 filas. Los
  lotes de producción deben ser deliberadamente pequeños.
- Formatos: PDF, XLSX, XLSM y XLSB. Los macros se inspeccionan, nunca se
  ejecutan.
- El OCR se expresa como incidencia bloqueante por página. La resolución debe
  aportar una extracción revisada; nunca se inventa texto.

## Rollback funcional

1. Deshabilitar `INVOICE_PRODUCTION_IMPORT_ENABLED`.
2. Detener lotes siguientes.
3. Conciliar el lote afectado.
4. Invocar la reversión administrativa con motivo.
5. Confirmar que facturas/notas quedan archivadas, pagos anulados, snapshots y
   aplicaciones revertidos, índices derivados retirados y evidencia intacta.
6. Mantener `business_records` y el read-through heredado.
7. Si se requiere aislamiento inmediato, deshabilitar
   `INVOICE_IMPORT_PHASE1_ENABLED`.

## Fuera de esta ejecución

La carga del corpus real, la firma contable, la creación/verificación del
backup D1, la ventana de cambio, la activación remota de banderas y el
despliegue requieren autorización operacional explícita. Ninguna de esas
acciones se ejecutó durante la implementación.
