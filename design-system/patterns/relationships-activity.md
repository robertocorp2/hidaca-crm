# Patrón: relaciones y actividad

**Propósito:** conectar un registro con proyectos, oportunidades, cotizaciones, facturas, casos, documentos, notas, historial y actividades.

`RelatedRecordSection` maneja título, icono, conteo, vacío y navegación. `ActivityTimeline` usa una lista ordenada con fecha, tipo, título, detalle y actor. Las relaciones secundarias pueden vivir en `details`; las principales deben ocupar el panel central.

**Responsive:** grupos abiertos sólo cuando aportan contenido; empty states no deben crear una página interminable en móvil.
