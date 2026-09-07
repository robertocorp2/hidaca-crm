# Informe de calidad de datos de facturación HIDACA

## Resultado ejecutivo

- Corpus final estable: **1,333 de 1,333 archivos** sin cambio por SHA-256; 0 agregados, cambiados, eliminados o inaccesibles.
- Extracción: **1,330 parseados**, **1 parcial**, **0 no legibles**, 1 no soportado y 1 restringido.
- Documentos por representación: **637 pares PDF/XLSX** y **50 archivos sin representación gemela** (33 PDF; 17 XLSX).
- Conflictos reales PDF/XLSX: **21 campos en 7 pares**.
- Errores de fórmula cacheados: **10 celdas en 10 libros**.
- Coincidencias nombre de archivo vs contenido: **15 archivos / 9 documentos base** no concuerdan.
- Los riesgos P0 son identidad de factura, anulaciones/reemisiones, pagos agregados sin evidencia transaccional y tratamiento fiscal no estándar.

## Reglas reproducibles

| Control | Regla | Resultado |
|---|---|---:|
| Duplicado binario | SHA-256 idéntico | 0 |
| Mismo nombre, contenido distinto | Nombre case-insensitive repetido y hashes distintos | 43 grupos / 88 archivos |
| Conflicto PDF/XLSX | Conjuntos normalizados del mismo campo son disjuntos en el mismo stem | 21 |
| Nombre vs factura interna | Número F/NC del filename ≠ primer número del contenido | 15 archivos |
| Fórmula con error | Resultado cacheado comienza `#` | 10 |
| ITBIS no 18 % | `abs(itbis - subtotal × 0.18) > 0.011` | 20 filas |
| Total no reconcilia | `abs(subtotal + itbis - total) > 0.011` con tres valores numéricos | 0 filas |
| Saldo negativo | `Pendiente < 0` | 2 filas |
| Placeholder | Fecha vacía y factura/NCF presente | 6 filas |
| Estado contradictorio | `Fecha Cierre = Anulada` y `Estatus = PAGADO` | 3 filas |

## Matriz principal

La matriz contiene **673 filas con cliente, factura o NCF**, de las cuales **671 tienen número de factura**. El rango de fechas válidas es 08/01/2021–29/07/2026.

Valores faltantes entre las filas inventariadas:

| Campo | Vacíos |
|---|---:|
| No. | 0 |
| Fecha | 6 |
| Mes | 6 |
| Año | 0 |
| Cliente | 6 |
| Factura | 2 |
| NCF | 0 |
| Tipo | 658 |
| Sub-Total | 6 |
| Itbis | 8 |
| Total | 6 |
| Fecha Cierre | 670 |
| Avance | 0 |
| Pendiente | 0 |
| Estatus | 0 |

### Anulaciones, reemisiones y crédito

| Fila Excel | Factura | Cliente | NCF | Fecha Cierre | Estatus | Observación |
|---:|---|---|---|---|---|---|
| 237 | F-0002 | LABORATORIO CLINICO AMADITA P DE GONZALEZ S A S | B0100000471 | Anulada | PAGADO | Candidata a anulada/sustituta; existe otra F-0002 con NCF distinto. |
| 518 | F-0115 | ROALCO SRL | B0100000748 | Anulada | PAGADO | No debe importarse como pagada sin resolver la anulación. |
| 549 | NC-0001 |  ALPA IMPORT SRL | B0400000001 | Anulada | PAGADO | No debe importarse como pagada sin resolver la anulación. |

La nota de crédito `NC-0001` (fila 549, NCF `B0400000001`) tiene subtotal e ITBIS pero total vacío. Debe modelarse como nota de crédito y aplicación, no como factura ordinaria.

### Placeholders incompletos

| Fila Excel | Factura | NCF | Año cacheado | Subtotal | ITBIS | Total |
|---:|---|---|---:|---:|---:|---:|
| 669 | F-0048 | E310000000019 | 1900 | 0.00 | 0.00 | 0.00 |
| 670 | F-0049 | E310000000020 | 1900 | 0.00 | 0.00 | 0.00 |
| 671 | F-0050 | E310000000021 | 1900 |  |  | 0.00 |
| 672 | F-0051 | E310000000022 | 1900 |  |  |  |
| 673 | None | E310000000023 | 1900 |  |  |  |
| 674 | None | E310000000024 | 1900 |  |  |  |

Los seis placeholders producen año `1900` desde fórmulas sobre fechas vacías. Son bloqueantes para aceptación automática.

### Saldos negativos

| Fila Excel | Factura | Cliente | NCF | Total | Avance | Pendiente |
|---:|---|---|---|---:|---:|---:|
| 632 | F-0011 | INMOBILIARIA LEE S R L | B0100000854 | 109,409.60 | 109,410.00 | -0.40 |
| 633 | F-0012 | INMOBILIARIA LEE S R L | B0100000855 | 374,296.00 | 374,300.00 | -4.00 |

### Tratamientos fiscales que no equivalen a 18 % del subtotal

Estas filas no son errores automáticos: incluyen exenciones, base gravada parcial u otro tratamiento. El importador debe conservar la evidencia y explicar el cálculo.

| Fila Excel | Factura | Cliente | Subtotal | ITBIS | Total |
|---:|---|---|---:|---:|---:|
| 39 | F-0038 |  DIVALDI VILLAGE LTD | 539,282.50 | 8,579.17 | 547,861.67 |
| 71 | F-0070 | DUBENSKY CORPORATION | 78,586.59 | 1,414.56 | 80,001.15 |
| 117 | F-0044 | EMBAJADA DE LOS ESTADOS UNIDOS DE AMERICA | 60,820.00 | 0.00 | 60,820.00 |
| 118 | F-0045 | EMBAJADA DE LOS ESTADOS UNIDOS DE AMERICA | 95,461.22 | 0.00 | 95,461.22 |
| 227 | F-0154 | COMGA INGENIERIA SRL | 347,930.00 | 5,693.40 | 353,623.40 |
| 305 | F-0069 | TPD TROPICAL PRODUCE DOMINICANA SRL | 137,500.00 | 2,475.00 | 139,975.00 |
| 393 | F-0157 | INMOBILIARIA LOCUS S A | 430,186.15 | 7,743.35 | 437,929.50 |
| 404 | F-0168 | PAV EVENTS SRL | 173,000.00 | 3,114.00 | 176,114.00 |
| 405 | F-0169 | PAV EVENTS SRL | 433,279.90 | 7,799.04 | 441,078.94 |
| 426 | F-0022 | PAV EVENTS SRL | 461,744.24 | 8,311.40 | 470,055.64 |
| 444 | F-0040 |  DOMINICAN THINGS DC SRL | 41,975.19 | 0.00 | 41,975.19 |
| 485 | F-0082 | NUMEL SRL | 481,335.00 | 8,664.03 | 489,999.03 |
| 517 | F-0114 | ROALCO SRL | 504,375.00 | 9,078.75 | 513,453.75 |
| 541 | F-0023 |  ALPA IMPORT SRL | 943,427.22 | 16,981.69 | 960,408.91 |
| 549 | NC-0001 |  ALPA IMPORT SRL | 943,427.22 | 16,981.69 |  |
| 550 | F-0031 |  ALPA IMPORT SRL | 943,427.22 | 16,981.69 | 960,408.91 |
| 565 | F-0046 | DOMINICAN THINGS DC SRL | 921,463.55 | 0.00 | 921,463.55 |
| 600 | F-0080 | CILPEN GLOBAL BUSINESS SRL | 127,510.00 | 0.00 | 127,510.00 |
| 602 | F-0082 | INSTITUTO INTERNACIONAL DE LA VISION INVIS SRL  | 4,224,259.10 | 76,036.66 | 4,300,295.76 |
| 627 | F-0006 | CILPEN GLOBAL BUSINESS SRL | 47,277.00 | 0.00 | 47,277.00 |

Entre las filas con subtotal, ITBIS y total numéricos hubo **0** discrepancias de `subtotal + ITBIS = total`. La nota de crédito con total vacío queda fuera de esa prueba y requiere revisión.

## Conflictos entre PDF y XLSX del mismo documento

| Archivo PDF | Campo | PDF | XLSX |
|---|---|---|---|
| FACTURAS HIDACA/2022/NOVIEMBRE 2022/LABORATORIO CLINICO AMADITA P DE GONZALEZ S A S F0138.pdf | `project_name` | ['Reparacion/ Mantenimiento'] | ['Reparacion/ Mantenimiento/ SUC. LOS PRADOS PARQUEO'] |
| FACTURAS HIDACA/2022/SEPTIEMBRE 2022/UNIDAD ENDOSCOPICA DIAGNOSTICA Y TERAPEUTICA UNEDT SRL F0113.pdf | `due_date` | ['08/09/2022'] | ['08/09/2023'] |
| FACTURAS HIDACA/2022/SEPTIEMBRE 2022/UNIDAD ENDOSCOPICA DIAGNOSTICA Y TERAPEUTICA UNEDT SRL F0113.pdf | `invoice_number` | ['F0113'] | ['F0122'] |
| FACTURAS HIDACA/2022/SEPTIEMBRE 2022/UNIDAD ENDOSCOPICA DIAGNOSTICA Y TERAPEUTICA UNEDT SRL F0113.pdf | `issue_date` | ['08/09/2022'] | ['08/09/2023'] |
| FACTURAS HIDACA/2022/SEPTIEMBRE 2022/UNIDAD ENDOSCOPICA DIAGNOSTICA Y TERAPEUTICA UNEDT SRL F0113.pdf | `quotation_number` | ['C230-2022'] | ['M165-2023'] |
| FACTURAS HIDACA/2023/JUNIO 2023/SERVIMAR S A S  F0085.pdf | `purchase_order` | ['000624'] | ['000747'] |
| FACTURAS HIDACA/2023/NOVIEMBRE 2023/CONSORCIO INDUSTRIAL GARCIA SRL  F0156.pdf | `due_date` | ['27/11/2023'] | ['26/12/2023'] |
| FACTURAS HIDACA/2023/NOVIEMBRE 2023/CONSORCIO INDUSTRIAL GARCIA SRL  F0156.pdf | `invoice_number` | ['F0156'] | ['F0167'] |
| FACTURAS HIDACA/2023/NOVIEMBRE 2023/CONSORCIO INDUSTRIAL GARCIA SRL  F0156.pdf | `issue_date` | ['27/11/2023'] | ['26/12/2023'] |
| FACTURAS HIDACA/2023/NOVIEMBRE 2023/CONSORCIO INDUSTRIAL GARCIA SRL  F0156.pdf | `quotation_number` | ['C019-2023 Y C160-2023'] | ['M225-2023'] |
| FACTURAS HIDACA/2025/ABRIL 2025/ALPA IMPORT SRL NC0001.pdf | `customer_tax_id` | ['101-59900-6 Nota de Credito No.: NC0001'] | ['101-59900-6'] |
| FACTURAS HIDACA/2025/ABRIL 2025/SOLUARC EIRL F0032.pdf | `due_date` | ['29/04/2025'] | ['22/05/2025'] |
| FACTURAS HIDACA/2025/ABRIL 2025/SOLUARC EIRL F0032.pdf | `issue_date` | ['29/04/2025'] | ['22/05/2025'] |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.pdf | `contact_name` | ['Jose Garcia'] | ['Laura Berrido'] |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.pdf | `customer_address` | ['Autopista Duarte Km. 16'] | ['C/ Porfirio Herrera No. 10 Torre Michelle Natalie PH'] |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.pdf | `customer_name` | ['CASA CHEPE SRL'] | ['J GARCIA MARTINEZ Y ASOCS SRL'] |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.pdf | `customer_tax_id` | ['101520213'] | ['101735368'] |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.pdf | `due_date` | ['17/09/2025'] | ['28/10/2025'] |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.pdf | `invoice_number` | ['F0074'] | ['F0089'] |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.pdf | `issue_date` | ['17/09/2025'] | ['28/10/2025'] |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.pdf | `quotation_number` | ['C181-2025'] | ['C177-2025'] |

Regla de autoridad: el PDF emitido controla el dato propio; el XLSX se conserva como evidencia editable y todo conflicto permanece visible.

## Errores de fórmula

| Archivo | Hoja/celda | Fórmula | Resultado cacheado |
|---|---|---|---|
| FACTURAS HIDACA/2023/ENERO 2023/LABORATORIO CLINICO AMADITA P DE GONZALEZ S A S F0005.xlsx | FACTURA!J34 | `=+I34/I33` | `#DIV/0!` |
| FACTURAS HIDACA/2023/FEBRERO 2023/SERVIMAR S A S  F0018.xlsx | FACTURA!J25 | `=+I25/H25` | `#DIV/0!` |
| FACTURAS HIDACA/2023/FEBRERO 2023/SERVIMAR S A S  F0019.xlsx | FACTURA!J25 | `=+I25/H25` | `#DIV/0!` |
| FACTURAS HIDACA/2023/FEBRERO 2023/SERVIMAR S A S  F0027.xlsx | FACTURA!J25 | `=+I25/H25` | `#DIV/0!` |
| FACTURAS HIDACA/2023/MARZO 2023/SERVIMAR S A S  F0034.xlsx | FACTURA!J25 | `=+I25/H25` | `#DIV/0!` |
| FACTURAS HIDACA/2023/MAYO 2023/SERVIMAR S A S  F0080.xlsx | FACTURA!J25 | `=+I25/H25` | `#DIV/0!` |
| FACTURAS HIDACA/2023/OCTUBRE 2023/RHP AGREGADOS Y CONSTRUCCIONES DOMINICANAS SRL F0146.xlsx | FACTURA!K41 | `=+K40+#REF!+#REF!+K39` | `#REF!` |
| FACTURAS HIDACA/2025/AGOSTO 2025/SERVIMAR S A S F0059.xlsx | FACTURA!J38 | `=11931.06/#REF!` | `#REF!` |
| FACTURAS HIDACA/2025/AGOSTO 2025/Starfish Resorts LTD F0060.xlsx | FACTURA!J40 | `=11931.06/#REF!` | `#REF!` |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/Starfish Resorts LTD F0078.xlsx | FACTURA!J40 | `=11931.06/#REF!` | `#REF!` |

Estos errores no impiden leer el resto del libro, pero el archivo queda en revisión y el importador no debe usar la celda errónea como valor canónico.

## Número en nombre de archivo distinto del contenido

| Archivo | Número en nombre | Número en contenido |
|---|---:|---:|
| FACTURAS HIDACA/2022/DICIEMBRE 2022/ESTACION DE SERVICIO BELLAMAR SRL F0019.pdf | 19 | 159 |
| FACTURAS HIDACA/2022/DICIEMBRE 2022/ESTACION DE SERVICIO BELLAMAR SRL F0019.xlsx | 19 | 159 |
| FACTURAS HIDACA/2022/SEPTIEMBRE 2022/UNIDAD ENDOSCOPICA DIAGNOSTICA Y TERAPEUTICA UNEDT SRL F0113.xlsx | 113 | 122 |
| FACTURAS HIDACA/2023/ENERO 2023/LABORATORIO CLINICO AMADITA P DE GONZALEZ S A S F0004.pdf | 4 | 6 |
| FACTURAS HIDACA/2023/ENERO 2023/LABORATORIO CLINICO AMADITA P DE GONZALEZ S A S F0004.xlsx | 4 | 6 |
| FACTURAS HIDACA/2023/NOVIEMBRE 2023/CONSORCIO INDUSTRIAL GARCIA SRL  F0156.xlsx | 156 | 167 |
| FACTURAS HIDACA/2023/OCTUBRE 2023/GSU HIGIENE & EVENTOS SRL  F0137.pdf | 137 | 136 |
| FACTURAS HIDACA/2023/OCTUBRE 2023/GSU HIGIENE & EVENTOS SRL  F0137.xlsx | 137 | 136 |
| FACTURAS HIDACA/2025/ENERO 2025/HERAN SRL F0006.pdf | 6 | 7 |
| FACTURAS HIDACA/2025/ENERO 2025/HERAN SRL F0006.xlsx | 6 | 7 |
| FACTURAS HIDACA/2025/OCTUBRE 2025/INSTITUTO INTERNACIONAL DE LA VISION INVIS SRL F0082.pdf | 82 | 85 |
| FACTURAS HIDACA/2025/OCTUBRE 2025/INSTITUTO INTERNACIONAL DE LA VISION INVIS SRL F0082.xlsx | 82 | 85 |
| FACTURAS HIDACA/2025/SEPTIEMBRE 2025/CASA CHEPE SRL F0074.xlsx | 74 | 89 |
| FACTURAS HIDACA/2026/ABRIL 2026/AMBITO SRL F0024.pdf | 24 | 45 |
| FACTURAS HIDACA/2026/ABRIL 2026/AMBITO SRL F0024.xlsx | 24 | 45 |

El contenido emitido prevalece. La discrepancia genera issue y prohíbe deduplicación por filename.

## Identificadores y contacto

- **2** PDFs producen un RNC/Cédula sobrecapturado por maquetación de texto; requieren extracción por región/celda: `FACTURAS HIDACA/2024/JUNIO 2024/CEMEX F0051.pdf` → `111000599 Direcclón: Carretcra Mella KM, 10 1/2, San Pedro de Macorls`; `FACTURAS HIDACA/2025/ABRIL 2025/ALPA IMPORT SRL NC0001.pdf` → `101-59900-6 Nota de Credito No.: NC0001`.
- **5** RNC normalizados aparecen asociados a más de una forma de nombre. No equivale automáticamente a clientes duplicados; el grupo `131464051` evidencia contaminación del RNC del emisor en algunos documentos.
- **2** PDFs contienen correos con espacios que no pasan una validación estricta.
- Los teléfonos se conservan como texto. Ningún valor etiquetado quedó con menos de diez dígitos agregados, pero extensiones/múltiples números requieren parsing conservador.

| Archivo con correo inválido | Valor |
|---|---|
| FACTURAS HIDACA/2024/JULIO 2024/CEMEX F0060.pdf | ['amanda.reyessuazo @cemex.com'] |
| FACTURAS HIDACA/2025/NOVIEMBRE 2025/Cemex dominicana F0095.pdf | ['shutterhidaca @gmail.com', 'henrymanuel.bautista @ cemex.com'] |

## Archivos sin par PDF/XLSX

Un archivo sin par no es inválido: puede ser la única representación emitida o editable. Debe conservarse y clasificarse.

| Ruta |
|---|
| FACTURAS HIDACA/2021/DICIEMBRE 2021/cemex  F0092.pdf |
| FACTURAS HIDACA/2021/DICIEMBRE 2021/CEMEX DOMINICANA  F0092.xlsx |
| FACTURAS HIDACA/2021/JUNIO 2021/CEMEX F-0037.pdf |
| FACTURAS HIDACA/2021/NOVIEMBRE 2021/ITBIS NOV.xlsx |
| FACTURAS HIDACA/2021/SEPTIEMBRE 2021/ALMACENES ZAGLUL F0090.xlsx |
| FACTURAS HIDACA/2022/FEBRERO 2022/CEMEX F-0009.pdf |
| FACTURAS HIDACA/2022/JULIO 2022/CEMEX DOMINICANA  F0085.xlsx |
| FACTURAS HIDACA/2022/JULIO 2022/CEMEX DOMINICANA F0085.pdf |
| FACTURAS HIDACA/2022/MARZO 2022/ESTACION DE SERVICIO BELLAMAR SRL F0019.pdf |
| FACTURAS HIDACA/2022/SEPTIEMBRE 2022/DF CENTRO DIGITAL PRE PRENSA SRL.xlsx |
| FACTURAS HIDACA/2023/ENERO 2023/LABORATORIO CLINICO AMADITA P DE GONZALEZ S A S F0002-1.xlsx |
| FACTURAS HIDACA/2023/JULIO 2023/MINISTERIO DE EDUCACION F0100.pdf |
| FACTURAS HIDACA/2023/MAYO 2023/CEMEX DOMINICANA  F0077.xlsx |
| FACTURAS HIDACA/2023/MAYO 2023/CEMEX DOMINICANA SA  F0077.pdf |
| FACTURAS HIDACA/2023/SEPTIEMBRE 2023/CEMEX DOMINICANA  F0129.xlsx |
| FACTURAS HIDACA/2023/SEPTIEMBRE 2023/CEMEX DOMINICANA  F0130.xlsx |
| FACTURAS HIDACA/2023/SEPTIEMBRE 2023/CEMEX DOMINICANA F0129.pdf |
| FACTURAS HIDACA/2023/SEPTIEMBRE 2023/CEMEX DOMINICANA F0130.pdf |
| FACTURAS HIDACA/2024/AGOSTO 2024/CEMEX DOMINICANA  F0069.xlsx |
| FACTURAS HIDACA/2024/AGOSTO 2024/CEMEX F0069.pdf |
| FACTURAS HIDACA/2024/DICIEMBRE 2024/ALPA IMPORT C281-2024.pdf |
| FACTURAS HIDACA/2024/JULIO 2024/CEMEX DOMINICANA  F0060.xlsx |
| FACTURAS HIDACA/2024/JULIO 2024/CEMEX F0060.pdf |
| FACTURAS HIDACA/2024/JUNIO 2024/CEMEX DOMINICANA  F0051.xlsx |
| FACTURAS HIDACA/2024/JUNIO 2024/CEMEX F0051.pdf |
| FACTURAS HIDACA/2024/MAYO 2024/CEMEX DOMINICANA  F0027.xlsx |
| FACTURAS HIDACA/2024/MAYO 2024/CESAR JOSE ORLANDO HERRERA PADILLA F0071.xlsx |
| FACTURAS HIDACA/2024/MAYO 2024/DT MARKETS REP. DOM.xlsx |
| FACTURAS HIDACA/2024/MAYO 2024/UNIFOT SRL F0033.pdf |
| FACTURAS HIDACA/2025/MARZO 2025/QUONDAM DOMINICANA SRL.xlsx |
| FACTURAS HIDACA/2025/NOVIEMBRE 2025/CEMEX DOMINICANA  F0095.xlsx |
| FACTURAS HIDACA/2025/NOVIEMBRE 2025/Cemex dominicana F0095.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/CESAR JOSE ORLANDO HERRERA PADILLA F0043.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/CILPEN GLOBAL BUSINESS SRL F0047.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/CLAUDIA CAROLINA MORENO QUIÑONES F0042.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/LOUGHTON SRL F0039.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0038.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0040.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0041.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0044.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0045.pdf |
| FACTURAS HIDACA/2026/JULIO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0046.pdf |
| FACTURAS HIDACA/2026/JUNIO 2026/CONSTRUCTORA FERN EIRL F0035.pdf |
| FACTURAS HIDACA/2026/JUNIO 2026/GLOBAL DISTRICT MC SRL F0037.pdf |
| FACTURAS HIDACA/2026/JUNIO 2026/LOUGHTON SRL F0036.pdf |
| FACTURAS HIDACA/2026/JUNIO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0033.pdf |
| FACTURAS HIDACA/2026/JUNIO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0034.pdf |
| FACTURAS HIDACA/2026/MAYO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0030.pdf |
| FACTURAS HIDACA/2026/MAYO 2026/PLAYA HEMINGWAY HOTELS & RESORTS SAS F0031.pdf |
| FACTURAS HIDACA/2026/MAYO 2026/TC REALTORS SRL F0032.pdf |

## Pagos, cuentas por cobrar y huérfanos

- El corpus no contiene un libro mayor de transacciones de pago con referencia bancaria/recibo suficientemente estructurada.
- `Avance` y `Pendiente` son agregados; no permiten crear ni asignar pagos.
- Por tanto, pagos mayores al saldo, pagos huérfanos, montos sin aplicar y multi-moneda no pueden cuantificarse responsablemente en esta fase.
- La moneda observada en facturas legibles es DOP/RD$; no se descubrió evidencia suficiente para importar pagos en otra moneda.
- Las 50 representaciones sin par y el PDF que requiere OCR no son documentos huérfanos canónicos hasta intentar matching por NCF/número/cliente/fecha.

## Riesgos priorizados

| Prioridad | Riesgo | Tratamiento |
|---|---|---|
| P0 | Anulada/sustituta y crédito colapsados como duplicado | Identidad con NCF, versión y relaciones de cancelación/aplicación. |
| P0 | Avance convertido en pago ficticio | Snapshot de cuenta por cobrar; pago solo con evidencia. |
| P0 | Suposición fija de 18 % | Configuración/tratamiento fiscal con evidencia. |
| P0 | XLSX editable contradice PDF emitido | Autoridad del emitido + issue visible. |
| P1 | Filename no coincide con factura | Extraer del contenido; filename es señal débil. |
| P1 | Fórmulas `#REF!`/`#DIV/0!` | Estado partial/review y no usar la celda errónea. |
| P1 | RNC del emisor confundido con cliente | Extracción posicional y validación por fuente. |
| P1 | PDF sin texto | OCR y revisión de confianza. |

## Decisiones no resolubles sin intervención

1. Confirmar las relaciones de sustitución para las tres filas marcadas `Anulada`.
2. Confirmar cómo se aplicó `NC-0001` y su importe total efectivo.
3. Resolver los seis pares PDF/XLSX con conflictos.
4. Decidir si los seis placeholders e-NCF se completarán, excluirán o permanecerán en staging.
5. Obtener evidencia transaccional antes de crear pagos/asignaciones.
6. Aprobar configuraciones fiscales para exentos/base parcial/otros tratamientos.
