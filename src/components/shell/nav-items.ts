import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  FileText,
  CheckSquare,
  DollarSign,
  Cake,
  Settings,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
};

// Solo "Dashboard", "Contactos" y "Pólizas" tienen módulo real en esta
// fase. El resto queda visible (para transmitir el mapa completo del
// CRM) pero deshabilitado — nunca navegan a una página que finja
// funcionalidad que no existe todavía.
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Contactos", href: "/contacts", icon: Users, enabled: true },
  { label: "Pólizas", href: "/policies", icon: FileText, enabled: true },
  { label: "Tareas", href: "/tasks", icon: CheckSquare, enabled: false },
  { label: "Comisiones", href: "/commissions", icon: DollarSign, enabled: false },
  { label: "Cumpleaños", href: "/birthdays", icon: Cake, enabled: false },
];

export const SETTINGS_NAV_ITEM: NavItem = {
  label: "Configuración",
  href: "/settings",
  icon: Settings,
  enabled: false,
};
