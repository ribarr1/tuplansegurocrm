import { describe, it, expect } from "vitest";
import { escapeHtml, renderTransactionalEmail } from "@/lib/email-templates";

describe("email-templates — escapeHtml", () => {
  it("escapa los cinco caracteres HTML peligrosos", () => {
    expect(escapeHtml(`<script>alert('x')</script> & "quoted"`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;"
    );
  });

  it("un nombre con HTML incrustado nunca se inyecta sin escapar en el correo renderizado", () => {
    const malicious = `<img src=x onerror=alert(1)>Juan`;
    const { html } = renderTransactionalEmail({
      subject: "Prueba",
      bodyHtml: `<p>Hola ${escapeHtml(malicious)},</p>`,
      bodyText: `Hola ${malicious},`,
    });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;Juan");
  });
});

describe("email-templates — renderTransactionalEmail", () => {
  it("incluye el botón, la URL completa como alternativa, y el aviso de ignorar", () => {
    const { html, text } = renderTransactionalEmail({
      subject: "Asunto",
      bodyHtml: "<p>Cuerpo</p>",
      bodyText: "Cuerpo",
      ctaLabel: "Hacer clic aquí",
      ctaUrl: "https://tuplansegurousa.example.com/activate?uid=abc&token=xyz",
    });
    expect(html).toContain("https://tuplansegurousa.example.com/activate?uid=abc&amp;token=xyz");
    expect(html).toContain("Hacer clic aquí");
    expect(html).toContain("Si no solicitaste esta acción");
    expect(text).toContain("https://tuplansegurousa.example.com/activate?uid=abc&token=xyz");
    expect(text).toContain("Si no solicitaste esta acción");
  });

  it("respeta un aviso de ignorar personalizado en vez del genérico", () => {
    const { html, text } = renderTransactionalEmail({
      subject: "Asunto",
      bodyHtml: "<p>Cuerpo</p>",
      bodyText: "Cuerpo",
      ignoreNotice: "Aviso personalizado de prueba.",
    });
    expect(html).toContain("Aviso personalizado de prueba.");
    expect(text).toContain("Aviso personalizado de prueba.");
    expect(html).not.toContain("Si no solicitaste esta acción");
  });

  it("sin CTA, no incluye ningún botón ni enlace adicional", () => {
    const { html } = renderTransactionalEmail({ subject: "Asunto", bodyHtml: "<p>Cuerpo</p>", bodyText: "Cuerpo" });
    expect(html).not.toContain("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px 0;");
  });

  it("nunca genera HTML inválido básico (etiquetas balanceadas de apertura/cierre para html/body)", () => {
    const { html } = renderTransactionalEmail({ subject: "Asunto", bodyHtml: "<p>Cuerpo</p>", bodyText: "Cuerpo" });
    expect(html).toMatch(/<html[^>]*>[\s\S]*<\/html>/);
    expect(html).toMatch(/<body[^>]*>[\s\S]*<\/body>/);
  });
});
