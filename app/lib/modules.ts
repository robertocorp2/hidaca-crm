export const modules = [
  { key: "clientes", label: "Empresas", singular: "empresa" },
  { key: "contactos", label: "Contactos", singular: "contacto" },
  { key: "proyectos", label: "Proyectos", singular: "proyecto" },
  { key: "cotizaciones", label: "Cotizaciones", singular: "cotización" },
  { key: "facturas", label: "Facturas", singular: "factura" },
  { key: "pagos", label: "Pagos", singular: "pago" },
  { key: "ordenes-cambio", label: "Casos", singular: "caso" },
  { key: "tareas", label: "Tareas", singular: "tarea" },
  { key: "hitos", label: "Hitos", singular: "hito" },
  { key: "reportes-diarios", label: "Reportes diarios", singular: "reporte" },
  { key: "equipos", label: "Equipos", singular: "equipo" },
  { key: "personal", label: "Personal", singular: "miembro" },
  { key: "suplidores", label: "Suplidores", singular: "suplidor" },
  { key: "whatsapp", label: "WhatsApp", singular: "conversación" },
  { key: "ai", label: "Asistente IA", singular: "ejecución IA" },
] as const;

export type ModuleKey = (typeof modules)[number]["key"];

export const permissionActions = [
  "view",
  "create",
  "edit",
  "approve",
  "delete",
  "administer",
  "ecf_generate",
  "ecf_sign",
  "ecf_submit",
  "ecf_retry",
  "ecf_adjust",
  "ecf_cancel",
  "ecf_xml",
  "ecf_logs",
  "ecf_configure",
] as const;

export type PermissionAction = (typeof permissionActions)[number];
export type StaffRole = "admin" | "operator" | "viewer";
export type PermissionEffect = "allow" | "deny";
export const ecfPermissionActions = [
  "ecf_generate",
  "ecf_sign",
  "ecf_submit",
  "ecf_retry",
  "ecf_adjust",
  "ecf_cancel",
  "ecf_xml",
  "ecf_logs",
  "ecf_configure",
] as const;
export type EcfPermissionAction = (typeof ecfPermissionActions)[number];
export const adminOnlyEcfActions: readonly EcfPermissionAction[] = [
  "ecf_sign",
  "ecf_submit",
  "ecf_cancel",
  "ecf_configure",
];

export const permissionModules = [
  { key: "inicio", label: "Inicio", group: "General", views: ["resumen"], entities: [], dependencies: [], actions: ["view"] },
  { key: "clientes", label: "Empresas", group: "CRM", views: ["clientes"], entities: ["business", "clientes"], dependencies: [], actions: ["view", "create", "edit", "delete"] },
  { key: "contactos", label: "Contactos", group: "CRM", views: ["contactos"], entities: ["contact", "contactos"], dependencies: ["clientes"], actions: ["view", "create", "edit", "delete"] },
  { key: "proyectos", label: "Proyectos", group: "Operaciones", views: ["proyectos"], entities: ["project", "proyectos"], dependencies: ["clientes", "contactos"], actions: ["view", "create", "edit", "delete"] },
  { key: "prospectos", label: "Prospectos", group: "CRM", views: ["leads"], entities: ["lead"], dependencies: [], actions: ["view", "create", "edit", "delete", "administer"] },
  { key: "oportunidades", label: "Oportunidades", group: "CRM", views: ["opportunities"], entities: ["opportunity"], dependencies: ["clientes", "contactos"], actions: ["view", "create", "edit", "delete", "administer"] },
  { key: "casos", label: "Casos", group: "Operaciones", views: ["ordenes-cambio"], entities: ["case", "ordenes-cambio"], dependencies: ["proyectos"], actions: ["view", "create", "edit", "delete"] },
  { key: "cotizaciones", label: "Cotizaciones", group: "Finanzas", views: ["cotizaciones", "quotations"], entities: ["quote", "quotation", "cotizaciones"], dependencies: ["clientes", "contactos", "proyectos"], actions: ["view", "create", "edit", "delete", "administer"] },
  { key: "facturas", label: "Facturas", group: "Finanzas", views: ["facturas"], entities: ["invoice", "facturas"], dependencies: ["clientes", "contactos", "proyectos", "cotizaciones"], actions: ["view", "create", "edit", "delete", "administer", "ecf_generate", "ecf_sign", "ecf_submit", "ecf_retry", "ecf_adjust", "ecf_cancel", "ecf_xml", "ecf_logs", "ecf_configure"] },
  { key: "pagos", label: "Pagos", group: "Finanzas", views: ["pagos"], entities: ["payment", "pagos"], dependencies: ["facturas", "clientes"], actions: ["view", "create", "edit", "delete"] },
  { key: "tareas", label: "Tareas", group: "Operaciones", views: ["tareas"], entities: ["task", "tareas"], dependencies: ["proyectos"], actions: ["view", "create", "edit", "delete"] },
  { key: "hitos", label: "Hitos", group: "Operaciones", views: ["hitos"], entities: ["milestone", "hitos"], dependencies: ["proyectos"], actions: ["view", "create", "edit", "delete"] },
  { key: "reportes-diarios", label: "Reportes diarios", group: "Operaciones", views: ["reportes-diarios"], entities: ["daily_report", "reportes-diarios"], dependencies: ["proyectos"], actions: ["view", "create", "edit", "delete"] },
  { key: "equipos", label: "Equipos", group: "Recursos", views: ["equipos"], entities: ["equipment", "equipos"], dependencies: [], actions: ["view", "create", "edit", "delete"] },
  { key: "personal", label: "Personal", group: "Recursos", views: ["personal"], entities: ["staff", "personal"], dependencies: [], actions: ["view", "create", "edit", "delete"] },
  { key: "suplidores", label: "Suplidores", group: "Recursos", views: ["suplidores"], entities: ["supplier", "suplidores"], dependencies: [], actions: ["view", "create", "edit", "delete"] },
  { key: "notas-credito", label: "Notas de crédito", group: "Finanzas", views: ["credit-notes"], entities: ["credit-note"], dependencies: ["facturas", "clientes"], actions: ["view", "create", "edit", "delete"] },
  { key: "cuentas-cobrar", label: "Cuentas por cobrar", group: "Finanzas", views: ["receivables"], entities: ["receivable"], dependencies: ["facturas", "clientes"], actions: ["view", "create", "edit", "delete"] },
  { key: "cobranza", label: "Cobranza", group: "Finanzas", views: ["collections"], entities: ["collection"], dependencies: ["cuentas-cobrar", "facturas", "clientes", "contactos"], actions: ["view", "create", "edit", "delete"] },
  { key: "agenda", label: "Actividades / Calendario", group: "Productividad", views: ["schedule", "calendar"], entities: ["activity"], dependencies: [], actions: ["view", "create", "edit", "delete"] },
  { key: "importaciones", label: "Importaciones", group: "Administración", views: ["imports"], entities: ["import"], dependencies: ["documentos"], actions: ["view", "create", "edit", "delete", "administer"] },
  { key: "documentos", label: "Documentos", group: "Administración", views: ["documentos"], entities: ["document"], dependencies: [], actions: ["view", "create", "edit", "delete"] },
  { key: "usuarios", label: "Usuarios", group: "Seguridad", views: ["usuarios"], entities: ["staff-user"], dependencies: [], actions: ["view", "create", "edit", "delete", "administer"] },
  { key: "whatsapp", label: "WhatsApp", group: "Comunicación", views: ["whatsapp"], entities: ["whatsapp"], dependencies: [], actions: ["view", "create", "edit", "administer"] },
  { key: "ai", label: "Asistente IA", group: "Productividad", views: ["ai"], entities: ["ai_run", "voice_recording", "record_note", "daily_report"], dependencies: [], actions: ["view", "create", "edit", "approve", "administer"] },
] as const;

export type PermissionModuleKey = (typeof permissionModules)[number]["key"];

export type EffectivePermissions = Record<
  PermissionModuleKey,
  Record<PermissionAction, boolean>
>;

export const rolePermissionDefaults: Record<StaffRole, EffectivePermissions> =
  Object.fromEntries(
    (["admin", "operator", "viewer"] as const).map((role) => [
      role,
      Object.fromEntries(
        permissionModules.map((module) => [
          module.key,
          Object.fromEntries(
            permissionActions.map((action) => [
              action,
              module.actions.includes(action as never) &&
                (role === "admin" ||
                  (role === "operator" && module.key !== "usuarios" && action !== "administer" && !(module.key === "ai" && action === "approve") && !adminOnlyEcfActions.includes(action as EcfPermissionAction)) ||
                  (role === "viewer" && action === "view" && module.key !== "usuarios")),
            ]),
          ),
        ]),
      ),
    ]),
  ) as Record<StaffRole, EffectivePermissions>;

export function isPermissionModuleKey(value: string): value is PermissionModuleKey {
  return permissionModules.some((module) => module.key === value);
}

export function moduleForView(view: string): PermissionModuleKey | null {
  const normalizedView = ({
    businesses: "clientes",
    contacts: "contactos",
    projects: "proyectos",
    cases: "ordenes-cambio",
    "ai-settings": "ai",
  } as Record<string, string>)[view] ?? view;
  return permissionModules.find((module) =>
    (module.views as readonly string[]).includes(normalizedView),
  )?.key ?? null;
}

export function moduleForEntity(entity: string): PermissionModuleKey | null {
  return permissionModules.find((module) =>
    (module.entities as readonly string[]).includes(entity),
  )?.key ?? null;
}

export function permissionModuleForLegacyRecord(module: string): PermissionModuleKey | null {
  return module === "ordenes-cambio" ? "casos" : isPermissionModuleKey(module) ? module : null;
}

export function emptyEffectivePermissions(): EffectivePermissions {
  return Object.fromEntries(
    permissionModules.map((module) => [
      module.key,
      Object.fromEntries(permissionActions.map((action) => [action, false])),
    ]),
  ) as EffectivePermissions;
}

export function resolveEffectivePermissions(
  role: StaffRole,
  defaults: Array<{ module: string; action: string; allowed: boolean }> = [],
  overrides: Array<{ module: string; action: string; effect: string }> = [],
) {
  const effective = emptyEffectivePermissions();
  const explicitDenials = new Set<string>();
  for (const permissionModule of permissionModules) for (const action of permissionActions) {
    effective[permissionModule.key][action] = rolePermissionDefaults[role][permissionModule.key][action];
  }
  for (const value of defaults) if (isPermissionModuleKey(value.module) && permissionActions.includes(value.action as PermissionAction)) {
    effective[value.module][value.action as PermissionAction] = value.allowed;
  }
  for (const override of overrides) if (isPermissionModuleKey(override.module) && permissionActions.includes(override.action as PermissionAction)) {
    effective[override.module][override.action as PermissionAction] = override.effect === "allow";
    if (override.effect === "deny") {
      explicitDenials.add(`${override.module}:${override.action}`);
    }
  }
  if (role !== "admin") for (const action of permissionActions) effective.usuarios[action] = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (const permissionModule of permissionModules) if (effective[permissionModule.key].view) {
      for (const dependencyKey of permissionModule.dependencies) {
        const dependency = permissionModules.find((item) => item.key === dependencyKey);
        if (dependency) for (const action of dependency.actions) {
          if (
            effective[permissionModule.key][action] &&
            !effective[dependency.key][action] &&
            !explicitDenials.has(`${dependency.key}:${action}`)
          ) {
            effective[dependency.key][action] = true;
            changed = true;
          }
        }
      }
    }
  }
  for (const permissionModule of permissionModules) if (!effective[permissionModule.key].view) {
    for (const action of permissionActions) if (action !== "view") effective[permissionModule.key][action] = false;
  }
  return effective;
}

export const financialModules = new Set<ModuleKey>([
  "cotizaciones",
  "facturas",
  "pagos",
  "ordenes-cambio",
]);

export function isModuleKey(value: string): value is ModuleKey {
  return modules.some((module) => module.key === value);
}

export const recordStatuses = [
  "Activo",
  "Pendiente",
  "En proceso",
  "Completado",
  "Pagado",
  "Vencido",
  "Cancelado",
] as const;
