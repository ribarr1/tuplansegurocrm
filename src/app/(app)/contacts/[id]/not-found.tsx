import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ContactNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 p-16 text-center">
      <p className="text-sm text-muted-foreground">No encontramos ese contacto.</p>
      <Button variant="outline" nativeButton={false} render={<Link href="/contacts" />}>
        Volver a Contactos
      </Button>
    </div>
  );
}
