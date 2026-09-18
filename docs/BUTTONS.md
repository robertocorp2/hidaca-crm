# HIDACA button contract

All new action controls use the shared `Button` or `IconButton` exports from
`app/app/ui.tsx`. Existing semantic classes remain supported for compatibility.

| Role | API / class | Default geometry | Use |
| --- | --- | --- | --- |
| Primary | `variant="primary"` / `.primary-button` | 44px minimum height, 11px × 18px padding | Main create, save, or continue action |
| Secondary | `variant="secondary"` / `.secondary-button` | 44px minimum height, 11px × 18px padding | Non-destructive alternate action |
| Danger | `variant="danger"` / `.danger-button` | 44px minimum height, 11px × 18px padding | Destructive or irreversible action |
| Ghost | `variant="ghost"` / `.ghost-button` | Content-sized, 40px minimum target | Low-emphasis contextual action, including overflow |
| Text | `variant="text"` / `.text-button` | Content-sized, 40px minimum target | Inline navigation or detail action |
| Icon-only | `<IconButton label="…" />` / `.icon-button` | 42px × 42px | Menu, close, or compact toolbar action; an accessible label is required |
| Plus | `Button variant="primary"` with a `Plus` icon | Primary geometry | Create action; the icon does not change the hit target |
| Overflow | `Button variant="ghost" size="sm"` with `MoreHorizontal` | 34px minimum height | Record or table overflow menu |

Use `size="sm"` for dense record/table actions (34px minimum height) and
`size="lg"` only for prominent standalone actions (48px minimum height). The
size modifiers preserve the chosen semantic variant, focus treatment, disabled
state, and responsive wrapping.

Every button must have visible text or an accessible name. Icon-only controls
must not rely on a tooltip or icon shape alone. Keep destructive actions
separate from the primary action and preserve keyboard focus visibility.
