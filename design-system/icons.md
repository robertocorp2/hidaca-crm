# Iconos

## Sistema aprobado

Usa `lucide-react`, que ya es dependencia del app y el sistema de navegación actual. El icono debe describir el concepto del destino: `Building2` para Empresas, `ContactRound` para Contactos, `FolderKanban` para Proyectos, `ReceiptText` para Facturas, `Activity` para Actividades, `Sparkles` para IA.

## Reglas

- 16–18px para controles y navegación; 30–32px para empty states o marcas de sección.
- `strokeWidth={1.8}` es la referencia del shell.
- Añade `aria-hidden="true"` si existe un label visible o `aria-label` si el icono es el único contenido.
- No uses Unicode como icono de interacción. Esto incluye flechas, lupa, cerrar, filtro, documento y estados.
- No dibujes SVG artesanal ni uses emojis para representar estados.
- Usa `currentColor` para que el icono herede el token semántico del control.

## Migración aplicada

Las primitives compartidas en `ui.tsx` usan Lucide para filtros, ordenamiento, documentos, empty states, cierre, chips y paginación. El glyph `—` se conserva únicamente como valor de datos ausente, no como control visual. Los módulos especializados que todavía usan símbolos deben migrarse en cambios separados con pruebas de teclado y snapshots visuales.
