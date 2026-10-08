# HIDACA Operaciones · Sistema de diseño

Versión 1.0.0 · 28 de agosto de 2026

Este documento es la fuente de decisión para la interfaz privada de HIDACA. Describe los patrones que ya existen en `hidaca-constructora-app/`, los normaliza y define cómo debe trabajar Codex cuando agregue o modifique UI. No es un rediseño del producto.

## Alcance y evidencia

La extracción cubre el shell autenticado y sus módulos: Empresas, Contactos, Proyectos, Prospectos, Oportunidades, Casos, Cotizaciones, Facturas, Pagos, Cobranza, Actividades, Calendario, WhatsApp, Asistente IA, Importaciones, Documentos, Usuarios y Configuración. También se revisaron login, navegación, páginas de lista, formularios, tablas, paneles de registro, relaciones, cronología, estados vacíos/cargando/error y reglas responsive.

Fuentes revisadas:

- `hidaca-constructora-app/app/globals.css` — base visual actual y capas de overrides.
- `hidaca-constructora-app/app/app/ui.tsx` — primitives y utilidades compartidas.
- `hidaca-constructora-app/app/app/navigation.tsx` — arquitectura de navegación e iconos Lucide.
- `hidaca-constructora-app/app/app/record-workspace.tsx` — patrón de detalle y relaciones.
- Vistas de dashboard, CRM, facturación, agenda, importaciones, WhatsApp, IA y usuarios.
- `reference/homepage-reference.png` y `reference/Hidaca-Website-Discovery-Analysis.txt` — contexto de marca y tono; no se usan para inventar datos del producto.
- Estado renderizado observado: login privado en desarrollo con fondo verde, card elevada y CTA primary.

La pantalla autenticada requiere identidad ChatGPT + allowlist D1; en este entorno esa barrera no se evade. La ruta `/design-system` es una superficie de desarrollo sin datos privados para validar el lenguaje visual.

## Principios

1. **Operación antes que decoración.** La jerarquía debe llevar a la siguiente acción: revisar, crear, editar, aprobar o navegar.
2. **Densidad legible.** Tablas y listas pueden ser compactas, pero siempre deben conservar etiquetas, foco visible y separación suficiente.
3. **Marca sobria.** Verde HIDACA para estructura y acciones; oro sólo como acento de selección o marca.
4. **Estados explícitos.** Cargando, vacío, error, éxito, advertencia y permisos deben poder distinguirse sin depender sólo del color.
5. **Relaciones visibles.** Un registro debe mostrar su contexto, documentos, actividades e historial sin obligar a perder el contexto.
6. **Responsive por reflujo.** Desktop conserva la densidad; tablet convierte la navegación en drawer; móvil apila, colapsa y permite desplazamiento horizontal sólo donde la tabla lo requiere.

## Fuente de tokens

Los tokens normalizados están en [`tokens.json`](./tokens.json). En código, los valores semánticos se expresan mediante variables CSS de `hidaca-constructora-app/app/globals.css`: `--color-primary`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-secondary`, `--space-*`, `--radius-*` y `--shadow-*`.

Si un componente necesita un valor nuevo, primero busca un token equivalente. Si el valor es realmente nuevo, agrégalo a `tokens.json`, al mapa CSS y a esta documentación antes de usarlo.

## Arquitectura de capas

| Capa             | Ubicación                                         | Uso                                                                   |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Shell            | `app/app/operations-client.tsx`, `navigation.tsx` | navegación, topbar, perfil, skip link, responsive                     |
| Primitives       | `app/app/ui.tsx`                                  | encabezados, estados, badges, filtros, paginación, modal, breadcrumbs |
| Composición      | `record-workspace.tsx` y vistas por módulo        | detalle, relaciones, cronología y flujos CRUD                         |
| Fundación visual | `app/globals.css`                                 | tokens, layout, controls, estados y breakpoints                       |
| Referencia       | `/design-system`                                  | superficie de desarrollo para regresiones visuales                    |

## Inventario y estado

### APPROVED

`PageHeader`, `Modal`, `Empty`, `LoadingState`, `ErrorState`, `InlineAlert`, `StatusBadge`, `DocumentRow`, `Pagination`, `Breadcrumbs`, `AutocompleteInput`, `ColumnFilterPopover`, `SortHeader`, `PageSizeControl`, `ActiveFilterChip`, `FilterableStatus`, `useUrlState`, `usePagination`, `useFormGuard`, `RecordWorkspace`, `ActivityTimeline` y navegación con iconos Lucide.

### EXPERIMENTAL

Superficies IA (`AiCopilotView`, `AiSettingsView`, `RecordAiPanel`, `DailyBriefPanel`), inbox de WhatsApp, importación revisable y sustitución de cotizaciones. Funcionan como superficies de producto, pero deben estabilizar contratos y tokens antes de convertirse en referencias para nuevos módulos.

### DEPRECATED

Glyphs de texto para interacción (`⌕`, `⌄`, `×`, `↑`, `↓`, `↕`, `←`, `→`, `▧`, `—`) cuando representan iconos o controles; estilos inline que inventen color/espaciado; clases de módulo que repitan una primitive existente; y cualquier componente que oculte estado sólo con color.

### DUPLICATE

La hoja global contiene capas históricas superpuestas para `primary-button`, `panel`, `page-heading`, `status`, tablas, topbar, navegación y record workspace. También existen variantes cercanas de `status`/`status-badge`, `detail-card`/`panel`, `user-tabs`/`record-tabs` y búsquedas específicas de Cotizaciones. No se eliminan en esta extracción porque son contratos activos; toda nueva UI debe usar la capa semántica aprobada y cada consolidación futura debe preservar snapshots y pruebas existentes.

## Reglas de implementación

- Lee este documento y el inventario del componente antes de editar UI.
- Busca una primitive aprobada antes de crear otra.
- Usa tokens semánticos, no literales arbitrarios.
- Usa Lucide o el sistema de iconos existente; un icono necesita `aria-hidden="true"` cuando el texto ya comunica su propósito.
- Mantén navegación por teclado, foco visible, etiquetas asociadas, estados anunciados y targets táctiles razonables.
- No mezcles responsabilidades de autorización con la apariencia; el servidor sigue siendo la autoridad.
- Mantén textos públicos de la app en español y nombres de código/comentarios en inglés.

## Calidad visual obligatoria

Para cada cambio UI:

`Build → Render → Screenshot → Compare → encontrar el mayor desajuste → corregir → revalidar`.

La validación mínima cubre 1440×900, 1024×768 y 390×844; teclado en controles principales; foco visible; `prefers-reduced-motion`; ausencia de overflow horizontal accidental; lint, typecheck, tests y build.

## Showcase

Las rutas `/design-system` y `/design-system/editor` sólo se sirven en desarrollo (`NODE_ENV !== "production"`). El showcase reutiliza las primitives reales del app y muestra tokens, tipografía, iconos, controles, estados, tabla, tabs, modal, record workspace y el comportamiento responsive. El editor permite probar los 76 valores canónicos, conserva borradores sólo en el navegador y genera un prompt de Codex más diffs de tokens/CSS; nunca escribe archivos del repositorio. Ninguna de las dos rutas incluye datos reales ni se publica como página de negocio.

## Gobierno

Cada nuevo patrón aprobado debe añadir una referencia en `components/` o `patterns/`, un ejemplo en el showcase y una prueba enfocada si cambia comportamiento. Las decisiones pendientes de cliente permanecen en [`CLIENT-APPROVALS.md`](../CLIENT-APPROVALS.md). Las inconsistencias conocidas y su prioridad se registran en [`references/visual-audit.md`](./references/visual-audit.md).
