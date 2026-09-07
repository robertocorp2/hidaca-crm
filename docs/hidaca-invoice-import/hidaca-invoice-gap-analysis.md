# Análisis de brechas del CRM para facturación

## Resumen ejecutivo

El CRM ya tiene una base sólida de clientes, contactos, proyectos, cotizaciones, pagos, documentos, staging, linaje y revisión. La brecha principal no es de almacenamiento de archivos: es la ausencia de un libro mayor normalizado de facturas y cuentas por cobrar. Hoy `facturas` y parte de `pagos` dependen de `business_records`, cuya forma genérica no puede representar líneas, NCF, versiones, anulaciones, asignaciones de pagos, notas de crédito ni saldos históricos con integridad.

La implementación debe extender el importador actual y sus controles en lugar de crear un segundo sistema paralelo.

## Evidencia revisada en el repositorio

- `db/schema.ts`: entidades canónicas, importación, proveniencia y revisión.
- `app/lib/importers/types.ts`: contrato actual de extracción/normalización.
- `app/lib/importers/hidaca-mapper.ts`: mapeo de cotizaciones y detección de pagos.
- `app/api/imports/route.ts`: carga individual, hash SHA-256, R2, D1 y candidatos.
- `app/api/imports/[id]/*`: detalle, revisión, aceptación, reintento y aceptación de registros.
- `app/app/imports-view.tsx`: flujo de carga/revisión.
- `app/api/records/*` y `app/app/operations-client.tsx`: módulos genéricos de facturas/pagos.

## Matriz de brechas

| Capacidad | Soporte actual | Brecha | Soporte requerido | Prioridad | Riesgo | Complejidad |
|---|---|---|---|---|---|---|
| Clientes y contactos | Alto | Coincidencias por nombre/teléfono pueden producir candidatos demasiado fuertes. | Autoenlace solo por RNC/Cédula, correo/teléfono exacto único cuando corresponda; nombres siempre revisión. | P0 | Alto | Media |
| Proyectos y cotizaciones | Alto | No existe relación factura → cotización/proyecto. | FKs opcionales, candidatos exactos y revisión. | P1 | Medio | Media |
| Facturas normalizadas | Nulo | `business_records` solo conserva título, cliente, monto, saldo y metadatos. | `invoices` con identidad, NCF, fechas, estado, autoridad, totales y versión. | P0 | Crítico | Alta |
| Líneas de factura | Nulo | No hay detalle vendible/fiscal. | `invoice_lines` con cantidad, dimensiones, precio, impuesto y fuente. | P0 | Alto | Alta |
| Pagos transaccionales | Parcial | `payments` existe y está ligado a cotizaciones, pero no a facturas mediante asignaciones. | Extender `payments`; crear `payment_allocations`. | P0 | Crítico | Alta |
| Saldo/avance de matriz | Nulo | Riesgo de convertir agregados en pagos ficticios. | `receivable_snapshots`; discrepancia contra pagos documentados. | P0 | Crítico | Media |
| Notas de crédito | Nulo | No se modela emisión ni aplicación. | `credit_notes`, líneas y aplicaciones. | P0 | Alto | Alta |
| Anulación y sustitución | Nulo | Hash/numero simple puede colapsar documentos distintos. | Estados `cancelled/replaced`, relación de sustitución e identidad con NCF/versión. | P0 | Crítico | Media |
| Cobranza | Nulo | No hay promesas, disputas ni próxima acción. | `collection_activities` y cola de cuentas por cobrar. | P2 | Medio | Media |
| Productos/servicios | Parcial | Las cotizaciones tienen líneas, pero no catálogo reusable. | Catálogo opcional; descripción histórica inmutable. | P2 | Bajo | Media |
| Configuración fiscal | Nulo | El importador puede asumir cálculos que no explican tratamientos no estándar. | Tasas/configuraciones con vigencia; nunca asumir 18 %. | P0 | Crítico | Alta |
| Documentos y R2 | Alto | Falta clasificación específica de factura, recibo y nota de crédito. | Reutilizar `documents`/`document_links`; ampliar roles/tipos. | P1 | Medio | Baja |
| Hash y duplicado de archivo | Alto | Un hash exacto detecta binarios iguales, no versiones lógicas ni PDF/XLSX del mismo documento. | Distinguir duplicado binario, representación emparejada, versión y sustitución. | P0 | Alto | Media |
| Staging y campos crudos | Alto | `import_rows` está orientado a filas y tipos actuales; falta documento de factura. | Agregar `document_kind`, identidad provisional y soportar encabezado/líneas. | P0 | Alto | Media |
| Issues y candidatos | Alto | Enums no incluyen factura, pago, crédito ni relaciones fiscales. | Ampliar tipos/candidatos sin perder compatibilidad. | P0 | Alto | Baja |
| Formatos de entrada | Parcial | Solo PDF/XLSX/XLSM/XLSB, carga individual, máximo 32 MB. | Lote multiarchivo/manifiesto; OCR y CSV/DOCX/imágenes solo cuando aparezcan. | P1 | Medio | Alta |
| OCR | Nulo | Un PDF sin capa de texto queda fallido/parcial. | OCR por página, confianza y revisión; nunca marcar éxito completo sin contenido. | P1 | Medio | Media |
| Importación idempotente | Parcial | Hash exacto y aceptación atómica por archivo; no identidad canónica de factura ni reversión de lote. | Decisiones deterministas, aceptación repetible y endpoint de reversión. | P0 | Crítico | Alta |
| Auditoría | Alto | `audit_log` y `entity_history` existen. | Registrar aceptación, corrección, asignación y reversión con lote/documento. | P0 | Alto | Baja |
| UI de facturas | Parcial | Lista/formulario genérico de `business_records`. | Lista/detalle normalizados, filtros, documentos, pagos, créditos e historial. | P1 | Alto | Alta |
| UI de pagos/AR | Parcial | Módulo genérico de pagos; sin asignación ni envejecimiento. | Pagos, asignaciones, cuentas por cobrar y cobranza. | P1 | Alto | Alta |
| Permisos | Alto | Roles `admin`, `operator`, `viewer` y autorización existente. | Reglas específicas para aceptar/revertir lote, impuestos, anulación y cobros. | P1 | Alto | Media |
| Compatibilidad heredada | Parcial | Varias rutas siguen leyendo `business_records`. | `legacy_record_id`, backfill determinista y convivencia read-through. | P0 | Alto | Alta |

## Matriz detallada de impacto

| Campo/soporte existente | Módulo existente | Requisito de fuente | Tipo de brecha | Cambio recomendado | Impacto DB | Impacto API | Impacto UI | Migración | Prioridad | Riesgo | Complejidad |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `business_records.title/customerName/amount/balance` | Facturas genéricas | Identidad fiscal, fechas, NCF, versión, totales y autoridad | Missing and required | Crear `invoices`; mantener `legacy_record_id` | Tabla/índices nuevos | `/api/invoices` + import | Lista/detalle normalizado | Aditiva + backfill candidato | P0 | Crítico | Alta |
| Ninguno | Ninguno | Líneas con código, descripción, cantidad, dimensiones, precio e impuesto | Missing and required | Crear `invoice_lines` | Tabla/FK/índice | Detalle/import | Tabla de líneas | Aditiva | P0 | Alto | Alta |
| `payments` | Pagos parcial | Un pago puede cubrir varias facturas | Supported but needs modification | Extender pago + `payment_allocations` | Columnas/tabla | Asignar/revertir | Asignaciones y no aplicado | Aditiva | P0 | Crítico | Alta |
| Ninguno | Ninguno | `Avance/Pendiente` como saldos históricos | Missing and required | Crear `receivable_snapshots` | Tabla | AR/reconciliation | Historial de saldo | Aditiva | P0 | Crítico | Media |
| Ninguno | Ninguno | Nota de crédito y aplicaciones | Missing and required | Crear créditos/líneas/aplicaciones | Tres tablas | CRUD/aplicación | Módulo español | Aditiva | P0 | Alto | Alta |
| `businesses.rnc/normalizedRnc` | Empresas | RNC/Cédula exacto y RNC del emisor separado | Supported but needs modification | Matching por contexto/validez/unicidad | Sin tabla nueva; reglas | Candidatos | Evidencia/confianza | No | P0 | Alto | Media |
| `contacts` | Contactos | Contacto/correo/teléfono | Already supported | Reutilizar; separar múltiples valores | Ninguno | Candidatos | Selector/revisión | No | P1 | Medio | Baja |
| `projects`, `quotations` | Proyectos/Cotizaciones | Proyecto/cotización asociados | Supported but needs modification | FK desde factura y revisión exacta | FK/índices | Candidatos/vínculos | Relaciones en detalle | Aditiva | P1 | Medio | Media |
| `documents`, `document_links` | Documentos | PDF/XLSX/recibo/crédito y representaciones | Supported but needs modification | Ampliar clasificación/propósito | Enum/metadatos | Upload/listado | Grupo de documentos | Aditiva | P1 | Medio | Baja |
| `import_batches/import_files` | Importaciones | Lote multiarchivo y `documentKind` | Supported but needs modification | Extender tipos/contadores/manifiesto | Columnas/enums | Dry-run por lote | Resumen por documento | Aditiva | P0 | Alto | Media |
| `source_field_values` | Importaciones | Crudo, mostrado, fórmula, normalizado y transformación | Already supported | Reutilizar/ampliar longitud/enums solo si hace falta | Bajo | Revisión | Vista de evidencia | Posible aditiva | P0 | Medio | Baja |
| `import_issues` | Importaciones | Conflictos fiscales, identidad, OCR, saldo y versión | Supported but needs modification | Ampliar issue types | Enum | Review/resolution | Cola/insignias | Aditiva | P0 | Alto | Baja |
| `import_candidates` | Importaciones | Candidatos factura/pago/crédito | Supported but needs modification | Ampliar candidate types; exactos únicamente para autoenlace | Enum | Matching | Selector con razones | Aditiva | P0 | Alto | Baja |
| Ninguno | Ninguno | Tasas/tratamientos fiscales con vigencia | Missing and required | Crear `tax_configurations` | Tabla | CRUD/validación | Configuración admin | Aditiva | P0 | Crítico | Alta |
| Ninguno | Ninguno | Productos/servicios reutilizables | Missing but optional | Crear catálogo opcional | Tabla/FK | CRUD | Selector | Aditiva | P2 | Bajo | Media |
| Ninguno | Ninguno | Días, aging bucket y saldo calculado | Derived field | Derivar en query/servicio desde fecha/saldo | Vista/query | `/api/receivables` | Aging | No o vista | P1 | Medio | Media |
| `audit_log`, `entity_history` | Auditoría | Lote/fuente/corrección/reversión | Supported but needs modification | Reutilizar con nuevas entidades/acciones | Índices opcionales | Eventos | Timeline | Aditiva menor | P0 | Alto | Baja |
| `.p12`, `.lnk` | Ninguno | Archivos sensibles/no ejecutables | Not recommended for import | Inventario/hash y exclusión | Ninguno | Bloqueo | Motivo visible | No | P0 | Crítico | Baja |
| Texto de firmas/leyendas | Documentos | Texto histórico de autorización | Historical/audit-only field | Conservar en evidencia, no crear usuarios | `source_field_values` | Lectura | Fuente | No | P2 | Bajo | Baja |

## Cambios concretos por área

### Esquema (`db/schema.ts` y migraciones Drizzle)

Agregar las entidades del modelo de datos y ampliar enums de importación/candidatos/issues. Las migraciones deben ser aditivas y no retirar `business_records`.

Áreas probables:

- `db/schema.ts`
- `drizzle/*`
- `db/index.ts` o helpers de D1 si requieren transacciones por lote

### Capa de importación

El contrato `ImportExtraction` ya conserva celdas, fórmulas y páginas, y `sourceFieldValues` soporta hoja/página/celda. Debe agregarse una normalización específica de facturas que no reutilice semánticas de cotización de forma implícita.

Cambios:

- Nuevo `invoice-mapper.ts` o estrategia tipada dentro del mapper.
- Clasificador `documentKind`: `invoice`, `receipt`, `credit_note`, `matrix`, `other`.
- Contratos futuros descritos en el plan de importación.
- OCR por página solo cuando el texto nativo sea insuficiente.
- Matching exacto y candidatos explícitos; retirar cualquier autoenlace basado solo en nombre normalizado.

### APIs

Extender `/api/imports` para lote/manifiesto y dry-run de factura. Mantener detalle, revisión y aceptación existentes. Agregar:

- Reversión de lote.
- Listado/detalle de facturas.
- Pagos y asignaciones.
- Notas de crédito y aplicaciones.
- Cuentas por cobrar y cobranza.

### Interfaz

Reemplazar gradualmente las vistas genéricas de `facturas`/`pagos`. Durante convivencia, mostrar registros normalizados y heredados con etiquetas claras, evitando doble conteo cuando exista `legacy_record_id`.

## Reglas que el código actual no debe aplicar al corpus

1. No aceptar un candidato de cliente por nombre normalizado como autoenlace.
2. No transformar `Avance` en una fila de `payments`.
3. No interpretar `Fecha Cierre = Anulada` como fecha inválida sin conservar el estado.
4. No deduplicar únicamente por factura + cliente + fecha.
5. No asumir ITBIS de 18 % cuando la fuente presenta otro tratamiento.
6. No considerar PDF y XLSX con el mismo documento como duplicados binarios; son representaciones/evidencias relacionadas.
7. No sobrescribir una factura emitida cuando cambia el archivo; crear versión, issue o relación de sustitución según la evidencia.

## Criterio de cierre de brechas

La fase de implementación estará lista para importación controlada cuando:

- el esquema normalizado y las migraciones aditivas pasen pruebas;
- el mismo dry-run produzca las mismas identidades, candidatos e issues;
- aceptar dos veces no cree duplicados;
- pagos/asignaciones solo nazcan de evidencia transaccional;
- la reversión afecte únicamente datos creados por el lote;
- la UI muestre fuente, autoridad, conflictos y estados heredados;
- los cálculos de total, saldo, créditos y pagos se reconcilien sin asumir una tasa fiscal fija.
