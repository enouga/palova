/**
 * Socle de FAQ commun fourni par Palova, affiché d'office sur la page FAQ de CHAQUE club.
 * Les réponses sont interpolées depuis les réglages du club → elles restent justes
 * automatiquement (délais, fenêtres, paiement…). Les clubs ajoutent leurs propres
 * questions via ClubFaqItem ; la lecture publique fusionne socle + items du club.
 */

/** Réglages du club nécessaires à l'interpolation des réponses du socle. */
export interface SocleClubContext {
  name: string;
  slug: string;
  publicBookingDays: number;
  memberBookingDays: number;
  cancellationCutoffHours: number;
  playerChangeCutoffHours: number;
  refundOnCancelWithinCutoff: boolean;
  requireOnlinePayment: boolean;
  legalEmail: string | null;
  legalPhone: string | null;
}

export interface SocleFaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
}

const CAT_RESERVER = 'Réserver un terrain';
const CAT_ANNULER = 'Annuler ou modifier';
const CAT_PAIEMENT = 'Paiement';
const CAT_PARTIES = 'Parties ouvertes & tournois';
const CAT_COMPTE = 'Compte & application';

/** « jusqu'à Xh avant le créneau » si délai > 0, sinon « jusqu'au début du créneau ». */
function cutoffPhrase(hours: number): string {
  return hours > 0 ? `jusqu'à **${hours} h avant** le créneau` : `jusqu'au début du créneau`;
}

/** Construit le socle FAQ interpolé pour un club. */
export function buildSocleFaq(ctx: SocleClubContext): SocleFaqItem[] {
  const contactLine = (() => {
    const email = ctx.legalEmail?.trim();
    const phone = ctx.legalPhone?.trim();
    if (email && phone) return `Pour toute question, contactez directement ${ctx.name} : ${email} / ${phone}.`;
    if (email) return `Pour toute question, contactez directement ${ctx.name} : ${email}.`;
    if (phone) return `Pour toute question, contactez directement ${ctx.name} au ${phone}.`;
    return `Pour toute question, contactez directement ${ctx.name} à l'accueil.`;
  })();

  return [
    {
      id: 'reserver',
      category: CAT_RESERVER,
      question: `Comment réserver un terrain à ${ctx.name} ?`,
      answer: `Pour réserver à ${ctx.name}, connectez-vous sur ${ctx.slug}.palova.fr (ou depuis l'app Palova), choisissez votre sport, la date et le créneau, puis confirmez. La réservation apparaît aussitôt dans « Mes réservations ».`,
    },
    {
      id: 'fenetre',
      category: CAT_RESERVER,
      question: `Combien de temps à l'avance puis-je réserver ?`,
      answer: `Les créneaux ouvrent **${ctx.publicBookingDays} jours à l'avance** pour tout le monde, et **${ctx.memberBookingDays} jours** pour les abonnés du club.`,
    },
    {
      id: 'quotas',
      category: CAT_RESERVER,
      question: `Combien de réservations puis-je avoir en même temps ?`,
      answer: `Cela dépend des quotas fixés par le club (heures pleines / heures creuses, abonné / non-abonné). Votre nombre de réservations en cours est rappelé au moment de réserver.`,
    },
    {
      id: 'annuler',
      category: CAT_ANNULER,
      question: `Comment annuler une réservation ?`,
      answer: `Allez dans « Mes réservations », ouvrez la réservation puis choisissez « Annuler ». L'annulation est possible ${cutoffPhrase(ctx.cancellationCutoffHours)}.`,
    },
    {
      id: 'remboursement',
      category: CAT_ANNULER,
      question: `Serai-je remboursé en cas d'annulation ?`,
      answer: ctx.refundOnCancelWithinCutoff
        ? `Oui : toute annulation effectuée dans les délais est remboursée automatiquement.`
        : `Le remboursement dépend de la politique du club ; contactez l'accueil en cas de besoin.`,
    },
    {
      id: 'changer-joueurs',
      category: CAT_ANNULER,
      question: `Puis-je changer les joueurs d'une partie ?`,
      answer: `Oui, depuis la réservation, ${cutoffPhrase(ctx.playerChangeCutoffHours)}. Chaque joueur ajouté est notifié.`,
    },
    {
      id: 'paiement',
      category: CAT_PAIEMENT,
      question: `Comment se passe le paiement ?`,
      answer: ctx.requireOnlinePayment
        ? `Le paiement se fait en ligne par carte au moment de la réservation, de façon sécurisée via Stripe.`
        : `Vous pouvez régler sur place à l'accueil ; le paiement en ligne peut aussi être proposé selon le créneau.`,
    },
    {
      id: 'securite-paiement',
      category: CAT_PAIEMENT,
      question: `Mes données bancaires sont-elles en sécurité ?`,
      answer: `Oui. Les paiements en ligne sont traités par **Stripe** ; ${ctx.name} ne stocke jamais votre numéro de carte.`,
    },
    {
      id: 'partie-ouverte',
      category: CAT_PARTIES,
      question: `Qu'est-ce qu'une « partie ouverte » ?`,
      answer: `C'est une partie créée par un joueur avec des places libres : d'autres joueurs peuvent s'y inscrire pour compléter l'équipe. Retrouvez-les dans l'onglet « Parties ».`,
    },
    {
      id: 'inscription-event',
      category: CAT_PARTIES,
      question: `Comment m'inscrire à un tournoi ou un événement ?`,
      answer: `Depuis l'onglet « Événements » ou « Tournois », ouvrez l'épreuve et inscrivez votre équipe. Les places disponibles et le règlement y sont indiqués.`,
    },
    {
      id: 'creer-compte',
      category: CAT_COMPTE,
      question: `Comment créer un compte ?`,
      answer: `Cliquez sur « S'inscrire », saisissez votre e-mail et le code reçu, puis complétez votre profil. C'est gratuit.`,
    },
    {
      id: 'pwa',
      category: CAT_COMPTE,
      question: `Puis-je utiliser Palova sur mon téléphone ?`,
      answer: `Oui : le site est une application installable (PWA). Depuis votre navigateur mobile, utilisez « Ajouter à l'écran d'accueil ».`,
    },
    {
      id: 'contact',
      category: CAT_COMPTE,
      question: `J'ai un souci avec ma réservation, qui contacter ?`,
      answer: `${contactLine} Pour un problème technique, l'assistance Palova est joignable depuis le pied de page.`,
    },
  ];
}
