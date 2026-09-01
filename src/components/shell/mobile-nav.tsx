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
        <SheetHeader className="h-14 justify-center border-b border-sidebar-border px-4">
          <SheetTitle>
            <Image
              src="/brand/logo-horizontal.png"
              alt="TuPlanSeguro USA"
              width={160}
              height={32}
              className="h-8 w-auto"
            />
          </SheetTitle>
        </SheetHeader>
        <NavContent role={role} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
