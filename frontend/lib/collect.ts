// Helpers purs de filtrage de la page Réservations & paiements (côté client).

/** Minutes locales (fuseau club) depuis minuit pour un instant ISO. */
function localMinutes(iso: string, tz: string): number {
  const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
  const [h, m] = f.split(':').map(Number);
  return h * 60 + m;
}

/** La résa recoupe-t-elle la fenêtre horaire [fromHour, toHour) (heures locales club) ? */
export function overlapsHourWindow(rv: { startTime: string; endTime: string }, fromHour: number, toHour: number, tz: string): boolean {
  const s = localMinutes(rv.startTime, tz);
  let e = localMinutes(rv.endTime, tz);
  if (e <= s) e = 24 * 60; // créneau franchissant minuit
  return s < toHour * 60 && e > fromHour * 60;
}

export type OutstandingMode = 'all' | 'due' | 'paid';

/** Filtre par état d'encaissement (montants en centimes). */
export function outstandingFilter(mode: OutstandingMode, due: number, paid: number, cancelled: boolean): boolean {
  if (mode === 'all') return true;
  if (cancelled) return false;
  const rest = Math.max(0, due - paid);
  return mode === 'due' ? rest > 0 : rest <= 0 && due > 0;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche texte sur nom/prénom/email du joueur et l'intitulé. Vide = tout. */
export function matchesQuery(rv: { title: string | null; user: { firstName: string; lastName: string; email: string } | null }, q: string): boolean {
  const needle = norm(q.trim());
  if (!needle) return true;
  const hay = norm([rv.title ?? '', rv.user ? `${rv.user.firstName} ${rv.user.lastName} ${rv.user.email}` : ''].join(' '));
  return hay.includes(needle);
}
