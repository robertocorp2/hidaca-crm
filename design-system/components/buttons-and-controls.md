# Botones y controles

## Variantes

- **Primary:** acción principal de la vista. Verde `color.action.primary`, texto blanco.
- **Secondary:** acción alternativa o navegación. Fondo blanco, borde default, texto verde profundo.
- **Text:** acción contextual de baja jerarquía, como “Ver”.
- **Danger:** borrar, archivar o reemplazar. Siempre requiere contexto y confirmación si es irreversible.
- **Icon button:** sólo para acciones reconocibles por icono; exige `aria-label`.

Todos los botones deben tener estado hover, focus-visible, disabled y busy si ejecutan una operación asíncrona. No uses `cursor: wait` como única señal de progreso: cambia el texto y conserva `role=status` cuando corresponda.

## Formularios

Usa `label` visible, `required` sólo cuando sea cierto, mensajes de error cercanos al campo y `InlineAlert` para el resumen. Los formularios CRUD deben usar `.record-form`, `.form-grid` y `.form-actions`. `useFormGuard` protege cambios sin guardar.
