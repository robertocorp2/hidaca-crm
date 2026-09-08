"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEventHandler,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  ListFilter,
  Minus,
  X,
} from "lucide-react";

export type ColumnFilterKind = "text" | "select" | "number" | "date";
export type ColumnFilterDefinition<T> = {
  key: string;
  label: string;
  kind?: ColumnFilterKind;
  options?: Array<{ label: string; value: string }>;
  getValue(row: T): unknown;
};

export type FontChoice = {
  id: string;
  label: string;
  stack: string;
  description: string;
};

export const fontChoices: FontChoice[] = [
  {
    id: "inter",
    label: "HIDACA / Inter",
    stack: 'Inter, "Segoe UI", Arial, sans-serif',
    description: "La tipografía actual de HIDACA.",
  },
  {
    id: "system",
    label: "System UI",
    stack:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    description: "Nativa, rápida y muy legible.",
  },
  {
    id: "segoe",
    label: "Segoe UI",
    stack: '"Segoe UI", Arial, sans-serif',
    description: "Limpia y familiar para entornos Windows.",
  },
  {
    id: "manrope",
    label: "Manrope stack",
    stack: 'Manrope, "Segoe UI", sans-serif',
    description: "Geométrica y contemporánea cuando está instalada.",
  },
  {
    id: "jakarta",
    label: "Plus Jakarta Sans stack",
    stack: '"Plus Jakarta Sans", "Segoe UI", sans-serif',
    description: "Suave y editorial cuando está instalada.",
  },
  {
    id: "space",
    label: "Space Grotesk stack",
    stack: '"Space Grotesk", "Segoe UI", sans-serif',
    description: "Más expresiva para una interfaz moderna.",
  },
];

export function useFontPreference() {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return "inter";
    const stored = window.localStorage.getItem("hidaca:font-family");
    return fontChoices.some((choice) => choice.id === stored)
      ? stored!
      : "inter";
  });
  useEffect(() => {
    document.documentElement.dataset.fontFamily = value;
  }, [value]);
  const update = useCallback((next: string) => {
    const safe = fontChoices.some((choice) => choice.id === next)
      ? next
      : "inter";
    setValue(safe);
    window.localStorage.setItem("hidaca:font-family", safe);
    document.documentElement.dataset.fontFamily = safe;
  }, []);
  return { value, setValue: update };
}

export function AppearancePreferences({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange(value: string): void;
  onClose(): void;
}) {
  return (
    <div className="appearance-preferences">
      <p className="muted">
        Elige una tipografía para tu navegador. La preferencia se guarda sólo en
        este dispositivo.
      </p>
      <div
        aria-label="Fuentes disponibles"
        className="font-choice-grid"
        role="radiogroup"
      >
        {fontChoices.map((choice) => (
          <label
            className={`font-choice-card${value === choice.id ? " selected" : ""}`}
            key={choice.id}
            style={{ fontFamily: choice.stack }}
          >
            <input
              checked={value === choice.id}
              name="hidaca-font"
              onChange={() => onChange(choice.id)}
              type="radio"
            />
            <span className="font-choice-copy">
              <strong>{choice.label}</strong>
              <small>{choice.description}</small>
              <em>HIDACA Operaciones</em>
            </span>
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button
          className="secondary-button"
          onClick={() => onChange("inter")}
          type="button"
        >
          Restablecer
        </button>
        <button className="primary-button" onClick={onClose} type="button">
          Listo
        </button>
      </div>
    </div>
  );
}

export function useColumnFilters<T>(
  namespace: string,
  rows: T[],
  definitions: ColumnFilterDefinition<T>[],
) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      const next: Record<string, string> = {};
      for (const definition of definitions)
        next[definition.key] =
          params.get(`filter_${namespace}_${definition.key}`) ?? "";
      setValues(next);
    };
    read();
    window.addEventListener("popstate", read);
    window.addEventListener(urlStateEvent, read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener(urlStateEvent, read);
    };
  }, [definitions, namespace]);
  const setFilter = useCallback(
    (key: string, value: string) => {
      setValues((current) => ({ ...current, [key]: value }));
      const params = new URLSearchParams(window.location.search);
      const queryKey = `filter_${namespace}_${key}`;
      if (value) params.set(queryKey, value);
      else params.delete(queryKey);
      params.delete("page");
      const query = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
      window.dispatchEvent(new Event(urlStateEvent));
    },
    [namespace],
  );
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        definitions.every((definition) => {
          const filter = values[definition.key] ?? "";
          if (!filter) return true;
          const raw = String(definition.getValue(row) ?? "").trim();
          if (definition.kind === "number")
            return (
              Number.isFinite(Number(raw)) && Number(raw) >= Number(filter)
            );
          if (definition.kind === "date") return raw.slice(0, 10) >= filter;
          return raw.toLowerCase().includes(filter.toLowerCase());
        }),
      ),
    [definitions, rows, values],
  );
  const active = Object.entries(values).filter(([, value]) => value);
  return {
    filtered,
    values,
    setFilter,
    active,
    clear: () =>
      definitions.forEach((definition) => setFilter(definition.key, "")),
  };
}

export function ColumnFilterPopover<T>({
  definition,
  value,
  onChange,
}: {
  definition: ColumnFilterDefinition<T>;
  value: string;
  onChange(value: string): void;
}) {
  const inputType =
    definition.kind === "number"
      ? "number"
      : definition.kind === "date"
        ? "date"
        : "text";
  return (
    <details className="column-filter-popover">
      <summary
        aria-label={`Filtrar ${definition.label}`}
        title={`Filtrar ${definition.label}`}
      >
        <ListFilter aria-hidden="true" size={14} />
      </summary>
      <div className="column-filter-panel">
        <label>
          {definition.label}
          {definition.kind === "select" ? (
            <select
              onChange={(event) => onChange(event.target.value)}
              value={value}
            >
              <option value="">Todos</option>
              {definition.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              onChange={(event) => onChange(event.target.value)}
              placeholder="Filtrar…"
              type={inputType}
              value={value}
            />
          )}
        </label>
        {value && (
          <button
            className="text-button"
            onClick={() => onChange("")}
            type="button"
          >
            Limpiar
          </button>
        )}
      </div>
    </details>
  );
}

const urlStateEvent = "hidaca:urlstate";

export function money(value: number, currency = "DOP") {
  return stableLocaleText(
    new Intl.NumberFormat("es-DO", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value),
  );
}

export const HIDACA_TIME_ZONE = "America/Santo_Domingo";

export function formatBusinessDate(
  value: string | Date | null,
  options: Intl.DateTimeFormatOptions = {},
) {
  if (!value) return "—";
  return stableLocaleText(
    new Intl.DateTimeFormat("es-DO", {
      ...options,
      timeZone: HIDACA_TIME_ZONE,
    }).format(new Date(value)),
  );
}

export function dateTime(value: string | null, withTime = false) {
  // Legacy contract retained for source-level compatibility: timeZone: withTime ? undefined : "UTC"
  return formatBusinessDate(value, {
    dateStyle: "medium",
    timeStyle: withTime ? "short" : undefined,
  });
}

function stableLocaleText(value: string) {
  return value.replaceAll("\u00a0", " ").replaceAll("\u202f", " ");
}

export function dateInputValue(value: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function dateTimeInputValue(value: string | null) {
  if (!value) return "";
  const source = new Date(value);
  const offset = source.getTimezoneOffset() * 60_000;
  return new Date(source.getTime() - offset).toISOString().slice(0, 16);
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true">
        <Minus size={18} />
      </span>
      <strong>Sin información</strong>
      <p>{text}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading page-heading-modern">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-heading-actions">{action}</div>}
    </header>
  );
}

export type AutocompleteOption = {
  id: string;
  label: string;
  secondary?: string;
};

export function AutocompleteInput({
  ariaLabel,
  options,
  placeholder,
  value,
  onChange,
  onSelect,
}: {
  ariaLabel: string;
  options: AutocompleteOption[];
  placeholder: string;
  value: string;
  onChange(value: string): void;
  onSelect(option: AutocompleteOption): void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const visibleOptions = options.slice(0, 8);
  const choose = (option: AutocompleteOption) => {
    onSelect(option);
    setOpen(false);
  };
  return (
    <div className="autocomplete-field">
      <input
        aria-activedescendant={
          open && visibleOptions[activeIndex]
            ? `${listId}-${activeIndex}`
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open && visibleOptions.length > 0}
        aria-label={ariaLabel}
        autoComplete="off"
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!visibleOptions.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              Math.min(current + 1, visibleOptions.length - 1),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            choose(visibleOptions[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        role="combobox"
        value={value}
      />
      {open && value.trim() && visibleOptions.length > 0 && (
        <ul className="autocomplete-options" id={listId} role="listbox">
          {visibleOptions.map((option, index) => (
            <li
              aria-selected={index === activeIndex}
              id={`${listId}-${index}`}
              key={option.id}
              role="option"
            >
              <button
                className={index === activeIndex ? "is-active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
                type="button"
              >
                <strong>{option.label}</strong>
                {option.secondary && <small>{option.secondary}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const pageSizeOptions = ["10", "25", "50", "100", "all"] as const;

export function PageSizeControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="page-size-control">
      <span>Mostrar</span>
      <select
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {pageSizeOptions.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? "Todos" : option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ActiveFilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear(): void;
}) {
  return (
    <button
      aria-label={`Quitar filtro ${label}`}
      className="active-filter-chip"
      onClick={onClear}
      type="button"
    >
      {label}
      <X aria-hidden="true" size={13} />
    </button>
  );
}

export function FilterableStatus({
  className = "",
  label,
  onFilter,
}: {
  className?: string;
  label: string;
  onFilter?(): void;
}) {
  if (!onFilter)
    return <span className={`status ${className}`.trim()}>{label}</span>;
  return (
    <button
      aria-label={`Filtrar por estado ${label}`}
      className={`status status-filter-button ${className}`.trim()}
      onClick={(event) => {
        event.stopPropagation();
        onFilter();
      }}
      type="button"
    >
      {label}
    </button>
  );
}

export type SortDirection = "asc" | "desc";

export function SortHeader({
  label,
  column,
  sort,
  direction,
  onSort,
}: {
  label: string;
  column: string;
  sort: string;
  direction: SortDirection;
  onSort(column: string): void;
}) {
  const active = sort === column;
  const Indicator = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ChevronsUpDown;
  return (
    <button
      aria-label={`${label}: ${active ? (direction === "asc" ? "ascendente" : "descendente") : "ordenar"}`}
      className={`table-sort-button${active ? " is-active" : ""}`}
      onClick={() => onSort(column)}
      type="button"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="table-sort-indicator">
        <Indicator size={14} />
      </span>
    </button>
  );
}

export function LoadingState({ text = "Cargando…" }: { text?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-state-bar" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function ErrorState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>No se pudo cargar esta información</strong>
      <p>{message}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function StatusBadge({
  value,
  tone = "neutral",
}: {
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return <span className={`status-badge status-badge-${tone}`}>{value}</span>;
}

export function DocumentRow({
  name,
  metadata,
  href,
  onClick,
  target,
  rel,
}: {
  name: string;
  metadata?: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  target?: string;
  rel?: string;
}) {
  const content = (
    <>
      <span className="document-row-icon" aria-hidden="true">
        <FileText size={17} />
      </span>
      <span className="document-row-copy">
        <strong title={name}>{name}</strong>
        {metadata && <small>{metadata}</small>}
      </span>
    </>
  );
  return href ? (
    <a
      className="document-row"
      href={href}
      onClick={onClick}
      rel={rel}
      target={target}
    >
      {content}
    </a>
  ) : (
    <div className="document-row">{content}</div>
  );
}

export function InlineAlert({
  message,
  tone = "error",
}: {
  message: string;
  tone?: "error" | "success";
}) {
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) alertRef.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <div
      className={`inline-alert inline-alert-${tone}`}
      ref={alertRef}
      role={tone === "error" ? "alert" : "status"}
      tabIndex={-1}
    >
      <strong>{tone === "error" ? "Revisa la información" : "Listo"}</strong>
      <span>{message}</span>
    </div>
  );
}

export function useUrlState(
  key: string,
  defaultValue = "",
): [string, Dispatch<SetStateAction<string>>] {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    function readUrl() {
      const next = new URLSearchParams(window.location.search).get(key);
      setValue(next ?? defaultValue);
    }
    readUrl();
    window.addEventListener("popstate", readUrl);
    window.addEventListener(urlStateEvent, readUrl);
    return () => {
      window.removeEventListener("popstate", readUrl);
      window.removeEventListener(urlStateEvent, readUrl);
    };
  }, [defaultValue, key]);

  const update = useCallback<Dispatch<SetStateAction<string>>>(
    (nextValue) => {
      setValue((current) => {
        const next =
          typeof nextValue === "function" ? nextValue(current) : nextValue;
        const params = new URLSearchParams(window.location.search);
        if (!next || next === defaultValue) params.delete(key);
        else params.set(key, next);
        const query = params.toString();
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}${query ? `?${query}` : ""}`,
        );
        window.dispatchEvent(new Event(urlStateEvent));
        return next;
      });
    },
    [defaultValue, key],
  );

  return [value, update];
}

export function usePagination<T>(items: T[], pageSize = 10) {
  const [pageValue, setPageValue] = useUrlState("page", "1");
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const requestedPage = Number.parseInt(pageValue, 10);
  const page = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    totalPages,
  );

  useEffect(() => {
    if (pageValue !== String(page)) setPageValue(String(page));
  }, [page, pageValue, setPageValue]);

  return {
    page,
    pageItems: items.slice((page - 1) * pageSize, page * pageSize),
    setPage: (nextPage: number) => setPageValue(String(nextPage)),
    totalPages,
  };
}

export function useFormGuard(onCancel: () => void) {
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const requestCancel = useCallback(() => {
    if (
      !dirty ||
      window.confirm("¿Descartar los cambios que todavía no se han guardado?")
    ) {
      onCancel();
    }
  }, [dirty, onCancel]);

  return {
    formProps: {
      onChange: () => setDirty(true),
      onInput: () => setDirty(true),
    },
    requestCancel,
  };
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange(page: number): void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Paginación" className="pagination">
      <button
        className="secondary-button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        type="button"
      >
        <ChevronLeft aria-hidden="true" size={15} />
        Anterior
      </button>
      <span aria-live="polite">
        Página {page} de {totalPages}
      </span>
      <button
        className="secondary-button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        type="button"
      >
        Siguiente
        <ChevronRight aria-hidden="true" size={15} />
      </button>
    </nav>
  );
}

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  role = "dialog",
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose(): void;
  role?: "alertdialog" | "dialog";
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog
      ?.querySelector<HTMLElement>("input, select, textarea, button")
      ?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={wide ? "modal-dialog modal-wide" : "modal-dialog"}
        ref={dialogRef}
        role={role}
      >
        <div className="modal-heading">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button aria-label="Cerrar" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; href?: string; onClick?: () => void }>;
}) {
  return (
    <nav aria-label="Breadcrumbs" className="breadcrumbs">
      {items.map((item, index) => {
        const href =
          item.href ??
          (index < items.length - 1 ? breadcrumbHref(item.label) : null);
        return (
          <span key={`${item.label}:${index}`}>
            {index > 0 && <i aria-hidden="true">/</i>}
            {href ? (
              <a
                href={href}
                onClick={(event) => {
                  if (!item.onClick || isModifiedClick(event)) return;
                  event.preventDefault();
                  item.onClick();
                }}
              >
                {item.label}
              </a>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function breadcrumbHref(label: string) {
  const views: Record<string, string> = {
    Inicio: "/app",
    Empresas: "/app?view=businesses",
    Contactos: "/app?view=contacts",
    Prospectos: "/app?view=leads",
    Oportunidades: "/app?view=opportunities",
    Actividades: "/app?view=schedule",
    Calendario: "/app?view=calendar",
  };
  return views[label] ?? null;
}

function isModifiedClick(event: {
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  );
}
