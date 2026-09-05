"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { RevealableCredentialField } from "@/components/ui/revealable-credential-field";
import { EditClientCredentialForm } from "./edit-client-credential-form";
import {
  revealClientPortalCredentialAction,
  copyClientPortalCredentialAction,
  deactivateClientPortalCredentialAction,
} from "./credentials-actions";

export function ClientCredentialRow({
  credentialId,
  personId,
  portalType,
  portalName,
  portalUrl,
  usernameMasked,
  passwordMasked,
  canReveal,
  isActive,
}: {
  credentialId: string;
  personId: string;
  portalType: string;
  portalName: string;
  portalUrl: string;
  usernameMasked: string;
  passwordMasked: string;
  canReveal: boolean;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <EditClientCredentialForm
        credentialId={credentialId}
        personId={personId}
        portalType={portalType}
        portalName={portalName}
        portalUrl={portalUrl}
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
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setIsEditing(true)}>
            Editar
          </Button>
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
        </div>
      )}
    </div>
  );
}
