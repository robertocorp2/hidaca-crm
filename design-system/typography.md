# Tipografía

## Familia

La familia base actual es `Inter, "Segoe UI", Arial, sans-serif`. La preferencia de usuario existe en `useFontPreference`, pero `Inter` es el valor de referencia para nuevas superficies.

## Escala

| Token                     | Valor                           | Uso                                             |
| ------------------------- | ------------------------------- | ----------------------------------------------- |
| `typography.size.xs`      | 12px                            | metadatos, headers de tabla, labels secundarios |
| `typography.size.sm`      | 14px                            | copy secundaria, controles compactos            |
| `typography.size.md`      | 16px                            | cuerpo base                                     |
| `typography.size.lg`      | 18px                            | títulos de panel                                |
| `typography.size.xl`      | 24px                            | encabezados de sección                          |
| `typography.size.2xl`     | 32px                            | encabezados de página                           |
| `typography.size.display` | `clamp(2.2rem, 4.4vw, 3.25rem)` | título de alta prioridad                        |

## Peso y ritmo

- Body: 400, line-height 1.55.
- Labels y controles: 600–750.
- Eyebrow, navegación y estados de énfasis: 850.
- Encabezados grandes: line-height 1.1 y letter-spacing negativo moderado.
- Eyebrows: mayúsculas, `0.14em` de tracking, color primary.

No uses cursivas decorativas, texto todo en mayúsculas para párrafos, ni tamaños menores a 12px para información operativa.
