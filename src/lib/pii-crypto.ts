import "server-only";

// Reexporta el cifrado real desde pii-crypto-core.ts (sin el guard) —
// ver el comentario de cabecera de ese archivo para el porqué de la
// separación. Toda la app (Server Components/Actions/servicios) debe
// seguir importando este archivo, nunca pii-crypto-core.ts
// directamente, salvo el importador de Fase 023 (que corre fuera del
// árbol de Next y no puede tolerar el guard).
export {
  encryptPii,
  decryptPii,
  _resetPiiEncryptionKeyCacheForTests,
} from "./pii-crypto-core";
