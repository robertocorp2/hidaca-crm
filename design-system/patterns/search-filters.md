# Patrón: búsqueda y filtros

**Propósito:** reducir una colección sin perder criterios aplicados.

**Componentes:** búsqueda global o contextual, `ColumnFilterPopover`, `AutocompleteInput`, `ActiveFilterChip`, `PageSizeControl`, `SortHeader`.

**Interacción:** filtros se reflejan en URL; cambio de filtro vuelve a página 1; chips son removibles; búsqueda anuncia resultados cuando la colección cambia. Los campos de relación usan autocompletado con teclado.

**Responsive:** toolbar se apila; resultados de búsqueda no desbordan viewport; tabla conserva scroll local.
