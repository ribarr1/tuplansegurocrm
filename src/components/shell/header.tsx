"use client";

import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { MobileNav } from "@/components/shell/mobile-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { NAV_ITEMS, SETTINGS_NAV_ITEM } from "@/components/shell/nav-items";
import type { UserRole } from "@/generated/prisma/client";

function pageTitle(pathname: string): string {
  const match = [...NAV_ITEMS, SETTINGS_NAV_ITEM].find((item) =>
    pathname.startsWith(item.href)
  );
  return match?.label ?? "Tu Plan Seguro Usa";
}

export function Header({ name, role }: { name: string; role: UserRole }) {
  const pathname = usePathname();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <MobileNav role={role} />
        <h1 className="text-sm font-semibold text-foreground">{pageTitle(pathname)}</h1>
      </div>
      <div className="flex items-center gap-3">
        <form method="GET" action="/search" className="hidden sm:block">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              name="q"
              placeholder="Buscar…"
              className="h-9 w-48 rounded-full border border-input bg-muted/40 pl-8 pr-3 text-sm outline-none transition-colors focus:border-ring focus:bg-background md:w-64"
            />
          </div>
        </form>
        <UserMenu name={name} role={role} />
      </div>
    </header>
  );
}
