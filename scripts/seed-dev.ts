import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Datos ficticios de CATÁLOGO (Carrier/Product) para poder probar el
// flujo de pólizas en desarrollo, ya que la base de datos empieza sin
// ningún Carrier/Product real cargado. Deliberadamente NO crea personas,
// hogares ni pólizas — ver CLAUDE.md ("NO crear seed de clientes").
//
// Idempotente: usa el nombre del Carrier (único en el schema) como
// clave de "existe / no existe" antes de crear; se puede correr varias
// veces sin duplicar filas. No se ejecuta automáticamente en ningún
// flujo (build/dev/test) — solo con `npm run seed:dev`.

const CARRIERS: {
  name: string;
  products: { name: string; policyType: "HEALTH" | "LIFE" | "SUPPLEMENTAL" | "DENTAL" | "FINAL_EXPENSE"; planYear?: number }[];
}[] = [
  {
    name: "Ambetter (Dev Seed)",
    products: [
      { name: "Ambetter Balanced Care 3", policyType: "HEALTH", planYear: 2026 },
      { name: "Ambetter Secure Care 1", policyType: "HEALTH", planYear: 2026 },
    ],
  },
  {
    name: "Molina Healthcare (Dev Seed)",
    products: [{ name: "Molina Marketplace Bronze", policyType: "HEALTH", planYear: 2026 }],
  },
  {
    name: "Aflac (Dev Seed)",
    products: [{ name: "Aflac Accident Advantage", policyType: "SUPPLEMENTAL" }],
  },
  {
    name: "Humana (Dev Seed)",
    products: [{ name: "Humana Dental Value Plan", policyType: "DENTAL" }],
  },
  {
    name: "Mutual of Omaha (Dev Seed)",
    products: [{ name: "Living Promise Final Expense", policyType: "FINAL_EXPENSE" }],
  },
];

async function main() {
  for (const carrierSeed of CARRIERS) {
    const carrier = await prisma.carrier.upsert({
      where: { name: carrierSeed.name },
      update: {},
      create: { name: carrierSeed.name },
    });

    for (const productSeed of carrierSeed.products) {
      const existing = await prisma.product.findFirst({
        where: { carrierId: carrier.id, name: productSeed.name },
      });
      if (existing) continue;

      await prisma.product.create({
        data: {
          carrierId: carrier.id,
          name: productSeed.name,
          policyType: productSeed.policyType,
          planYear: productSeed.planYear,
        },
      });
    }
  }

  console.log("Catálogo de desarrollo (Carrier/Product) listo.");
}

main()
  .catch((e) => {
    console.error("Error sembrando catálogo de desarrollo:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
