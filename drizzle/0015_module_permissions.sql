CREATE TABLE `role_permissions` (
	`role` text NOT NULL,
	`module` text NOT NULL,
	`action` text NOT NULL,
	`allowed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`role`, `module`, `action`)
);
--> statement-breakpoint
CREATE INDEX `role_permissions_role_idx` ON `role_permissions` (`role`);
--> statement-breakpoint
CREATE TABLE `user_permission_overrides` (
	`user_id` integer NOT NULL,
	`module` text NOT NULL,
	`action` text NOT NULL,
	`effect` text NOT NULL,
	PRIMARY KEY(`user_id`, `module`, `action`),
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_permission_overrides_user_idx` ON `user_permission_overrides` (`user_id`);
--> statement-breakpoint
WITH RECURSIVE
  roles(role) AS (VALUES ('admin'), ('operator'), ('viewer')),
  modules(module) AS (
    VALUES ('inicio'),('clientes'),('contactos'),('proyectos'),('prospectos'),('oportunidades'),('casos'),('cotizaciones'),('facturas'),('pagos'),('tareas'),('hitos'),('reportes-diarios'),('equipos'),('personal'),('suplidores'),('notas-credito'),('cuentas-cobrar'),('cobranza'),('agenda'),('importaciones'),('documentos'),('usuarios')
  ),
  actions(action) AS (VALUES ('view'),('create'),('edit'),('delete'),('administer'))
INSERT INTO `role_permissions` (`role`, `module`, `action`, `allowed`)
SELECT role, module, action,
  CASE
    WHEN role = 'admin' AND (
      action = 'view' OR
      action IN ('create','edit','delete') AND module != 'inicio' OR
      action = 'administer' AND module IN ('prospectos','oportunidades','cotizaciones','facturas','importaciones','usuarios')
    ) THEN 1
    WHEN role = 'operator' AND module NOT IN ('inicio','usuarios') AND action IN ('view','create','edit','delete') THEN 1
    WHEN role = 'operator' AND module = 'inicio' AND action = 'view' THEN 1
    WHEN role = 'viewer' AND module != 'usuarios' AND action = 'view' THEN 1
    ELSE 0
  END
FROM roles CROSS JOIN modules CROSS JOIN actions;
