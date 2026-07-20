/** Lien externe saisi par un club (annonce, sponsor…) et rendu tel quel en `<a href>` côté
 * front : seuls http(s) sont acceptés, sinon un `javascript:`/`data:` stocké en base
 * s'exécuterait au clic de n'importe quel visiteur (XSS stocké). Retourne null si invalide
 * (le champ est alors effacé plutôt que rejeté — cohérent avec `.trim() || null`). */
export function sanitizeExternalLinkUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}
