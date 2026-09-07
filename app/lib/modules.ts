export const modules = [
  { key: "clientes", label: "Empresas", singular: "empresa", icon: "EM" },
  { key: "contactos", label: "Contactos", singular: "contacto", icon: "CO" },
  { key: "proyectos", label: "Proyectos", singular: "proyecto", icon: "PR" },
  { key: "cotizaciones", label: "Cotizaciones", singular: "cotización", icon: "CT" },
  { key: "facturas", label: "Facturas", singular: "factura", icon: "FA" },
  { key: "pagos", label: "Pagos", singular: "pago", icon: "PA" },
  { key: "ordenes-cambio", label: "Casos", singular: "caso", icon: "CS" },
  { key: "tareas", label: "Tareas", singular: "tarea", icon: "TA" },
  { key: "hitos", label: "Hitos", singular: "hito", icon: "HI" },
  { key: "reportes-diarios", label: "Reportes diarios", singular: "reporte", icon: "RD" },
  { key: "equipos", label: "Equipos", singular: "equipo", icon: "EQ" },
  { key: "personal", label: "Personal", singular: "miembro", icon: "PE" },
  { key: "suplidores", label: "Suplidores", singular: "suplidor", icon: "SU" },
] as const;

export type ModuleKey = (typeof modules)[number]["key"];

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
