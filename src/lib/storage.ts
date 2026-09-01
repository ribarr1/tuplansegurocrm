import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Abstracción de almacenamiento de archivos — Fase 019.5. La app nunca
// debe acoplarse directamente a disco local: todo el resto del código
// habla contra esta interfaz, nunca contra fs/path directamente. La
// implementación de producción (S3-compatible: R2, B2, etc.) queda
// pendiente y se decidirá explícitamente más adelante — ver
// docs/DECISIONS.md — esto NO contrata ni integra ningún proveedor
// todavía.
export interface FileStorage {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

// Dev/V1: disco local, FUERA de /public (nunca URLs públicas
// permanentes — el acceso siempre pasa por una Route Handler que
// primero verifica autorización sobre la Policy dueña del documento).
// storageKey es SIEMPRE generado por el servicio que llama a save()
// (uuid + extensión derivada del mimeType validado, nunca del nombre
// original) — esta clase nunca decide el nombre, solo lo usa como
// nombre de archivo plano dentro de su propio directorio, sin
// subcarpetas derivadas de input, evitando path traversal por diseño.
class LocalFileStorage implements FileStorage {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private resolveSafePath(key: string): string {
    // Defensa en profundidad: aunque storageKey siempre se genera
    // internamente (nunca a partir de input de usuario), se rechaza
    // cualquier separador de ruta o referencia relativa antes de
    // construir la ruta final.
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(key)) {
      throw new Error("storageKey inválido.");
    }
    return path.join(this.baseDir, key);
  }

  async save(key: string, data: Buffer): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(this.resolveSafePath(key), data);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveSafePath(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolveSafePath(key), { force: true });
  }
}

// private-storage/ está gitignored (mismo patrón que private-imports/,
// Fase 019) — nunca debe versionarse ni servirse como estático.
export const fileStorage: FileStorage = new LocalFileStorage(
  path.join(process.cwd(), "private-storage", "policy-documents")
);

// Extensión segura derivada del MIME ya validado — nunca del nombre de
// archivo original del usuario.
const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function generateStorageKey(mimeType: string): string {
  const ext = EXTENSION_BY_MIME[mimeType];
  if (!ext) throw new Error(`Tipo MIME no soportado para storageKey: ${mimeType}`);
  return `${crypto.randomUUID()}.${ext}`;
}
