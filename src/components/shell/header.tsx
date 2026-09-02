"use client";

import { usePathname } from "next/navigation";
import { MobileNav } from "@/components/shell/mobile-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { NAV_ITEMS, SETTINGS_NAV_ITEM } from "@/components/shell/nav-items";
import type { UserRole } from "@/generated/prisma/client";

function pageTitle(pathname: string): string {
  const match = [...NAV_ITEMS, SETTINGS_NAV_ITEM].find((item) =>
    pathname.startsWith(item.href)
  );
  return match?.label ?? "TuPlanSeguro USA";
}

export function Header({ name, role }: { name: string; role: UserRole }) {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-2">
        <MobileNav role={role} />
        <h1 className="text-sm font-medium">{pageTitle(pathname)}</h1>
      </div>
      <div className="flex items-center gap-3">
        <form method="GET" action="/search" className="hidden sm:block">
          <input
            type="text"
            name="q"
            placeholder="Buscar…"
            className="h-8 w-48 rounded-md border border-input bg-background px-2.5 text-sm md:w-64"
          />
        </form>
        <UserMenu name={name} role={role} />
      </div>
    </header>
  );
}
