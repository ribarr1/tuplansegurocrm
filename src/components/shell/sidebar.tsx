import Image from "next/image";
import type { UserRole } from "@/generated/prisma/client";
import { NavContent } from "@/components/shell/nav-content";

export function Sidebar({ role }: { role: UserRole }) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <Image
          src="/brand/logo-horizontal.png"
          alt="TuPlanSeguro USA"
          width={160}
          height={32}
          className="h-8 w-auto"
          priority
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavContent role={role} />
      </div>
    </aside>
  );
}
