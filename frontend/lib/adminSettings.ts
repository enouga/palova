// Helpers PURS de la page Réglages du club. Aucune horloge, aucun fetch, aucun JSX.
import type { ClubAdminDetail, UpdateClubBody, OffPeakRange } from '@/lib/api';

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
    showOffersPublicly: c.showOffersPublicly,
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
