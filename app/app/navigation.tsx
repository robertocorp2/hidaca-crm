import {
  Activity,
  BadgeDollarSign,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ClipboardPenLine,
  ContactRound,
  CreditCard,
  FileMinusCorner as FileMinus2,
  FileText,
  FileUp,
  Files,
  FolderKanban,
  FolderOpen,
  HandCoins,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Milestone,
  MessageCircle,
  ReceiptText,
  Settings2,
  Sparkles,
  Target,
  Truck,
  UserCog,
  UserRoundSearch,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { ModuleKey } from "../lib/modules";

export type NavigationView =
  | "resumen"
  | ModuleKey
  | "leads"
  | "opportunities"
  | "schedule"
  | "calendar"
  | "quotations"
  | "imports"
  | "credit-notes"
  | "receivables"
  | "collections"
  | "documentos"
  | "usuarios"
  | "ai-settings";

export type NavigationItem = {
  view: NavigationView;
  label: string;
  icon: LucideIcon;
  feature?: "invoices";
  adminOnly?: boolean;
};

export type NavigationGroup = {
  key: string;
  label: string | null;
  items: readonly NavigationItem[];
};

export const navigationGroups = [
  {
    key: "general",
    label: null,
    items: [
      { view: "resumen", label: "Inicio", icon: LayoutDashboard },
    ],
  },
  {
    key: "crm",
    label: "CRM",
    items: [
      { view: "clientes", label: "Empresas", icon: Building2 },
      { view: "contactos", label: "Contactos", icon: ContactRound },
      { view: "proyectos", label: "Proyectos", icon: FolderKanban },
      { view: "leads", label: "Prospectos", icon: UserRoundSearch },
      { view: "opportunities", label: "Oportunidades", icon: Target },
      { view: "ordenes-cambio", label: "Casos", icon: BriefcaseBusiness },
    ],
  },
  {
    key: "operations",
    label: "Operaciones",
    items: [
      { view: "cotizaciones", label: "Cotizaciones", icon: FileText },
      { view: "facturas", label: "Facturas", icon: ReceiptText },
      { view: "pagos", label: "Pagos", icon: CreditCard },
      { view: "tareas", label: "Tareas", icon: ListChecks },
      { view: "hitos", label: "Hitos", icon: Milestone },
      { view: "reportes-diarios", label: "Reportes diarios", icon: ClipboardPenLine },
      { view: "equipos", label: "Equipos", icon: Truck },
      { view: "personal", label: "Personal", icon: UsersRound },
      { view: "suplidores", label: "Suplidores", icon: Handshake },
    ],
  },
  {
    key: "billing",
    label: "Facturación y cobros",
    items: [
      {
        view: "credit-notes",
        label: "Notas de crédito",
        icon: FileMinus2,
        feature: "invoices",
      },
      {
        view: "receivables",
        label: "Cuentas por cobrar",
        icon: HandCoins,
        feature: "invoices",
      },
      {
        view: "collections",
        label: "Cobranza",
        icon: BadgeDollarSign,
        feature: "invoices",
      },
    ],
  },
  {
    key: "agenda",
    label: "Agenda",
    items: [
      { view: "schedule", label: "Actividades", icon: Activity },
      { view: "calendar", label: "Calendario", icon: CalendarDays },
    ],
  },
  {
    key: "communication",
    label: "Comunicación",
    items: [
      { view: "whatsapp", label: "WhatsApp", icon: MessageCircle },
      { view: "ai", label: "Asistente IA", icon: Sparkles },
    ],
  },
  {
    key: "files-access",
    label: "Archivos y acceso",
    items: [
      { view: "quotations", label: "Cotizaciones fuente", icon: Files },
      { view: "imports", label: "Importaciones", icon: FileUp },
      { view: "documentos", label: "Documentos", icon: FolderOpen },
      {
        view: "usuarios",
        label: "Usuarios",
        icon: UserCog,
        adminOnly: true,
      },
    ],
  },
  {
    key: "configuration",
    label: "Configuración",
    items: [
      { view: "ai-settings", label: "Inteligencia Artificial", icon: Settings2, adminOnly: true },
    ],
  },
] as const satisfies readonly NavigationGroup[];

export const navigationItems: readonly NavigationItem[] = (
  navigationGroups as readonly NavigationGroup[]
).flatMap((group) => group.items);
