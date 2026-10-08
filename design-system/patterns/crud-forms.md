# Patrón: formularios CRUD

**Propósito:** crear o editar una entidad con validación clara y salida segura.

**Componentes:** `Modal` o `record-form`, `PageHeader`, form grid, `InlineAlert`, `useFormGuard`, botones secondary/primary.

**Responsive:** dos columnas en desktop, una en ≤800px; campos largos usan `.wide`. Acciones se apilan cuando el ancho no permite targets cómodos.

**Interacción:** foco inicial en el primer campo; errors preservan input; guardar muestra busy; cancelar confirma sólo si hay cambios.
