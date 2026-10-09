# Auditoría visual y backlog de consolidación

## Evidencia actual

- Login renderizado: fondo verde con radial gold, card blanca elevada, marca `H`, eyebrow y CTA primary.
- Shell autenticado: no se capturó en este entorno porque la identidad ChatGPT/allowlist no está disponible; se validará con un entorno autorizado cuando corresponda.
- CSS observado: 5,400+ líneas y múltiples definiciones posteriores para los mismos bloques. Esto aumenta el riesgo de regresiones por orden de cascada.

## Duplicaciones prioritarias

1. Consolidar `primary-button`, `secondary-button`, `panel` y `page-heading` en una sola capa de base.
2. Unificar `status` y `status-badge` con una API semántica común y mantener alias temporal.
3. Unificar búsqueda de Cotizaciones con `GlobalSearch`/`AutocompleteInput` donde el modelo de interacción sea equivalente.
4. Migrado en esta extracción: primitives de `ui.tsx` ahora usan Lucide; queda pendiente revisar glyphs especializados fuera de la capa compartida.
5. Partir `globals.css` por responsabilidad sólo después de fijar snapshots visuales.

## Riesgos no resueltos

- No se puede verificar contraste calculado de todas las combinaciones sólo con la lectura de CSS; ejecutar contraste automatizado en la próxima sesión autenticada.
- Hay módulos listados en navegación cuya vista se resuelve por superficies genéricas; antes de crear variantes, confirmar si la diferencia es de datos o de interacción.
- Las fuentes alternativas se guardan por dispositivo; no deben convertirse en requisito visual de una pantalla.
