import { ClubPageKind } from '@prisma/client';

/**
 * Modèles Palova pré-remplis pour les pages légales/commerciales d'un club.
 * Le club part de ce contenu (rendu avec ses données) puis le personnalise.
 * Objectif : autonomie sans page blanche — jamais de valeur brute « null ».
 */

/** Données du club nécessaires au rendu des modèles. */
export interface TemplateClubContext {
  name: string;
  legalEntityName: string | null;
  legalForm: string | null;
  siret: string | null;
  vatNumber: string | null;
  legalRepresentative: string | null;
  legalEmail: string | null;
  legalPhone: string | null;
  address: string;
  city: string | null;
}

/** Hébergeur du site (commun à tous les clubs) — injecté dans les mentions légales. */
export const HOSTING_PROVIDER = {
  name: 'Palova',
  detail: 'Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Allemagne',
  site: 'https://palova.fr',
};

const TODO = '**[à compléter]**';
const orTodo = (v: string | null | undefined): string => (v && v.trim() ? v.trim() : TODO);

function fullAddress(club: TemplateClubContext): string {
  return [club.address?.trim(), club.city?.trim()].filter(Boolean).join(', ') || TODO;
}

function renderMentionsLegales(club: TemplateClubContext): string {
  const merchant = orTodo(club.legalEntityName);
  const form = orTodo(club.legalForm);
  return `# Mentions légales

## Éditeur du site
Le présent site est édité par **${merchant}** (${form}), exploitant le club **${club.name}**.

- Siège social : ${fullAddress(club)}
- SIRET : ${orTodo(club.siret)}
- TVA intracommunautaire : ${orTodo(club.vatNumber)}
- Directeur de la publication : ${orTodo(club.legalRepresentative)}
- Contact : ${orTodo(club.legalEmail)}${club.legalPhone?.trim() ? ` — ${club.legalPhone.trim()}` : ''}

## Hébergement
Le site est hébergé par **${HOSTING_PROVIDER.name}** — ${HOSTING_PROVIDER.detail} (${HOSTING_PROVIDER.site}).

## Propriété intellectuelle
L'ensemble des contenus de ce site (textes, visuels, logos) est protégé. Toute reproduction sans autorisation est interdite.

## Données personnelles
Le traitement de vos données est décrit dans notre politique de confidentialité. Vous disposez de droits d'accès, de rectification et de suppression que vous pouvez exercer en nous contactant.
`;
}

function renderCgv(club: TemplateClubContext): string {
  const merchant = orTodo(club.legalEntityName);
  return `# Conditions générales de vente

Les présentes conditions générales de vente (CGV) régissent les réservations et achats effectués auprès de **${merchant}**, exploitant le club **${club.name}**.

## 1. Objet
Les CGV s'appliquent à toute réservation de terrain, inscription à un tournoi ou un événement, et à tout achat d'offre proposée par le club via la plateforme.

## 2. Prix
Les prix sont indiqués en euros, toutes taxes comprises. Le club peut faire évoluer ses tarifs à tout moment ; le tarif applicable est celui affiché au moment de la réservation.

## 3. Réservation et paiement
La réservation est confirmée après validation et, le cas échéant, paiement en ligne sécurisé via Stripe. Le paiement sur place reste possible selon les modalités du club.

## 4. Annulation et remboursement
Les conditions et délais d'annulation, ainsi que les modalités de remboursement, sont précisés dans la fiche de réservation et dans la FAQ du club.

## 5. Droit de rétractation
Conformément à l'article L221-28 du Code de la consommation, le droit de rétractation ne s'applique pas aux prestations de loisirs fournies à une date déterminée.

## 6. Responsabilité
Le club met tout en œuvre pour assurer la disponibilité des installations. Sa responsabilité ne saurait être engagée en cas de force majeure.

## 7. Litiges
Les présentes CGV sont soumises au droit français. En cas de litige, une solution amiable sera recherchée avant toute action ; le consommateur peut recourir à un médiateur de la consommation.
`;
}

function renderConfidentialite(club: TemplateClubContext): string {
  const merchant = orTodo(club.legalEntityName);
  const contact = orTodo(club.legalEmail);
  return `# Politique de confidentialité

**${merchant}** (club **${club.name}**) accorde une grande importance à la protection de vos données personnelles, conformément au Règlement général sur la protection des données (RGPD).

## Données collectées
Nous collectons les données que vous nous fournissez (identité, e-mail, téléphone) et celles liées à votre activité (réservations, paiements).

## Finalités
Vos données personnelles sont utilisées pour gérer votre compte, vos réservations et paiements, et vous informer de la vie du club.

## Base légale et conservation
Les traitements reposent sur l'exécution du contrat et votre consentement. Les données sont conservées le temps nécessaire à ces finalités puis archivées ou supprimées.

## Vos droits
Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation et d'opposition. Pour les exercer, contactez-nous à ${contact}.

## Sous-traitants
La plateforme technique est fournie par Palova ; les paiements en ligne sont traités par Stripe. Ces prestataires agissent comme sous-traitants au sens du RGPD.

## Cookies
Le site utilise des cookies strictement nécessaires à son fonctionnement.
`;
}

function renderOffres(club: TemplateClubContext): string {
  return `# Nos offres

Bienvenue chez **${club.name}** ! Retrouvez ici nos formules pour jouer, progresser et profiter du club.

## Réservation à l'unité
Réservez un terrain à l'heure ou à la session, selon nos tarifs heures pleines / heures creuses.

## Abonnements
Nos abonnés bénéficient d'une ouverture anticipée des réservations et de tarifs préférentiels. ${TODO} : décrivez ici vos formules d'abonnement et leurs prix.

## Carnets & cartes prépayées
Des carnets de parties et un porte-monnaie sont disponibles à l'accueil. ${TODO} : détaillez vos carnets et avantages.

## Cours & stages
${TODO} : présentez vos cours, initiations et stages encadrés.
`;
}

/** Rend le markdown du modèle Palova pour un type de page donné. */
export function renderClubPageTemplate(kind: ClubPageKind, club: TemplateClubContext): string {
  switch (kind) {
    case 'CGV': return renderCgv(club);
    case 'MENTIONS_LEGALES': return renderMentionsLegales(club);
    case 'CONFIDENTIALITE': return renderConfidentialite(club);
    case 'OFFRES': return renderOffres(club);
    default: {
      const _exhaustive: never = kind;
      throw new Error(`VALIDATION_ERROR: ${_exhaustive as string}`);
    }
  }
}
