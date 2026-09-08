"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, ExternalLink, RotateCcw, Search, Sparkles } from "lucide-react";
import {
  buildCodexPrompt,
  buildCssDiff,
  buildTokenDiff,
  categoryLabel,
  createTokenChanges,
  editorVariableName,
  flattenTokenDocument,
  readStoredDraft,
  tokenValues,
  validateTokenValue,
  type TokenDocument,
  type TokenLeaf,
  type TokenValues,
} from "./design-system-token-utils";

type OutputTab = "prompt" | "tokens" | "css";

const categoryOrder = [
  "color",
  "space",
  "typography",
  "radius",
  "shadow",
  "breakpoint",
  "motion",
  "zIndex",
];

const draftKey = (version: string) => `hidaca:design-token-editor:${version}`;

function parseNumberAndUnit(value: string): { number: string; unit: string } | null {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|vw|vh|ch|ms|s)?$/);
  return match ? { number: match[1], unit: match[2] ?? "" } : null;
}

function simpleColor(value: string): string | null {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : null;
}

function inputLabel(leaf: TokenLeaf): string {
  return leaf.path.split(".").at(-1)?.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`) ?? leaf.path;
}

function TokenField({
  leaf,
  value,
  error,
  changed,
  onChange,
  onReset,
}: {
  leaf: TokenLeaf;
  value: string;
  error?: string;
  changed: boolean;
  onChange(value: string): void;
  onReset(): void;
}) {
  const parsed = parseNumberAndUnit(value);
  const isNumeric = ["length", "duration", "integer", "number"].includes(leaf.inputKind);
  const unitOptions = leaf.inputKind === "duration" ? ["ms", "s"] : ["px", "rem", "em", "%", "vw", "vh", "ch"];
  const color = leaf.inputKind === "color" ? simpleColor(value) : null;

  function updateNumber(nextNumber: string) {
    const defaultUnit = leaf.inputKind === "duration" ? "ms" : leaf.inputKind === "length" ? "px" : "";
    onChange(`${nextNumber}${parsed?.unit ?? defaultUnit}`);
  }

  return (
    <div className={`ds-editor-field${changed ? " is-changed" : ""}${error ? " has-error" : ""}`}>
      <div className="ds-editor-field-heading">
        <label htmlFor={`token-${leaf.path}`}>{inputLabel(leaf)}</label>
        {changed && <span className="ds-editor-changed">Modificado</span>}
      </div>
      <div className="ds-editor-input-row">
        {color && (
          <input
            aria-label={`Selector de color para ${leaf.path}`}
            className="ds-editor-color-input"
            onChange={(event) => onChange(event.target.value)}
            type="color"
            value={color}
          />
        )}
        {isNumeric && parsed ? (
          <>
            <input
              aria-describedby={error ? `error-${leaf.path}` : undefined}
              aria-invalid={Boolean(error)}
              className="ds-editor-value-input"
              id={`token-${leaf.path}`}
              onChange={(event) => updateNumber(event.target.value)}
              type="number"
              value={parsed.number}
            />
            {["length", "duration"].includes(leaf.inputKind) && (
              <select
                aria-label={`Unidad para ${leaf.path}`}
                onChange={(event) => onChange(`${parsed.number}${event.target.value}`)}
                value={parsed.unit}
              >
                {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            )}
          </>
        ) : (
          <input
            aria-describedby={error ? `error-${leaf.path}` : undefined}
            aria-invalid={Boolean(error)}
            className="ds-editor-value-input"
            id={`token-${leaf.path}`}
            onChange={(event) => onChange(event.target.value)}
            type="text"
            value={value}
          />
        )}
        <button
          aria-label={`Restablecer ${leaf.path}`}
          className="ds-editor-reset-token"
          disabled={!changed}
          onClick={onReset}
          title="Restablecer valor"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={13} />
        </button>
      </div>
      <div className="ds-editor-field-meta">
        <code>{leaf.path}</code>
        <span>{leaf.role}</span>
      </div>
      {error && <p className="ds-editor-error" id={`error-${leaf.path}`}>{error}</p>}
    </div>
  );
}

function Preview({ values, leaves }: { values: TokenValues; leaves: TokenLeaf[] }) {
  const [viewport, setViewport] = useState("1024");
  const previewStyle = useMemo(
    () => Object.fromEntries(leaves.map((leaf) => [editorVariableName(leaf.path), values[leaf.path]])) as React.CSSProperties,
    [leaves, values],
  );
  const compactBreakpoint = Number.parseInt(values["breakpoint.compact"] ?? "760", 10) || 760;
  const tabletBreakpoint = Number.parseInt(values["breakpoint.tablet"] ?? "1100", 10) || 1100;
  const narrow = Number(viewport) <= compactBreakpoint;
  const tablet = Number(viewport) <= tabletBreakpoint;
  const v = (path: string) => `var(${editorVariableName(path)})`;

  return (
    <div className="ds-editor-preview-card">
      <div className="ds-editor-panel-heading">
        <div>
          <p className="eyebrow">Vista previa en vivo</p>
          <h2>Prueba el lenguaje antes de aplicarlo</h2>
        </div>
        <label className="ds-editor-viewport-control">
          <span>Viewport simulado</span>
          <select aria-label="Viewport simulado" onChange={(event) => setViewport(event.target.value)} value={viewport}>
            <option value="390">390px · móvil</option>
            <option value="760">760px · compacto</option>
            <option value="1024">1024px · tablet</option>
            <option value="1440">1440px · desktop</option>
          </select>
        </label>
      </div>
      <div className="ds-editor-preview-frame" style={previewStyle}>
        <div className="ds-editor-preview-brand">
          <span className="ds-brand-mark">H</span>
          <div><strong>HIDACA</strong><small>Operaciones</small></div>
          <span className="ds-editor-preview-mode">{narrow ? "Móvil" : tablet ? "Tablet" : "Desktop"}</span>
        </div>
        <div className="ds-editor-preview-heading">
          <div><p className="eyebrow">Registro / Empresa</p><h3>Casa Mirador</h3><p>Una superficie de trabajo para revisar contexto y siguiente acción.</p></div>
          <button className="primary-button" type="button">Nueva acción</button>
        </div>
        <div className={`ds-editor-preview-grid${narrow ? " is-narrow" : ""}`}>
          <article className="ds-editor-preview-panel">
            <span className="ds-editor-preview-label">Tipografía</span>
            <strong style={{ color: v("color.text.heading"), fontFamily: v("typography.fontFamily"), fontSize: v("typography.size.xl") }}>Decisiones claras</strong>
            <p style={{ color: v("color.text.secondary"), lineHeight: v("typography.lineHeight.body") }}>El contenido permanece legible mientras los estados y las acciones conservan jerarquía.</p>
          </article>
          <article className="ds-editor-preview-panel">
            <span className="ds-editor-preview-label">Estados</span>
            <div className="ds-editor-preview-badges"><span className="status-badge status-success">Aprobada</span><span className="status-badge status-warning">En revisión</span><span className="status-badge status-danger">Vencida</span></div>
            <div className="ds-editor-preview-actions"><button className="primary-button" type="button">Guardar</button><button className="secondary-button" type="button">Cancelar</button></div>
          </article>
        </div>
        <div className="ds-editor-preview-metrics">
          <div><small>Espaciado grande</small><strong>{values["space.lg"]}</strong><i style={{ background: v("color.action.primary"), height: v("space.xs"), width: v("space.lg") }} /></div>
          <div><small>Radio de tarjeta</small><strong>{values["radius.lg"]}</strong><i className="ds-editor-radius-demo" style={{ borderRadius: v("radius.lg") }} /></div>
          <div><small>Elevación</small><strong>shadow.xs</strong><i className="ds-editor-shadow-demo" style={{ boxShadow: v("shadow.xs") }} /></div>
        </div>
        <div className="ds-editor-preview-layers">
          <span>Capas</span>
          <i style={{ background: v("color.brand.tint"), zIndex: Number(values["zIndex.sticky"] ?? 20) }}>Sticky · {values["zIndex.sticky"]}</i>
          <i style={{ background: v("color.brand.goldLight"), zIndex: Number(values["zIndex.popover"] ?? 80) }}>Popover · {values["zIndex.popover"]}</i>
          <i style={{ background: v("color.brand.primary"), color: v("color.text.onBrand"), zIndex: Number(values["zIndex.modal"] ?? 100) }}>Modal · {values["zIndex.modal"]}</i>
        </div>
      </div>
    </div>
  );
}

export function DesignSystemTokenEditor({ document: tokenDocument }: { document: TokenDocument }) {
  const leaves = useMemo(() => flattenTokenDocument(tokenDocument), [tokenDocument]);
  const defaults = useMemo(() => tokenValues(leaves), [leaves]);
  const storageKey = draftKey(tokenDocument.version);
  const [values, setValues] = useState<TokenValues>(defaults);
  const [query, setQuery] = useState("");
  const [outputTab, setOutputTab] = useState<OutputTab>("prompt");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(["color", "typography"]));
  const [copyStatus, setCopyStatus] = useState("");
  const [storageStatus, setStorageStatus] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const outputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = readStoredDraft(typeof window === "undefined" ? null : window.localStorage, storageKey, tokenDocument.version, defaults);
    const timer = window.setTimeout(() => {
      setValues(stored.values);
      if (stored.discarded) setStorageStatus("El borrador anterior fue descartado porque cambió la versión de tokens.");
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaults, storageKey, tokenDocument.version]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ values, version: tokenDocument.version }));
    } catch {
      window.setTimeout(() => setStorageStatus("No se pudo guardar el borrador local en este navegador."), 0);
    }
  }, [hydrated, storageKey, tokenDocument.version, values]);

  const changes = useMemo(() => createTokenChanges(leaves, values), [leaves, values]);
  const errors = useMemo(
    () => Object.fromEntries(leaves.map((leaf) => [leaf.path, validateTokenValue(leaf, values[leaf.path] ?? "")])),
    [leaves, values],
  );
  const invalidCount = Object.values(errors).filter(Boolean).length;
  const output = outputTab === "prompt"
    ? buildCodexPrompt(tokenDocument, changes)
    : outputTab === "tokens"
      ? buildTokenDiff(changes)
      : buildCssDiff(changes);
  const canExport = changes.length > 0 && invalidCount === 0;
  const groups = categoryOrder.map((category) => ({
    category,
    leaves: leaves.filter((leaf) => {
      if (leaf.category !== category) return false;
      const normalized = query.toLowerCase().trim();
      return !normalized || `${leaf.path} ${leaf.role} ${leaf.value}`.toLowerCase().includes(normalized);
    }),
  })).filter((group) => group.leaves.length > 0);

  function update(path: string, next: string) {
    setValues((current) => ({ ...current, [path]: next }));
  }

  function resetAll() {
    setValues(defaults);
    setCopyStatus("");
  }

  function resetGroup(category: string) {
    setValues((current) => {
      const next = { ...current };
      for (const leaf of leaves) if (leaf.category === category) next[leaf.path] = leaf.value;
      return next;
    });
  }

  async function copyOutput() {
    if (!canExport) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(output);
      copied = true;
    } catch {
      const target = outputRef.current;
      if (target) {
        target.focus();
        target.select();
        copied = document.execCommand("copy");
      }
    }
    setCopyStatus(copied ? "Copiado al portapapeles." : "Selecciona el texto para copiarlo manualmente.");
  }

  return (
    <main className="ds-editor-shell">
      <header className="ds-editor-hero">
        <div className="ds-editor-nav">
          <a href="/design-system"><span className="ds-brand-mark">H</span><span><strong>HIDACA</strong><small>Sistema de diseño</small></span></a>
          <div><a href="/design-system">Showcase <ExternalLink aria-hidden="true" size={14} /></a><span>Desarrollo solamente</span></div>
        </div>
        <div className="ds-editor-hero-copy">
          <p className="eyebrow">HIDACA / Token editor</p>
          <h1>Ajusta el sistema. Exporta la decisión.</h1>
          <p>Edita los valores normalizados, comprueba el efecto en una vista operativa y copia un prompt listo para que Codex aplique el cambio con contexto.</p>
        </div>
      </header>

      <div className="ds-editor-content">
        <div className="ds-editor-toolbar">
          <div><strong>{changes.length}</strong><span>cambios pendientes</span>{invalidCount > 0 && <em>{invalidCount} inválidos</em>}</div>
          <div className="ds-editor-toolbar-actions"><span>v{tokenDocument.version}</span><button className="secondary-button" disabled={changes.length === 0} onClick={resetAll} type="button"><RotateCcw aria-hidden="true" size={14} /> Restablecer todo</button></div>
        </div>
        {storageStatus && <p className="ds-editor-notice" role="status">{storageStatus}</p>}
        <div className="ds-editor-layout">
          <aside className="ds-editor-controls ds-editor-card">
            <div className="ds-editor-panel-heading"><div><p className="eyebrow">Valores preestablecidos</p><h2>Controles</h2></div><span>{leaves.length} tokens</span></div>
            <label className="ds-editor-search"><Search aria-hidden="true" size={16} /><span className="sr-only">Buscar tokens</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por token o uso" type="search" value={query} /></label>
            <div className="ds-editor-groups">
              {groups.map((group) => {
                const open = query.trim() ? true : openGroups.has(group.category);
                return <section className="ds-editor-group" key={group.category}>
                  <div className="ds-editor-group-heading"><button aria-expanded={open} onClick={() => setOpenGroups((current) => { const next = new Set(current); if (next.has(group.category)) next.delete(group.category); else next.add(group.category); return next; })} type="button"><span>{categoryLabel(group.category)}</span><b>{group.leaves.length}</b></button><button aria-label={`Restablecer ${categoryLabel(group.category)}`} className="ds-editor-reset-group" disabled={!changes.some((change) => change.path.startsWith(`${group.category}.`))} onClick={() => resetGroup(group.category)} type="button"><RotateCcw aria-hidden="true" size={13} /></button></div>
                  {open && <div className="ds-editor-fields">{group.leaves.map((leaf) => <TokenField changed={values[leaf.path] !== leaf.value} error={validateTokenValue(leaf, values[leaf.path] ?? "") ?? undefined} key={leaf.path} leaf={leaf} onChange={(next) => update(leaf.path, next)} onReset={() => update(leaf.path, leaf.value)} value={values[leaf.path] ?? ""} />)}</div>}
                </section>;
              })}
              {groups.length === 0 && <p className="ds-editor-empty">No hay tokens que coincidan con “{query}”.</p>}
            </div>
          </aside>

          <section className="ds-editor-main-column">
            <Preview leaves={leaves} values={values} />
            <section className="ds-editor-output ds-editor-card">
              <div className="ds-editor-panel-heading"><div><p className="eyebrow">Salida para Codex</p><h2>Lo que cambió</h2></div><button className="primary-button" disabled={!canExport} onClick={() => void copyOutput()} type="button"><Clipboard aria-hidden="true" size={15} /> Copiar salida</button></div>
              <div className="ds-editor-tabs" role="tablist" aria-label="Formato de salida">
                {([ ["prompt", "Prompt Codex"], ["tokens", "Diff tokens"], ["css", "Diff CSS"] ] as Array<[OutputTab, string]>).map(([tab, label]) => <button aria-selected={outputTab === tab} className={outputTab === tab ? "active" : ""} key={tab} onClick={() => setOutputTab(tab)} role="tab" type="button">{label}</button>)}
              </div>
              <textarea aria-label="Salida generada" className="ds-editor-output-text" readOnly ref={outputRef} value={output} />
              <div className="ds-editor-output-footer"><span>{invalidCount > 0 ? "Corrige los valores inválidos antes de copiar." : changes.length > 0 ? `${changes.length} cambio${changes.length === 1 ? "" : "s"} listo${changes.length === 1 ? "" : "s"} para exportar.` : "Ajusta un valor para generar una salida."}</span>{copyStatus && <span className="ds-editor-copy-status" role="status"><Check aria-hidden="true" size={14} /> {copyStatus}</span>}</div>
            </section>
          </section>
        </div>
      </div>
      <div className="ds-editor-footer"><span><Sparkles aria-hidden="true" size={15} /> El editor sólo guarda borradores en este navegador.</span><a href="/app">Volver a Operaciones <ExternalLink aria-hidden="true" size={14} /></a></div>
    </main>
  );
}
