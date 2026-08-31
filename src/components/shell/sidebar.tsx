import type { UserRole } from "@/generated/prisma/client";
import { NavContent } from "@/components/shell/nav-content";

export function Sidebar({ role }: { role: UserRole }) {
  return (
    <aside className="hidden w-64 shrink-0 border-r bg-background md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-sm font-semibold tracking-tight">TuPlanSeguro USA</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavContent role={role} />
      </div>
    </aside>
  );
}
