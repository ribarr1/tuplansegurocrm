import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { listAgentCarrierContracts } from "@/services/agent-carrier-contracts.service";
import { listActiveCarriers } from "@/services/policies.service";
import { listAllUsers } from "@/services/users.service";
import { AppError } from "@/services/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { POLICY_TYPE_LABELS } from "@/lib/labels";
import { CreateContractForm } from "./create-contract-form";
import { ToggleContractStatusButton } from "./toggle-contract-status-button";

export default async function AgentContractsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();

  let contracts;
  try {
    contracts = await listAgentCarrierContracts(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return (
        <div className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm text-muted-foreground">No tienes acceso a los contratos de este usuario.</p>
        </div>
      );
    }
    throw error;
  }

  const [users, carriers] = await Promise.all([
    actor.role === "ADMIN" ? listAllUsers(actor) : Promise.resolve([]),
    actor.role === "ADMIN" ? listActiveCarriers(actor) : Promise.resolve([]),
  ]);
  const targetUser = users.find((u) => u.id === id);
  if (actor.role === "ADMIN" && !targetUser) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">
          Contratos con compañías{targetUser ? ` — ${targetUser.name}` : ""}
        </h2>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/users" />}>
          Volver a Usuarios
        </Button>
      </div>

      {actor.role === "ADMIN" && <CreateContractForm userId={id} carriers={carriers} />}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Compañía</TableHead>
              <TableHead>Tipo de póliza</TableHead>
              <TableHead>Estado (US)</TableHead>
              <TableHead>Estatus</TableHead>
              <TableHead>Notas</TableHead>
              {actor.role === "ADMIN" && <TableHead className="text-right">Acciones</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Sin contratos registrados.
                </TableCell>
              </TableRow>
            ) : (
              contracts.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell className="font-medium">{contract.carrier.name}</TableCell>
                  <TableCell>{POLICY_TYPE_LABELS[contract.policyType]}</TableCell>
                  <TableCell>{contract.state}</TableCell>
                  <TableCell>
                    <Badge variant={contract.status === "ACTIVE" ? "default" : "outline"}>
                      {contract.status === "ACTIVE" ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {contract.notes ?? "—"}
                  </TableCell>
                  {actor.role === "ADMIN" && (
                    <TableCell className="text-right">
                      <ToggleContractStatusButton
                        contractId={contract.id}
                        userId={id}
                        status={contract.status}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
