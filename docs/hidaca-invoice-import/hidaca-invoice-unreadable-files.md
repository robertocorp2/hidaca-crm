# Archivos no legibles, parciales y de revisión manual

## Resumen

| Clasificación | Cantidad | Resultado |
|---|---:|---|
| No legible | 0 | Ningún archivo accesible falló completamente. |
| Parcial / OCR requerido | 1 | PDF sin capa de texto utilizable. |
| No soportado | 1 | Acceso directo de Windows; no se ejecutó. |
| Restringido / inventario solamente | 1 | Certificado `.p12`; no se abrió. |

La ecuación global del inventario permanece reconciliada. “Parcial” no se reportó como éxito completo.

## Parcial — requiere OCR

| Ruta | Motivo | Acción |
|---|---|---|
| `FACTURAS HIDACA/2021/JUNIO 2021/CEMEX F-0037.pdf` | La página 1 no contiene una capa de texto utilizable. | Aplicar OCR por página, conservar motor/versión/confianza y revisar contra factura/NCF. |

## No soportado

| Ruta | Motivo | Acción |
|---|---|---|
| `FACTURAS HIDACA/2022/JULIO 2022/ASTHIR ABINADER JIMENEZ F0086 - Acceso directo.lnk` | Acceso directo de Windows; puede ejecutar/navegar fuera del corpus. | No ejecutar ni desreferenciar. El PDF/XLSX de la factura existe por separado. |

## Restringido

| Ruta | Motivo | Acción |
|---|---|---|
| `FACTURAS HIDACA/FACTURADOR DGII/certificado firma digital.p12` | Contenedor sensible de certificado/clave. | Solo inventario/hash. Mantener fuera de Git y de los artefactos. No abrir ni importar al CRM. |

## Libros legibles con errores de fórmula

Estos archivos se abrieron y se inspeccionaron, pero las celdas indicadas no deben alimentar valores canónicos sin revisión:

| Ruta | Celda | Error |
|---|---|---|
| `FACTURAS HIDACA/2023/ENERO 2023/LABORATORIO CLINICO AMADITA P DE GONZALEZ S A S F0005.xlsx` | `FACTURA!J34` | `#DIV/0!` |
| `FACTURAS HIDACA/2023/FEBRERO 2023/SERVIMAR S A S  F0018.xlsx` | `FACTURA!J25` | `#DIV/0!` |
| `FACTURAS HIDACA/2023/FEBRERO 2023/SERVIMAR S A S  F0019.xlsx` | `FACTURA!J25` | `#DIV/0!` |
| `FACTURAS HIDACA/2023/FEBRERO 2023/SERVIMAR S A S  F0027.xlsx` | `FACTURA!J25` | `#DIV/0!` |
| `FACTURAS HIDACA/2023/MARZO 2023/SERVIMAR S A S  F0034.xlsx` | `FACTURA!J25` | `#DIV/0!` |
| `FACTURAS HIDACA/2023/MAYO 2023/SERVIMAR S A S  F0080.xlsx` | `FACTURA!J25` | `#DIV/0!` |
| `FACTURAS HIDACA/2023/OCTUBRE 2023/RHP AGREGADOS Y CONSTRUCCIONES DOMINICANAS SRL F0146.xlsx` | `FACTURA!K41` | `#REF!` |
| `FACTURAS HIDACA/2025/AGOSTO 2025/SERVIMAR S A S F0059.xlsx` | `FACTURA!J38` | `#REF!` |
| `FACTURAS HIDACA/2025/AGOSTO 2025/Starfish Resorts LTD F0060.xlsx` | `FACTURA!J40` | `#REF!` |
| `FACTURAS HIDACA/2025/SEPTIEMBRE 2025/Starfish Resorts LTD F0078.xlsx` | `FACTURA!J40` | `#REF!` |

## Pares emitido/editable con conflictos

Estos pares son legibles, pero requieren aplicar la regla de autoridad (PDF emitido primero) y mantener ambos valores:

1. `2022/NOVIEMBRE 2022/LABORATORIO CLINICO AMADITA P DE GONZALEZ S A S F0138` — proyecto.
2. `2022/SEPTIEMBRE 2022/UNIDAD ENDOSCOPICA DIAGNOSTICA Y TERAPEUTICA UNEDT SRL F0113` — fecha, vencimiento, factura y cotización.
3. `2023/JUNIO 2023/SERVIMAR S A S  F0085` — orden de compra.
4. `2023/NOVIEMBRE 2023/CONSORCIO INDUSTRIAL GARCIA SRL  F0156` — fecha, vencimiento, factura y cotización.
5. `2025/ABRIL 2025/ALPA IMPORT SRL NC0001` — RNC sobrecapturado en PDF/nota de crédito.
6. `2025/ABRIL 2025/SOLUARC EIRL F0032` — fecha y vencimiento.
7. `2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074` — cliente, RNC, contacto, dirección, fechas, factura y cotización.

El informe de calidad contiene los 21 campos exactos, los 50 archivos sin par PDF/XLSX, los nueve documentos cuyo filename contradice el número interno y las filas de matriz que requieren revisión.
