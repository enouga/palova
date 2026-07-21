/**
 * Le corps de l'éditeur riche contient-il un vrai contenu ?
 * L'éditeur TipTap émet toujours du markup (`<p></p>` même vide) — un simple
 * `.trim()` ne suffit pas. Vrai s'il reste du texte non-blanc OU au moins une image.
 */
export function broadcastHasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0;
}

/** Canaux d'un envoi de diffusion. `push` est couplé à `inApp` (jamais de push sans cloche). */
export interface BroadcastChannels {
  email: boolean;
  inApp: boolean;
  push: boolean;
}

/** Applique le couplage : décocher la cloche coupe aussi le push. */
export function coupleChannels(c: BroadcastChannels): BroadcastChannels {
  return { ...c, push: c.push && c.inApp };
}

/** Au moins un canal effectif (push seul impossible car couplé à la cloche). */
export function hasAnyChannel(c: BroadcastChannels): boolean {
  return c.email || c.inApp;
}
