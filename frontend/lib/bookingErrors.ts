export const HOLD_SECONDS = 300; // miroir de HOLD_TTL_SECONDS (backend)

export function formatHour(iso: string, tz = 'Europe/Paris'): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

export const BOOKING_ERRORS: Record<string, string> = {
  SLOT_NOT_AVAILABLE:     "Ce créneau vient d'être pris. Choisissez-en un autre.",
  SLOT_ALREADY_HELD:      "Ce créneau vient d'être pris. Choisissez-en un autre.",
  QUOTA_PEAK_REACHED:     'Vous avez atteint votre nombre maximum de réservations en heures pleines.',
  QUOTA_OFFPEAK_REACHED:  'Vous avez atteint votre nombre maximum de réservations en heures creuses.',
  TOO_MANY_PLAYERS:       'Trop de joueurs pour ce terrain.',
  PARTNER_NOT_MEMBER:     "Un partenaire n'est pas membre du club.",
  PARTNER_DUPLICATE:      'Un partenaire figure en double.',
  RESERVATION_NOT_PENDING: 'La pré-réservation a expiré. Veuillez recommencer.',
  // Pré-conditions de paiement (gardes serveur) — jamais affichées en code brut.
  ONLINE_PAYMENT_REQUIRED: 'Ce club exige le paiement en ligne pour réserver.',
  CARD_FINGERPRINT_REQUIRED: "Ce club demande d'enregistrer une carte bancaire (protection no-show). Acceptez les conditions, puis enregistrez votre carte.",
  CGV_NOT_ACCEPTED:        'Veuillez accepter les conditions générales de vente.',
  PAYMENT_NOT_SUCCEEDED:   "Le paiement n'a pas abouti. Veuillez réessayer.",
  SETUP_NOT_SUCCEEDED:     "L'enregistrement de la carte n'a pas abouti. Veuillez réessayer.",
};
