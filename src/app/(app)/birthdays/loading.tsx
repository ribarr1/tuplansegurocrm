import { Skeleton } from "@/components/ui/skeleton";

export default function BirthdaysLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
