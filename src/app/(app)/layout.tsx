import { requireUser } from "@/lib/authorization";
import { Sidebar } from "@/components/shell/sidebar";
import { Header } from "@/components/shell/header";

// Layout del área protegida del CRM. requireUser() es la verificación
// real (sesión válida + User.isActive) — src/proxy.ts solo hace una
// redirección optimista antes de llegar aquí (ver docs/SECURITY.md).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header name={user.name} role={user.role} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
