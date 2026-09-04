"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setAgentLicenseStatusAction } from "./actions";

export function ToggleLicenseStatusButton({
  licenseId,
  userId,
  status,
}: {
  licenseId: string;
  userId: string;
  status: "ACTIVE" | "INACTIVE" | "EXPIRED";
}) {
  const [isPending, startTransition] = useTransition();
  if (status === "EXPIRED") return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await setAgentLicenseStatusAction(
            licenseId,
            userId,
            status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
          );
          if (result.error) alert(result.error);
        });
      }}
    >
      {isPending ? "Guardando…" : status === "ACTIVE" ? "Desactivar" : "Activar"}
    </Button>
  );
}
