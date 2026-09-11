import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { hashPassword } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";

// ---------------------------------------------------------------------------
// REGRESIÓN REAL — "Functions cannot be passed directly to Client
// Components" en /commissions/analytics.
//
// Causa raíz: page.tsx (Server Component) pasaba `valueFormatter={(v) =>
// ...}` — una función — como prop a <BarChart>/<LineChart> ("use
// client"). React/Next serializa las props de un Server Component hacia
// un Client Component al cruzar esa frontera; una función no es
// serializable y el runtime lo rechaza. `tsc`/`npm run build` NUNCA
// detectan esto: ambas rutas son dinámicas (`ƒ`), así que `next build`
// nunca las renderiza con datos reales durante el build — el error solo
// aparece al servir una petición real. Esta prueba SÍ invoca las
// funciones de página reales (mismo código que Next ejecuta en runtime)
// y camina el árbol de elementos React devuelto para confirmar que
// ningún prop pasado a <BarChart>/<LineChart> es una función — la
// misma condición exacta que producía el error.
//
// `next/headers` requiere el contexto de petición real de Next
// (AsyncLocalStorage) que no existe en un test de Vitest plano —
// requireUser()/getSessionUser() llaman a headers() internamente. Se
// sustituye ÚNICAMENTE ese primitivo de plataforma (no la lógica de
// negocio: auth.api.getSession/Prisma corren de verdad, con una sesión
// real de un usuario ADMIN sintético) para poder invocar las páginas
// fuera del runtime de Next — mismo criterio que el shim de
// "server-only" ya presente en vitest.config.ts.
// ---------------------------------------------------------------------------

const headersHolder = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => headersHolder.current,
}));

const createdUserIds: string[] = [];
const ADMIN_PASSWORD = "AdminPasswordAnalyticsRender2026";

function uniqueName(label: string) {
  return `${label}${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function getSessionHeadersFor(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const setCookie = response.headers.get("set-cookie");
  const cookiePair = setCookie?.split(";")[0];
  if (!cookiePair) throw new Error("no session cookie");
  return new Headers({ cookie: cookiePair });
}

// El header Set-Cookie combinado trae varias cookies separadas por
// ", " — hay que localizar la cookie por NOMBRE, nunca asumir que es
// la primera del header combinado (ver mfa.service.test.ts).
function extractCookiePair(setCookieHeader: string | null, cookieName: string): string {
  const pair = setCookieHeader
    ?.split(", ")
    .map((part) => part.split(";")[0].trim())
    .find((part) => part.startsWith(`${cookieName}=`) && part !== `${cookieName}=`);
  if (!pair) throw new Error(`no se encontró la cookie ${cookieName} en Set-Cookie`);
  return pair;
}

beforeAll(async () => {
  // PREPRODUCCIÓN (MFA): un ADMIN sin MFA queda bloqueado fuera del
  // CRM (requireUser() redirige a /mfa/setup) — esta prueba no
  // ejercita MFA, pero SÍ necesita un ADMIN que pueda pasar esa
  // puerta, así que completa un enrollment y login REALES (nunca fija
  // twoFactorEnabled=true a mano: eso deja al usuario en un estado que
  // Better Auth trata como "tiene 2FA" sin secreto real, y el propio
  // signInEmail exige entonces un segundo factor que nunca podría
  // completarse).
  const email = `admin-analytics-render.${uniqueName("")}@test.local`;
  const admin = await prisma.user.create({
    data: { name: "Admin Analytics Render Test", email, role: "ADMIN", isActive: true },
  });
  createdUserIds.push(admin.id);
  await prisma.account.create({
    data: {
      issuer: "local:credential",
      providerId: "credential",
      accountId: admin.id,
      userId: admin.id,
      password: await hashPassword(ADMIN_PASSWORD),
    },
  });

  const initialHeaders = await getSessionHeadersFor(email, ADMIN_PASSWORD);
  const enabled = await auth.api.enableTwoFactor({
    body: { password: ADMIN_PASSWORD, method: "totp" },
    headers: initialHeaders,
  });
  if (enabled.method !== "totp") throw new Error("enableTwoFactor no devolvió method totp");
  const secretParam = new URL(enabled.totpURI).searchParams.get("secret");
  if (!secretParam) throw new Error("totpURI sin secret");
  const secret = Buffer.from(base32.decode(secretParam)).toString();
  await auth.api.verifyTOTP({ body: { code: await createOTP(secret).totp() }, headers: initialHeaders });

  const secondSignIn = await auth.api.signInEmail({ body: { email, password: ADMIN_PASSWORD }, asResponse: true });
  const twoFactorCookie = extractCookiePair(secondSignIn.headers.get("set-cookie"), "better-auth.two_factor");
  const verify = await auth.api.verifyTOTP({
    body: { code: await createOTP(secret).totp() },
    headers: new Headers({ cookie: twoFactorCookie }),
    asResponse: true,
  });
  const sessionCookie = extractCookiePair(verify.headers.get("set-cookie"), "better-auth.session_token");
  headersHolder.current = new Headers({ cookie: sessionCookie });
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

// Camina el árbol de elementos React devuelto por un Server Component
// SIN invocar ningún componente función (nunca se "renderiza" de
// verdad — eso rompería los hooks de los componentes cliente) — solo
// inspecciona `.type`/`.props`, exactamente lo que React necesitaría
// serializar al cruzar la frontera servidor/cliente.
function collectFunctionPropsPassedTo(root: ReactNode, targetTypes: unknown[]): string[] {
  const offenders: string[] = [];
  const seen = new Set<unknown>();

  function walk(node: ReactNode): void {
    if (node === null || node === undefined || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    if (!isValidElement(node)) return;
    const props = (node.props ?? {}) as Record<string, unknown>;

    if (targetTypes.includes(node.type)) {
      for (const [key, value] of Object.entries(props)) {
        if (typeof value === "function") {
          offenders.push(`${String((node.type as { name?: string }).name ?? node.type)}.${key}`);
        }
      }
    }

    if ("children" in props) walk(props.children as ReactNode);
    // Algunos props (ej. `data`) son arreglos de objetos planos, no
    // elementos React — walk() los ignora de forma segura (no son
    // válidos como elemento ni como array de nodos con hijos propios).
  }

  walk(root);
  return offenders;
}

// CORRECCIÓN — hydration mismatch real en el <title> de cada punto/barra
// (BarChart/LineChart): renderiza el árbol COMPLETO de cada página real
// (con datos reales de la base) a HTML vía renderToString, exactamente
// el mismo paso que ejecuta el servidor de Next para estas rutas — si
// algún <title> volviera a recibir varios children interpolados en vez
// de un único string precomputado, React emite un warning de desarrollo
// ("the children prop of <title> tags...") capturado aquí por
// console.error. renderToString no necesita jsdom: es SSR puro, corre
// igual en Node — no hace falta el pragma @vitest-environment jsdom
// para esta verificación específica.
function assertNoTitleChildrenWarning(errorSpy: ReturnType<typeof vi.spyOn>) {
  const calls = errorSpy.mock.calls as unknown[][];
  const offending = calls
    .map((args) => args.map(String).join(" "))
    .filter((msg) => /<title>/i.test(msg) && /children/i.test(msg));
  expect(offending).toEqual([]);
}

describe("páginas de analítica — nunca pasan funciones a los componentes de gráfica (regresión real de serialización RSC)", () => {
  it("/commissions/analytics no pasa ninguna función como prop a BarChart/LineChart", async () => {
    const { default: CommissionAnalyticsPage } = await import("@/app/(app)/commissions/analytics/page");
    const tree = await CommissionAnalyticsPage({ searchParams: Promise.resolve({}) });
    const offenders = collectFunctionPropsPassedTo(tree, [BarChart, LineChart]);
    expect(offenders).toEqual([]);
  });

  it("/policies/analytics no pasa ninguna función como prop a BarChart/LineChart", async () => {
    const { default: PolicyAnalyticsPage } = await import("@/app/(app)/policies/analytics/page");
    const tree = await PolicyAnalyticsPage({ searchParams: Promise.resolve({}) });
    const offenders = collectFunctionPropsPassedTo(tree, [BarChart, LineChart]);
    expect(offenders).toEqual([]);
  });

  it("/commissions/analytics: el árbol completo (datos reales) se sirve sin la advertencia de children de <title>", async () => {
    const { default: CommissionAnalyticsPage } = await import("@/app/(app)/commissions/analytics/page");
    const tree = await CommissionAnalyticsPage({ searchParams: Promise.resolve({}) });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderToString(tree)).not.toThrow();
    } finally {
      assertNoTitleChildrenWarning(errorSpy);
      errorSpy.mockRestore();
    }
  });

  it("/policies/analytics: el árbol completo (datos reales) se sirve sin la advertencia de children de <title>", async () => {
    const { default: PolicyAnalyticsPage } = await import("@/app/(app)/policies/analytics/page");
    const tree = await PolicyAnalyticsPage({ searchParams: Promise.resolve({}) });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderToString(tree)).not.toThrow();
    } finally {
      assertNoTitleChildrenWarning(errorSpy);
      errorSpy.mockRestore();
    }
  });
});
