# Source mapping

The parser accepts PDF, XLSX, XLSM, and XLSB. Macros are detected but never
executed. Spreadsheet cells retain sheet, address, raw/display value, formula,
and formula error. PDFs retain page text and source line.

High-confidence labels map customer, contact, project, quote identity, and
date. Recognized table headers map installation dimensions, quantity, area,
unit/mÂ² price, and totals. Financial labels map subtotal, installation,
repair, maintenance, ITBIS, and total. Event labels such as _anticipo_,
_abono recibido_, and _pago final_ map payments; percentage-only payment terms
do not become received money. Terms remain in original Spanish.

`despiece`, production, BOM, and material sheets map to private manufacturing
records. Broken formulas remain source evidence and produce an explicit issue.
Unknown or low-confidence values remain visible in the review table.
