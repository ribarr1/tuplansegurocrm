import { z } from "zod";
import { optionalSearchFilter, optionalEnumFilter, emptyStringToUndefined } from "@/schemas/common";

export const BIRTHDAY_GREETING_STATUS_VALUES = ["PENDING", "SENT", "SKIPPED"] as const;
export const BIRTHDAY_GREETING_CHANNEL_VALUES = ["WHATSAPP", "SMS", "EMAIL", "OTHER"] as const;

export const listBirthdaysQuerySchema = z.object({
  view: z.preprocess(
    emptyStringToUndefined,
    z.enum(["today", "month", "nextMonth", "upcoming", "all"]).default("all")
  ),
  search: optionalSearchFilter(),
  status: optionalEnumFilter(BIRTHDAY_GREETING_STATUS_VALUES),
});
export type ListBirthdaysQuery = z.infer<typeof listBirthdaysQuerySchema>;

const yearSchema = z.coerce.number().int().min(1900, "Año inválido.").max(2100, "Año inválido.").optional();

export const markBirthdaySentSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  channel: z.enum(BIRTHDAY_GREETING_CHANNEL_VALUES, "Selecciona un canal válido."),
  year: yearSchema,
});
export type MarkBirthdaySentInput = z.infer<typeof markBirthdaySentSchema>;

export const markBirthdaySkippedSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  year: yearSchema,
});
export type MarkBirthdaySkippedInput = z.infer<typeof markBirthdaySkippedSchema>;

export const resetBirthdayGreetingSchema = z.object({
  personId: z.uuid("Selecciona un contacto válido."),
  year: yearSchema,
});
export type ResetBirthdayGreetingInput = z.infer<typeof resetBirthdayGreetingSchema>;
