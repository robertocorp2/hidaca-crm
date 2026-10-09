# Registro de descubrimiento

## Superficies y módulos

| Superficie                  | Evidencia                                      | Patrón principal                 |
| --------------------------- | ---------------------------------------------- | -------------------------------- |
| Login                       | `app/page.tsx`, `globals.css`                  | auth card / estado restringido   |
| Shell y navegación          | `operations-client.tsx`, `navigation.tsx`      | sidebar + topbar + drawer        |
| Inicio                      | `operations-client.tsx`                        | dashboard + métricas + snapshots |
| Empresas / Contactos        | `entity-views.tsx`                             | collection + record workspace    |
| Proyectos                   | `projects-view.tsx`                            | collection + filters             |
| Prospectos                  | `leads-view.tsx`                               | pipeline/list + conversion modal |
| Oportunidades               | `opportunities-view.tsx`, `pipeline.tsx`       | pipeline + outcome branch        |
| Casos                       | `entity-views.tsx` / modules                   | generic collection               |
| Cotizaciones                | `cotizaciones-view.tsx`, `quotation-view.tsx`  | source history + detail          |
| Facturas / Pagos / Cobranza | `invoice-view.tsx`, `billing-view.tsx`         | financial detail + tables        |
| Actividades / Calendario    | `agenda-view.tsx`                              | list + calendar                  |
| Documentos / Importaciones  | `imports-view.tsx`, document components        | upload + review states           |
| Usuarios / Settings         | `users-admin-view.tsx`, `ai-settings-view.tsx` | admin forms + permissions        |
| WhatsApp / IA               | `whatsapp-view.tsx`, `ai-copilot-view.tsx`     | inbox/chat + assistant           |

## Hallazgos normalizados

- El verde profundo estructura la navegación y la autenticación; el verde primary dirige acciones; el oro comunica marca/selección.
- La superficie base es blanca sobre canvas `#f3f6f4`.
- Los paneles usan radios entre 10–14px, bordes verdes-grisáceos y sombras suaves.
- La densidad operativa se apoya en controles de 42–44px, tablas con padding de 12–16px y gaps de 8–18px.
- Lucide es el sistema consistente para navegación y superficies nuevas.
- El record workspace es el patrón de mayor valor reutilizable.
- El CSS tiene sucesivas capas de “polish”, “expansion”, “responsive”, “refinement” y “presentation”; esto es deuda de consolidación, no una invitación a reescribirlo durante cada feature.
