import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const BRAND = {
  dark: "#103D2E",
  green: "#1F6B4F",
  mint: "#DDEEE7",
  cream: "#F6F4EF",
  gold: "#C49A47",
  text: "#183028",
  muted: "#5D6D66",
  border: "#CBD8D2",
  warning: "#FFF0CC",
  danger: "#FDE2E1",
};

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function asText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(" | ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function statusCounts(manifest) {
  const counts = {};
  for (const item of manifest) {
    counts[item.parse_status] = (counts[item.parse_status] ?? 0) + 1;
  }
  return counts;
}

function mappingFor(sourceKey) {
  const key = sourceKey.replace(/^parsed::/, "").toLowerCase();
  const parsed = sourceKey.startsWith("parsed::");
  const base = {
    inferredMeaning: "Evidencia cruda no estructurada",
    normalizedField: "raw_value",
    webLabel: "Valor original",
    module: "Importaciones",
    table: "source_field_values",
    column: "raw_value",
    dataType: "text",
    maxLength: 4000,
    required: "Opcional",
    uniqueness: "No único",
    defaultValue: "",
    allowedValues: "",
    transformation: "Conservar exactamente; normalizar solo en columna separada.",
    validation: "Debe conservar ruta y ubicación de fuente.",
    relationship: "import_file_id / import_row_id",
    confidence: parsed ? "Alta" : "Baja",
    notes: "Histórico/auditoría; revisar antes de promover a campo canónico.",
    humanReview: parsed ? "No" : "Sí",
    disposition: "Destino: evidencia cruda",
  };

  const apply = (patch) => Object.assign(base, patch);

  if (key.includes("ncf") && !key.includes("tipo")) {
    return apply({
      inferredMeaning: "Número de comprobante fiscal",
      normalizedField: "ncf_raw",
      webLabel: "NCF",
      module: "Facturas",
      table: "invoices",
      column: "ncf_raw",
      dataType: "text",
      maxLength: 30,
      uniqueness: "Único parcial cuando válido",
      transformation: "Conservar crudo y crear ncf_normalized.",
      validation: "Formato NCF/e-NCF válido y unicidad.",
      relationship: "",
      confidence: parsed ? "Alta" : "Media",
      humanReview: parsed ? "No" : "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("vencimiento") || key === "due_date") {
    return apply({
      inferredMeaning: "Fecha de vencimiento",
      normalizedField: "due_date",
      webLabel: "Vencimiento",
      module: "Facturas",
      table: "invoices",
      column: "due_date",
      dataType: "date",
      maxLength: null,
      transformation: "DD/MM/YYYY → ISO YYYY-MM-DD; conservar due_date_raw.",
      validation: "Fecha válida; normalmente no anterior a emisión.",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado",
    });
  }
  if ((key.includes("fecha") && !key.includes("cierre")) || key === "issue_date") {
    return apply({
      inferredMeaning: "Fecha de emisión",
      normalizedField: "issue_date",
      webLabel: "Fecha de factura",
      module: "Facturas",
      table: "invoices",
      column: "issue_date",
      dataType: "date",
      maxLength: null,
      transformation: "DD/MM/YYYY → ISO YYYY-MM-DD; conservar issue_date_raw.",
      validation: "Fecha válida; no derivar 1900 desde celda vacía.",
      confidence: parsed ? "Alta" : "Media",
      humanReview: parsed ? "No" : "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("fecha cierre")) {
    return apply({
      inferredMeaning: "Campo operativo sobrecargado: fecha o estado",
      normalizedField: "status_raw",
      webLabel: "Cierre / estado original",
      module: "Cuentas por cobrar",
      table: "receivable_snapshots",
      column: "status_raw",
      dataType: "text",
      maxLength: 120,
      transformation: "Conservar crudo; separar fecha/estado solo con regla explícita.",
      validation: "Si contiene “Anulada”, no parsear como fecha.",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado con revisión",
    });
  }
  if (key.includes("cliente") || key === "customer_name") {
    return apply({
      inferredMeaning: "Nombre legal/comercial del cliente",
      normalizedField: "name",
      webLabel: "Cliente",
      module: "Empresas",
      table: "businesses",
      column: "name",
      dataType: "text",
      maxLength: 240,
      required: "Requerido para aceptación",
      transformation: "Conservar nombre; normalized_name solo para candidatos.",
      validation: "No autoenlazar por nombre.",
      relationship: "invoices.business_id → businesses.id",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado",
    });
  }
  if (key === "customer_tax_id" || key.includes("rnc") || key.includes("cédula") || key.includes("cedula")) {
    return apply({
      inferredMeaning: "RNC/Cédula del cliente o emisor según ubicación",
      normalizedField: "rnc",
      webLabel: "RNC / Cédula",
      module: "Empresas",
      table: "businesses",
      column: "rnc",
      dataType: "text",
      maxLength: 30,
      uniqueness: "Candidato único cuando válido",
      transformation: "Conservar crudo; crear normalized_rnc.",
      validation: "Validar longitud/dígito y distinguir emisor de cliente.",
      relationship: "invoices.business_id → businesses.id",
      confidence: parsed ? "Alta" : "Media",
      humanReview: parsed ? "No" : "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("factura") || key === "invoice_number") {
    return apply({
      inferredMeaning: "Número interno de factura",
      normalizedField: "invoice_number_raw",
      webLabel: "No. de factura",
      module: "Facturas",
      table: "invoices",
      column: "invoice_number_raw",
      dataType: "text",
      maxLength: 60,
      required: "Requerido o revisión bloqueante",
      uniqueness: "Compuesto; no único global",
      transformation: "Conservar crudo; normalizar prefijo/número por separado.",
      validation: "Identidad incluye negocio, año/fecha, NCF y versión.",
      confidence: parsed ? "Alta" : "Media",
      humanReview: parsed ? "No" : "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("direcci") || key === "customer_address") {
    return apply({
      inferredMeaning: "Dirección del cliente",
      normalizedField: "address",
      webLabel: "Dirección",
      module: "Empresas",
      table: "businesses",
      column: "address",
      dataType: "text",
      maxLength: 1000,
      transformation: "Conservar texto; no inferir dirección de proyecto.",
      validation: "Revisar contexto emisor/cliente/proyecto.",
      confidence: parsed ? "Alta" : "Media",
      humanReview: parsed ? "No" : "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("proyecto") || key === "project_name") {
    return apply({
      inferredMeaning: "Nombre/descripción de proyecto",
      normalizedField: "name",
      webLabel: "Proyecto",
      module: "Proyectos",
      table: "projects",
      column: "name",
      dataType: "text",
      maxLength: 240,
      transformation: "Conservar crudo; crear candidato, nunca autoenlace fuzzy.",
      validation: "Requiere negocio y revisión si hay múltiples candidatos.",
      relationship: "invoices.project_id → projects.id",
      confidence: "Alta",
      humanReview: "Sí",
      disposition: "Mapeado con revisión",
    });
  }
  if (key.includes("cotizaci") || key === "quotation_number") {
    return apply({
      inferredMeaning: "Número de cotización relacionada",
      normalizedField: "quotation_number",
      webLabel: "Cotización",
      module: "Cotizaciones",
      table: "quotations",
      column: "quotation_number",
      dataType: "text",
      maxLength: 80,
      transformation: "Conservar crudo; normalizar para candidato exacto.",
      validation: "Año/base deben concordar; vínculo por revisión.",
      relationship: "invoices.quotation_id → quotations.id",
      confidence: "Alta",
      humanReview: "Sí",
      disposition: "Mapeado con revisión",
    });
  }
  if (key.includes("orden de compra") || key === "purchase_order") {
    return apply({
      inferredMeaning: "Número de orden de compra",
      normalizedField: "purchase_order_number",
      webLabel: "Orden de compra",
      module: "Facturas",
      table: "invoices",
      column: "purchase_order_number",
      dataType: "text",
      maxLength: 120,
      transformation: "Conservar crudo; N/A → value_state not_applicable.",
      validation: "",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado",
    });
  }
  if (key.includes("condici") && key.includes("pago") || key === "payment_terms") {
    return apply({
      inferredMeaning: "Condiciones de pago",
      normalizedField: "payment_terms_raw",
      webLabel: "Condiciones de pago",
      module: "Facturas",
      table: "invoices",
      column: "payment_terms_raw",
      dataType: "text",
      maxLength: 1000,
      transformation: "Conservar crudo; clasificación opcional separada.",
      validation: "",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado",
    });
  }
  if (key.includes("representante") || key === "representative") {
    return apply({
      inferredMeaning: "Representante registrado en el documento",
      normalizedField: "sales_representative",
      webLabel: "Representante",
      module: "Facturas",
      table: "invoices",
      column: "sales_representative",
      dataType: "text",
      maxLength: 240,
      transformation: "Conservar nombre histórico.",
      validation: "",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado",
    });
  }
  if (key.includes("contacto") || key === "contact_name") {
    return apply({
      inferredMeaning: "Persona contacto",
      normalizedField: "name",
      webLabel: "Contacto",
      module: "Contactos",
      table: "contacts",
      column: "name",
      dataType: "text",
      maxLength: 240,
      transformation: "Conservar crudo; crear candidato.",
      validation: "No autoenlazar por nombre.",
      relationship: "invoices.contact_id → contacts.id",
      confidence: "Alta",
      humanReview: "Sí",
      disposition: "Mapeado con revisión",
    });
  }
  if (key.includes("correo") || key.includes("email") || key.includes("e-mail")) {
    return apply({
      inferredMeaning: "Correo de contacto",
      normalizedField: "email",
      webLabel: "Correo",
      module: "Contactos",
      table: "contacts",
      column: "email",
      dataType: "text",
      maxLength: 320,
      transformation: "Conservar crudo; normalized_email en minúsculas.",
      validation: "Formato válido; múltiples correos se separan con proveniencia.",
      relationship: "invoices.contact_id → contacts.id",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado",
    });
  }
  if (key.includes("celular") || key.includes("móvil") || key.includes("movil")) {
    return apply({
      inferredMeaning: "Teléfono móvil",
      normalizedField: "mobile_phone",
      webLabel: "Celular",
      module: "Contactos",
      table: "contacts",
      column: "mobile_phone",
      dataType: "text",
      maxLength: 80,
      transformation: "Conservar formato crudo y normalized_mobile_phone separado.",
      validation: "Validar sin eliminar extensión.",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado",
    });
  }
  if (key.includes("tel") || key === "phone") {
    return apply({
      inferredMeaning: "Teléfono",
      normalizedField: "phone",
      webLabel: "Teléfono",
      module: "Contactos",
      table: "contacts",
      column: "phone",
      dataType: "text",
      maxLength: 80,
      transformation: "Conservar crudo y normalized_phone separado.",
      validation: "Validar sin eliminar extensión.",
      confidence: parsed ? "Alta" : "Media",
      humanReview: parsed ? "No" : "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("código") || key.includes("codigo")) {
    return apply({
      inferredMeaning: "Código de producto/servicio",
      normalizedField: "item_code",
      webLabel: "Código",
      module: "Líneas de factura",
      table: "invoice_lines",
      column: "item_code",
      dataType: "text",
      maxLength: 120,
      transformation: "Conservar crudo.",
      validation: "",
      relationship: "invoice_lines.invoice_id → invoices.id",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("descripci")) {
    return apply({
      inferredMeaning: "Descripción de línea",
      normalizedField: "description",
      webLabel: "Descripción",
      module: "Líneas de factura",
      table: "invoice_lines",
      column: "description",
      dataType: "text",
      maxLength: 4000,
      transformation: "Conservar texto y saltos relevantes.",
      validation: "Requerido para línea con importe.",
      relationship: "invoice_lines.invoice_id → invoices.id",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("cant")) {
    return apply({
      inferredMeaning: "Cantidad de línea",
      normalizedField: "quantity",
      webLabel: "Cantidad",
      module: "Líneas de factura",
      table: "invoice_lines",
      column: "quantity",
      dataType: "decimal",
      maxLength: null,
      transformation: "Separadores locales → decimal; conservar crudo.",
      validation: "No negativa salvo crédito/reversión.",
      relationship: "invoice_lines.invoice_id → invoices.id",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("ubicaci")) {
    return apply({
      inferredMeaning: "Ubicación de la línea",
      normalizedField: "location",
      webLabel: "Ubicación",
      module: "Líneas de factura",
      table: "invoice_lines",
      column: "location",
      dataType: "text",
      maxLength: 500,
      transformation: "Conservar crudo.",
      relationship: "invoice_lines.invoice_id → invoices.id",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("ancho")) {
    return apply({
      inferredMeaning: "Ancho en centímetros",
      normalizedField: "width_cm",
      webLabel: "Ancho (cm)",
      module: "Líneas de factura",
      table: "invoice_lines",
      column: "width_cm",
      dataType: "decimal",
      maxLength: null,
      transformation: "Decimal; conservar unidad y crudo.",
      validation: "Positivo cuando aplica.",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("altura")) {
    return apply({
      inferredMeaning: "Altura en centímetros",
      normalizedField: "height_cm",
      webLabel: "Altura (cm)",
      module: "Líneas de factura",
      table: "invoice_lines",
      column: "height_cm",
      dataType: "decimal",
      maxLength: null,
      transformation: "Decimal; conservar unidad y crudo.",
      validation: "Positivo cuando aplica.",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("área") || key.includes("area")) {
    return apply({
      inferredMeaning: "Área en metros cuadrados",
      normalizedField: "area_sqm",
      webLabel: "Área (m²)",
      module: "Líneas de factura",
      table: "invoice_lines",
      column: "area_sqm",
      dataType: "decimal",
      maxLength: null,
      transformation: "Decimal; conservar fórmula/resultado.",
      validation: "Reconciliar con ancho × altura cuando exista.",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("precio")) {
    return apply({
      inferredMeaning: "Precio unitario",
      normalizedField: "unit_price",
      webLabel: "Precio unitario",
      module: "Líneas de factura",
      table: "invoice_lines",
      column: "unit_price",
      dataType: "decimal",
      maxLength: null,
      transformation: "Moneda local → decimal; conservar crudo.",
      validation: "Reconciliar línea.",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key.includes("itbis")) {
    return apply({
      inferredMeaning: "ITBIS declarado",
      normalizedField: "tax_amount",
      webLabel: "ITBIS",
      module: "Facturas",
      table: "invoices",
      column: "tax_amount",
      dataType: "decimal",
      maxLength: null,
      transformation: "Decimal; tasa/tratamiento por separado.",
      validation: "No asumir 18 %; reconciliar contra evidencia.",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado con revisión",
    });
  }
  if (key.includes("sub-total") || key.includes("subtotal") || key.includes("sub total")) {
    return apply({
      inferredMeaning: "Subtotal de factura",
      normalizedField: "subtotal_amount",
      webLabel: "Subtotal",
      module: "Facturas",
      table: "invoices",
      column: "subtotal_amount",
      dataType: "decimal",
      maxLength: null,
      transformation: "Decimal; conservar fórmula/resultado.",
      validation: "Reconciliar con líneas/cargos según tratamiento.",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado con revisión",
    });
  }
  if (key.includes("avance")) {
    return apply({
      inferredMeaning: "Importe pagado agregado de la matriz/documento",
      normalizedField: "paid_amount",
      webLabel: "Avance observado",
      module: "Cuentas por cobrar",
      table: "receivable_snapshots",
      column: "paid_amount",
      dataType: "decimal",
      maxLength: null,
      transformation: "Guardar snapshot; NO crear payments.",
      validation: "paid + balance debe reconciliar con total o generar issue.",
      relationship: "receivable_snapshots.invoice_id → invoices.id",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado como snapshot",
    });
  }
  if (key.includes("pendiente")) {
    return apply({
      inferredMeaning: "Saldo agregado observado",
      normalizedField: "balance_amount",
      webLabel: "Pendiente observado",
      module: "Cuentas por cobrar",
      table: "receivable_snapshots",
      column: "balance_amount",
      dataType: "decimal",
      maxLength: null,
      transformation: "Guardar snapshot.",
      validation: "Reportar negativos y discrepancias.",
      relationship: "receivable_snapshots.invoice_id → invoices.id",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Mapeado como snapshot",
    });
  }
  if (key.includes("total")) {
    return apply({
      inferredMeaning: "Total monetario según contexto",
      normalizedField: "total_amount",
      webLabel: "Total",
      module: "Facturas",
      table: "invoices",
      column: "total_amount",
      dataType: "decimal",
      maxLength: null,
      transformation: "Decimal; distinguir línea, subtotal y total por ubicación.",
      validation: "Reconciliar; no elegir la última etiqueta ciegamente.",
      confidence: "Baja",
      humanReview: "Sí",
      disposition: "Mapeado con revisión",
    });
  }
  if (key.includes("estatus") || key === "status") {
    return apply({
      inferredMeaning: "Estado operativo de factura/saldo",
      normalizedField: "status",
      webLabel: "Estado",
      module: "Facturas",
      table: "invoices",
      column: "status",
      dataType: "enum",
      maxLength: 30,
      allowedValues: "draft|issued|partial|paid|overdue|cancelled|replaced|credited|unknown",
      transformation: "Mapeo explícito desde valor crudo.",
      validation: "Valor desconocido → unknown + review.",
      confidence: "Media",
      humanReview: "Sí",
      disposition: "Mapeado",
    });
  }
  if (key === "mes" || key === "año" || key === "ano") {
    return apply({
      inferredMeaning: "Periodo derivado",
      normalizedField: key === "mes" ? "issue_month" : "issue_year",
      webLabel: key === "mes" ? "Mes" : "Año",
      module: "Facturas",
      table: "invoices",
      column: key === "mes" ? "issue_date" : "issue_year",
      dataType: key === "mes" ? "derived" : "integer",
      maxLength: null,
      transformation: "Derivar de issue_date válida; conservar fuente para auditoría.",
      validation: "No aceptar año 1900 por celda vacía.",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Campo derivado",
    });
  }
  if (key === "no" || key === "no.") {
    return apply({
      inferredMeaning: "Número secuencial operativo de la matriz",
      normalizedField: "",
      webLabel: "",
      module: "Importaciones",
      table: "",
      column: "",
      dataType: "integer",
      maxLength: null,
      transformation: "Conservar solo en raw_values/source_row_number.",
      validation: "",
      relationship: "",
      confidence: "Alta",
      notes: "No es identidad de factura.",
      humanReview: "No",
      disposition: "Excluido: índice operativo",
    });
  }
  if (key.includes("realizado por") || key.includes("autorizado por")) {
    return apply({
      inferredMeaning: "Firma/leyenda del documento",
      normalizedField: "original_spanish_text",
      webLabel: "Firma / autorización original",
      module: "Documentos",
      table: "source_field_values",
      column: "raw_value",
      dataType: "text",
      maxLength: 1000,
      transformation: "Conservar como evidencia; no crear usuario.",
      validation: "",
      relationship: "source document",
      confidence: "Alta",
      humanReview: "No",
      disposition: "Histórico/auditoría",
    });
  }
  return base;
}

function rawType(mapping, examples) {
  if (mapping.dataType === "date") return "fecha/texto";
  if (mapping.dataType === "decimal" || mapping.dataType === "integer") return "número/fórmula/texto";
  if (examples.some((value) => /^-?[\d,.]+$/.test(String(value).trim()))) return "número/texto";
  return "texto";
}

function formatDataSheet(sheet, title, subtitle, headers, rows, widths, tableName) {
  const lastColumn = columnName(headers.length - 1);
  sheet.showGridLines = false;
  sheet.getRange(`A1:${lastColumn}1`).merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A1:${lastColumn}1`).format = {
    fill: BRAND.dark,
    font: { bold: true, color: "#FFFFFF", size: 18 },
    rowHeight: 34,
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:${lastColumn}2`).merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${lastColumn}2`).format = {
    fill: BRAND.mint,
    font: { color: BRAND.text, italic: true, size: 10 },
    rowHeight: 30,
    wrapText: true,
    verticalAlignment: "center",
  };
  sheet.getRange(`A4:${lastColumn}4`).values = [headers];
  sheet.getRange(`A4:${lastColumn}4`).format = {
    fill: BRAND.green,
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    verticalAlignment: "center",
    rowHeight: 34,
    borders: { preset: "all", style: "thin", color: BRAND.border },
  };
  if (rows.length > 0) {
    const endRow = 4 + rows.length;
    sheet.getRange(`A5:${lastColumn}${endRow}`).values = rows;
    sheet.getRange(`A5:${lastColumn}${endRow}`).format = {
      font: { color: BRAND.text, size: 9 },
      verticalAlignment: "top",
      wrapText: true,
      borders: { preset: "all", style: "thin", color: BRAND.border },
    };
    const table = sheet.tables.add(`A4:${lastColumn}${endRow}`, true, tableName);
    table.style = "TableStyleMedium4";
    table.showFilterButton = true;
  }
  sheet.freezePanes.freezeRows(4);
  widths.forEach((width, index) => {
    sheet.getRange(`${columnName(index)}:${columnName(index)}`).format.columnWidth = width;
  });
}

function buildSummarySheet(workbook, name, title, summary, manifest, notes) {
  const sheet = workbook.worksheets.add(name);
  const counts = statusCounts(manifest);
  sheet.showGridLines = false;
  sheet.getRange("A1:H1").merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A1:H1").format = {
    fill: BRAND.dark,
    font: { bold: true, color: "#FFFFFF", size: 20 },
    rowHeight: 38,
  };
  sheet.getRange("A3:B10").values = [
    ["Métrica", "Valor"],
    ["Archivos inventariados", summary.reconciliation.total],
    ["Archivos parseados", summary.reconciliation.parsed],
    ["Archivos parciales", summary.reconciliation.partial],
    ["Archivos no legibles", summary.reconciliation.unreadable],
    ["Archivos no soportados", summary.reconciliation.unsupported],
    ["Campos fuente distintos", summary.field_catalog_entries],
    ["Pares PDF/XLSX", summary.paired_pdf_xlsx_documents],
  ];
  sheet.getRange("A3:B3").format = {
    fill: BRAND.green,
    font: { bold: true, color: "#FFFFFF" },
  };
  sheet.getRange("A4:B10").format = {
    borders: { preset: "all", style: "thin", color: BRAND.border },
  };
  sheet.getRange("B4:B10").format.numberFormat = "0";
  sheet.getRange("D3:H3").merge();
  sheet.getRange("D3").values = [["Decisiones y alcance"]];
  sheet.getRange("D3:H3").format = {
    fill: BRAND.gold,
    font: { bold: true, color: "#FFFFFF" },
  };
  sheet.getRange("D4:H12").merge(true);
  const noteRows = notes.slice(0, 9).map((note) => [note, "", "", "", ""]);
  while (noteRows.length < 9) noteRows.push(["", "", "", "", ""]);
  sheet.getRange("D4:H12").values = noteRows;
  sheet.getRange("D4:H12").format = {
    fill: BRAND.cream,
    font: { color: BRAND.text, size: 10 },
    wrapText: true,
    verticalAlignment: "top",
    borders: { preset: "all", style: "thin", color: BRAND.border },
  };
  sheet.getRange("A13:B16").values = [
    ["Estado", "Cantidad"],
    ["parsed", counts.parsed ?? 0],
    ["partial", counts.partial ?? 0],
    ["unsupported/restricted", (counts.unsupported ?? 0) + (counts.restricted_inventory_only ?? 0)],
  ];
  sheet.getRange("A13:B13").format = {
    fill: BRAND.green,
    font: { bold: true, color: "#FFFFFF" },
  };
  sheet.getRange("A13:B16").format.borders = {
    preset: "all",
    style: "thin",
    color: BRAND.border,
  };
  sheet.getRange("A18:B19").values = [
    ["Generado", new Date(summary.generated_at)],
    ["Versión de parser", summary.parser_version],
  ];
  sheet.getRange("B18").format.numberFormat = "dd/mm/yyyy hh:mm";
  sheet.getRange("A:A").format.columnWidth = 31;
  sheet.getRange("B:B").format.columnWidth = 18;
  sheet.getRange("D:H").format.columnWidth = 20;
  sheet.freezePanes.freezeRows(1);
  return sheet;
}

export async function buildInvoiceWorkbooks({ analysisDir, outputDir, renderDir }) {
  const [summary, manifest, catalog, profiles] = await Promise.all([
    fs.readFile(path.join(analysisDir, "summary.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(analysisDir, "manifest-initial.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(analysisDir, "field-catalog.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(analysisDir, "file-profiles.json"), "utf8").then(JSON.parse),
  ]);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(renderDir, { recursive: true });

  const catalogWorkbook = Workbook.create();
  buildSummarySheet(
    catalogWorkbook,
    "Resumen",
    "HIDACA — Catálogo de campos de facturación",
    summary,
    manifest,
    [
      "El documento emitido controla los datos propios; la matriz es índice operativo.",
      "Los valores crudos y normalizados se preservan por separado.",
      "Las etiquetas de baja confianza permanecen como evidencia y requieren revisión.",
      "No se omitieron etiquetas aunque aparezcan una sola vez.",
      "RNC, NCF, teléfonos y referencias se tratan como texto.",
      "Las ubicaciones listadas son muestras; el manifiesto conserva cobertura completa.",
      "No se importó ni modificó información de producción.",
    ],
  );

  const catalogHeaders = [
    "ID",
    "Campo fuente normalizado",
    "Etiquetas originales",
    "Ocurrencias",
    "Formatos fuente",
    "Ubicaciones de muestra",
    "Ejemplos observados",
    "Tipo bruto observado",
    "Formato observado",
    "Significado propuesto",
    "Entidad / tabla propuesta",
    "Campo destino propuesto",
    "Confianza",
    "Ambigüedad / notas",
    "Disposición",
  ];
  const catalogRows = catalog.map((entry, index) => {
    const mapping = mappingFor(entry.normalized_source_field);
    const labels = Object.keys(entry.source_labels ?? {});
    const examples = entry.examples ?? [];
    return [
      index + 1,
      entry.normalized_source_field,
      labels.join(" | "),
      Number(entry.occurrences ?? 0),
      Object.entries(entry.source_formats ?? {})
        .map(([format, count]) => `${format}: ${count}`)
        .join(" | "),
      (entry.source_locations ?? []).join("\n"),
      examples.join(" | "),
      rawType(mapping, examples),
      mapping.dataType,
      mapping.inferredMeaning,
      mapping.table || "—",
      mapping.column || "—",
      mapping.confidence,
      mapping.notes,
      mapping.disposition,
    ];
  });
  const catalogSheet = catalogWorkbook.worksheets.add("Campos fuente");
  formatDataSheet(
    catalogSheet,
    "Catálogo completo de campos fuente",
    "Una fila por etiqueta/campo distinto. Las muestras no limitan la evidencia completa conservada en el manifiesto y perfiles.",
    catalogHeaders,
    catalogRows,
    [8, 30, 38, 12, 18, 62, 45, 20, 18, 34, 26, 28, 13, 44, 24],
    "HidacaInvoiceFieldCatalog",
  );
  catalogSheet.getRange(`D5:D${4 + catalogRows.length}`).format.numberFormat = "0";
  catalogSheet
    .getRange(`M5:M${4 + catalogRows.length}`)
    .conditionalFormats.add("containsText", { text: "Baja", format: { fill: BRAND.danger } });

  const coverageHeaders = [
    "Ruta original",
    "Extensión",
    "Tamaño (bytes)",
    "Fecha modificación fuente",
    "SHA-256",
    "Categoría",
    "Estado de parseo",
    "Parser",
    "Hojas / páginas",
    "Legible por máquina",
    "OCR requerido",
    "Advertencias",
  ];
  const profileByPath = new Map(profiles.map((profile) => [profile.relative_path, profile]));
  const coverageRows = manifest.map((entry) => {
    const profile = profileByPath.get(entry.relative_path) ?? {};
    const units =
      profile.worksheets?.length != null
        ? `${profile.worksheets.length} hojas`
        : profile.pages?.length != null
          ? `${profile.pages.length} páginas`
          : "";
    return [
      entry.relative_path,
      entry.extension,
      Number(entry.size_bytes),
      new Date(entry.source_modified_at),
      entry.sha256,
      entry.category,
      entry.parse_status,
      profile.parser ?? "",
      units,
      profile.machine_readable == null ? "" : profile.machine_readable ? "Sí" : "No",
      profile.ocr_required ? "Sí" : "No",
      asText(profile.warnings ?? entry.reason ?? ""),
    ];
  });
  const coverageSheet = catalogWorkbook.worksheets.add("Cobertura de fuentes");
  formatDataSheet(
    coverageSheet,
    "Cobertura de archivos y evidencia",
    "Inventario completo asociado al catálogo; los hashes permiten reproducir duplicados exactos.",
    coverageHeaders,
    coverageRows,
    [62, 12, 16, 20, 68, 22, 20, 24, 16, 18, 15, 60],
    "HidacaInvoiceSourceCoverage",
  );
  coverageSheet.getRange(`C5:C${4 + coverageRows.length}`).format.numberFormat = "#,##0";
  coverageSheet.getRange(`D5:D${4 + coverageRows.length}`).format.numberFormat = "dd/mm/yyyy hh:mm";
  coverageSheet
    .getRange(`G5:G${4 + coverageRows.length}`)
    .conditionalFormats.add("containsText", { text: "partial", format: { fill: BRAND.warning } });

  const catalogOutput = path.join(outputDir, "hidaca-invoice-field-catalog.xlsx");
  const catalogBlob = await SpreadsheetFile.exportXlsx(catalogWorkbook);
  await catalogBlob.save(catalogOutput);

  const mappingWorkbook = Workbook.create();
  const canonicalDestinations = new Set();
  const mappings = catalog.map((entry) => {
    const mapping = mappingFor(entry.normalized_source_field);
    if (mapping.table && mapping.column && mapping.table !== "source_field_values") {
      canonicalDestinations.add(`${mapping.table}.${mapping.column}`);
    }
    return { entry, mapping };
  });
  buildSummarySheet(
    mappingWorkbook,
    "Resumen",
    "HIDACA — Mapeo fuente a CRM",
    { ...summary, field_catalog_entries: catalog.length },
    manifest,
    [
      `${canonicalDestinations.size} destinos canónicos distintos propuestos por el mapeo.`,
      "Todo campo tiene destino, campo derivado o exclusión explícita.",
      "Solo identificadores exactos únicos permiten autoenlace.",
      "Coincidencias por nombre, contacto, dirección, fecha o monto son candidatos.",
      "Avance/Pendiente se guardan como snapshots, no pagos.",
      "ITBIS se valida contra el tratamiento declarado; no se asume 18 %.",
      "Etiquetas ambiguas se conservan en source_field_values y requieren revisión.",
    ],
  );

  const mappingHeaders = [
    "Archivo fuente",
    "Hoja o tipo de documento",
    "Columna o etiqueta fuente",
    "Ejemplo fuente",
    "Significado inferido",
    "Campo normalizado propuesto",
    "Etiqueta web en español",
    "Módulo destino",
    "Tabla destino",
    "Columna destino",
    "Tipo de dato",
    "Longitud máxima",
    "Requerido u opcional",
    "Único o no único",
    "Valor predeterminado",
    "Valores permitidos",
    "Regla de transformación",
    "Regla de validación",
    "Relación / llave foránea",
    "Nivel de confianza",
    "Notas",
    "Requiere revisión humana",
    "Disposición",
  ];
  const mappingRows = mappings.map(({ entry, mapping }) => [
    (entry.source_locations ?? []).slice(0, 4).join("\n"),
    Object.keys(entry.source_formats ?? {}).join(" / "),
    Object.keys(entry.source_labels ?? {}).join(" | ") || entry.normalized_source_field,
    (entry.examples ?? []).slice(0, 5).join(" | "),
    mapping.inferredMeaning,
    mapping.normalizedField,
    mapping.webLabel,
    mapping.module,
    mapping.table,
    mapping.column,
    mapping.dataType,
    mapping.maxLength == null ? "" : Number(mapping.maxLength),
    mapping.required,
    mapping.uniqueness,
    mapping.defaultValue,
    mapping.allowedValues,
    mapping.transformation,
    mapping.validation,
    mapping.relationship,
    mapping.confidence,
    mapping.notes,
    mapping.humanReview,
    mapping.disposition,
  ]);
  const mappingSheet = mappingWorkbook.worksheets.add("Mapeo");
  formatDataSheet(
    mappingSheet,
    "Mapeo fuente → destino",
    "Contrato de implementación. Los campos ambiguos no se corrigen automáticamente y permanecen en revisión.",
    mappingHeaders,
    mappingRows,
    [54, 22, 38, 40, 34, 30, 26, 24, 26, 28, 16, 14, 20, 22, 20, 30, 46, 44, 42, 18, 48, 22, 26],
    "HidacaInvoiceFieldMapping",
  );
  mappingSheet.getRange(`L5:L${4 + mappingRows.length}`).format.numberFormat = "0";
  mappingSheet
    .getRange(`V5:V${4 + mappingRows.length}`)
    .conditionalFormats.add("containsText", { text: "Sí", format: { fill: BRAND.warning } });
  mappingSheet
    .getRange(`T5:T${4 + mappingRows.length}`)
    .conditionalFormats.add("containsText", { text: "Baja", format: { fill: BRAND.danger } });

  const rulesSheet = mappingWorkbook.worksheets.add("Reglas");
  const rulesHeaders = ["Regla", "Decisión", "Justificación"];
  const rulesRows = [
    ["Autoridad", "Documento emitido > matriz", "La matriz funciona como índice/snapshot."],
    ["Autoenlace", "Solo identificador exacto válido y único", "Evita falsos positivos."],
    ["Fuzzy", "Candidato + revisión", "Nombre/dirección/monto no son identidad."],
    ["Factura", "Negocio + número + año/fecha + NCF + versión", "Soporta anuladas y reemitidas."],
    ["Pagos", "Solo evidencia transaccional", "Avance/Pendiente no son transacciones."],
    ["Impuestos", "Tratamiento declarado/configuración vigente", "No asumir 18 %."],
    ["Nulos", "Separar vacío/cero/N/A/no calculado", "Preserva significado."],
    ["Linaje", "Archivo + hoja/página + fila/celda + crudo/fórmula", "Auditoría reproducible."],
  ];
  formatDataSheet(
    rulesSheet,
    "Reglas de mapeo y autoridad",
    "Reglas bloqueadas para el futuro importador.",
    rulesHeaders,
    rulesRows,
    [28, 48, 72],
    "HidacaInvoiceMappingRules",
  );

  const mappingOutput = path.join(outputDir, "hidaca-invoice-field-mapping.xlsx");
  const mappingBlob = await SpreadsheetFile.exportXlsx(mappingWorkbook);
  await mappingBlob.save(mappingOutput);

  const catalogPreview = await catalogWorkbook.render({
    sheetName: "Campos fuente",
    range: "A1:O18",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(renderDir, "hidaca-invoice-field-catalog-preview.png"),
    new Uint8Array(await catalogPreview.arrayBuffer()),
  );
  const mappingPreview = await mappingWorkbook.render({
    sheetName: "Mapeo",
    range: "A1:W16",
    scale: 0.75,
    format: "png",
  });
  await fs.writeFile(
    path.join(renderDir, "hidaca-invoice-field-mapping-preview.png"),
    new Uint8Array(await mappingPreview.arrayBuffer()),
  );

  const catalogInspection = await catalogWorkbook.inspect({
    kind: "workbook,sheet,table",
    maxChars: 5000,
    tableMaxRows: 4,
    tableMaxCols: 8,
    tableMaxCellChars: 80,
  });
  const mappingInspection = await mappingWorkbook.inspect({
    kind: "workbook,sheet,table",
    maxChars: 5000,
    tableMaxRows: 4,
    tableMaxCols: 8,
    tableMaxCellChars: 80,
  });
  await Promise.all([
    fs.rm(`${catalogOutput}.inspect.ndjson`, { force: true }),
    fs.rm(`${mappingOutput}.inspect.ndjson`, { force: true }),
  ]);

  return {
    catalogOutput,
    mappingOutput,
    catalogRows: catalogRows.length,
    mappingRows: mappingRows.length,
    canonicalDestinations: canonicalDestinations.size,
    previews: [
      path.join(renderDir, "hidaca-invoice-field-catalog-preview.png"),
      path.join(renderDir, "hidaca-invoice-field-mapping-preview.png"),
    ],
    inspections: {
      catalog: catalogInspection,
      mapping: mappingInspection,
    },
  };
}
