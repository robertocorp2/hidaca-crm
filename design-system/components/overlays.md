# Modales, drawers y popovers

`Modal` es la referencia. Debe bloquear scroll del body, mover foco al primer control, cerrar con Escape, contener Tab/Shift+Tab y devolver foco al disparador. El backdrop puede cerrar sólo si no hay una acción destructiva pendiente.

Un drawer es apropiado para navegación o contexto secundario en móvil. Un popover sirve para filtros o perfil; no lo uses para formularios largos. La información importante debe permanecer accesible en el DOM y tener nombre accesible.
