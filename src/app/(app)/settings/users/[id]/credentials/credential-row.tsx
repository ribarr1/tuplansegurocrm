"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { RevealableCredentialField } from "@/components/ui/revealable-credential-field";
import { EditCredentialForm } from "./edit-credential-form";
import {
  revealAgentPortalCredentialAction,
  copyAgentPortalCredentialAction,
  deactivateAgentPortalCredentialAction,
} from "./actions";

export function CredentialRow({
  credentialId,
  userId,
  carrierId,
  portalName,
  portalUrl,
  carriers,
  usernameMasked,
  passwordMasked,
  canReveal,
  isActive,
}: {
  credentialId: string;
  userId: string;
  carrierId: string | null;
  portalName: string;
  portalUrl: string;
  carriers: { id: string; name: string }[];
  usernameMasked: string;
  passwordMasked: string;
  canReveal: boolean;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <EditCredentialForm
        credentialId={credentialId}
        userId={userId}
        carrierId={carrierId}
        portalName={portalName}
        portalUrl={portalUrl}
        carriers={carriers}
        onDone={() => setIsEditing(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="w-20 text-muted-foreground">Usuario</span>
        <RevealableCredentialField
          masked={usernameMasked}
          canReveal={canReveal}
          onReveal={() => revealAgentPortalCredentialAction(credentialId, "username")}
          onCopy={() => copyAgentPortalCredentialAction(credentialId, "username")}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-20 text-muted-foreground">Contraseña</span>
        <RevealableCredentialField
          masked={passwordMasked}
          canReveal={canReveal}
          onReveal={() => revealAgentPortalCredentialAction(credentialId, "password")}
          onCopy={() => copyAgentPortalCredentialAction(credentialId, "password")}
        />
      </div>
      <div className="flex gap-2">
        {canReveal && isActive && (
          <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setIsEditing(true)}>
            Editar
          </Button>
        )}
        {canReveal && isActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const result = await deactivateAgentPortalCredentialAction(credentialId, userId);
                if (result.error) alert(result.error);
              });
            }}
          >
            {isPending ? "Desactivando…" : "Desactivar"}
          </Button>
        )}
      </div>
    </div>
  );
}
