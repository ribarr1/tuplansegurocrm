import type { AuthorizedUser } from "@/lib/authorization";
import { getGoogleReviewInfo } from "@/services/google-reviews.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GOOGLE_REVIEW_STATUS_LABELS } from "@/lib/labels";
import { formatDateOnlyUS } from "@/lib/date-only";
import { GoogleReviewStatusActions } from "./google-review-status-actions";

const GOOGLE_REVIEW_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  PENDING_REQUEST: "outline",
  REQUESTED: "secondary",
  PUBLISHED: "default",
  DO_NOT_REQUEST: "outline",
};

// Fase 025.5 (UAT-10) — exclusivamente administrativo: esta card SOLO
// se renderiza cuando actor.role === "ADMIN" (ver page.tsx); el
// servicio (getGoogleReviewInfo) también lo rechaza server-side de
// forma independiente, defensa en profundidad real, nunca solo
// ocultar el componente.
export async function GoogleReviewCard({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const info = await getGoogleReviewInfo(actor, personId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Reseña de Google</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Estado</span>
          <Badge variant={GOOGLE_REVIEW_BADGE_VARIANT[info.googleReviewStatus]}>
            {GOOGLE_REVIEW_STATUS_LABELS[info.googleReviewStatus]}
          </Badge>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Solicitada el</span>
          <span>{info.reviewRequestedAt ? formatDateOnlyUS(info.reviewRequestedAt) : "—"}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Publicada el</span>
          <span>{info.reviewPublishedAt ? formatDateOnlyUS(info.reviewPublishedAt) : "—"}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Último cambio por</span>
          <span>{info.reviewStatusUpdatedBy?.name ?? "—"}</span>
        </div>
        <GoogleReviewStatusActions personId={personId} currentStatus={info.googleReviewStatus} />
      </CardContent>
    </Card>
  );
}
