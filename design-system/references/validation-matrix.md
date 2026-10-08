# Matriz de validación

| Área        | Desktop 1440×900   | Tablet 1024×768  | Mobile 390×844                | Teclado                    |
| ----------- | ------------------ | ---------------- | ----------------------------- | -------------------------- |
| Login       | card centrada      | card fluida      | padding reducido              | CTA enfocable              |
| Shell       | sidebar + topbar   | drawer           | menú + búsqueda + avatar      | skip link, Escape, focus   |
| Listas      | columnas completas | 2-column layout  | toolbar apilado, scroll local | fila, filtro, paginación   |
| Detalle     | 3 columnas         | 2/1 columnas     | stack                         | tabs, acciones, relaciones |
| Formularios | 2 columnas         | 1–2 columnas     | 1 columna                     | labels, errors, modal trap |
| Estados     | panel contextual   | panel contextual | copy no recortada             | `role=status` / `alert`    |

## Comandos

Desde `hidaca-constructora-app/`: `npm run format`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
