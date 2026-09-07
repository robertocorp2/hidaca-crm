# Rediseño integral de Facturas

## Decisiones compartidas

- La entidad canónica es `invoices`; `business_records` solo permanece como lectura heredada hasta que una fila se vincule mediante `invoices.legacy_record_id`.
- Se reutilizan las relaciones existentes con `businesses`, `contacts`, `projects`, `quotations`, `invoice_lines`, `payment_allocations` y `credit_note_applications`. No se crean columnas duplicadas para datos ya representados.
- Los registros históricos incompletos siguen visibles, pero sus campos ausentes se presentan como `—`; el estado histórico `pagado` se normaliza visualmente como `Pagada` sin inventar un monto pagado.
- Los totales observados en fuentes importadas se conservan. En creación y edición manual, los importes se calculan de forma determinista a partir de partidas, descuento, cargos, ITBIS y avance.
- La fuente histórica se mantiene trazable mediante `legacy_record_id`, `source_authority`, `source_values`, documentos y lotes de importación existentes.

## Tarea 1 — Corregir el contrato de listado y legado

### Goal

Entregar filas contables completas y correctamente mapeadas para facturas normalizadas y heredadas.

### Context

La API actual confunde `business_records.title` con el número de factura y muestra `amount`/`balance` como si fueran total/balance sin consultar metadatos. Además, la búsqueda no contempla el RNC y el listado carece de subtotal e ITBIS.

### Relevant files or references

- `app/api/invoices/route.ts`
- `app/lib/invoice-domain.ts`
- Captura del registro histórico adjunta a la solicitud

### Proposed approach

Ampliar el contrato con fecha, NCF, RNC, subtotal, ITBIS, total, estado y origen; buscar por factura, NCF, empresa y RNC; permitir orden seguro por fecha, factura, cliente y total; extraer campos heredados de metadatos únicamente cuando existan y evitar reinterpretar `balance` como total.

### Acceptance criteria

- Las filas normalizadas exponen todos los campos mínimos del registro contable.
- Las filas heredadas no presentan valores falsos ni intercambian factura, total y balance.
- `pagado`/`paid` se muestra como `Pagada`.
- La búsqueda incluye factura, NCF, cliente y RNC.
- El orden solicitado se aplica mediante una lista cerrada de campos.

### Verify

- `npm test -- --test-name-pattern invoice`
- Pruebas del contrato de API y mapeo heredado.

## Tarea 2 — Crear y editar facturas completas

### Goal

Permitir registrar y actualizar una factura con relaciones, datos fiscales, referencias y múltiples partidas.

### Context

El esquema canónico ya contiene las relaciones y campos esenciales, pero el formulario actual solo envía empresa, número, NCF, fechas y total; la edición no está expuesta en UI.

### Relevant files or references

- `app/app/billing-view.tsx`
- `app/api/invoices/route.ts`
- `app/api/invoices/[id]/route.ts`
- `app/api/invoices/[id]/lines/route.ts`
- `db/schema.ts`

### Proposed approach

Crear un formulario de factura dedicado que capture referencias, estado, importes y una colección editable de partidas. Calcular en cliente para retroalimentación inmediata y validar/recalcular en servidor. Conservar los valores importados cuando no se editen.

### Acceptance criteria

- Se pueden agregar y quitar cero, una o muchas partidas.
- Cada partida admite código, descripción, cantidad, ubicación, ancho, altura, área, precio y total.
- Subtotal, descuento, base posterior, cargos, ITBIS, total, avance y balance se calculan consistentemente.
- Se pueden crear y editar facturas sin romper relaciones de Empresa.
- Los campos históricos ausentes siguen siendo nulos o vacíos, no inventados.

### Verify

- Pruebas unitarias de cálculos financieros.
- Pruebas de contratos POST/PATCH y partidas.

## Tarea 3 — Rediseñar lista y detalle

### Goal

Convertir Facturas en una vista contable escaneable y un expediente estructurado de factura.

### Context

La vista actual usa seis celdas genéricas y un modal pequeño. La captura fuente incluye información fiscal, cliente/proyecto, partidas y resumen financiero.

### Relevant files or references

- `app/app/billing-view.tsx`
- `app/globals.css`
- Capturas adjuntas de listado, modal y factura emitida

### Proposed approach

Especializar la experiencia de Facturas sin alterar Pagos, Notas de crédito, Cuentas por cobrar o Cobranza. Añadir encabezados ordenables, tabla responsive, panel amplio con secciones Factura, Cliente, Proyecto, Conceptos y Resumen financiero, además de modo de edición.

### Acceptance criteria

- El listado muestra Fecha, Factura, NCF, Cliente/Empresa, Sub-Total, ITBIS, Total y Estado.
- Cada fila es operable con puntero y teclado.
- El detalle presenta todo campo disponible y `—` para ausencias.
- La tabla de conceptos muestra las nueve columnas solicitadas sin perder legibilidad móvil.
- Crear y editar usan el mismo modelo visible en el detalle.

### Verify

- Inspección en navegador a anchos móvil, tableta y escritorio.
- Pruebas de superficie y accesibilidad existentes.

## Tarea 4 — Compatibilidad del importador y validación final

### Goal

Garantizar que el registro histórico y los documentos detallados convivan sin pérdida ni regresiones.

### Context

El importador existente normaliza encabezados y conserva evidencia. La nueva UI debe consumir esos mismos campos sin cambiar su semántica.

### Relevant files or references

- `app/lib/importers/invoice.ts`
- `app/api/imports/[id]/accept-invoices/route.ts`
- `tests/invoice-import-engine.test.ts`
- `tests/invoice-schema.test.mjs`
- `tests/invoice-import-surface.test.mjs`

### Proposed approach

Agregar casos del encabezado `MES/FECHA/Nombre/Factura/NCF/Sub-Total/Itbis/Total/pagado`, verificar mapeo por nombres normalizados y ejecutar toda la validación del proyecto. No importar, borrar ni modificar datos reales durante las pruebas.

### Acceptance criteria

- El mapeo no depende de posiciones de columna.
- Las facturas pagadas conservan su estado sin pagos fabricados.
- Las migraciones siguen siendo aditivas y todos los registros heredados se preservan.
- Lint, typecheck, tests y build pasan.
- No hay regresiones visibles en otras secciones.

### Verify

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- Validación visual responsive en navegador.

## Fuera de alcance

- Importar o corregir datos de producción.
- Eliminar el registro heredado malformado sin evidencia de su origen.
- Activar banderas remotas, desplegar o modificar credenciales.
