import { ClubAdminDetail } from '@/lib/api';

export type StepState = 'done' | 'current' | 'todo';

export interface GuideStep {
  key: string;
  title: string;
  body: string;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    key: 'prepare',
    title: 'Préparez vos informations',
    body:
      "SIRET (ou n° RNA pour une association), IBAN du club, pièce d'identité du représentant légal, " +
      "email et téléphone mobile. Pas besoin de compte Stripe existant — tout se crée à l'étape suivante (~10 min).",
  },
  {
    key: 'connect',
    title: 'Connectez votre compte',
    body:
      'Cliquez sur « Connecter mon compte Stripe » et remplissez le formulaire hébergé par Stripe (en français). ' +
      'Vous pouvez le quitter et le reprendre plus tard avec « Reprendre l\'onboarding ».',
  },
  {
    key: 'verify',
    title: "Vérifiez l'activation",
    body:
      'Au retour sur Palova, le statut passe à « Compte actif » (sinon cliquez « Rafraîchir le statut »). ' +
      'Si le statut affiche « Compte restreint », complétez les informations demandées dans le tableau de bord Stripe.',
  },
  {
    key: 'options',
    title: 'Choisissez vos options et testez',
    body:
      'Cochez « Exiger le paiement CB » et/ou « Empreinte bancaire » selon vos besoins, puis testez un paiement.',
  },
];

export function stripeGuideStates(status: ClubAdminDetail['stripeAccountStatus']): StepState[] {
  switch (status) {
    case 'NONE': return ['current', 'todo', 'todo', 'todo'];
    case 'PENDING': return ['done', 'current', 'todo', 'todo'];
    case 'RESTRICTED': return ['done', 'done', 'current', 'todo'];
    case 'ACTIVE': return ['done', 'done', 'done', 'current'];
    default: return ['current', 'todo', 'todo', 'todo'];
  }
}

export interface DocLink {
  label: string;
  url: string;
}

export const STRIPE_DOC_LINKS: DocLink[] = [
  {
    label: 'Créer un compte Stripe Express',
    url: 'https://docs.stripe.com/connect/express-accounts?locale=fr-FR',
  },
  {
    label: 'Cartes de test Stripe',
    url: 'https://docs.stripe.com/testing?locale=fr-FR',
  },
  {
    label: 'Support Stripe',
    url: 'https://support.stripe.com/?locale=fr-FR',
  },
];
