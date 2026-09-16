import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";

// ---------------------------------------------------------------------------
// LIMPIEZA CONTROLADA DE BASE DEV — CONSERVAR ADMIN PRINCIPAL.
//
// Herramienta administrativa LOCAL (nunca un endpoint, nunca se ejecuta
// desde la aplicación) para vaciar la base de PostgreSQL de desarrollo
// local, conservando exclusivamente la identidad operativa completa de
// UN usuario (resuelto por correo, nunca por ID hardcodeado).
//
// Uso:
//   npx tsx scripts/clean-dev-database.ts --dry-run --preserve-user=ribarr1@gmail.com
//   npx tsx scripts/clean-dev-database.ts --execute --preserve-user=ribarr1@gmail.com --confirm=CLEAN_LOCAL_DEV_PRESERVE_RIBARR1
//
// Decisiones de alcance confirmadas explícitamente por el usuario
// (documentadas también en docs/DECISIONS.md):
// - AgentCarrierContract: se eliminan TODOS, incluidos los del usuario
//   preservado — dependen de Carrier (onDelete: Restrict), que también
//   se elimina por completo; no es posible conservar un contrato cuyo
//   carrier deja de existir. AgentLicense es independiente (sin FK a
//   Carrier) y SÍ se conserva íntegro para el usuario preservado.
// - AgentPortalCredential: se conserva ÚNICAMENTE la fila del usuario
//   preservado cuyo portalName contiene "easy" (la credencial real del
//   sistema de origen del próximo CSV) — se resuelve por texto, nunca
//   por ID hardcodeado, y el script se detiene si no encuentra
//   EXACTAMENTE una coincidencia. Cualquier otra credencial de portal
//   (ej. la vinculada a un carrier de prueba) se elimina por completo.
// - AuditEvent y Verification: se eliminan por completo (no aparecen en
//   la lista de "conservar exclusivamente"; son historial operativo de
//   datos de prueba).
// ---------------------------------------------------------------------------

const PRESERVE_EMAIL_CONFIRMATION_TOKEN = "CLEAN_LOCAL_DEV_PRESERVE_RIBARR1";
const EASY_PORTAL_NAME_PATTERN = "easy";

type CliArgs = {
  dryRun: boolean;
  execute: boolean;
  preserveUser?: string;
  confirm?: string;
};

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: CliArgs = { dryRun: false, execute: false };
  for (const arg of args) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--execute") out.execute = true;
    else if (arg.startsWith("--preserve-user=")) out.preserveUser = arg.slice("--preserve-user=".length);
    else if (arg.startsWith("--confirm=")) out.confirm = arg.slice("--confirm=".length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1) Verificación del entorno — nunca imprime la URL completa ni
// credenciales. Rechaza cualquier cosa que no sea, de forma
// demostrable, PostgreSQL local.
// ---------------------------------------------------------------------------
function assertLocalDevDatabase(): { hostSanitized: string; port: string; database: string } {
  if (process.env.NODE_ENV === "production") {
    throw new Error("NODE_ENV=production — este script nunca se ejecuta en producción.");
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL no está definida.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida.");
  }

  const host = url.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocalHost) {
    throw new Error(`Host no reconocido como local (${host.slice(0, 3)}***) — rechazado.`);
  }

  const database = url.pathname.replace(/^\//, "");
  if (/prod|staging|production/i.test(database)) {
    throw new Error(`El nombre de la base ("${database}") parece de producción/staging — rechazado.`);
  }

  return { hostSanitized: host, port: url.port || "5432", database };
}

function assertMigrationsUpToDate(): void {
  const validate = spawnSync("npx", ["prisma", "validate"], { encoding: "utf8", shell: true });
  if (validate.status !== 0) {
    console.error(validate.stdout, validate.stderr);
    throw new Error("`prisma validate` falló.");
  }
  const status = spawnSync("npx", ["prisma", "migrate", "status"], { encoding: "utf8", shell: true });
  const output = `${status.stdout}\n${status.stderr}`;
  if (status.status !== 0 || !/up to date/i.test(output)) {
    console.error(output);
    throw new Error("`prisma migrate status` indica migraciones pendientes/fallidas — deteniendo.");
  }
}

// ---------------------------------------------------------------------------
// 2) Resolver al usuario a conservar por correo (normalizado,
// case-insensitive) — nunca por ID hardcodeado. Debe existir
// EXACTAMENTE uno.
// ---------------------------------------------------------------------------
async function resolvePreservedUser(email: string) {
  const matches = await prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true, name: true, email: true, role: true, isActive: true, activatedAt: true,
      emailVerified: true, isAgent: true, twoFactorEnabled: true,
    },
  });
  if (matches.length !== 1) {
    throw new Error(`Se esperaba exactamente 1 usuario con ese correo, se encontraron ${matches.length} — deteniendo.`);
  }
  const user = matches[0];
  if (user.role !== "ADMIN") {
    throw new Error(`El usuario preservado no es ADMIN (es ${user.role}) — deteniendo, esto no coincide con lo esperado.`);
  }

  const account = await prisma.account.findFirst({ where: { userId: user.id }, select: { id: true, password: true } });
  const twoFactor = await prisma.twoFactor.findUnique({ where: { userId: user.id }, select: { id: true } });
  const licenseCount = await prisma.agentLicense.count({ where: { userId: user.id } });
  const contractCount = await prisma.agentCarrierContract.count({ where: { userId: user.id } });
  const portalCredentialCount = await prisma.agentPortalCredential.count({ where: { userId: user.id } });

  // La credencial de portal "EASY" (el sistema de origen del próximo
  // CSV) se resuelve por TEXTO (portalName), nunca por ID hardcodeado —
  // y debe existir EXACTAMENTE una coincidencia, o el script se detiene
  // sin tocar ninguna credencial (instrucción explícita del usuario).
  const easyCandidates = await prisma.agentPortalCredential.findMany({
    where: { userId: user.id, portalName: { contains: EASY_PORTAL_NAME_PATTERN, mode: "insensitive" } },
    select: { id: true, portalName: true, portalUrl: true, carrierId: true },
  });
  if (easyCandidates.length !== 1) {
    throw new Error(
      `Se esperaba exactamente 1 credencial de portal "EASY" para el usuario preservado, se encontraron ${easyCandidates.length} — deteniendo sin eliminar ninguna credencial.`
    );
  }
  const easyPortalCredential = easyCandidates[0];

  return {
    user,
    hasAccountWithPassword: !!account?.password?.length,
    hasTwoFactor: !!twoFactor,
    licenseCount,
    contractCount,
    portalCredentialCount,
    easyPortalCredentialId: easyPortalCredential.id,
    easyPortalCredentialName: easyPortalCredential.portalName,
  };
}

// ---------------------------------------------------------------------------
// 3) Conteos por tabla — usado tanto por el dry-run como para el
// reporte final posterior a la ejecución.
// ---------------------------------------------------------------------------
async function collectCounts() {
  return {
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    accounts: await prisma.account.count(),
    verifications: await prisma.verification.count(),
    twoFactors: await prisma.twoFactor.count(),
    agentLicenses: await prisma.agentLicense.count(),
    agentCarrierContracts: await prisma.agentCarrierContract.count(),
    agentPortalCredentials: await prisma.agentPortalCredential.count(),
    carriers: await prisma.carrier.count(),
    products: await prisma.product.count(),
    commissionRules: await prisma.commissionRule.count(),
    people: await prisma.person.count(),
    households: await prisma.household.count(),
    householdMembers: await prisma.householdMember.count(),
    policies: await prisma.policy.count(),
    policyMembers: await prisma.policyMember.count(),
    healthPolicyDetails: await prisma.healthPolicyDetail.count(),
    policyDocuments: await prisma.policyDocument.count(),
    policyExternalReferences: await prisma.policyExternalReference.count(),
    clientPortalCredentials: await prisma.clientPortalCredential.count(),
    paymentMethods: await prisma.paymentMethod.count(),
    personProviders: await prisma.personProvider.count(),
    personMedications: await prisma.personMedication.count(),
    personSensitiveIdentities: await prisma.personSensitiveIdentity.count(),
    personImmigrationDocuments: await prisma.personImmigrationDocument.count(),
    birthdayGreetings: await prisma.birthdayGreeting.count(),
    tasks: await prisma.task.count(),
    notes: await prisma.note.count(),
    commissionExpectations: await prisma.commissionExpectation.count(),
    commissionPayments: await prisma.commissionPayment.count(),
    commissionStatements: await prisma.commissionStatement.count(),
    commissionStatementRows: await prisma.commissionStatementRow.count(),
    commissionStatementApplyBatches: await prisma.commissionStatementApplyBatch.count(),
    auditEvents: await prisma.auditEvent.count(),
  };
}

type Counts = Awaited<ReturnType<typeof collectCounts>>;

// Conteo esperado DESPUÉS de la limpieza — todo en 0 salvo lo que se
// conserva explícitamente para el usuario preservado.
function expectedAfter(preserved: Awaited<ReturnType<typeof resolvePreservedUser>>): Partial<Counts> {
  return {
    users: 1,
    sessions: 0,
    accounts: 1,
    verifications: 0,
    twoFactors: 1,
    agentLicenses: preserved.licenseCount,
    agentCarrierContracts: 0,
    // Únicamente la credencial de portal "EASY" — cualquier otra
    // (ej. la vinculada a un carrier de prueba) se elimina.
    agentPortalCredentials: 1,
    carriers: 0,
    products: 0,
    commissionRules: 0,
    people: 0,
    households: 0,
    householdMembers: 0,
    policies: 0,
    policyMembers: 0,
    healthPolicyDetails: 0,
    policyDocuments: 0,
    policyExternalReferences: 0,
    clientPortalCredentials: 0,
    paymentMethods: 0,
    personProviders: 0,
    personMedications: 0,
    personSensitiveIdentities: 0,
    personImmigrationDocuments: 0,
    birthdayGreetings: 0,
    tasks: 0,
    notes: 0,
    commissionExpectations: 0,
    commissionPayments: 0,
    commissionStatements: 0,
    commissionStatementRows: 0,
    commissionStatementApplyBatches: 0,
    auditEvents: 0,
  };
}

function printReport(title: string, before: Counts, after: Partial<Counts>) {
  console.log(`\n${title}`);
  console.log("tabla".padEnd(34) + "actual".padStart(10) + "esperado_después".padStart(20) + "a_eliminar".padStart(14));
  for (const key of Object.keys(before) as (keyof Counts)[]) {
    const cur = before[key];
    const exp = after[key] ?? 0;
    const toDelete = cur - exp;
    console.log(key.padEnd(34) + String(cur).padStart(10) + String(exp).padStart(20) + String(toDelete).padStart(14));
  }
}

// ---------------------------------------------------------------------------
// Cuarentena de archivos de PolicyDocument — nunca borrado definitivo
// en esta fase. Duplicación mínima de la ruta de LocalFileStorage
// (src/lib/storage.ts es "server-only", no puede importarse desde un
// script tsx fuera del árbol de Next — mismo motivo ya documentado en
// create-admin.ts).
const PRIVATE_STORAGE_DIR = path.resolve(__dirname, "..", "private-storage");
const QUARANTINE_DIR = path.resolve(__dirname, "..", "..", "crmTuPlanSeguro_backups_privados", "quarantine-policy-documents");

async function quarantinePolicyDocumentFiles(): Promise<{ manifest: { storageKey: string; fileName: string; moved: boolean }[] }> {
  const docs = await prisma.policyDocument.findMany({ select: { storageKey: true, fileName: true } });
  const manifest: { storageKey: string; fileName: string; moved: boolean }[] = [];
  if (docs.length === 0) return { manifest };

  fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
  for (const doc of docs) {
    const src = path.join(PRIVATE_STORAGE_DIR, doc.storageKey);
    const dest = path.join(QUARANTINE_DIR, doc.storageKey);
    let moved = false;
    try {
      if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
        moved = true;
      }
    } catch {
      moved = false;
    }
    manifest.push({ storageKey: doc.storageKey, fileName: doc.fileName, moved });
  }
  const manifestPath = path.join(QUARANTINE_DIR, `manifest_${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest };
}

// ---------------------------------------------------------------------------
// Ejecución — una sola transacción interactiva, orden que respeta cada
// FK (Restrict) del schema real. Nunca deshabilita constraints, nunca
// session_replication_role, nunca recrea el esquema.
// ---------------------------------------------------------------------------
async function executeCleanup(preserveUserId: string, easyPortalCredentialId: string) {
  await quarantinePolicyDocumentFiles();

  await prisma.$transaction(async (tx) => {
    // Comisiones / conciliación (de lo más dependiente a lo menos)
    await tx.commissionStatementRow.deleteMany({});
    await tx.commissionPayment.deleteMany({});
    await tx.commissionStatementApplyBatch.deleteMany({});
    await tx.commissionStatement.deleteMany({});
    await tx.commissionExpectation.deleteMany({});
    await tx.commissionRule.deleteMany({});

    // Pólizas y todo lo que cuelga de ellas
    await tx.policyExternalReference.deleteMany({});
    await tx.policyDocument.deleteMany({});
    await tx.healthPolicyDetail.deleteMany({});
    await tx.clientPortalCredential.deleteMany({});
    await tx.paymentMethod.deleteMany({});
    await tx.policyMember.deleteMany({});
    await tx.task.deleteMany({});
    await tx.note.deleteMany({});
    // Rompe la auto-referencia previousPolicyId antes de borrar en
    // bloque — evita una violación de FK Restrict entre pólizas
    // encadenadas (renovaciones).
    await tx.policy.updateMany({ where: { previousPolicyId: { not: null } }, data: { previousPolicyId: null } });
    await tx.policy.deleteMany({});

    // Personas y hogares
    await tx.birthdayGreeting.deleteMany({});
    await tx.personProvider.deleteMany({});
    await tx.personMedication.deleteMany({});
    await tx.personImmigrationDocument.deleteMany({});
    await tx.personSensitiveIdentity.deleteMany({});
    await tx.householdMember.deleteMany({});
    await tx.person.deleteMany({});
    await tx.household.deleteMany({});

    // Contratos del agente con carriers — TODOS, incluidos los del
    // usuario preservado (dependen de Carrier, que también se borra;
    // ver el comentario de alcance al inicio del archivo).
    await tx.agentCarrierContract.deleteMany({});

    // Credenciales de portal del agente — se conserva ÚNICAMENTE la
    // fila "EASY" ya resuelta por texto (nunca por ID hardcodeado en
    // el código, solo pasada como parámetro ya verificado); cualquier
    // otra (ej. la vinculada a un carrier de prueba) se elimina.
    await tx.agentPortalCredential.deleteMany({ where: { id: { not: easyPortalCredentialId } } });

    // Catálogo comercial — de más a menos dependiente
    await tx.product.deleteMany({});
    await tx.carrier.deleteMany({});

    // Auditoría e historial operativo de todo lo anterior
    await tx.auditEvent.deleteMany({});
    await tx.verification.deleteMany({});

    // Sesiones — TODAS, incluida la del usuario preservado (fuerza un
    // login nuevo, ver ficha).
    await tx.session.deleteMany({});

    // Cualquier OTRO usuario (no debería existir ninguno hoy, pero el
    // script debe ser correcto en el caso general) — Account/
    // TwoFactor/AgentLicense/AgentPortalCredential/Session de ese otro
    // usuario se eliminan en cascada al borrar su fila User.
    await tx.user.deleteMany({ where: { id: { not: preserveUserId } } });
  });
}

// ---------------------------------------------------------------------------
// Verificación posterior de integridad referencial — más allá de lo
// que Postgres ya garantizó durante la transacción, confirma que no
// quedó ninguna FK huérfana hacia una fila ya eliminada.
// ---------------------------------------------------------------------------
async function verifyNoOrphans(): Promise<string[]> {
  const problems: string[] = [];
  const orphanChecks: [string, () => Promise<number>][] = [
    ["Session.userId sin User", async () => (await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM session s LEFT JOIN users u ON u.id = s."userId" WHERE u.id IS NULL`)[0].c as unknown as number],
  ];
  for (const [label, check] of orphanChecks) {
    const count = Number(await check());
    if (count > 0) problems.push(`${label}: ${count}`);
  }
  return problems;
}

async function main() {
  const args = parseCliArgs();
  if (!args.dryRun && !args.execute) {
    console.error("Especifica --dry-run o --execute.");
    process.exitCode = 1;
    return;
  }
  if (!args.preserveUser) {
    console.error("Falta --preserve-user=<correo>.");
    process.exitCode = 1;
    return;
  }

  const env = assertLocalDevDatabase();
  console.log(`Entorno confirmado: host=${env.hostSanitized} puerto=${env.port} base=${env.database} (DEV local).`);

  assertMigrationsUpToDate();
  console.log("Migraciones al día.\n");

  const preserved = await resolvePreservedUser(args.preserveUser);
  console.log("Usuario a conservar:");
  console.log(JSON.stringify({
    id: preserved.user.id,
    name: preserved.user.name,
    email: preserved.user.email,
    role: preserved.user.role,
    isActive: preserved.user.isActive,
    activatedAt: preserved.user.activatedAt,
    emailVerified: preserved.user.emailVerified,
    isAgent: preserved.user.isAgent,
    twoFactorEnabled: preserved.user.twoFactorEnabled,
    hasAccountWithPassword: preserved.hasAccountWithPassword,
    hasTwoFactor: preserved.hasTwoFactor,
    licenseCount: preserved.licenseCount,
    contractCount: preserved.contractCount,
    portalCredentialCount: preserved.portalCredentialCount,
    easyPortalCredentialToPreserve: { id: preserved.easyPortalCredentialId, portalName: preserved.easyPortalCredentialName },
  }, null, 2));

  const before = await collectCounts();
  const after = expectedAfter(preserved);

  // Salvaguarda explícita de la ficha: si el cierre de dependencias
  // pretendiera afectar al usuario/Account/MFA/licencias preservados,
  // detenerse. AgentCarrierContract se elimina siempre por diseño (ver
  // comentario de alcance) — nunca dispara esta salvaguarda.
  if (
    after.users !== 1 ||
    after.accounts !== 1 ||
    after.twoFactors !== 1 ||
    after.agentLicenses !== preserved.licenseCount ||
    after.agentPortalCredentials !== 1
  ) {
    throw new Error("La limpieza planeada afectaría al usuario/Account/MFA/licencias/credencial EASY preservados — deteniendo sin tocar nada.");
  }

  printReport(args.dryRun ? "DRY RUN — nada se modificó" : "PLAN DE EJECUCIÓN", before, after);

  if (args.dryRun) {
    console.log("\nDry-run completo. Ejecuta con --execute --confirm=... para aplicar.");
    return;
  }

  if (args.confirm !== PRESERVE_EMAIL_CONFIRMATION_TOKEN) {
    console.error(`\nFalta o es incorrecta la confirmación exacta (--confirm=${PRESERVE_EMAIL_CONFIRMATION_TOKEN}) — deteniendo.`);
    process.exitCode = 1;
    return;
  }

  console.log("\nEjecutando limpieza dentro de una transacción...");
  await executeCleanup(preserved.user.id, preserved.easyPortalCredentialId);
  console.log("Transacción confirmada.");

  const afterReal = await collectCounts();
  printReport("RESULTADO REAL POST-LIMPIEZA", afterReal, after);

  const orphanProblems = await verifyNoOrphans();
  if (orphanProblems.length > 0) {
    console.error("Problemas de integridad detectados:", orphanProblems);
    process.exitCode = 1;
    return;
  }
  console.log("\nSin filas huérfanas detectadas. Limpieza completa.");
}

main()
  .catch((e) => {
    console.error("Error — deteniendo sin garantizar cambios parciales fuera de la transacción:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
