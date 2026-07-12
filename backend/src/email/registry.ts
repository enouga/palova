import sanitizeHtml from 'sanitize-html';
import { Brand, InfoRow, PALOVA_BRAND, escapeHtml, renderLayout } from './templates/layout';
import { absoluteAsset, clubAppUrl } from './links';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Vrai si `vars` porte la clé en propre (jamais une clé héritée du prototype, ex. `toString`). */
const hasVar = (vars: Record<string, string>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(vars, k);

/** Substitution texte : valeur brute, placeholder inconnu → retiré. */
export function substituteText(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(PLACEHOLDER, (_m, k: string) => (hasVar(vars, k) ? vars[k] : ''));
}

/** Substitution dans du HTML : valeur HTML-échappée, placeholder inconnu → retiré. */
export function substituteHtml(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(PLACEHOLDER, (_m, k: string) => (hasVar(vars, k) ? escapeHtml(vars[k]) : ''));
}

/** Clés `{{…}}` uniques présentes dans un gabarit. */
export function collectPlaceholders(tpl: string): string[] {
  const set = new Set<string>();
  for (const m of tpl.matchAll(PLACEHOLDER)) set.add(m[1]);
  return [...set];
}

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'span', 'h2', 'h3', 'blockquote', 'img'],
  allowedAttributes: { a: ['href'], p: ['style'], span: ['style'], h2: ['style'], h3: ['style'], img: ['src', 'alt'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  // Une image n'est gardée que si sa source est http(s) ou un chemin /uploads/ de Palova
  // (allowedSchemes ne filtre pas les chemins relatifs — on le fait ici explicitement).
  exclusiveFilter: (frame) =>
    frame.tag === 'img' &&
    !(/^https?:\/\//i.test(frame.attribs.src || '') || (frame.attribs.src || '').startsWith('/uploads/')),
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(/],
      'font-weight': [/^(normal|bold|[1-9]00)$/],
      'font-style': [/^(normal|italic)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'text-decoration': [/^(none|underline|line-through)$/],
    },
  },
  disallowedTagsMode: 'discard',
};

/** Assainit le corps HTML **personnalisé** d'un club (allowlist serrée). */
export function sanitizeBodyHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTS);
}

/**
 * Décore le corps AU RENDU (jamais au stockage) : sources /uploads absolutisées,
 * style des images, liens à l'accent, blockquotes/h2/h3 sans style → style du gabarit.
 * Limitation assumée : un h2/h3 déjà stylé (ex. text-align de l'éditeur) garde son style
 * et ne reçoit pas la police serif.
 */
export function decorateBodyHtml(html: string, accent: string): string {
  return html
    .replace(/(<img\b[^>]*\bsrc=")(\/uploads\/[^"]+)"/gi, (_m, pre: string, p: string) => `${pre}${absoluteAsset(p)}"`)
    .replace(/<img\b/gi, '<img style="max-width:100%;height:auto;border-radius:12px;"')
    .replace(/<a\b(?![^>]*\bstyle=)/gi, `<a style="color:${accent};"`)
    .replace(/<blockquote\b(?![^>]*\bstyle=)/gi, '<blockquote style="margin:14px 0;padding:8px 16px;border-left:3px solid #d8dce3;color:#5d6675;font-style:italic;"')
    .replace(/<h2\b(?![^>]*\bstyle=)/gi, `<h2 style="font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:26px;font-weight:600;color:#181d26;margin:18px 0 8px;"`)
    .replace(/<h3\b(?![^>]*\bstyle=)/gi, `<h3 style="font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:24px;font-weight:600;color:#181d26;margin:16px 0 6px;"`);
}

/** Brand email d'un club (logo en URL absolue, coordonnées pour le pied de page, repli Palova). */
export function brandFromClub(club: {
  name: string; logoUrl: string | null; accentColor: string;
  slug?: string | null; address?: string | null; city?: string | null;
  contactPhone?: string | null; contactEmail?: string | null;
}): Brand {
  const address = [club.address, club.city].filter(Boolean).join(', ');
  return {
    name: club.name || PALOVA_BRAND.name,
    logoUrl: absoluteAsset(club.logoUrl),
    accentColor: club.accentColor || PALOVA_BRAND.accentColor,
    address: address || null,
    phone: club.contactPhone || null,
    email: club.contactEmail || null,
    manageUrl: club.slug ? clubAppUrl(club.slug, '/me/profile') : null,
  };
}

export interface EmailVar { key: string; label: string; sample: string; }

export interface EmailDef {
  type: string;
  group: 'inscriptions' | 'organisateur' | 'parties' | 'messages' | 'matchs' | 'paiement';
  title: string;
  description: string;
  vars: EmailVar[];
  defaults: { subject: string; heading: string; bodyHtml: string; ctaLabel?: string; footerNote?: string };
  infoRows?: (v: Record<string, string>) => InfoRow[];
  hasCta: boolean;
}

/** Valeurs d'exemple (pour l'aperçu admin), une par variable déclarée. */
export function sampleVars(def: EmailDef): Record<string, string> {
  return Object.fromEntries(def.vars.map((v) => [v.key, v.sample]));
}

// Helpers infoRows réutilisables (les valeurs sont rendues échappées par renderLayout).
const row = (label: string, value: string): InfoRow => ({ label, value });
const terrainRows = (v: Record<string, string>): InfoRow[] =>
  [row('Terrain', v.terrain), row('Date', v.date), row('Club', v.club)];

export const EMAIL_DEFS: Record<string, EmailDef> = {
  // ----------------------------------------------------------- Inscriptions
  'registration.confirmed': {
    type: 'registration.confirmed', group: 'inscriptions',
    title: 'Inscription confirmée',
    description: 'Au joueur (et son coéquipier) quand son inscription est validée.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom du destinataire', sample: 'Marie' },
      { key: 'activite', label: "Nom de l'activité", sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: "Référence (le tournoi / l'événement / le cours)", sample: 'le tournoi' },
      { key: 'club', label: 'Nom du club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date lisible', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'coequipier', label: 'Coéquipier (tournoi, sinon vide)', sample: 'Lucas Martin' },
      { key: 'phrase_coequipier', label: 'Phrase coéquipier (auto)', sample: ' Vous êtes inscrit·e en binôme avec Lucas Martin.' },
      { key: 'lien', label: 'Lien vers l\'activité', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: 'Inscription confirmée — {{activite}}',
      heading: 'Inscription confirmée ✅',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Votre inscription à <strong>{{activite}}</strong> est confirmée.{{phrase_coequipier}}</p>',
      ctaLabel: 'Voir {{ref_activite}}',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club), ...(v.coequipier ? [row('Coéquipier', v.coequipier)] : [])],
  },

  'registration.waitlisted': {
    type: 'registration.waitlisted', group: 'inscriptions',
    title: "Inscription en liste d'attente",
    description: "Au joueur quand l'épreuve est complète : mise en liste d'attente.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'coequipier', label: 'Coéquipier', sample: 'Lucas Martin' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: "Liste d'attente — {{activite}}",
      heading: "Vous êtes en liste d'attente",
      bodyHtml: "<p>Bonjour {{prenom}},</p><p>C'est complet pour le moment : votre inscription à <strong>{{activite}}</strong> est enregistrée en <strong>liste d'attente</strong>.</p>",
      ctaLabel: 'Voir {{ref_activite}}',
      footerNote: 'Vous serez prévenu·e par email dès qu’une place se libère.',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club), ...(v.coequipier ? [row('Coéquipier', v.coequipier)] : [])],
  },

  'registration.cancelled': {
    type: 'registration.cancelled', group: 'inscriptions',
    title: 'Désinscription confirmée',
    description: 'Au joueur après sa désinscription.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: 'Désinscription confirmée — {{activite}}',
      heading: 'Désinscription confirmée',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Votre inscription à <strong>{{activite}}</strong> a bien été annulée.</p>',
      ctaLabel: 'Voir {{ref_activite}}',
      footerNote: 'Vous pouvez vous réinscrire tant que les inscriptions sont ouvertes.',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club)],
  },

  'registration.promoted': {
    type: 'registration.promoted', group: 'inscriptions',
    title: 'Place libérée (promotion)',
    description: "Au joueur promu de la liste d'attente à confirmé.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'coequipier', label: 'Coéquipier', sample: 'Lucas Martin' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: "Une place s'est libérée — {{activite}}",
      heading: 'Bonne nouvelle, une place s’est libérée 🎉',
      bodyHtml: "<p>Bonjour {{prenom}},</p><p>Une place vient de se libérer : vous passez de la liste d'attente à <strong>inscrit·e confirmé·e</strong> à <strong>{{activite}}</strong> !</p>",
      ctaLabel: 'Voir {{ref_activite}}',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club), ...(v.coequipier ? [row('Coéquipier', v.coequipier)] : [])],
  },

  'activity.cancelled_by_club': {
    type: 'activity.cancelled_by_club', group: 'inscriptions',
    title: 'Activité annulée par le club',
    description: "À tous les inscrits quand le club annule l'activité.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'date', label: 'Date', sample: 'dimanche 6 juillet 2026 à 14h00' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/tournois/1' },
    ],
    defaults: {
      subject: 'Activité annulée — {{activite}}',
      heading: 'Activité annulée',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{activite}}</strong> a été annulé par le club.</p>',
      ctaLabel: 'Voir {{ref_activite}}',
    },
    infoRows: (v) => [row('Date', v.date), row('Club', v.club)],
  },

  // ----------------------------------------------------------- Organisateur
  'organizer.registration': {
    type: 'organizer.registration', group: 'organisateur',
    title: 'Organisateur — nouvelle inscription',
    description: 'Au staff (OWNER/ADMIN) à chaque nouvelle inscription.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom du staff', sample: 'Éric' },
      { key: 'joueurs', label: 'Joueur(s) inscrit(s)', sample: 'Marie Durand & Lucas Martin' },
      { key: 'statut', label: 'Statut', sample: 'confirmée' },
      { key: 'nb_inscrits', label: 'Inscriptions confirmées', sample: '12' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'lien', label: 'Lien admin', sample: 'https://club.palova.fr/admin/tournaments' },
    ],
    defaults: {
      subject: 'Nouvelle inscription — {{activite}}',
      heading: 'Nouvelle inscription',
      bodyHtml: "<p>Bonjour {{prenom}},</p><p><strong>{{joueurs}}</strong> vient de s'inscrire ({{statut}}) à <strong>{{activite}}</strong>.</p>",
      ctaLabel: 'Gérer {{ref_activite}}',
    },
    infoRows: (v) => (v.nb_inscrits ? [row('Inscriptions confirmées', v.nb_inscrits)] : []),
  },

  'organizer.cancellation': {
    type: 'organizer.cancellation', group: 'organisateur',
    title: 'Organisateur — désinscription',
    description: 'Au staff (OWNER/ADMIN) à chaque désinscription.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom du staff', sample: 'Éric' },
      { key: 'joueurs', label: 'Joueur(s)', sample: 'Marie Durand & Lucas Martin' },
      { key: 'activite', label: 'Activité', sample: 'Tournoi P100 du dimanche' },
      { key: 'ref_activite', label: 'Référence', sample: 'le tournoi' },
      { key: 'lien', label: 'Lien admin', sample: 'https://club.palova.fr/admin/tournaments' },
    ],
    defaults: {
      subject: 'Désinscription — {{activite}}',
      heading: 'Désinscription',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{joueurs}}</strong> vient de se désinscrire de <strong>{{activite}}</strong>.</p>',
      ctaLabel: 'Gérer {{ref_activite}}',
    },
  },

  // -------------------------------------------------------- Parties ouvertes
  'open_match.joined': {
    type: 'open_match.joined', group: 'parties',
    title: 'Partie — un joueur a rejoint',
    description: "À l'organisateur quand un joueur rejoint sa partie ouverte.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom organisateur', sample: 'Éric' },
      { key: 'joueur', label: 'Joueur qui rejoint', sample: 'Marie Durand' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'phrase_places', label: 'Places restantes (auto)', sample: 'Il reste 2 places.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: '{{joueur}} a rejoint votre partie',
      heading: 'Un joueur a rejoint votre partie 🎾',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{joueur}}</strong> a rejoint votre partie ouverte. {{phrase_places}}</p>',
      ctaLabel: 'Voir la partie',
    },
    infoRows: terrainRows,
  },

  'open_match.added': {
    type: 'open_match.added', group: 'parties',
    title: 'Partie — vous avez été ajouté·e',
    description: "Au membre ajouté à une partie (partenaire, ajout organisateur ou rattachement club).",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'phrase_par', label: 'Phrase « ajouté par » (auto)', sample: 'Éric Nougayrède vous a ajouté·e à une partie de padel.' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/reservations' },
    ],
    defaults: {
      subject: 'Vous avez été ajouté·e à une partie — {{club}}',
      heading: 'Vous jouez ! 🎾',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>{{phrase_par}}</p>',
      ctaLabel: 'Voir mes parties',
    },
    infoRows: terrainRows,
  },

  'open_match.removed': {
    type: 'open_match.removed', group: 'parties',
    title: 'Partie — vous avez été retiré·e',
    description: "Au joueur retiré d'une partie par l'organisateur.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: "Vous avez été retiré·e d'une partie — {{club}}",
      heading: 'Changement dans une partie',
      bodyHtml: "<p>Bonjour {{prenom}},</p><p>L'organisateur vous a retiré·e de cette partie de padel.</p>",
      ctaLabel: 'Voir les parties ouvertes',
    },
    infoRows: terrainRows,
  },

  'open_match.left': {
    type: 'open_match.left', group: 'parties',
    title: 'Partie — un joueur a quitté',
    description: "À l'organisateur quand un joueur quitte sa partie ouverte.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom organisateur', sample: 'Éric' },
      { key: 'joueur', label: 'Joueur qui quitte', sample: 'Marie Durand' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'phrase_places', label: 'Places restantes (auto)', sample: 'Il reste 1 place.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: '{{joueur}} a quitté votre partie',
      heading: 'Un joueur a quitté votre partie',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{joueur}}</strong> a quitté votre partie ouverte. {{phrase_places}}</p>',
      ctaLabel: 'Voir la partie',
    },
    infoRows: terrainRows,
  },

  'open_match.proposed': {
    type: 'open_match.proposed', group: 'parties',
    title: 'Partie — proposée à ton niveau',
    description: "Aux membres opt-in « à mon niveau » dont le niveau correspond.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'niveau', label: 'Fourchette de niveau', sample: 'Niveau 2 à 5' },
      { key: 'phrase_places', label: 'Places restantes (auto)', sample: 'Il reste 2 places.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: 'Une partie à ton niveau — {{club}}',
      heading: 'Une partie pour toi ! 🎾',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Une partie ouverte correspond à ton niveau et cherche des joueurs. {{phrase_places}}</p>',
      ctaLabel: 'Voir la partie',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Date', v.date), row('Niveau', v.niveau), row('Club', v.club)],
  },

  'open_match.message': {
    type: 'open_match.message', group: 'parties',
    title: 'Partie — nouveau message (chat)',
    description: 'Aux membres du chat absents quand un message est posté.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur du message', sample: 'Éric Nougayrède' },
      { key: 'message', label: 'Extrait du message', sample: 'On se retrouve à 17h45 ?' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/parties' },
    ],
    defaults: {
      subject: 'Nouveau message — {{terrain}}',
      heading: 'Nouveau message dans ta partie 💬',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Un nouveau message a été posté dans ta partie :</p><blockquote><strong>{{auteur}}</strong> : {{message}}</blockquote>',
      ctaLabel: 'Voir la discussion',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Club', v.club)],
  },

  // ------------------------------------------------------------- Messagerie
  'dm.message': {
    type: 'dm.message', group: 'messages',
    title: 'Message privé reçu',
    description: 'Au destinataire absent quand un message privé arrive (1 email par rafale de messages).',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur du message', sample: 'Éric Nougayrède' },
      { key: 'message', label: 'Extrait du message', sample: 'On se fait un match samedi ?' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/messages' },
    ],
    defaults: {
      subject: 'Nouveau message de {{auteur}}',
      heading: 'Nouveau message privé 💬',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Vous avez reçu un message privé :</p><blockquote><strong>{{auteur}}</strong> : {{message}}</blockquote>',
      ctaLabel: 'Répondre',
    },
    infoRows: (v) => [row('Club', v.club)],
  },

  // ---------------------------------------------------------------- Matchs
  'match.pending_confirmation': {
    type: 'match.pending_confirmation', group: 'matchs',
    title: 'Match — confirme le résultat',
    description: 'Aux 3 autres joueurs quand un résultat est saisi.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur de la saisie', sample: 'Éric Nougayrède' },
      { key: 'score', label: 'Score', sample: '6-4 / 6-3' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/matches' },
    ],
    defaults: {
      subject: 'Confirme le résultat de ton match',
      heading: 'Résultat en attente de confirmation',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{auteur}}</strong> a saisi le résultat de votre match : <strong>{{score}}</strong>. Confirmez ou contestez ce résultat depuis votre espace.</p>',
      ctaLabel: 'Voir mes matchs',
    },
  },

  'match.disputed': {
    type: 'match.disputed', group: 'matchs',
    title: 'Match — résultat contesté',
    description: 'Aux participants quand le résultat est contesté (1er message).',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur', sample: 'Éric Nougayrède' },
      { key: 'score', label: 'Score', sample: '6-4 / 6-3' },
      { key: 'extrait', label: 'Message', sample: 'Le 2ᵉ set était 6-4 pour nous.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/matches' },
    ],
    defaults: {
      subject: '{{auteur}} a contesté le résultat de votre match',
      heading: 'Résultat contesté',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{auteur}}</strong> a contesté le résultat (<strong>{{score}}</strong>) et a laissé un message :</p><blockquote>{{extrait}}</blockquote>',
      ctaLabel: 'Voir la discussion',
    },
  },

  'match.comment': {
    type: 'match.comment', group: 'matchs',
    title: 'Match — message sur litige',
    description: 'Aux participants à chaque nouveau message sur un litige.',
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'auteur', label: 'Auteur', sample: 'Éric Nougayrède' },
      { key: 'score', label: 'Score', sample: '6-4 / 6-3' },
      { key: 'extrait', label: 'Message', sample: 'D’accord, on valide alors.' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/matches' },
    ],
    defaults: {
      subject: 'Nouveau message sur le litige de votre match',
      heading: 'Nouveau message',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p><strong>{{auteur}}</strong> a écrit dans la discussion du litige (<strong>{{score}}</strong>) :</p><blockquote>{{extrait}}</blockquote>',
      ctaLabel: 'Voir la discussion',
    },
  },

  // -------------------------------------------------------------- Paiement
  'payment.refunded': {
    type: 'payment.refunded', group: 'paiement',
    title: 'Remboursement',
    description: "Au joueur quand sa réservation annulée est remboursée.",
    hasCta: true,
    vars: [
      { key: 'prenom', label: 'Prénom', sample: 'Marie' },
      { key: 'terrain', label: 'Terrain', sample: 'Court 2' },
      { key: 'date', label: 'Date', sample: 'samedi 5 juillet 2026 à 18h00' },
      { key: 'club', label: 'Club', sample: 'Padel Arena Paris' },
      { key: 'montant', label: 'Montant remboursé', sample: '20,00 €' },
      { key: 'support_solde', label: 'Mention solde (auto)', sample: ' recrédité sur votre solde (carnet / porte-monnaie)' },
      { key: 'lien', label: 'Lien', sample: 'https://club.palova.fr/me/reservations' },
    ],
    defaults: {
      subject: 'Remboursement de votre réservation — {{club}}',
      heading: 'Réservation remboursée 💶',
      bodyHtml: '<p>Bonjour {{prenom}},</p><p>Votre réservation annulée a été remboursée : <strong>{{montant}}</strong>{{support_solde}}.</p>',
      ctaLabel: 'Voir mes réservations',
    },
    infoRows: (v) => [row('Terrain', v.terrain), row('Date', v.date), row('Club', v.club), row('Remboursé', v.montant)],
  },
};

/** Surcharge club minimale (sous-ensemble du modèle ClubEmailTemplate). */
export interface EmailOverride {
  subject: string; heading: string; bodyHtml: string;
  ctaLabel: string | null; footerNote: string | null;
}

export interface BuiltEmail { subject: string; html: string; text: string; }

/** Convertit du HTML en texte brut : balises de bloc → saut de ligne, autres balises retirées. */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|li|h2|h3|blockquote|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function buildText(textBody: string, infoRows: InfoRow[], ctaLabel: string | undefined, ctaUrl: string | undefined, footerNote: string | undefined): string {
  const lines = [textBody, ''];
  for (const r of infoRows) lines.push(`${r.label} : ${r.value}`);
  if (ctaLabel && ctaUrl) { lines.push('', `${ctaLabel} : ${ctaUrl}`); }
  if (footerNote) { lines.push('', footerNote); }
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n').trim();
}

/**
 * Construit un email club : surcharge si fournie, sinon défaut du registre.
 * Le corps PAR DÉFAUT est de confiance (non assaini, styles préservés) ; le corps
 * PERSONNALISÉ est assaini. Les valeurs de variables sont HTML-échappées dans le corps.
 */
export function renderClubEmail(
  type: string,
  vars: Record<string, string>,
  brand: Brand,
  override?: EmailOverride | null,
): BuiltEmail {
  const def = EMAIL_DEFS[type];
  if (!def) throw new Error('EMAIL_TYPE_UNKNOWN');

  const usingCustomBody = override?.bodyHtml != null;
  const subjectTpl = override?.subject ?? def.defaults.subject;
  const headingTpl = override?.heading ?? def.defaults.heading;
  const bodyTpl = override?.bodyHtml ?? def.defaults.bodyHtml;
  const ctaTpl = (override?.ctaLabel ?? def.defaults.ctaLabel) || undefined;
  const footerTpl = (override?.footerNote ?? def.defaults.footerNote) || '';

  const subject = substituteText(subjectTpl, vars);
  const heading = substituteText(headingTpl, vars);
  const substitutedBody = substituteHtml(bodyTpl, vars);
  const introHtml = usingCustomBody ? sanitizeBodyHtml(substitutedBody) : substitutedBody;
  // Texte brut dérivé du gabarit substitué AVEC valeurs brutes (non échappées) :
  // évite les entités HTML (&amp;) et fusionne pas les paragraphes (sauts de ligne).
  const textBody = htmlToText(substituteText(bodyTpl, vars));
  const ctaLabel = ctaTpl ? substituteText(ctaTpl, vars) : undefined;
  const footerNote = substituteText(footerTpl, vars) || undefined;
  const infoRows = def.infoRows ? def.infoRows(vars) : [];
  const ctaUrl = def.hasCta ? vars.lien : undefined;

  const accent = brand.accentColor || PALOVA_BRAND.accentColor;
  const decoratedIntro = decorateBodyHtml(introHtml, accent);
  const html = renderLayout({ brand, preheader: subject, heading, introHtml: decoratedIntro, infoRows, ctaLabel, ctaUrl, footerNote });
  const text = buildText(textBody, infoRows, ctaLabel, ctaUrl, footerNote);
  return { subject, html, text };
}
