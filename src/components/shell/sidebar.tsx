import Image from "next/image";
import type { UserRole } from "@/generated/prisma/client";
import { NavContent } from "@/components/shell/nav-content";

export function Sidebar({ role }: { role: UserRole }) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        <div className="flex items-center gap-2 rounded-lg bg-white/95 px-3 py-1.5">
          <Image
            src="/brand/logo-horizontal.png"
            alt="Tu Plan Seguro USA"
            width={160}
            height={32}
            className="h-7 w-auto"
            priority
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavContent role={role} />
      </div>
    </aside>
  );
}
