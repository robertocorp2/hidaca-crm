export type TokenDocument = {
  name: string;
  version: string;
  [key: string]: unknown;
};

export type TokenInputKind =
  | "color"
  | "length"
  | "duration"
  | "integer"
  | "number"
  | "shadow"
  | "text";

export type TokenLeaf = {
  category: string;
  key: string;
  path: string;
  role: string;
  value: string;
  inputKind: TokenInputKind;
};

export type TokenValues = Record<string, string>;

export type TokenChange = {
  after: string;
  before: string;
  cssVariables: string[];
  path: string;
  role: string;
};

export type StoredTokenDraft = {
  values: TokenValues;
  version: string;
};

const runtimeCssVariables: Record<string, string[]> = {
  "color.brand.forest": ["--green-950"],
  "color.brand.deep": ["--green-900"],
  "color.brand.primary": ["--green-700"],
  "color.brand.primaryHover": ["--green-800"],
  "color.brand.tint": ["--green-100"],
  "color.brand.gold": ["--gold"],
  "color.brand.goldLight": ["--gold-light"],
  "color.background.canvas": ["--color-background-canvas", "--canvas"],
  "color.background.surface": ["--color-background-surface", "--surface"],
  "color.text.primary": ["--color-text", "--ink"],
  "color.text.heading": ["--color-text-heading", "--green-950"],
  "color.text.secondary": ["--color-text-secondary", "--muted"],
  "color.text.onBrand": ["--color-text-on-brand"],
  "color.border.default": ["--color-border", "--line"],
  "color.border.strong": ["--color-border-strong"],
  "color.border.focus": ["--color-border-focus"],
  "color.action.primary": ["--color-primary"],
  "color.action.primaryHover": ["--color-primary-hover"],
  "color.action.danger": ["--color-action-danger", "--color-danger", "--danger"],
  "color.status.success": ["--color-success"],
  "color.status.warning": ["--color-warning"],
  "color.status.danger": ["--color-danger", "--danger"],
  "color.status.info": ["--color-info"],
  "space.2xs": ["--space-1"],
  "space.xs": ["--space-2"],
  "space.sm": ["--space-3"],
  "space.md": ["--space-4"],
  "space.lg": ["--space-5"],
  "space.xl": ["--space-6"],
  "radius.sm": ["--radius-sm"],
  "radius.md": ["--radius-md"],
  "radius.lg": ["--radius-lg"],
  "radius.pill": ["--radius-pill"],
  "shadow.xs": ["--shadow-xs"],
  "motion.fast": ["--motion-fast"],
  "motion.normal": ["--motion-normal"],
};

const categoryLabels: Record<string, string> = {
  color: "Colores",
  space: "Espaciado",
  typography: "Tipografía",
  radius: "Radios",
  shadow: "Sombras",
  breakpoint: "Breakpoints",
  motion: "Motion",
  zIndex: "Z-index",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferInputKind(path: string, value: string): TokenInputKind {
  if (path.startsWith("color.")) return "color";
  if (path.startsWith("shadow.")) return "shadow";
  if (path.startsWith("zIndex.")) return "integer";
  if (path.includes("weight.")) return "integer";
  if (path.includes("lineHeight.")) return "number";
  if (path.startsWith("motion.fast") || path.startsWith("motion.normal")) {
    return "duration";
  }
  if (
    path.startsWith("space.") ||
    path.startsWith("radius.") ||
    path.startsWith("breakpoint.") ||
    (path.startsWith("typography.size.") && !value.includes("clamp"))
  ) {
    return "length";
  }
  return "text";
}

export function flattenTokenDocument(document: TokenDocument): TokenLeaf[] {
  const leaves: TokenLeaf[] = [];

  function visit(value: unknown, segments: string[]) {
    if (!isRecord(value)) return;
    if (typeof value.value === "string") {
      const path = segments.join(".");
      leaves.push({
        category: segments[0] ?? "other",
        inputKind: inferInputKind(path, value.value),
        key: segments.at(-1) ?? path,
        path,
        role: typeof value.role === "string" ? value.role : "",
        value: value.value,
      });
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, [...segments, key]);
  }

  visit(document, []);
  return leaves;
}

export function tokenValues(leaves: TokenLeaf[]): TokenValues {
  return Object.fromEntries(leaves.map((leaf) => [leaf.path, leaf.value]));
}

export function categoryLabel(category: string): string {
  return categoryLabels[category] ?? category;
}

export function runtimeVariablesFor(path: string): string[] {
  return runtimeCssVariables[path] ?? [];
}

export function createTokenChanges(
  leaves: TokenLeaf[],
  current: TokenValues,
): TokenChange[] {
  return leaves
    .filter((leaf) => current[leaf.path] !== leaf.value)
    .map((leaf) => ({
      after: current[leaf.path] ?? "",
      before: leaf.value,
      cssVariables: runtimeVariablesFor(leaf.path),
      path: leaf.path,
      role: leaf.role,
    }));
}

export function validateTokenValue(leaf: TokenLeaf, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "El valor no puede estar vacío.";
  if (leaf.inputKind === "integer" && !/^-?\d+$/.test(trimmed)) {
    return "Usa un número entero.";
  }
  if (leaf.inputKind === "number" && !/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return "Usa un número válido, por ejemplo 1.55.";
  }
  if (leaf.inputKind === "length" && !/^(?:0|(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vw|vh|ch))$/.test(trimmed) && !trimmed.startsWith("clamp(")) {
    return "Usa una medida CSS válida, por ejemplo 16px.";
  }
  if (leaf.inputKind === "duration" && !/^(?:0|(?:\d+\.?\d*|\.\d+)(?:ms|s))$/.test(trimmed)) {
    return "Usa una duración válida, por ejemplo 180ms.";
  }
  if (leaf.inputKind === "color" && typeof CSS !== "undefined" && !CSS.supports("color", trimmed)) {
    return "Usa un color CSS válido, por ejemplo #0c6747 o rgba(...).";
  }
  if (leaf.inputKind === "shadow" && typeof CSS !== "undefined" && !CSS.supports("box-shadow", trimmed)) {
    return "Usa una sombra CSS válida.";
  }
  return null;
}

export function buildTokenDiff(changes: TokenChange[]): string {
  if (changes.length === 0) return "# No hay cambios en los tokens.";
  return changes
    .map(
      (change) =>
        `@@ ${change.path} @@\n- ${JSON.stringify(change.before)}\n+ ${JSON.stringify(change.after)}`,
    )
    .join("\n\n");
}

export function buildCssDiff(changes: TokenChange[]): string {
  const mapped = changes.filter((change) => change.cssVariables.length > 0);
  const unmapped = changes.filter((change) => change.cssVariables.length === 0);
  const sections = mapped.flatMap((change) =>
    change.cssVariables.map(
      (variable) =>
        `@@ globals.css · ${variable} · ${change.path} @@\n- ${variable}: ${change.before};\n+ ${variable}: ${change.after};`,
    ),
  );
  if (unmapped.length > 0) {
    sections.push(
      "# Requieren auditoría de usos literales o media queries:\n" +
        unmapped.map((change) => `- ${change.path}: ${change.before} → ${change.after}`).join("\n"),
    );
  }
  return sections.length > 0 ? sections.join("\n\n") : "# No hay cambios CSS.";
}

export function buildCodexPrompt(
  document: TokenDocument,
  changes: TokenChange[],
): string {
  if (changes.length === 0) {
    return "No hay cambios seleccionados. Ajusta un valor del editor para generar un prompt.";
  }
  const mapped = changes.filter((change) => change.cssVariables.length > 0);
  const unmapped = changes.filter((change) => change.cssVariables.length === 0);
  const lines = changes.map(
    (change) => `- ${change.path}: ${change.before} → ${change.after}`,
  );
  return [
    "Actualiza el sistema de diseño de HIDACA con los cambios aprobados abajo.",
    "",
    "Fuente canónica:",
    "- design-system/tokens.json",
    "- hidaca-constructora-app/app/globals.css",
    "",
    `Versión actual del sistema: ${document.version}`,
    "",
    "Cambios exactos:",
    ...lines,
    "",
    "Instrucciones:",
    "1. Actualiza primero design-system/tokens.json conservando nombres, roles y estructura.",
    mapped.length > 0
      ? "2. Actualiza las variables CSS mapeadas sólo después de revisar sus usos y aliases."
      : "2. Revisa globals.css sólo si alguno de estos tokens tiene un uso runtime confirmado.",
    "3. Busca valores literales duplicados antes de reemplazarlos y conserva excepciones justificadas.",
    "4. No cambies datos de negocio, autorización ni comportamiento de producción.",
    "5. Mantén accesibilidad, responsive behavior, foco visible y prefers-reduced-motion.",
    unmapped.length > 0
      ? `6. Audita manualmente estos tokens sin variable CSS directa: ${unmapped.map((change) => change.path).join(", ")}.`
      : "",
    "",
    "Validación requerida:",
    "- npm run format",
    "- npm run lint",
    "- npm run typecheck",
    "- npm run test",
    "- npm run build",
    "- Renderiza y revisa 1440×900, 1024×768 y 390×844.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function readStoredDraft(
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
  key: string,
  version: string,
  defaults: TokenValues,
): { values: TokenValues; discarded: boolean } {
  if (!storage) return { discarded: false, values: defaults };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { discarded: false, values: defaults };
    const parsed = JSON.parse(raw) as Partial<StoredTokenDraft>;
    if (parsed.version !== version || !parsed.values || typeof parsed.values !== "object") {
      storage.removeItem(key);
      return { discarded: true, values: defaults };
    }
    return {
      discarded: false,
      values: Object.fromEntries(
        Object.keys(defaults).map((path) => [
          path,
          typeof parsed.values?.[path] === "string" ? parsed.values[path] : defaults[path],
        ]),
      ),
    };
  } catch {
    return { discarded: false, values: defaults };
  }
}

export function editorVariableName(path: string): `--${string}` {
  return `--editor-${path.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}
