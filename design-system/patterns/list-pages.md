# Patrón: páginas de lista

**Propósito:** revisar una colección y ejecutar una acción contextual.

**Usa cuando:** el usuario necesita buscar, filtrar, ordenar, paginar y abrir registros.

**No uses cuando:** la decisión depende de una secuencia visual o de comparar pocos objetos; considera cards o dashboard.

**Componentes:** `PageHeader`, toolbar/filter bar, `DataTable`, `StatusBadge`, `Empty`, `LoadingState`, `ErrorState`, `Pagination`.

**Responsive:** desktop muestra columnas completas; tablet reduce el grid; móvil apila toolbar y usa scroll sólo dentro de `.table-wrap`. No escondas la columna de acción sin ofrecer una ruta equivalente.

**Interacción:** query, filtros y página viven en URL; limpiar filtros resetea página; fila interactiva responde a Enter/Espacio.

**Ejemplo:** Empresas, Contactos, Cotizaciones, Facturas.
