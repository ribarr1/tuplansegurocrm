import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPremiumTrackingForPolicy } from "@/services/premiums.service";
import { AppError } from "@/services/errors";
import { Button } from "@/components/ui/button";
import { getDateOnlyParts } from "@/lib/date-only";
import { PremiumDetailForm } from "./premium-detail-form";
import { updatePremiumTrackingAction } from "./actions";

function toDateInputValue(date: Date | null): string | undefined {
  if (!date) return undefined;
  const { year, month, day } = getDateOnlyParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default async function EditPremiumTrackingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();

  let premium;
  try {
    premium = await getPremiumTrackingForPolicy(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    if (error instanceof AppError && error.code === "FORBIDDEN") {
      return (
        <div className="flex flex-col items-center gap-3 p-16 text-center">
          <p className="text-sm text-muted-foreground">No tienes acceso a esta póliza.</p>
          <Button variant="outline" nativeButton={false} render={<Link href="/premiums" />}>
            Volver
          </Button>
        </div>
      );
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-lg font-semibold">
        Seguimiento de pago — {premium.policyNumber ?? "Póliza sin número"}
      </h2>
      <PremiumDetailForm
        action={updatePremiumTrackingAction.bind(null, id)}
        defaultValues={{
          premiumAmount: premium.premiumAmount?.toString(),
          billingFrequency: premium.billingFrequency ?? undefined,
          nextPaymentDueDate: toDateInputValue(premium.nextPaymentDueDate),
          paymentStatus: premium.paymentStatus ?? undefined,
          autopay: premium.autopay,
          needsPaymentAssistance: premium.needsPaymentAssistance,
        }}
      />
    </div>
  );
}
