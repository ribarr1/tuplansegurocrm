"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setGoogleConnectorSecretsAction, setMetaConnectorSecretsAction } from "./actions";

export function ConnectorConfigForm({
  credentialId,
  source,
  hasConnectorSecrets,
}: {
  credentialId: string;
  source: "GOOGLE" | "META";
  hasConnectorSecrets: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result =
        source === "GOOGLE"
          ? await setGoogleConnectorSecretsAction(credentialId, formData)
          : await setMetaConnectorSecretsAction(credentialId, formData);
      if (result.error) setError(result.error);
      else {
        setSuccess(true);
        setIsOpen(false);
      }
    });
  }

  if (!isOpen) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(true)}>
          {hasConnectorSecrets ? "Reconfigurar conector" : "Configurar conector"}
        </Button>
        {success && <p className="text-xs text-emerald-600">Guardado.</p>}
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-2 rounded-md border p-3 text-left">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {source === "GOOGLE" ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`verificationKey-${credentialId}`}>Clave de verificación de Google (google_key)</Label>
          <Input id={`verificationKey-${credentialId}`} name="verificationKey" required />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`appSecret-${credentialId}`}>App Secret</Label>
            <Input id={`appSecret-${credentialId}`} name="appSecret" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`pageAccessToken-${credentialId}`}>Page Access Token</Label>
            <Input id={`pageAccessToken-${credentialId}`} name="pageAccessToken" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`verifyToken-${credentialId}`}>Verify Token (elegido por ti)</Label>
            <Input id={`verifyToken-${credentialId}`} name="verifyToken" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`pageId-${credentialId}`}>Page ID</Label>
            <Input id={`pageId-${credentialId}`} name="pageId" required />
          </div>
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
