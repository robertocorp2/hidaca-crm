# Espaciado y layout

## Escala

La escala base es de 4px: `2xs 4`, `xs 8`, `sm 12`, `md 16`, `lg 24`, `xl 32`, `2xl 40`, `3xl 48`, `4xl 64`.

## Reglas

- Usa `md` como gap/padding de componente por defecto.
- Usa `lg` para padding de panel y separación entre bloques.
- Usa `xl`/`2xl` para separar secciones de página.
- El workspace usa un inset fluido equivalente a 24–42px en desktop y 18px en móvil.
- Los controles deben conservar al menos 42–44px de altura cuando sean accionables.
- Los grids deben usar `minmax(0, 1fr)` para que el contenido no fuerce overflow.
- Tablas densas pueden usar scroll horizontal dentro de `.table-wrap`; nunca en el body.

## Breakpoints

| Token                  | Umbral | Comportamiento                                              |
| ---------------------- | ------ | ----------------------------------------------------------- |
| `breakpoint.mobile`    | 600px  | topbar compacto, búsqueda móvil, KPIs a una columna         |
| `breakpoint.compact`   | 760px  | navegación móvil, headings y forms apilados                 |
| `breakpoint.tablet`    | 1100px | sidebar se convierte en drawer y grids pasan a dos columnas |
| `breakpoint.wide`      | 1500px | ancho máximo del workspace                                  |
| `breakpoint.ultraWide` | 1760px | dashboard puede mostrar seis métricas                       |
