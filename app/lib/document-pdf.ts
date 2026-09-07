import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { calculateDocument, type DocumentCalculation, type DocumentLineInput } from "./document-calculations";

export type PdfDocumentData = {
  kind: "invoice" | "quotation";
  number: string;
  date: string;
  dueDate: string;
  currency?: string;
  businessName: string;
  businessRnc?: string;
  businessAddress?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  projectName?: string;
  paymentTerms?: string;
  notes?: string;
  lines: DocumentLineInput[];
  discount?: unknown;
  additionalCharge?: unknown;
  additionalChargeLabel?: string;
  taxRate?: unknown;
  advance?: unknown;
  calculation?: DocumentCalculation;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const margin = 42;

export async function createDocumentPdf(data: PdfDocumentData) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const calculation = data.calculation ?? calculateDocument(data);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - margin;

  const nextPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - margin;
  };
  const ensure = (height: number) => {
    if (y - height < margin) nextPage();
  };
  const text = (value: unknown) => String(value ?? "").trim() || "—";
  const draw = (value: string, x: number, size = 9, font = regular, color = rgb(0.12, 0.2, 0.17)) => {
    page.drawText(value, { x, y, size, font, color });
  };
  const line = (offset = 0) => page.drawLine({ start: { x: margin, y: y - offset }, end: { x: PAGE_WIDTH - margin, y: y - offset }, thickness: 0.7, color: rgb(0.78, 0.84, 0.81) });
  const wrapped = (value: string, x: number, width: number, size = 9, font = regular) => {
    const words = value.split(/\s+/);
    const rows: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > width && current) {
        rows.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) rows.push(current);
    for (const row of rows) { ensure(size + 4); draw(row, x, size, font); y -= size + 4; }
  };

  draw("HIDACA", margin, 20, bold, rgb(0.02, 0.31, 0.2));
  draw("Constructora S.R.L.", margin, 9, regular);
  draw(data.kind === "invoice" ? "FACTURA" : "COTIZACIÓN", 390, 18, bold, rgb(0.02, 0.31, 0.2));
  y -= 22;
  draw(`No. ${text(data.number)}`, 390, 10, bold);
  y -= 18;
  line();
  y -= 20;

  draw("Información del documento", margin, 11, bold);
  y -= 18;
  draw(`Fecha: ${text(data.date)}`, margin, 9);
  draw(`${data.kind === "invoice" ? "Vencimiento" : "Validez hasta"}: ${text(data.dueDate)}`, 260, 9);
  y -= 20;
  draw("Cliente", margin, 11, bold);
  y -= 17;
  draw(text(data.businessName), margin, 10, bold);
  y -= 14;
  if (data.businessRnc) { draw(`RNC: ${data.businessRnc}`, margin, 9); y -= 13; }
  if (data.contactName || data.contactPhone || data.contactEmail) {
    draw(`Contacto: ${[data.contactName, data.contactPhone, data.contactEmail].filter(Boolean).join(" · ")}`, margin, 9);
    y -= 13;
  }
  if (data.businessAddress) { wrapped(data.businessAddress, margin, PAGE_WIDTH - margin * 2, 9); }
  if (data.projectName) { draw(`Proyecto: ${data.projectName}`, margin, 9); y -= 15; }
  y -= 8;

  ensure(80);
  draw("Conceptos", margin, 11, bold);
  y -= 18;
  const columns = [margin, 83, 255, 322, 389, 454];
  const headers = ["Cant.", "Descripción", "Ancho", "Altura", "Área", "Precio", "Total"];
  const headerXs = [margin, 83, 255, 322, 389, 454, 505];
  headers.forEach((header, index) => draw(header, headerXs[index], 7.5, bold));
  y -= 12;
  line();
  y -= 14;
  for (const sourceLine of data.lines) {
    const calculated = calculation.lines.find((lineItem) => lineItem.id === sourceLine.id) ?? calculateDocument({ lines: [sourceLine] }).lines[0];
    ensure(34);
    const description = text(sourceLine.description);
    draw(text(calculated.quantity), columns[0], 8);
    wrapped(description, columns[1], 160, 8);
    const rowY = y + 12;
    page.drawText(calculated.widthCm === null ? "—" : `${calculated.widthCm}`, { x: columns[2], y: rowY, size: 8, font: regular });
    page.drawText(calculated.heightCm === null ? "—" : `${calculated.heightCm}`, { x: columns[3], y: rowY, size: 8, font: regular });
    page.drawText(calculated.areaTotal === null ? "—" : `${calculated.areaTotal}`, { x: columns[4], y: rowY, size: 8, font: regular });
    page.drawText(formatAmount(calculated.unitPrice, data.currency), { x: columns[5], y: rowY, size: 8, font: regular });
    page.drawText(formatAmount(calculated.lineTotal, data.currency), { x: 505, y: rowY, size: 8, font: bold });
    y = Math.min(y, rowY) - 16;
  }
  y -= 6;
  line();
  y -= 22;

  ensure(130);
  draw("Resumen financiero", 350, 11, bold);
  y -= 18;
  const totals: Array<[string, number]> = [
    ["Sub-Total", calculation.subtotal],
    ["Descuento", calculation.discount],
    [data.additionalChargeLabel || "Cargo adicional", calculation.additionalCharge],
    [`ITBIS ${calculation.taxRate}%`, calculation.taxAmount],
    ["Total", calculation.total],
    ["Avance / pagado", calculation.advance],
    ["Balance", calculation.balance],
  ];
  for (const [label, value] of totals) {
    draw(label, 350, label === "Total" || label === "Balance" ? 10 : 9, label === "Total" || label === "Balance" ? bold : regular);
    page.drawText(formatAmount(value, data.currency), { x: 480, y, size: label === "Total" || label === "Balance" ? 10 : 9, font: label === "Total" || label === "Balance" ? bold : regular });
    y -= 16;
  }
  y -= 12;
  if (data.paymentTerms || data.notes) {
    ensure(80);
    draw("Términos y notas", margin, 11, bold);
    y -= 17;
    if (data.paymentTerms) wrapped(`Condiciones: ${data.paymentTerms}`, margin, PAGE_WIDTH - margin * 2, 9);
    if (data.notes) wrapped(data.notes, margin, PAGE_WIDTH - margin * 2, 9);
  }

  return pdf.save();
}

function formatAmount(value: number, currency = "DOP") {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency, maximumFractionDigits: 2 }).format(value).replaceAll("\u00a0", " ").replaceAll("\u202f", " ");
}
