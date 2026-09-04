"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { RevealableCredentialField } from "@/components/ui/revealable-credential-field";
import {
  revealClientPortalCredentialAction,
  copyClientPortalCredentialAction,
  deactivateClientPortalCredentialAction,
} from "./credentials-actions";

export function ClientCredentialRow({
  credentialId,
  personId,
  usernameMasked,
  passwordMasked,
  canReveal,
  isActive,
}: {
  credentialId: string;
  personId: string;
  usernameMasked: string;
  passwordMasked: string;
  canReveal: boolean;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="w-20 text-muted-foreground">Usuario</span>
        <RevealableCredentialField
          masked={usernameMasked}
          canReveal={canReveal}
          onReveal={() => revealClientPortalCredentialAction(credentialId, "username")}
          onCopy={() => copyClientPortalCredentialAction(credentialId, "username")}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-20 text-muted-foreground">Contraseña</span>
        <RevealableCredentialField
          masked={passwordMasked}
          canReveal={canReveal}
          onReveal={() => revealClientPortalCredentialAction(credentialId, "password")}
          onCopy={() => copyClientPortalCredentialAction(credentialId, "password")}
        />
      </div>
      {isActive && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const result = await deactivateClientPortalCredentialAction(credentialId, personId);
              if (result.error) alert(result.error);
            });
          }}
        >
          {isPending ? "Desactivando…" : "Desactivar"}
        </Button>
      )}
    </div>
  );
}
