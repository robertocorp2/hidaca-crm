# Patrón: responsive y mobile

El app no tiene una experiencia móvil distinta: mantiene el modelo mental y cambia la presentación.

- ≤1100px: sidebar es drawer con backdrop.
- ≤760px: headings/forms apilan y tabs permiten overflow horizontal.
- ≤600px: topbar muestra menú, búsqueda y avatar; KPIs y dashboards pasan a una columna.
- ≤520px: toolbar y acciones se apilan.

Valida con zoom y teclado, no sólo con una captura. El body no debe adquirir overflow horizontal; si una tabla necesita más ancho, el scroll pertenece a `.table-wrap`.
