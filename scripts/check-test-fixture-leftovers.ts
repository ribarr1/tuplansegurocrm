import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Fase 025.4 (UAT-08, parte 3 — evitar recurrencia).
//
// Los tests de integración de este proyecto corren contra la base de
// datos REAL de DEV (ver docs/DECISIONS.md) — cada suite crea sus
// propios fixtures (usuarios/personas/pólizas @test.local o con
// nombres sintéticos) y los borra en su `afterAll`. Ese `afterAll` NO
// se ejecuta si el proceso de test se interrumpe a la mitad (Ctrl+C,
// timeout externo, crash) — eso fue la causa real del incidente de
// UAT-08 (12 usuarios `@test.local` quedaron huérfanos tras una
// corrida interrumpida de policies.service.test.ts durante Fase
// 025.3), NO un bug de cleanup en el código del test.
//
// Este script es la red de seguridad: se corre manualmente después de
// una sesión de tests (o se agrega a un paso de CI) para detectar
// fixtures que sobrevivieron. Nunca borra nada automáticamente — solo
// reporta, para que un humano decida.
async function main() {
  const testLocalUsers = await prisma.user.findMany({
    where: { email: { endsWith: "@test.local" } },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (testLocalUsers.length === 0) {
    console.log("OK — no hay usuarios @test.local en la base. Sin fixtures filtrados.");
  } else {
    console.log(`ALERTA — ${testLocalUsers.length} usuario(s) @test.local encontrados en DEV:`);
    for (const u of testLocalUsers) {
      console.log(`  - ${u.email} (role=${u.role}, createdAt=${u.createdAt.toISOString()})`);
    }
    console.log(
      "Revisa cuál suite los creó (por el prefijo del correo) y por qué su afterAll no corrió " +
        "(lo más probable: la corrida se interrumpió a la mitad). Nunca los borres a ciegas — " +
        "confirma primero que no tengan dependencias reales (ver el patrón en " +
        "docs/DECISIONS.md, Fase 025.4)."
    );
  }

  // Personas/hogares sintéticos de prueba también pueden quedar
  // huérfanos si un test crea Person/Household fuera del patrón
  // @test.local (algunos archivos usan "Test Person<timestamp>" como
  // lastName) — reporte informativo, nunca se borra aquí.
  const syntheticPeople = await prisma.person.count({
    where: { lastName: { contains: "Test", mode: "insensitive" } },
  });
  if (syntheticPeople > 0) {
    console.log(
      `Nota: ${syntheticPeople} Person con "Test" en el apellido (puede incluir nombres reales legítimos ` +
        "que coincidan por casualidad — no es evidencia por sí sola, solo una pista para revisar a mano)."
    );
  }

  process.exitCode = testLocalUsers.length > 0 ? 1 : 0;
}
main().finally(() => prisma.$disconnect());
