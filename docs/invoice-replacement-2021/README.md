# Reemplazo de Facturas 2021

## Entregables

- Código del flujo administrativo en **Importaciones**.
- Endpoints `POST /api/imports/invoices/replace/preview` y `POST /api/imports/invoices/replace/commit`.
- Libro separado `HIDACA_Facturas_2021_Importacion.xlsx` con las hojas `Facturas`, `Fuentes`, `Conflictos` y `Reconciliacion`.

El libro validado contiene 92 facturas (F-0001–F-0092), 92 NCF únicos, 20 filas cuya autoridad es el registro 2021 y 72 cuya autoridad es el documento emitido. F-0090 aparece una sola vez; la copia de septiembre queda identificada como representación duplicada y la de diciembre como principal. F-0093–F-0107 no se importan.

## Despliegue de código

1. Ejecutar `npm install` en la raíz del app.
2. Ejecutar `npm run lint`, `npm run typecheck`, `npm run test` y `npm run build`.
3. Ejecutar `npm run sites:package` y desplegar el ZIP resultante mediante el flujo habitual de Sites/Cloudflare.
4. Confirmar que `INVOICE_IMPORT_PHASE1_ENABLED=true` esté configurado en el entorno de producción.
5. No ejecutar la previsualización ni el commit como parte del despliegue automático.

## Operación administrativa manual

1. Iniciar sesión con un usuario administrador.
2. Abrir **Importaciones** y localizar **Reemplazar Facturas desde el libro consolidado**.
3. Seleccionar `HIDACA_Facturas_2021_Importacion.xlsx` y pulsar **Previsualizar reemplazo**.
4. Confirmar antes de continuar:
   - 92 facturas y 92 identidades fiscales.
   - 56 facturas vinculadas a empresas existentes y 36 empresas nuevas bajo el estado verificado de la base. Si la base cambió, revisar el nuevo detalle en vez de asumir estos números.
   - Un registro heredado de Facturas, dos lotes y seis archivos anteriores a eliminar.
   - Cero facturas normalizadas, partidas, pagos, asignaciones, notas de crédito, aplicaciones, snapshots o actividades nuevas.
   - Los conteos de Cotizaciones preservadas.
5. Escribir exactamente `REEMPLAZAR FACTURAS 2021` y confirmar.

El commit vuelve a analizar el mismo archivo, verifica su SHA-256, recalcula el preflight y compara la huella del estado en vivo. Si apareció cualquier factura, pago, crédito o dependencia, o si cambió el archivo, aborta sin modificar la base. Todas las eliminaciones e inserciones en D1 se envían como una sola transacción. El libro consolidado se conserva como documento fuente; no se crean partidas, pagos ni asignaciones.

## Validación posterior

- 92 facturas activas y 92 NCF únicos.
- Cero filas en `invoice_lines`.
- Cero registros activos o archivados del módulo heredado `facturas`.
- Cero lotes o archivos de los intentos anteriores y cero objetos R2 asociados.
- Un lote completado con `source = 'invoice_replace'` y el libro consolidado como evidencia.
- Cotizaciones, sus lotes y los demás módulos con los mismos conteos del preflight.
- Un segundo commit con el mismo archivo responde de forma idempotente y no duplica registros.

## Riesgo y reversión

La purga no crea respaldo recuperable y es irreversible. Revertir el despliegue restaura únicamente el código anterior; no restaura staging, documentos, objetos R2 ni historial eliminado. Si la reconciliación posterior reporta una diferencia, no repetir el commit: conservar el identificador del lote administrativo y revisar el estado antes de cualquier intervención.

## Evidencia del libro

El SHA-256 debe coincidir con el valor mostrado por la previsualización administrativa. El hash se obtiene del archivo final entregado; cualquier cambio al libro obliga a ejecutar una previsualización nueva.
