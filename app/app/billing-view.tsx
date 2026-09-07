"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { BusinessRow } from "./types";
import { Empty, Modal, money } from "./ui";

type BillingMode =
  | "facturas"
  | "pagos"
  | "credit-notes"
  | "receivables"
  | "collections";
type DataRow = Record<string, unknown>;

const modeConfig: Record<
  BillingMode,
  { title: string; eyebrow: string; endpoint: string; listKey: string }
> = {
  facturas: {
    title: "Facturas",
    eyebrow: "Facturación",
    endpoint: "/api/invoices",
    listKey: "invoices",
  },
  pagos: {
    title: "Pagos y asignaciones",
    eyebrow: "Tesorería",
    endpoint: "/api/payments",
    listKey: "payments",
  },
  "credit-notes": {
    title: "Notas de crédito",
    eyebrow: "Facturación",
    endpoint: "/api/credit-notes",
    listKey: "creditNotes",
  },
  receivables: {
    title: "Cuentas por cobrar",
    eyebrow: "Cartera",
    endpoint: "/api/receivables",
    listKey: "receivables",
  },
  collections: {
    title: "Gestión de cobranza",
    eyebrow: "Cartera",
    endpoint: "/api/collection-activities",
    listKey: "activities",
  },
};

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  issued: "Emitida",
  partially_paid: "Pago parcial",
  paid: "Pagada",
  overdue: "Vencida",
  cancelled: "Anulada",
  void: "Anulado",
  unknown: "Por revisar",
  received: "Recibido",
  cleared: "Conciliado",
  pending: "Pendiente",
  applied: "Aplicada",
  unpaid: "Sin pago",
  partial: "Parcial",
};

export function BillingView({
  businesses,
  canWrite,
  currentUserEmail,
  mode,
  setMessage,
}: {
  businesses: BusinessRow[];
  canWrite: boolean;
  currentUserEmail: string;
  mode: BillingMode;
  setMessage: (value: string) => void;
}) {
  const config = modeConfig[mode];
  const [rows, setRows] = useState<DataRow[]>([]);
  const [legacyRows, setLegacyRows] = useState<DataRow[]>([]);
  const [invoiceOptions, setInvoiceOptions] = useState<DataRow[]>([]);
  const [query, setQuery] = useState("");
  const [aging, setAging] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<DataRow | null>(null);
  const [detail, setDetail] = useState<DataRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (aging) params.set("aging", aging);
    const response = await fetch(`${config.endpoint}?${params}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      setMessage(text(payload.error) || "No se pudo cargar la información.");
      setRows([]);
    } else {
      setRows(array(payload[config.listKey]));
      setLegacyRows(
        array(
          payload[
            mode === "facturas"
              ? "legacyInvoices"
              : mode === "pagos"
                ? "legacyPayments"
                : ""
          ],
        ),
      );
      if (mode === "collections") {
        const invoiceResponse = await fetch("/api/invoices?limit=500", {
          cache: "no-store",
        });
        const invoicePayload = (await invoiceResponse.json()) as Record<
          string,
          unknown
        >;
        setInvoiceOptions(array(invoicePayload.invoices));
      }
    }
    setLoading(false);
  }, [aging, config, mode, query, setMessage]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function openDetail(row: DataRow) {
    setSelected(row);
    if (!["facturas", "pagos", "credit-notes"].includes(mode)) return;
    const id = text(row.id);
    const endpoint =
      mode === "facturas"
        ? `/api/invoices/${id}`
        : mode === "pagos"
          ? `/api/payments/${id}`
          : `/api/credit-notes/${id}`;
    const response = await fetch(endpoint, { cache: "no-store" });
    const payload = (await response.json()) as DataRow;
    setDetail(response.ok ? payload : null);
  }

  async function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    if (mode === "collections") {
      payload.ownerEmail = currentUserEmail;
      payload.occurredAt = new Date().toISOString();
    }
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as Record<string, unknown>;
    setBusy(false);
    if (!response.ok) {
      setMessage(text(result.error) || "No se pudo guardar.");
      return;
    }
    setShowForm(false);
    setMessage("Registro guardado correctamente.");
    await load();
  }

  const allRows = useMemo<DataRow[]>(
    () => [
      ...rows,
      ...legacyRows.map<DataRow>((row) => ({ ...row, legacy: 1 })),
    ],
    [legacyRows, rows],
  );

  return (
    <>
      <div className="breadcrumbs">
        <span>Inicio</span>
        <i>/</i>
        <span aria-current="page">{config.title}</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h1>{config.title}</h1>
          <p>
            Datos normalizados con trazabilidad de fuente y convivencia segura
            con los registros heredados.
          </p>
        </div>
        {canWrite && mode !== "receivables" && (
          <button className="primary-button" onClick={() => setShowForm(true)}>
            Nuevo registro
          </button>
        )}
      </div>
      <div className="toolbar">
        <input
          aria-label={`Buscar en ${config.title}`}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por número, NCF o empresa…"
          value={query}
        />
        {mode === "receivables" && (
          <select
            aria-label="Antigüedad del saldo"
            onChange={(event) => setAging(event.target.value)}
            value={aging}
          >
            <option value="">Toda la antigüedad</option>
            <option value="current">Al día</option>
            <option value="1-30">1–30 días</option>
            <option value="31-60">31–60 días</option>
            <option value="61-90">61–90 días</option>
            <option value="90+">Más de 90 días</option>
          </select>
        )}
        <span>{allRows.length} registros</span>
      </div>
      <section className="panel">
        {loading ? (
          <p className="muted">Cargando…</p>
        ) : allRows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns(mode).map((column) => (
                    <th key={column.key}>{column.label}</th>
                  ))}
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((row, index) => (
                  <tr
                    className="clickable-row"
                    key={`${text(row.id)}-${index}`}
                    onClick={() => void openDetail(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openDetail(row);
                      }
                    }}
                    tabIndex={0}
                  >
                    {columns(mode).map((column) => (
                      <td key={column.key}>{cell(row, column.key)}</td>
                    ))}
                    <td>
                      <span className="status-badge">
                        {number(row.legacy)
                          ? "Heredado"
                          : sourceLabel(text(row.sourceAuthority))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No hay registros. Ajusta los filtros o registra el primer elemento." />
        )}
      </section>
      {showForm && (
        <Modal onClose={() => setShowForm(false)} title={`Nuevo: ${config.title}`}>
          <BillingForm
            businesses={businesses}
            busy={busy}
            mode={mode}
            onCancel={() => setShowForm(false)}
            onSubmit={createRecord}
            rows={mode === "collections" ? invoiceOptions : rows}
          />
        </Modal>
      )}
      {selected && (
        <Modal
          onClose={() => {
            setSelected(null);
            setDetail(null);
          }}
          title={rowTitle(mode, selected)}
        >
          <BillingDetail
            canWrite={canWrite}
            detail={detail}
            mode={mode}
            onChanged={async () => {
              setSelected(null);
              setDetail(null);
              await load();
            }}
            row={selected}
            setMessage={setMessage}
          />
        </Modal>
      )}
    </>
  );
}

function BillingForm({
  businesses,
  busy,
  mode,
  onCancel,
  onSubmit,
  rows,
}: {
  businesses: BusinessRow[];
  busy: boolean;
  mode: BillingMode;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  rows: DataRow[];
}) {
  return (
    <form className="form-grid" onSubmit={onSubmit}>
      {mode === "collections" ? (
        <label>
          Factura
          <select name="invoiceId" required>
            <option value="">Seleccionar</option>
            {rows.map((row) => (
              <option key={text(row.id)} value={text(row.id)}>
                {text(row.invoiceNumberRaw)} · {text(row.businessName)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Empresa
          <select name="businessId" required>
            <option value="">Seleccionar</option>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === "facturas" && (
        <>
          <Field label="Número de factura" name="invoiceNumberRaw" required />
          <Field label="NCF" name="ncfRaw" />
          <Field label="Fecha de emisión" name="issueDate" type="date" />
          <Field label="Fecha de vencimiento" name="dueDate" type="date" />
          <Field label="Total" name="totalAmount" type="number" />
        </>
      )}
      {mode === "pagos" && (
        <>
          <Field label="Monto" name="amount" required type="number" />
          <Field label="Fecha" name="paymentDate" type="date" />
          <Field label="Recibo" name="receiptNumber" />
          <Field label="Referencia" name="transactionReference" />
          <Field label="Método" name="method" />
        </>
      )}
      {mode === "credit-notes" && (
        <>
          <Field
            label="Número de nota de crédito"
            name="creditNoteNumberRaw"
            required
          />
          <Field label="NCF" name="ncfRaw" />
          <Field label="Fecha" name="issueDate" type="date" />
          <Field label="Total" name="totalAmount" type="number" />
          <Field label="Motivo" name="reason" />
        </>
      )}
      {mode === "collections" && (
        <>
          <label>
            Tipo
            <select name="activityType">
              <option value="call">Llamada</option>
              <option value="email">Correo</option>
              <option value="visit">Visita</option>
              <option value="promise_to_pay">Promesa de pago</option>
              <option value="dispute">Disputa</option>
              <option value="note">Nota</option>
            </select>
          </label>
          <Field label="Resultado" name="outcome" />
          <Field label="Próxima acción" name="nextActionAt" type="datetime-local" />
          <Field label="Notas" name="notes" />
        </>
      )}
      <div className="form-actions">
        <button className="secondary-button" onClick={onCancel} type="button">
          Cancelar
        </button>
        <button className="primary-button" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

function BillingDetail({
  canWrite,
  detail,
  mode,
  onChanged,
  row,
  setMessage,
}: {
  canWrite: boolean;
  detail: DataRow | null;
  mode: BillingMode;
  onChanged: () => Promise<void>;
  row: DataRow;
  setMessage: (value: string) => void;
}) {
  const allocations =
    mode === "pagos"
      ? array(detail?.allocations)
      : mode === "credit-notes"
        ? array(detail?.applications)
        : [];
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const endpoint =
      mode === "pagos"
        ? `/api/payments/${text(row.id)}/allocations`
        : `/api/credit-notes/${text(row.id)}/applications`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as DataRow;
    setMessage(
      response.ok
        ? "Aplicación registrada correctamente."
        : text(payload.error) || "No se pudo aplicar.",
    );
    if (response.ok) await onChanged();
  }
  return (
    <div className="billing-detail">
      <dl className="detail-grid">
        {columns(mode).map((column) => (
          <div key={column.key}>
            <dt>{column.label}</dt>
            <dd>{cell(row, column.key)}</dd>
          </div>
        ))}
      </dl>
      {detail && mode === "facturas" && (
        <>
          <h3>Partidas y movimientos</h3>
          <p className="muted">
            {array(detail.lines).length} partidas ·{" "}
            {array(detail.allocations).length} pagos ·{" "}
            {array(detail.creditApplications).length} notas aplicadas
          </p>
          {array(detail.lines).length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Partida</th>
                    <th>Descripción</th>
                    <th>Cantidad</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {array(detail.lines).map((line) => (
                    <tr key={text(line.id)}>
                      <td>{text(line.line_number)}</td>
                      <td>{text(line.description)}</td>
                      <td>{text(line.quantity) || "—"}</td>
                      <td>
                        {line.line_total === null
                          ? "—"
                          : money(number(line.line_total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canWrite && (
            <form
              className="form-grid compact-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const response = await fetch(
                  `/api/invoices/${text(row.id)}/lines`,
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(
                      Object.fromEntries(
                        new FormData(event.currentTarget).entries(),
                      ),
                    ),
                  },
                );
                const payload = (await response.json()) as DataRow;
                setMessage(
                  response.ok
                    ? "Partida agregada."
                    : text(payload.error) || "No se pudo agregar la partida.",
                );
                if (response.ok) await onChanged();
              }}
            >
              <h3>Agregar partida</h3>
              <Field label="Descripción" name="description" required />
              <Field label="Cantidad" name="quantity" type="number" />
              <Field label="Precio unitario" name="unitPrice" type="number" />
              <Field label="Total" name="lineTotal" type="number" />
              <button className="primary-button">Agregar</button>
            </form>
          )}
        </>
      )}
      {allocations.length > 0 && (
        <>
          <h3>Aplicaciones</h3>
          <ul>
            {allocations.map((item) => (
              <li key={text(item.id)}>
                {text(item.invoice_number_raw)} · {money(number(item.amount))}
              </li>
            ))}
          </ul>
        </>
      )}
      {canWrite && (mode === "pagos" || mode === "credit-notes") && (
        <form className="form-grid compact-form" onSubmit={apply}>
          <h3>Aplicar a factura</h3>
          <Field label="ID de factura" name="invoiceId" required />
          <Field label="Monto" name="amount" required type="number" />
          <button className="primary-button">Aplicar</button>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  required,
  type = "text",
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input name={name} required={required} step="0.01" type={type} />
    </label>
  );
}

function columns(mode: BillingMode) {
  if (mode === "facturas")
    return [
      { key: "invoiceNumberRaw", label: "Factura" },
      { key: "businessName", label: "Empresa" },
      { key: "issueDate", label: "Fecha" },
      { key: "totalAmount", label: "Total" },
      { key: "balanceAmount", label: "Balance" },
      { key: "status", label: "Estado" },
    ];
  if (mode === "pagos")
    return [
      { key: "receiptNumber", label: "Recibo" },
      { key: "businessName", label: "Empresa" },
      { key: "paymentDate", label: "Fecha" },
      { key: "amount", label: "Monto" },
      { key: "allocatedAmount", label: "Asignado" },
      { key: "status", label: "Estado" },
    ];
  if (mode === "credit-notes")
    return [
      { key: "creditNoteNumberRaw", label: "Nota de crédito" },
      { key: "businessName", label: "Empresa" },
      { key: "issueDate", label: "Fecha" },
      { key: "totalAmount", label: "Total" },
      { key: "appliedAmount", label: "Aplicado" },
      { key: "status", label: "Estado" },
    ];
  if (mode === "receivables")
    return [
      { key: "invoiceNumberRaw", label: "Factura" },
      { key: "businessName", label: "Empresa" },
      { key: "dueDate", label: "Vencimiento" },
      { key: "balanceAmount", label: "Balance" },
      { key: "daysPastDue", label: "Días vencidos" },
      { key: "receivableStatus", label: "Estado" },
    ];
  return [
    { key: "invoiceNumberRaw", label: "Factura" },
    { key: "businessName", label: "Empresa" },
    { key: "activityType", label: "Tipo" },
    { key: "occurredAt", label: "Fecha" },
    { key: "ownerEmail", label: "Responsable" },
    { key: "nextActionAt", label: "Próxima acción" },
  ];
}

function cell(row: DataRow, key: string) {
  const value = row[key];
  if (["amount", "totalAmount", "balanceAmount", "allocatedAmount", "appliedAmount"].includes(key)) {
    return value === null || value === undefined ? "—" : money(number(value));
  }
  if (key === "status" || key === "receivableStatus")
    return statusLabels[text(value)] ?? (text(value) || "—");
  if (key === "activityType")
    return {
      call: "Llamada",
      email: "Correo",
      visit: "Visita",
      promise_to_pay: "Promesa de pago",
      dispute: "Disputa",
      note: "Nota",
      other: "Otro",
    }[text(value)] ?? text(value);
  return text(value) || "—";
}

function sourceLabel(value: string) {
  return (
    {
      issued_document: "Documento emitido",
      matrix: "Matriz",
      manual_resolution: "Resolución manual",
      legacy: "Heredado",
    }[value] ?? "Normalizado"
  );
}

function rowTitle(mode: BillingMode, row: DataRow) {
  return (
    text(
      row[
        mode === "facturas"
          ? "invoiceNumberRaw"
          : mode === "credit-notes"
            ? "creditNoteNumberRaw"
            : mode === "pagos"
              ? "receiptNumber"
              : "invoiceNumberRaw"
      ],
    ) || modeConfig[mode].title
  );
}
function text(value: unknown) {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : String(value);
}
function number(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}
function array(value: unknown): DataRow[] {
  return Array.isArray(value) ? (value as DataRow[]) : [];
}
