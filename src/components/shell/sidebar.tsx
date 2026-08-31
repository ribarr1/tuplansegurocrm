import { NavContent } from "@/components/shell/nav-content";

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r bg-background md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-sm font-semibold tracking-tight">TuPlanSeguro USA</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavContent />
      </div>
    </aside>
  );
}
