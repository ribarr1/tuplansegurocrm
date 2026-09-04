"use client";

import { useState } from "react";
import Image from "next/image";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavContent } from "@/components/shell/nav-content";
import type { UserRole } from "@/generated/prisma/client";

export function MobileNav({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menú" />}
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
        <SheetHeader className="h-16 justify-center border-b border-sidebar-border px-4">
          <SheetTitle>
            <div className="flex items-center gap-2 rounded-lg bg-white/95 px-3 py-1.5">
              <Image
                src="/brand/logo-horizontal.png"
                alt="Tu Plan Seguro USA"
                width={160}
                height={32}
                className="h-7 w-auto"
              />
            </div>
          </SheetTitle>
        </SheetHeader>
        <NavContent role={role} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
