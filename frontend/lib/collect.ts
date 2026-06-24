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

export type StatusMode = 'all' | 'unpaid' | 'partial' | 'paid' | 'cancelled';

/**
 * Filtre par statut d'encaissement (montants en centimes) :
 * - all      → toutes les réservations actives (annulées masquées) ;
 * - unpaid   → dû > 0 et rien encaissé (« Non payé ») ;
 * - partial  → un acompte mais reste dû (« Partiellement payé ») ;
 * - paid     → payant et entièrement soldé ;
 * - cancelled → uniquement les annulées.
 */
export function statusFilter(mode: StatusMode, due: number, paid: number, cancelled: boolean): boolean {
  if (mode === 'cancelled') return cancelled;
  if (cancelled) return false;                 // les autres modes ne montrent que l'actif
  const rest = Math.max(0, due - paid);
  switch (mode) {
    case 'all':     return true;
    case 'unpaid':  return due > 0 && paid <= 0;
    case 'partial': return paid > 0 && rest > 0;
    case 'paid':    return due > 0 && rest <= 0;
  }
}

export type TimePreset = 'now' | 'morning' | 'afternoon' | 'evening';

const clampH = (h: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, h));

/**
 * Fenêtre horaire [from, to) d'un raccourci de créneau (heures locales club),
 * bornée aux horaires d'ouverture. « now » = le créneau d'une heure en cours.
 */
export function presetWindow(preset: TimePreset, openH: number, closeH: number, nowH: number): [number, number] {
  switch (preset) {
    case 'morning':   return [openH, clampH(12, openH, closeH)];
    case 'afternoon': return [clampH(12, openH, closeH), clampH(18, openH, closeH)];
    case 'evening':   return [clampH(18, openH, closeH), closeH];
    case 'now': {
      const h = clampH(nowH, openH, closeH - 1);
      return [h, h + 1];
    }
  }
}

/**
 * La réservation a-t-elle au moins un encaissement par l'un des moyens demandés ?
 * Ensemble vide = pas de filtre (tout passe).
 */
export function hasAnyMethod(payments: ReadonlyArray<{ method: string }>, methods: ReadonlySet<string>): boolean {
  if (methods.size === 0) return true;
  return payments.some((p) => methods.has(p.method));
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Recherche texte sur l'intitulé, le titulaire (nom/prénom/email) ET les joueurs
 * ajoutés à la réservation (participants). Vide = tout.
 */
export function matchesQuery(
  rv: {
    title: string | null;
    user: { firstName: string; lastName: string; email: string } | null;
    participants?: { firstName: string; lastName: string }[];
  },
  q: string,
): boolean {
  const needle = norm(q.trim());
  if (!needle) return true;
  const parts = (rv.participants ?? []).map((p) => `${p.firstName} ${p.lastName}`).join(' ');
  const hay = norm([rv.title ?? '', rv.user ? `${rv.user.firstName} ${rv.user.lastName} ${rv.user.email}` : '', parts].join(' '));
  return hay.includes(needle);
}

/**
 * Le créneau est-il « à venir » ? = sa fin n'est pas encore passée (l'en-cours
 * reste visible — on peut encore encaisser). `nowMs = null` (heure courante pas
 * encore connue côté client) → tout passe (pas de masquage avant hydratation).
 */
export function isUpcoming(rv: { endTime: string }, nowMs: number | null): boolean {
  if (nowMs === null) return true;
  return new Date(rv.endTime).getTime() >= nowMs;
}
