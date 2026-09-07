"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

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

export function dateTime(value: string | null, withTime = false) {
  if (!value) return "—";
  return stableLocaleText(
    new Intl.DateTimeFormat("es-DO", {
      dateStyle: "medium",
      timeStyle: withTime ? "short" : undefined,
      timeZone: withTime ? undefined : "UTC",
    }).format(new Date(value)),
  );
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
  return <EmptyState title="Sin información" description={text} action={action} />;
}

export function EmptyState({
  title,
  description,
  action,
  icon = "—",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function LoadingState({ text = "Cargando…" }: { text?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-state-mark" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <strong>No se pudo cargar la información</strong>
      <p>{message}</p>
      {onRetry && (
        <button className="secondary-button" onClick={onRetry} type="button">
          Reintentar
        </button>
      )}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-card ${className}`.trim()}>
      {(title || description || actions) && (
        <div className="section-card-heading">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="section-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function RecordField({
  label,
  value,
  href,
  empty = "No disponible",
}: {
  label: string;
  value?: ReactNode;
  href?: string;
  empty?: string;
}) {
  const content = value || <span className="record-field-empty">{empty}</span>;
  return (
    <div className="record-field">
      <dt>{label}</dt>
      <dd>{href ? <a href={href}>{content}</a> : content}</dd>
    </div>
  );
}

export function RecordHeader({
  eyebrow,
  title,
  subtitle,
  avatar,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  avatar: string;
  actions?: ReactNode;
}) {
  return (
    <div className="record-header">
      <div className="record-heading">
        <span className="record-avatar" aria-hidden="true">
          {avatar}
        </span>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 title={title}>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="record-header-actions">{actions}</div>}
    </div>
  );
}

export function RecordActions({ children }: { children: ReactNode }) {
  return <div className="record-actions">{children}</div>;
}

export function RelatedTabs({
  items,
  active,
  onChange,
}: {
  items: Array<{ key: string; label: string; count?: number }>;
  active: string;
  onChange(key: string): void;
}) {
  return (
    <div className="related-tabs" role="tablist" aria-label="Información relacionada">
      {items.map((item) => (
        <button
          aria-selected={item.key === active}
          className={item.key === active ? "active" : undefined}
          key={item.key}
          onClick={() => onChange(item.key)}
          role="tab"
          type="button"
        >
          <span>{item.label}</span>
          {item.count !== undefined && <small>{item.count}</small>}
        </button>
      ))}
    </div>
  );
}

export function RelatedListItem({
  title,
  meta,
  href,
  onClick,
}: {
  title: string;
  meta?: string;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <strong>{title}</strong>
      {meta && <small>{meta}</small>}
    </>
  );
  return (
    <li className="related-list-item">
      {href ? (
        <a href={href}>{content}</a>
      ) : onClick ? (
        <button onClick={onClick} type="button">
          {content}
        </button>
      ) : (
        <span>{content}</span>
      )}
    </li>
  );
}

export function DocumentRow({
  name,
  originalName,
  contentType,
  extension,
  size,
  createdAt,
  href,
}: {
  name: string;
  originalName?: string;
  contentType?: string;
  extension?: string;
  size?: number;
  createdAt?: string;
  href?: string;
}) {
  const displayName = originalName || name;
  const fileExtension = (extension || displayName.split(".").pop() || "FILE").toUpperCase();
  const metadata = [
    contentType || fileExtension,
    size !== undefined ? formatBytes(size) : "",
    createdAt ? dateTime(createdAt) : "",
  ].filter(Boolean).join(" • ");
  return (
    <article className="document-row">
      <span className="file-icon" aria-hidden="true">{fileExtension.slice(0, 4)}</span>
      <div className="document-row-copy" title={displayName}>
        <strong>{displayName}</strong>
        {metadata && <small>{metadata}</small>}
      </div>
      {href && (
        <a className="text-button" href={href} aria-label={`Abrir ${displayName}`}>
          Abrir
        </a>
      )}
    </article>
  );
}

export function OverflowMenu({
  label = "Más acciones",
  items,
}: {
  label?: string;
  items: Array<{ label: string; onSelect(): void; danger?: boolean; disabled?: boolean }>;
}) {
  return (
    <details className="overflow-menu">
      <summary aria-label={label}>•••</summary>
      <div role="menu">
        {items.map((item) => (
          <button
            className={item.danger ? "danger-menu-item" : undefined}
            disabled={item.disabled}
            key={item.label}
            onClick={item.onSelect}
            role="menuitem"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
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
      </button>
    </nav>
  );
}

export function Modal({
  title,
  eyebrow,
  description,
  children,
  onClose,
  role = "dialog",
  wide = false,
  footer,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  onClose(): void;
  role?: "alertdialog" | "dialog";
  wide?: boolean;
  footer?: ReactNode;
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
        aria-describedby={description ? `${titleId}-description` : undefined}
        aria-modal="true"
        className={wide ? "modal-dialog modal-wide" : "modal-dialog"}
        ref={dialogRef}
        role={role}
      >
        <div className="modal-heading">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={titleId}>{title}</h2>
            {description && (
              <p className="modal-description" id={`${titleId}-description`}>
                {description}
              </p>
            )}
          </div>
          <button aria-label="Cerrar" onClick={onClose} type="button">
            ×
          </button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </section>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
