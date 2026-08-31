import { requireUser } from "@/lib/authorization";
import { LogoutButton } from "./logout-button";

// Página protegida mínima únicamente para verificar Auth. El CRM
// funcional (clientes, pólizas, etc.) se construye en fases posteriores.
export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-xl font-semibold">CRM TuPlanSeguro USA</h1>
      <div className="flex flex-col items-center gap-1 text-sm text-zinc-600">
        <p>{user.name}</p>
        <p>{user.email}</p>
        <p className="font-medium">{user.role}</p>
      </div>
      <LogoutButton />
    </div>
  );
}
