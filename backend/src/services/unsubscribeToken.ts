import crypto from 'crypto';

// Secret dédié si présent, sinon repli JWT_SECRET (dev). Un lien de désinscription
// n'expire JAMAIS (il doit toujours marcher) — la révocation n'a pas de sens ici :
// le pire usage abusif est de (dés)inscrire la personne de ses emails d'annonces.
const secret = () => process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || '';

export function unsubscribeToken(userId: string): string {
  const payload = Buffer.from(userId, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** userId si la signature est valide, null sinon (comparaison en temps constant). */
export function verifyUnsubscribeToken(token: string): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}
