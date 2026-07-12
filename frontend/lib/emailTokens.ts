// Conversion entre le format STOCKÉ des gabarits d'email ({{clé}} dans du HTML ou du texte)
// et le format ÉDITEUR (jetons <span data-var="clé">Libellé</span> pour TipTap).
// Helpers purs — le backend continue de recevoir exactement le format historique.

export interface EmailVarLite { key: string; label: string }

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const VAR_SPAN = /<span\b[^>]*\bdata-var="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tokenSpan(key: string, label: string): string {
  return `<span data-var="${esc(key)}">${esc(label)}</span>`;
}

/** HTML stocké → HTML éditeur : chaque {{clé}} déclarée devient un jeton ; clé inconnue laissée visible. */
export function storedToEditorHtml(stored: string, vars: EmailVarLite[]): string {
  const byKey = new Map(vars.map((v) => [v.key, v.label]));
  return stored.replace(PLACEHOLDER, (m, k: string) => (byKey.has(k) ? tokenSpan(k, byKey.get(k)!) : m));
}

/** HTML éditeur → HTML stocké : les jetons redeviennent {{clé}}. */
export function editorHtmlToStored(html: string): string {
  return html.replace(VAR_SPAN, (_m, k: string) => `{{${k}}}`);
}

/** Texte stocké (objet/titre/CTA) → HTML une ligne pour l'éditeur. */
export function plainToEditorHtml(text: string, vars: EmailVarLite[]): string {
  return `<p>${storedToEditorHtml(esc(text), vars)}</p>`;
}

/** HTML une ligne de l'éditeur → texte stocké : jetons → {{clé}}, balises retirées, entités décodées. */
export function editorHtmlToPlain(html: string): string {
  return editorHtmlToStored(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}
