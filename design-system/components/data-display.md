# Datos, estados y feedback

## Paneles y tablas

Los paneles son superficies blancas con borde `color.border.default`, radio `radius.xl` y sombra `shadow.sm`. Las tablas viven dentro de `.table-wrap`; una fila interactiva debe tener `tabIndex`, Enter/Espacio, hover y foco. Los importes se alinean a la derecha y usan locale `es-DO`.

## Estados

- **Empty:** describe la ausencia en lenguaje de negocio y ofrece crear/importar cuando el permiso lo permite.
- **Loading:** comunica el bloque que carga; evita saltos de layout innecesarios.
- **Error:** explica qué falló y ofrece reintento si está disponible.
- **Success:** confirma la acción sin interrumpir el flujo.
- **Warning:** informa una condición que requiere revisión; no la uses como decoración.

Estado y color deben ir acompañados por texto o estructura; nunca dependas sólo del color.
