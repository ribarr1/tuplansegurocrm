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

// "Dashboard", "Contactos", "Pólizas", "Tareas", "Comisiones",
// "Cumpleaños" y "Configuración" tienen módulo real en esta fase. El
// resto queda visible (para transmitir el mapa completo del CRM) pero
// deshabilitado — nunca navegan a una página que finja funcionalidad
// que no existe todavía.
//
// "Comisiones" es FINANCIERO/RESTRINGIDO: ASSISTANT no debe verlo en el
// menú (ver filtrado por rol en el componente de shell) y además recibe
// FORBIDDEN si navega directamente a /commissions — no basta con
// ocultarlo en la UI (ver docs/DECISIONS.md, Fase 016).
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Contactos", href: "/contacts", icon: Users, enabled: true },
  { label: "Pólizas", href: "/policies", icon: FileText, enabled: true },
  { label: "Tareas", href: "/tasks", icon: CheckSquare, enabled: true },
  { label: "Comisiones", href: "/commissions", icon: DollarSign, enabled: true },
  { label: "Cumpleaños", href: "/birthdays", icon: Cake, enabled: true },
];

export const SETTINGS_NAV_ITEM: NavItem = {
  label: "Configuración",
  href: "/settings",
  icon: Settings,
  enabled: true,
};
