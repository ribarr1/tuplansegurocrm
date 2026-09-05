import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Fase 025.4 (UAT-03/07) — acción administrativa puntual, un solo uso,
// idempotente. Rubén Ibarra es ADMIN pero también agente real de la
// agencia (licencias/contratos ya existentes en DEV lo confirman, y el
// propietario del sistema lo confirmó explícitamente en la ficha de
// UAT). Se identifica de forma inequívoca: es el ÚNICO User real en la
// base (sin prefijo sintético de test), rol ADMIN. Nunca se adivina —
// si en el futuro existieran varios ADMIN reales, este script debe
// dejar de usarse tal cual y la marca debe hacerse desde la UI
// (Settings > Usuarios > "¿Este usuario también es agente?").
async function main() {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", email: { not: { endsWith: "@test.local" } } },
    select: { id: true, name: true, email: true, isAgent: true },
  });

  if (admins.length !== 1) {
    console.log(
      `No se puede identificar a Rubén de forma inequívoca (se encontraron ${admins.length} ADMIN reales). ` +
        "No se modifica nada — márcalo manualmente desde Settings > Usuarios."
    );
    return;
  }

  const ruben = admins[0];
  if (ruben.isAgent) {
    console.log(`Ya está marcado como agente: ${ruben.name} (sin cambios, idempotente).`);
    return;
  }

  await prisma.user.update({ where: { id: ruben.id }, data: { isAgent: true } });
  console.log(`Marcado como agente: ${ruben.name} (${ruben.id}).`);
}
main().finally(() => prisma.$disconnect());
