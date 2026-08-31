import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { auth } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";

// Bootstrap seguro del primer usuario ADMIN. Sin signup público, sin
// usuario/password hardcodeado. Usa auth.api.signUpEmail (misma lógica
// de hash que el resto de la aplicación) en vez de criptografía propia.
// name/email/password nunca quedan escritos en ningún archivo: se
// reciben por variables de entorno de proceso (no persistidas) o por
// prompt interactivo con la contraseña oculta en terminal.

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const CTRL_C_CODE = 3;
const BACKSPACE_CODE = 8;
const DEL_CODE = 127;

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(question);
    let input = "";
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (chunk: string) => {
      const char = chunk.toString();
      const code = char.charCodeAt(0);

      if (char === "\r" || char === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(input);
        return;
      }
      if (code === CTRL_C_CODE) {
        cleanup();
        stdout.write("\n");
        process.exit(1);
      }
      if (code === BACKSPACE_CODE || code === DEL_CODE) {
        input = input.slice(0, -1);
        return;
      }
      input += char;
    };

    function cleanup() {
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
    }

    stdin.on("data", onData);
  });
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  const name = process.env.ADMIN_NAME ?? (await rl.question("Nombre completo: "));
  const email = process.env.ADMIN_EMAIL ?? (await rl.question("Correo electrónico: "));
  const password =
    process.env.ADMIN_PASSWORD ?? (await promptHidden("Contraseña (mínimo 10 caracteres): "));

  rl.close();

  if (!name.trim()) {
    console.error("El nombre no puede estar vacío.");
    process.exitCode = 1;
    return;
  }
  if (!isValidEmail(email)) {
    console.error("El correo electrónico no es válido.");
    process.exitCode = 1;
    return;
  }
  if (password.length < 10) {
    console.error("La contraseña debe tener al menos 10 caracteres.");
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`Ya existe un usuario con el correo ${email}.`);
    process.exitCode = 1;
    return;
  }

  const result = await auth.api.signUpEmail({
    body: { name, email, password },
  });

  if (!result?.user?.id) {
    console.error("No se pudo crear el usuario.");
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: result.user.id },
    data: { role: "ADMIN", isActive: true },
  });

  console.log(`Usuario ADMIN creado correctamente: ${email}`);
}

main()
  .catch((e) => {
    console.error("Error creando el administrador:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
