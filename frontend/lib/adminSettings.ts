// Helpers PURS de la page Réglages du club. Aucune horloge, aucun fetch, aucun JSX.
import type { ClubAdminDetail, UpdateClubBody, OffPeakRange, AdminClubSport, SportsBatchItem, BookingReleaseMode } from '@/lib/api';
import { effectiveDurations } from '@/lib/duration';

export type SettingsTabKey = 'identite' | 'sports' | 'reservation' | 'tarifs' | 'caisse' | 'visibilite';

export const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
  { key: 'identite',   label: 'Identité' },
  { key: 'sports',     label: 'Sports' },
  { key: 'reservation', label: 'Réservation' },
  { key: 'tarifs',     label: 'Tarifs & quotas' },
  { key: 'caisse',     label: 'Caisse & paiement' },
  { key: 'visibilite', label: 'Visibilité & joueurs' },
];

/** Lit `?tab=` d'une query string ; défaut et valeur inconnue → 'identite'. */
export function parseTab(search: string): SettingsTabKey {
  const raw = new URLSearchParams(search).get('tab');
  return SETTINGS_TABS.some((t) => t.key === raw) ? (raw as SettingsTabKey) : 'identite';
}

/** Presets de fenêtre de réservation (jours), indépendants public / abonnés. */
export const DAY_PRESETS_PUBLIC = [7, 14, 30];
export const DAY_PRESETS_MEMBER = [14, 28, 60];

/** Explication affichée sous le sélecteur de mode d'ouverture, propre au mode sélectionné. */
export const BOOKING_RELEASE_MODE_HELP: Record<BookingReleaseMode, string> = {
  DAY_AT_HOUR:
    "Chaque jour à l’heure indiquée (0 = minuit), une journée calendaire entière s’ouvre d’un coup — tous ses créneaux, du matin au soir. Avant cette heure, la fenêtre montre un jour de moins.",
  ROLLING_SLOT:
    "Aucune heure d’ouverture : la fenêtre est réservable en continu, jusqu’à exactement le nombre de jours choisi après l’instant présent (à la minute près). Les heures publique/abonnés ci-dessous sont ignorées.",
  WINDOW_SHIFT:
    "La fenêtre avance d’un jour chaque nuit à minuit, mais s’arrête toujours à l’heure indiquée (0 = minuit) sur le dernier jour visible — pas la journée entière.",
};

/**
 * Body du PATCH club depuis un brouillon. UNIQUE source de vérité des champs
 * enregistrés — inclut `showOtherClubsReservations` (que l'ancien save() oubliait).
 * offPeakHours vidé → null (désactive les heures creuses).
 */
export function buildUpdateBody(c: ClubAdminDetail): UpdateClubBody {
  return {
    name: c.name, description: c.description ?? '', address: c.address,
    city: c.city ?? '', timezone: c.timezone, logoUrl: c.logoUrl ?? '',
    coverImageUrl: c.coverImageUrl,
    accentColor: c.accentColor, defaultThemeMode: c.defaultThemeMode,
    listedInDirectory: c.listedInDirectory,
    listTournamentsNationally: c.listTournamentsNationally,
    listOpenMatchesNationally: c.listOpenMatchesNationally ?? false,
    levelSystemEnabled: c.levelSystemEnabled,
    publicBookingDays: Number(c.publicBookingDays), memberBookingDays: Number(c.memberBookingDays),
    bookingReleaseMode: c.bookingReleaseMode,
    publicReleaseHour: Number(c.publicReleaseHour), memberReleaseHour: Number(c.memberReleaseHour),
    offPeakHours: c.offPeakHours && Object.keys(c.offPeakHours).length > 0 ? c.offPeakHours : null,
    bookingQuotas: c.bookingQuotas ?? null,
    playerChangeCutoffHours: Number(c.playerChangeCutoffHours),
    cancellationCutoffHours: Number(c.cancellationCutoffHours),
    showOtherClubsReservations: c.showOtherClubsReservations,
    refundOnCancelWithinCutoff: c.refundOnCancelWithinCutoff,
    requireOnlinePayment: c.requireOnlinePayment,
    requireCardFingerprint: c.requireCardFingerprint,
    quickPaymentMethods: c.quickPaymentMethods,
    payAtClubOnly: c.payAtClubOnly ?? false,
  };
}

/** Vrai si le brouillon diffère de la baseline sur un champ enregistré. */
export function isDirty(server: ClubAdminDetail, draft: ClubAdminDetail): boolean {
  return JSON.stringify(buildUpdateBody(server)) !== JSON.stringify(buildUpdateBody(draft));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Libellé d'une plage creuse, ex. « 9h30 → 12h00 ». */
export function offPeakChipLabel(r: OffPeakRange): string {
  return `${r.start}h${pad2(r.startMin ?? 0)} → ${r.end}h${pad2(r.endMin ?? 0)}`;
}

/** Ligne de brouillon Sports : `clubSportId: null` = sport ajouté, pas encore côté serveur. */
export interface SportsDraftItem {
  sportId: string;
  clubSportId: string | null;
  durationsMin: number[];
}

/** Convertit la liste serveur (AdminClubSport[]) en brouillon éditable. */
export function toSportsDraft(list: AdminClubSport[]): SportsDraftItem[] {
  return list.map((s) => ({ sportId: s.sport.id, clubSportId: s.id, durationsMin: s.durationsMin }));
}

/** Ajoute un sport au brouillon (idempotent — pas de doublon si déjà présent). */
export function addSportDraft(items: SportsDraftItem[], sportId: string): SportsDraftItem[] {
  if (items.some((i) => i.sportId === sportId)) return items;
  return [...items, { sportId, clubSportId: null, durationsMin: [] }];
}

/** Bascule une durée pour un sport du brouillon ; refuse de vider l'ensemble (au moins une durée). */
export function toggleDurationDraft(
  items: SportsDraftItem[], sportId: string, defaultDurationsMin: number[], min: number,
): SportsDraftItem[] {
  return items.map((item) => {
    if (item.sportId !== sportId) return item;
    const cur = new Set(effectiveDurations(item.durationsMin, defaultDurationsMin));
    if (cur.has(min)) cur.delete(min); else cur.add(min);
    if (cur.size === 0) return item;
    return { ...item, durationsMin: Array.from(cur).sort((a, b) => a - b) };
  });
}

function normalizeSportsForCompare(items: { sportId: string; durationsMin: number[] }[]) {
  return items
    .map((i) => ({ sportId: i.sportId, durationsMin: [...i.durationsMin].sort((a, b) => a - b) }))
    .sort((a, b) => a.sportId.localeCompare(b.sportId));
}

/** Vrai si le brouillon Sports diffère de la baseline serveur (ajout de sport ou durées modifiées). */
export function sportsDirty(server: AdminClubSport[], draft: SportsDraftItem[]): boolean {
  const serverItems = server.map((s) => ({ sportId: s.sport.id, durationsMin: s.durationsMin }));
  const draftItems = draft.map((d) => ({ sportId: d.sportId, durationsMin: d.durationsMin }));
  return JSON.stringify(normalizeSportsForCompare(serverItems)) !== JSON.stringify(normalizeSportsForCompare(draftItems));
}

/** Ne renvoie QUE les lignes du brouillon qui diffèrent de la baseline (jamais la liste entière). */
export function buildSportsBatchBody(server: AdminClubSport[], draft: SportsDraftItem[]): SportsBatchItem[] {
  const baselineBySport = new Map(server.map((s) => [s.sport.id, s.durationsMin]));
  const out: SportsBatchItem[] = [];
  for (const item of draft) {
    const baseline = baselineBySport.get(item.sportId);
    const changed = baseline === undefined
      || JSON.stringify([...baseline].sort((a, b) => a - b)) !== JSON.stringify([...item.durationsMin].sort((a, b) => a - b));
    if (changed) out.push({ sportId: item.sportId, durationsMin: item.durationsMin });
  }
  return out;
}
