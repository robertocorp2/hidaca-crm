# Runbook de importación de facturas HIDACA

## Propósito

Ejecutar lotes pequeños, auditables y reversibles sin retirar el legado. Este
runbook no autoriza por sí mismo una importación.

## Roles

- Operaciones prepara archivos y resuelve campos.
- Contabilidad revisa impuestos, totales, pagos, créditos y saldos.
- Administrador acepta/revierte.
- Responsable de cambio verifica backup, ventana y monitoreo.

## Preflight obligatorio

- [ ] Código/migraciones aprobados y desplegados por el proceso normal.
- [ ] `INVOICE_IMPORT_PHASE1_ENABLED=true`.
- [ ] `INVOICE_PRODUCTION_IMPORT_ENABLED=false` durante preparación.
- [ ] Backup D1 creado y restauración probada; registrar su identificador.
- [ ] Objetos R2 originales accesibles.
- [ ] Ventana de cambio y responsables confirmados.
- [ ] Export baseline de conteos/sumas/legado guardado.
- [ ] Lote de 10 archivos o menos y 2,000 filas o menos.

## Dry-run y revisión

1. Cargar el lote en **Importaciones → Simulación de facturas**.
2. Confirmar manifiesto, SHA-256, parser, páginas/hojas y número de filas.
3. Resolver OCR, fórmulas, placeholders, NCF duplicados, anulaciones/versiones
   y conflictos documento/matriz.
4. Una fila de matriz solo puede quedar vinculada exactamente u omitida.
5. Confirmar que pagos/asignaciones tienen evidencia identificable.
6. Ejecutar conciliación y exportarla como CSV.
7. Repetir el mismo dry-run: debe reutilizar el lote y las decisiones.

## Piloto no productivo

El piloto debe incluir factura normal, anulada/sustituta, nota de crédito,
impuesto distinto de 18 %, pago parcial/asignado, snapshot discrepante y un
archivo partial/bloqueado. Aceptar con `ACEPTAR PILOTO`, conciliar y simular
reversión antes de autorizar producción.

## Promoción controlada

1. Resolver/omitir todas las filas; cero issues `error`/`blocking`.
2. Obtener aprobación escrita de Operaciones y Contabilidad.
3. Activar temporalmente `INVOICE_PRODUCTION_IMPORT_ENABLED=true`.
4. Invocar promoción con:
   - confirmación `IMPORTAR PRODUCCION`;
   - ID del backup probado;
   - ID/descripción de la ventana.
5. El servicio recalcula conciliación antes de aceptar.
6. Desactivar inmediatamente la bandera de producción.
7. Ejecutar post-validación y exportar conciliación.
8. Muestrear por año, cliente, NCF, anulada, impuesto, pago y crédito.

## Criterios de detención

Detener el lote y no iniciar el siguiente ante:

- diferencia financiera superior a tolerancia;
- duplicado NCF/identidad;
- original R2 inaccesible;
- huérfano;
- pago sin evidencia;
- fila parcial presentada como lista;
- diferencia inesperada en `business_records`;
- ausencia de auditoría o búsqueda;
- error de D1/R2.

## Reversión

1. Deshabilitar producción y detener lotes siguientes.
2. Exportar conciliación y evidencia del incidente.
3. Confirmar `REVERTIR LOTE` e indicar motivo.
4. El endpoint bloquea si hay movimientos posteriores ajenos al lote.
5. La reversión:
   - archiva facturas/notas del lote;
   - anula pagos del lote;
   - revierte asignaciones/aplicaciones y snapshots;
   - retira búsqueda derivada;
   - conserva originales, extracciones, staging, issues, historial y auditoría.
6. Ejecutar post-validación de reversión.
7. Restaurar backup solo si el responsable de cambio determina que la
   reversión lógica no es suficiente.

## Evidencia de cierre

- CSV de conciliación antes/después.
- JSON de post-validación.
- ID de lote, hashes, backup, ventana, aprobadores y auditoría.
- Lista de issues residuales con responsable.
- Resultado de muestreo contable.
