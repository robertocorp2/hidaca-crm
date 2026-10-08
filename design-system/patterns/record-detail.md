# Patrón: detalle de registro

**Propósito:** entender un registro, actuar sobre él y navegar sus relaciones sin perder contexto.

**Componentes:** `RecordWorkspace`, `RecordHeader`, propiedades, tabs, `RelationshipPanel`, `ActivityTimeline`, `Modal` para editar/archivar.

**Responsive:** tres columnas en desktop; una columna con grupos colapsables en móvil. Las acciones primarias permanecen cerca del encabezado.

**Interacción:** tabs con estado seleccionado accesible; relaciones con conteo y “Ver todos”; actividad enlaza al registro cuando existe; acciones destructivas requieren confirmación.
