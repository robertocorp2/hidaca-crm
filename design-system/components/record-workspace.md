# Record workspace

El patrón aprobado para el detalle de Empresas y Contactos es una composición de tres zonas:

1. **Summary panel:** avatar/marca, nombre, subtítulo, acciones, IA, propiedades y resumen rápido.
2. **Center panel:** tabs de relaciones principales, estado vacío y actividad reciente.
3. **Related panel:** actividades, notas, historial y relaciones secundarias colapsables.

En móvil las tres zonas pasan a una columna. Las relaciones conservan el contexto con `details/summary`; el usuario debe poder abrir cada grupo con teclado. Las acciones de alto riesgo viven en menú contextual y no compiten con la acción primaria.
