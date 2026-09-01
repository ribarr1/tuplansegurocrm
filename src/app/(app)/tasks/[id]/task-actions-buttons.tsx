"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { completeTaskAction, cancelTaskAction } from "../actions";

export function TaskActionButtons({ taskId, status }: { taskId: string; status: string }) {
  const [isPending, startTransition] = useTransition();
  const isClosed = status === "COMPLETED" || status === "CANCELLED";

  if (isClosed) return null;

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await completeTaskAction(taskId);
            if (result.error) alert(result.error);
          })
        }
      >
        {isPending ? "Guardando…" : "Completar"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await cancelTaskAction(taskId);
            if (result.error) alert(result.error);
          })
        }
      >
        {isPending ? "Guardando…" : "Cancelar"}
      </Button>
    </div>
  );
}
