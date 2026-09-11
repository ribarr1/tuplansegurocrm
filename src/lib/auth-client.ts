import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// PREPRODUCCIÓN — MFA. Solo agrega el plugin cliente (habilita
// authClient.twoFactor.enable/verifyTotp/verifyBackupCode/etc.) —
// deliberadamente SIN `onTwoFactorRedirect`/`twoFactorPage`: la
// navegación a /login/verify la hace src/app/login/page.tsx explícitamente
// con useRouter().push() al ver `twoFactorRedirect: true` en la
// respuesta de signIn.email, en vez de un window.location.href global
// aquí (evita una recarga completa y una posible carrera con la propia
// lógica de la página de login).
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
