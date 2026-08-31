"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, SETTINGS_NAV_ITEM } from "@/components/shell/nav-items";

export function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col justify-between">
      <nav className="flex flex-col gap-1 p-3">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;

          if (!item.enabled) {
            return (
              <span
                key={item.href}
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/50"
                title="Disponible próximamente"
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-secondary text-secondary-foreground"
                  : "text-foreground/80 hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3">
        {SETTINGS_NAV_ITEM.enabled ? (
          <Link
            href={SETTINGS_NAV_ITEM.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith(SETTINGS_NAV_ITEM.href)
                ? "bg-secondary text-secondary-foreground"
                : "text-foreground/80 hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            <SETTINGS_NAV_ITEM.icon className="size-4" aria-hidden="true" />
            {SETTINGS_NAV_ITEM.label}
          </Link>
        ) : (
          <span
            className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/50"
            title="Disponible próximamente"
          >
            <SETTINGS_NAV_ITEM.icon className="size-4" aria-hidden="true" />
            {SETTINGS_NAV_ITEM.label}
          </span>
        )}
      </div>
    </div>
  );
}
