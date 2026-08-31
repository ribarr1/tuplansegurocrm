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
        onClick={() => startTransition(() => completeTaskAction(taskId))}
      >
        {isPending ? "Guardando…" : "Completar"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => startTransition(() => cancelTaskAction(taskId))}
      >
        {isPending ? "Guardando…" : "Cancelar"}
      </Button>
    </div>
  );
}
