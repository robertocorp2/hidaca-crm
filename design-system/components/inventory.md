# Inventario de componentes

| Componente                | Implementación actual                                                    | Estado               | Regla                                                                                 |
| ------------------------- | ------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------- |
| Button                    | `.primary-button`, `.secondary-button`, `.text-button`, `.danger-button` | APPROVED             | usa la variante semántica; no inventes otra por módulo                                |
| IconButton                | `.menu-button`, `.mobile-search-button`, profile trigger                 | APPROVED             | siempre label accesible y target ≥42px                                                |
| Badge / StatusBadge       | `StatusBadge`, `.status-badge-*`, `.status`                              | APPROVED / DUPLICATE | para nuevas superficies usa `StatusBadge`; conserva `.status` sólo por compatibilidad |
| Input / Textarea / Select | labels nativos + `.form-grid`                                            | APPROVED             | label visible, help/error asociado, no placeholder como único label                   |
| Search                    | `GlobalSearch`, `.quotations-search`, `AutocompleteInput`                | APPROVED / DUPLICATE | reutiliza `AutocompleteInput` para búsqueda relacional                                |
| Card / Panel              | `.panel`, `.detail-card`, `.summary-card`                                | APPROVED / DUPLICATE | `panel` es la superficie por defecto                                                  |
| DataTable                 | `.table-wrap`, `.collection-table`, `.responsive-table`                  | APPROVED / DUPLICATE | scroll dentro de wrapper; filas seleccionables necesitan teclado                      |
| Tabs                      | `RecordTabs`, `.record-tabs`, `.user-tabs`, `.whatsapp-tabs`             | APPROVED / DUPLICATE | `aria-selected`, panel asociado y overflow horizontal en móvil                        |
| Modal                     | `Modal`, `.modal-backdrop`, `.modal-dialog`                              | APPROVED             | focus inicial, Escape, focus return y body lock                                       |
| Drawer                    | sidebar móvil + `.nav-backdrop`                                          | APPROVED             | focus containment y cierre por Escape                                                 |
| Tooltip / Dropdown        | profile dropdown, column filter popover                                  | EXPERIMENTAL         | preferir contenido visible; no esconder información crítica sólo en tooltip           |
| EmptyState                | `Empty` + relationship empty                                             | APPROVED             | explicar qué falta y ofrecer acción contextual                                        |
| LoadingState              | `LoadingState` y copy “Cargando…”                                        | APPROVED             | `role=status`, no bloquear sin comunicación                                           |
| ErrorState                | `ErrorState`, `InlineAlert`, `flash`                                     | APPROVED / DUPLICATE | usa `ErrorState` para bloque y `InlineAlert` para contexto                            |
| RecordHeader              | `RecordHeader` en `record-workspace.tsx`                                 | APPROVED             | título, tipo, acciones agrupadas                                                      |
| RecordSummary             | properties + quick summary                                               | APPROVED             | usa labels, valores y relaciones navegables                                           |
| RecordWorkspace           | `RecordWorkspace`                                                        | APPROVED             | patrón estándar para Empresas/Contactos                                               |
| RelationshipPanel         | `RelatedRecordSection`                                                   | APPROVED             | muestra conteo, estado vacío y “Ver todos”                                            |
| ActivityTimeline          | `ActivityTimeline`                                                       | APPROVED             | `ol`, fecha semántica, actor y enlace cuando aplica                                   |
| FilterBar                 | toolbar + chips + URL state                                              | APPROVED             | filtros legibles, persistidos en URL y limpiables                                     |
| Pagination                | `Pagination`, `PageSizeControl`                                          | APPROVED             | anuncia página, deshabilita límites y conserva URL                                    |
| Navigation                | `navigationGroups` + Lucide                                              | APPROVED             | permiso filtra destino; active state visible                                          |

## Reutilización

Antes de agregar un componente:

1. Busca el nombre en `app/app/ui.tsx`.
2. Busca la clase en `app/globals.css`.
3. Compara si la necesidad es realmente distinta o sólo una variante de contenido.
4. Si es nueva, añade estado, responsive behavior, ejemplo en showcase y documentación.
