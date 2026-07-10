import { MyReservation, MyTournamentRegistration, MyEventRegistration, MyLessonEnrollment } from '@/lib/api';
import { ACCENTS } from '@/lib/theme';

export type AgendaKind = 'reservation' | 'tournament' | 'event' | 'lesson';

/** Couleur + libellé par type d'item d'agenda — source de vérité unique (listes + calendrier).
 *  Couleurs prises dans ACCENTS (constantes), pas th.accent/th.accentWarm qui peuvent être
 *  surchargés par la couleur du club. */
export function agendaKindMeta(kind: AgendaKind): { color: string; label: string } {
  switch (kind) {
    case 'reservation': return { color: ACCENTS.blue,    label: 'Réservation' };
    case 'tournament':  return { color: ACCENTS.apricot, label: 'Tournoi' };
    case 'event':       return { color: ACCENTS.emerald, label: 'Event' };
    case 'lesson':      return { color: ACCENTS.violet,  label: 'Cours' };
  }
}

/** Libellés partagés (réservation vs inscription tournoi/event), réutilisés par les composants. */
export const STATUS_LABEL: Record<string, string> = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };
export const REG_LABEL: Record<string, string> = { CONFIRMED: 'Inscrit', WAITLISTED: "Liste d'attente" };
export const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

export interface MonthCell {
  key: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
}

export type CalendarEntry =
  | { kind: 'reservation'; id: string; dayKey: string; past: boolean; r: MyReservation }
  | {
      kind: 'tournament'; id: string; dayKeys: string[]; startKey: string; endKey: string;
      past: boolean; reg: MyTournamentRegistration;
    }
  | {
      kind: 'event'; id: string; dayKeys: string[]; startKey: string; endKey: string;
      past: boolean; ev: MyEventRegistration;
    }
  | { kind: 'lesson'; id: string; dayKey: string; past: boolean; enrollment: MyLessonEnrollment };

/** Clé du sport d'une entrée d'agenda (pour décider d'afficher le badge sport en vue cross-club). */
export function agendaEntrySportKey(e: CalendarEntry): string | null {
  if (e.kind === 'reservation') return e.r.resource.sport?.key ?? null;
  if (e.kind === 'tournament')  return e.reg.tournament.sport?.key ?? null;
  if (e.kind === 'event')       return e.ev.event.sport?.key ?? null;
  return e.enrollment.lesson.sport?.key ?? null; // lesson
}

/**
 * Clé jour YYYY-MM-DD d'un instant ISO dans le fuseau donné.
 * Seule conversion instant→jour de la lib : tout le reste manipule des clés
 * en arithmétique UTC pure (insensible au DST et au fuseau du runtime).
 */
export function dayKeyInTz(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

/** Clé du jour courant dans le fuseau du navigateur (surlignage « aujourd'hui »). */
export function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function keyOfUtc(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Grille du mois (month 1–12) : semaines lun→dim, cellules des mois adjacents incluses. */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const first = Date.UTC(year, month - 1, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7; // 0 = lundi
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekCount = Math.ceil((lead + daysInMonth) / 7);

  const weeks: MonthCell[][] = [];
  let t = first - lead * 86_400_000;
  for (let w = 0; w < weekCount; w++) {
    const week: MonthCell[] = [];
    for (let d = 0; d < 7; d++, t += 86_400_000) {
      const date = new Date(t);
      week.push({
        key: keyOfUtc(t),
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month - 1 && date.getUTCFullYear() === year,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12 + 12) % 12 + 1 };
}

/** Libellé « juin 2026 ». */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Toutes les clés jour de startKey à endKey inclus (cap sécurité : 62 jours). */
export function enumerateDayKeys(startKey: string, endKey: string): string[] {
  const [y, m, d] = startKey.split('-').map(Number);
  const end = Date.parse(`${endKey}T00:00:00Z`);
  const out: string[] = [];
  for (let t = Date.UTC(y, m - 1, d); t <= end && out.length < 62; t += 86_400_000) {
    out.push(keyOfUtc(t));
  }
  return out;
}

/** Fusionne réservations terrain, inscriptions tournois, inscriptions events et cours en entrées calendrier. */
export function buildCalendarEntries(
  reservations: MyReservation[],
  regs: MyTournamentRegistration[],
  events: MyEventRegistration[],
  lessons: MyLessonEnrollment[],
  now: Date,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  for (const r of reservations) {
    if (r.status === 'CANCELLED') continue;
    entries.push({
      kind: 'reservation',
      id: r.id,
      dayKey: dayKeyInTz(r.startTime, r.resource.club.timezone),
      past: new Date(r.endTime) < now,
      r,
    });
  }

  for (const reg of regs) {
    if (reg.status === 'CANCELLED' || reg.tournament.status === 'CANCELLED') continue;
    const tz = reg.tournament.club.timezone;
    const startKey = dayKeyInTz(reg.tournament.startTime, tz);
    const endKey = reg.tournament.endTime ? dayKeyInTz(reg.tournament.endTime, tz) : startKey;
    entries.push({
      kind: 'tournament',
      id: reg.id,
      startKey,
      endKey,
      dayKeys: enumerateDayKeys(startKey, endKey),
      past: new Date(reg.tournament.endTime ?? reg.tournament.startTime) < now,
      reg,
    });
  }

  for (const ev of events) {
    if (ev.status === 'CANCELLED' || ev.event.status === 'CANCELLED') continue;
    const tz = ev.event.club.timezone;
    const startKey = dayKeyInTz(ev.event.startTime, tz);
    const endKey = ev.event.endTime ? dayKeyInTz(ev.event.endTime, tz) : startKey;
    entries.push({
      kind: 'event',
      id: ev.id,
      startKey,
      endKey,
      dayKeys: enumerateDayKeys(startKey, endKey),
      past: new Date(ev.event.endTime ?? ev.event.startTime) < now,
      ev,
    });
  }

  for (const enrollment of lessons) {
    if (enrollment.status === 'CANCELLED') continue;
    const startTime = enrollment.lesson.reservation.startTime;
    const dayKey = dayKeyInTz(startTime, enrollment.lesson.club.timezone);
    entries.push({
      kind: 'lesson',
      id: enrollment.enrollmentId,
      dayKey,
      past: new Date(enrollment.lesson.reservation.endTime) < now,
      enrollment,
    });
  }

  return entries;
}

/** Instant ISO de début d'une entrée, tous types confondus. */
function entryStart(e: CalendarEntry): string {
  if (e.kind === 'reservation') return e.r.startTime;
  if (e.kind === 'tournament') return e.reg.tournament.startTime;
  if (e.kind === 'lesson') return e.enrollment.lesson.reservation.startTime;
  return e.ev.event.startTime;
}

// Ordre d'affichage intra-jour : tournois, puis events, puis réservations, puis cours.
const KIND_RANK: Record<CalendarEntry['kind'], number> = { tournament: 0, event: 1, reservation: 2, lesson: 3 };

/** Index par jour ; tournois/events multi-jours apparaissent sur chacun de leurs jours, avant les réservations. */
export function entriesByDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>();
  const push = (key: string, e: CalendarEntry) => {
    const list = byDay.get(key);
    if (list) list.push(e);
    else byDay.set(key, [e]);
  };

  for (const e of entries) {
    if (e.kind === 'reservation' || e.kind === 'lesson') push(e.dayKey, e);
    else for (const key of e.dayKeys) push(key, e);
  }

  for (const list of byDay.values()) {
    // rang de kind, puis instant ISO UTC (ordre lexicographique = chronologique).
    list.sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || entryStart(a).localeCompare(entryStart(b)));
  }
  return byDay;
}

// --- Listes « Mes réservations » (À venir / Passées) : fusion à plat, triée par date ---

export type AgendaListItem =
  | { kind: 'reservation'; id: string; start: string; past: boolean; r: MyReservation }
  | { kind: 'tournament'; id: string; start: string; past: boolean; reg: MyTournamentRegistration }
  | { kind: 'event'; id: string; start: string; past: boolean; ev: MyEventRegistration }
  | { kind: 'lesson'; id: string; start: string; past: boolean; enrollment: MyLessonEnrollment };

/**
 * Fusionne réservations + inscriptions tournois + inscriptions events + cours en une liste à plat,
 * triée chronologiquement par instant de début (ISO UTC), tie-break stable par id.
 * Exclut les éléments annulés (réservation, inscription ou tournoi/event sous-jacent).
 * `past` = terminé avant `now` (repli sur le début si pas d'heure de fin).
 */
export function buildAgendaList(
  reservations: MyReservation[],
  regs: MyTournamentRegistration[],
  events: MyEventRegistration[],
  lessons: MyLessonEnrollment[],
  now: Date,
): AgendaListItem[] {
  const items: AgendaListItem[] = [];

  for (const r of reservations) {
    if (r.status === 'CANCELLED') continue;
    items.push({ kind: 'reservation', id: r.id, start: r.startTime, past: new Date(r.endTime) < now, r });
  }

  for (const reg of regs) {
    if (reg.status === 'CANCELLED' || reg.tournament.status === 'CANCELLED') continue;
    const t = reg.tournament;
    items.push({ kind: 'tournament', id: reg.id, start: t.startTime, past: new Date(t.endTime ?? t.startTime) < now, reg });
  }

  for (const ev of events) {
    if (ev.status === 'CANCELLED' || ev.event.status === 'CANCELLED') continue;
    const e = ev.event;
    items.push({ kind: 'event', id: ev.id, start: e.startTime, past: new Date(e.endTime ?? e.startTime) < now, ev });
  }

  for (const enrollment of lessons) {
    if (enrollment.status === 'CANCELLED') continue;
    const startTime = enrollment.lesson.reservation.startTime;
    items.push({
      kind: 'lesson',
      id: enrollment.enrollmentId,
      start: startTime,
      past: new Date(enrollment.lesson.reservation.endTime) < now,
      enrollment,
    });
  }

  // ISO UTC : localeCompare = chronologique ; tie-break id → tri stable et déterministe.
  return items.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

/** Slug du club auquel appartient un item d'agenda (pour cloisonner/relier par club). */
export function agendaItemClubSlug(item: AgendaListItem): string {
  if (item.kind === 'reservation') return item.r.resource.club.slug;
  if (item.kind === 'tournament') return item.reg.tournament.club.slug;
  if (item.kind === 'lesson') return item.enrollment.lesson.club.slug;
  return item.ev.event.club.slug;
}

/** "YYYY-MM-DD" + delta jours, arithmétique UTC pure (aucun décalage de fuseau/DST). */
export function addDaysKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** "YYYY-MM-DD" → "vendredi 10 juillet" (rendu UTC : indépendant du fuseau du navigateur). */
export function frLongLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "YYYY-MM-DD" → "vendredi" (jour de semaine seul). */
export function frWeekday(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
