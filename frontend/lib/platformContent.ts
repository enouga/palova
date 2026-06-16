// Contenu statique de la PLATEFORME Palova (palova.fr), maintenu par Palova/dev
// (faible fréquence de changement → versionné dans le code, pas d'éditeur admin).
// Les pages publiques host-aware affichent ce contenu quand aucun club n'est résolu.
// Les repères « [à compléter] » marquent les données légales/tarifaires réelles à renseigner.

export const PLATFORM_MENTIONS = `# Mentions légales

## Éditeur
Le site palova.fr est édité par **Palova** — [à compléter] (forme juridique, capital, RCS).

- Siège social : [à compléter]
- SIRET : [à compléter]
- Directeur de la publication : [à compléter]
- Contact : contact@palova.fr

## Hébergement
Le site est hébergé par **Hetzner Online GmbH** — Industriestr. 25, 91710 Gunzenhausen, Allemagne.

## Propriété intellectuelle
La marque Palova, le logo et l'ensemble des éléments du site sont protégés. Toute reproduction non autorisée est interdite.
`;

export const PLATFORM_CGV = `# Conditions générales d'utilisation et de vente

Les présentes conditions régissent l'utilisation de la plateforme **Palova** par les clubs et leurs adhérents.

## 1. Objet
Palova fournit aux clubs sportifs un logiciel de réservation, de gestion et d'encaissement en ligne, accessible par abonnement.

## 2. Comptes
Chaque club dispose d'un espace dédié. Le club est responsable de l'exactitude de ses informations et de la gestion de ses adhérents.

## 3. Abonnement et facturation
L'accès à Palova est proposé par formules d'abonnement (voir la page **Tarifs**). La facturation est mensuelle ou annuelle selon la formule choisie.

## 4. Encaissement
Les paiements en ligne des adhérents sont encaissés directement par chaque club via son compte Stripe. Palova n'est pas partie à ces transactions et agit comme fournisseur technique.

## 5. Disponibilité
Palova met en œuvre les moyens raisonnables pour assurer la disponibilité du service, sans garantie d'absence totale d'interruption.

## 6. Données
Le traitement des données est décrit dans la politique de confidentialité.

## 7. Droit applicable
Les présentes conditions sont soumises au droit français.
`;

export const PLATFORM_CONFIDENTIALITE = `# Politique de confidentialité

**Palova** attache une grande importance à la protection des données personnelles, conformément au RGPD.

## Responsable de traitement
Palova agit comme responsable de traitement pour la gestion des comptes et sous-traitant pour le compte des clubs concernant les données de leurs adhérents.

## Données collectées
Identité, e-mail, téléphone, et données d'usage liées aux réservations et paiements.

## Finalités
Fournir le service de réservation et de gestion, assurer la sécurité et améliorer la plateforme.

## Vos droits
Accès, rectification, effacement, limitation, opposition et portabilité. Contact : contact@palova.fr.

## Sous-traitants
Hébergement par Hetzner ; paiements par Stripe.

## Cookies
Cookies strictement nécessaires au fonctionnement du service.
`;

export const PLATFORM_TARIFS = `# Tarifs Palova

Palova équipe les clubs de padel (et autres sports de terrain) d'un site de réservation, de gestion et d'encaissement clé en main.

## Découverte — 0 €
Pour démarrer : réservations en ligne, page club brandée, annuaire public. Idéal pour tester.

## Club — [à compléter] € / mois
Tout Découverte + gestion des membres et abonnés, tournois & événements, parties ouvertes, caisse et comptabilité.

## Club Pro — [à compléter] € / mois
Tout Club + encaissement en ligne (Stripe Connect), quotas avancés, multi-sports, support prioritaire.

---

Chaque club encaisse directement ses adhérents via son propre compte Stripe : **les fonds vont au club**, Palova n'est pas intermédiaire de paiement.

Envie d'équiper votre club ? Écrivez-nous à **contact@palova.fr**.
`;

export interface PlatformFaqEntry { category: string; question: string; answer: string }

// FAQ plateforme : destinée aux GÉRANTS de club qui découvrent Palova.
export const PLATFORM_FAQ: PlatformFaqEntry[] = [
  { category: 'Démarrer', question: 'Qu\'est-ce que Palova ?', answer: 'Palova est une plateforme qui donne à votre club un site de réservation brandé, la gestion de vos membres, tournois et événements, ainsi que l\'encaissement en ligne.' },
  { category: 'Démarrer', question: 'Comment équiper mon club ?', answer: 'Écrivez-nous à contact@palova.fr : nous créons votre espace, vous choisissez votre sous-domaine ({votreclub}.palova.fr) et vous personnalisez votre club en quelques minutes.' },
  { category: 'Démarrer', question: 'Mes adhérents doivent-ils installer une application ?', answer: 'Non. Palova est une application web installable (PWA) : vos adhérents y accèdent depuis n\'importe quel navigateur, et peuvent l\'ajouter à leur écran d\'accueil.' },
  { category: 'Encaissement', question: 'Comment fonctionne le paiement en ligne ?', answer: 'Chaque club connecte son propre compte Stripe : les paiements de vos adhérents vous sont versés directement. Palova n\'est pas intermédiaire de paiement.' },
  { category: 'Encaissement', question: 'Qui gère mes CGV et mentions légales ?', answer: 'Vous. Palova vous fournit des modèles pré-remplis avec vos informations ; vous les complétez et les publiez depuis votre espace d\'administration, rubrique « Contenu & mentions ».' },
  { category: 'Facturation', question: 'Quelles sont les formules ?', answer: 'Voir la page Tarifs. Une formule de découverte gratuite permet de tester les réservations en ligne avant de passer à une formule complète.' },
  { category: 'Données', question: 'Où sont hébergées les données ?', answer: 'Les données sont hébergées en Europe (Hetzner, Allemagne) et traitées conformément au RGPD.' },
];
