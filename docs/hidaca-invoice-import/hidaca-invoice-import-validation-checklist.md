# Lista de validación para importación de facturas HIDACA

## Uso

Esta lista debe completarse en cada implementación/piloto. Cada casilla requiere evidencia reproducible: comando/prueba, lote, archivo/fila/celda/página o captura. “No aplica” exige motivo.

## 1. Descubrimiento y manifiesto

- [ ] La enumeración inicial incluye todos los archivos y carpetas accesibles.
- [ ] La enumeración final completa se ejecutó contra el origen vivo.
- [ ] Cada archivo tiene ruta relativa, timestamp, tamaño, extensión, hash y estado de descarga.
- [ ] Cada delta está clasificado como `unchanged`, `added`, `changed`, `removed` o `inaccessible`.
- [ ] Todos los archivos agregados/cambiados se descargaron, hashearon y analizaron.
- [ ] La ecuación `total = parsed + partial + unreadable + unsupported + irrelevant` se cumple.
- [ ] No se ejecutaron `.lnk`, `.exe`, macros ni código embebido.
- [ ] Originales y archivos sensibles permanecen fuera de Git.

## 2. Extracción

- [ ] Cada hoja Excel, incluso oculta o vacía, está contabilizada.
- [ ] Se conservaron valor crudo, fórmula, resultado cacheado y formato.
- [ ] Merges, filtros, validaciones, comentarios, nombres y rangos usados están inventariados.
- [ ] Cada página PDF está contabilizada.
- [ ] Se intentó texto nativo antes de OCR.
- [ ] Páginas sin texto útil están marcadas `partial`/OCR requerido.
- [ ] Motor/versión/confianza de OCR se conserva cuando se usa.
- [ ] Muestras de cada formato trazan a archivo, hoja/página, fila/celda y valor.

## 3. Catálogo y mapeo

- [ ] Cada etiqueta/campo distinto aparece en el catálogo, aunque ocurra una sola vez.
- [ ] Cada campo tiene destino canónico o razón de exclusión.
- [ ] Los nombres públicos son españoles y los internos `snake_case` ingleses.
- [ ] Valores crudos y normalizados ocupan columnas separadas.
- [ ] Fechas de Excel son fechas tipadas, no texto accidental.
- [ ] Números monetarios son numéricos; RNC/NCF/teléfonos permanecen texto.
- [ ] Los workbooks tienen tablas filtrables y encabezados congelados.
- [ ] No hay fórmulas con `#REF!`, `#VALUE!`, `#DIV/0!`, `#NAME?` o `#N/A`.
- [ ] Los encabezados/columnas no están recortados en el render.

## 4. Identidad y duplicados

- [ ] SHA-256 idéntico se clasifica como duplicado binario.
- [ ] PDF/XLSX del mismo documento se vinculan como representaciones, no duplicados binarios.
- [ ] La identidad considera negocio, número, año/fecha, NCF, versión y anulación/sustitución.
- [ ] El número del nombre de archivo no prevalece sobre el contenido emitido.
- [ ] Anulada/sustituta con NCF distinto no se colapsa.
- [ ] Coincidencias por nombre/dirección/monto siempre requieren revisión.
- [ ] Solo identificadores exactos únicos permiten autoenlace.

## 5. Datos fiscales y financieros

- [ ] Subtotal, base gravada/exenta, impuesto y total se conservan por separado.
- [ ] La tasa fiscal se toma de evidencia/configuración; no se asume 18 %.
- [ ] Cada discrepancia tiene regla, tolerancia y ubicación reproducible.
- [ ] Saldos negativos pequeños se reportan, no se corrigen silenciosamente.
- [ ] `Avance`/`Pendiente` se importan como snapshot, no como transacción.
- [ ] Pagos se crean solo con evidencia transaccional identificable.
- [ ] Suma de asignaciones no excede el pago sin issue.
- [ ] Suma de pagos/créditos/saldo reconcilia con la factura o queda issue abierto.
- [ ] Notas de crédito se emiten y aplican como eventos separados.

## 6. Matching

- [ ] RNC/Cédula se valida y normaliza antes de buscar.
- [ ] NCF/e-NCF exacto único se valida antes de autoenlace.
- [ ] Correo/teléfono solo autoenlaza cuando la política aprobada y la unicidad lo permiten.
- [ ] Todas las demás señales producen candidatos con razones visibles.
- [ ] Conflictos documento emitido vs matriz conservan ambos valores y autoridad.
- [ ] Entidades huérfanas/candidatos múltiples están en review queue.

## 7. Dry-run e idempotencia

- [ ] Dos dry-runs iguales producen mismas huellas, decisiones e issues.
- [ ] Cambiar el orden de archivos no cambia identidades.
- [ ] El dry-run no crea estado canónico.
- [ ] Cada decisión muestra regla y evidencia.
- [ ] Reintentar aceptación devuelve el resultado existente y no duplica.
- [ ] Restricciones únicas protegen contra aceptación concurrente.

## 8. Aceptación

- [ ] D1 realiza la aceptación canónica de forma atómica.
- [ ] Un fallo no deja facturas/líneas/asignaciones parciales.
- [ ] R2 conserva original y extracción.
- [ ] `import_batch_id`/linaje identifica registros creados y enlazados.
- [ ] `entity_history` y `audit_log` registran aceptación/correcciones.
- [ ] Los contadores de lote concuerdan con filas/entidades.

## 9. Reversión

- [ ] Solo `admin` puede revertir.
- [ ] Preview de reversión lista exactamente lo afectado.
- [ ] Se revierten solo registros/vínculos creados por el lote.
- [ ] Datos preexistentes y cambios posteriores no se eliminan.
- [ ] Dependencias posteriores bloquean la reversión con explicación.
- [ ] Originales, staging y auditoría permanecen.
- [ ] La reconciliación posterior demuestra el resultado.

## 10. UI y permisos

- [ ] Facturas lista/detalle muestran NCF, total, saldo, estado, fuente y autoridad.
- [ ] Pagos muestran evidencia y asignaciones.
- [ ] Notas de crédito muestran aplicaciones/saldo disponible.
- [ ] Cuentas por cobrar muestran envejecimiento y discrepancias.
- [ ] Cobranza muestra próxima acción/responsable.
- [ ] `viewer` no puede mutar.
- [ ] `operator` no puede revertir lotes ni cambiar configuración fiscal.
- [ ] `admin` tiene acciones críticas con confirmación y auditoría.
- [ ] Registros heredados están etiquetados y no se doble cuentan.

## 11. Regresión

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Pruebas unitarias cubren normalización/identidad/autoridad.
- [ ] Pruebas de integración cubren dry-run, aceptación repetida y rollback.
- [ ] Pruebas de seguridad cubren tamaño, MIME, macros, paths y archivos sensibles.

## 12. Aprobación de piloto

- [ ] Piloto pequeño incluye factura normal, anulada/sustituta, tratamiento fiscal no estándar, crédito y saldo discrepante.
- [ ] Reconciliación del piloto fue revisada por negocio/contabilidad.
- [ ] Issues bloqueantes están resueltos.
- [ ] Se documentó rollback.
- [ ] Existe autorización explícita antes de importar producción.

## 13. Controles implementados (verificación técnica)

- [ ] `GET /api/imports/{batchId}/reconciliation` retorna `balanced=true`.
- [ ] El CSV de conciliación fue archivado con la evidencia del lote.
- [ ] `GET /api/imports/{batchId}/post-validation` retorna `passed=true`.
- [ ] `inaccessibleObjects=0`, `missingSearch=0` y `missingHistory=0`.
- [ ] La reversión fue ensayada en un lote no productivo.
- [ ] Las dos banderas vuelven a `false` después de la ventana.
- [ ] Se siguió `hidaca-invoice-production-runbook.md`.
