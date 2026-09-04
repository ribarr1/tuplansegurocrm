import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { Playfair_Display, DM_Sans } from "next/font/google";
import "./globals.css";

// Identidad visual corporativa de Tu Plan Seguro USA — Fase 022
// (Parte J). Playfair Display para títulos/encabezados (elegante,
// cálido), DM Sans para texto operativo/UI (legible, profesional) —
// nunca al revés (Playfair en tablas/inputs/botones pequeños sería
// ilegible y recargado). Cargadas vía next/font/google (self-hosted en
// build, sin llamada a Google en runtime ni CDN externo) — nunca un
// <link> ni un script de fuentes cargado en el navegador del usuario.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tu Plan Seguro CRM",
  description: "CRM interno de Tu Plan Seguro USA — clientes, pólizas, comisiones y más en un solo lugar.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${dmSans.variable} ${playfairDisplay.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
