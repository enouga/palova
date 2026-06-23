import { Brand, InfoRow, escapeHtml, renderLayout } from './layout';

export type ActivityType = 'tournament' | 'event' | 'lesson';
export type PlayerAction = 'confirmed' | 'waitlisted' | 'cancelled' | 'promoted';
export type OrganizerKind = 'registration' | 'cancellation';

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/** Vocabulaire selon le type d'activité (tournoi vs événement vs cours). */
function words(type: ActivityType) {
  if (type === 'tournament') {
    return { article: 'au tournoi', noun: 'le tournoi', voir: 'Voir le tournoi', gerer: 'Gérer le tournoi' };
  }
  if (type === 'lesson') {
    return { article: 'au cours', noun: 'le cours', voir: 'Voir le cours', gerer: 'Gérer les cours' };
  }
  return { article: "à l'événement", noun: "l'événement", voir: "Voir l'événement", gerer: "Gérer l'événement" };
}

export interface PlayerEmailInput {
  firstName: string;
  action: PlayerAction;
  activityType: ActivityType;
  activityName: string;
  clubName: string;
  dateLabel: string;
  url: string;
  brand: Brand;
  /** Nom du coéquipier (tournois en binôme). */
  partnerName?: string | null;
  /** Position en liste d'attente (1 = premier), si connue. */
  waitlistPosition?: number | null;
}

/** Email envoyé au joueur (et à son coéquipier) selon l'action. */
export function buildPlayerEmail(i: PlayerEmailInput): BuiltEmail {
  const w = words(i.activityType);
  const name = i.activityName;

  const infoRows: InfoRow[] = [
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
  ];
  if (i.partnerName) infoRows.push({ label: 'Coéquipier', value: i.partnerName });

  let subject: string;
  let heading: string;
  let intro: string;
  let footerNote = '';

  switch (i.action) {
    case 'confirmed':
      subject = `Inscription confirmée — ${name}`;
      heading = 'Inscription confirmée ✅';
      intro = `Votre inscription ${w.article} <strong>${escapeHtml(name)}</strong> est confirmée.`;
      if (i.partnerName) intro += ` Vous êtes inscrit·e en binôme avec ${escapeHtml(i.partnerName)}.`;
      break;
    case 'waitlisted':
      subject = `Liste d'attente — ${name}`;
      heading = "Vous êtes en liste d'attente";
      intro =
        `C'est complet pour le moment : votre inscription ${w.article} <strong>${escapeHtml(name)}</strong> ` +
        `est enregistrée en <strong>liste d'attente</strong>` +
        (i.waitlistPosition ? ` (position ${i.waitlistPosition})` : '') + '.';
      footerNote = 'Vous serez prévenu·e par email dès qu’une place se libère.';
      break;
    case 'cancelled':
      subject = `Désinscription confirmée — ${name}`;
      heading = 'Désinscription confirmée';
      intro = `Votre inscription ${w.article} <strong>${escapeHtml(name)}</strong> a bien été annulée.`;
      footerNote = 'Vous pouvez vous réinscrire tant que les inscriptions sont ouvertes.';
      break;
    case 'promoted':
      subject = `Une place s'est libérée — ${name}`;
      heading = 'Bonne nouvelle, une place s’est libérée 🎉';
      intro =
        `Une place vient de se libérer : vous passez de la liste d'attente à ` +
        `<strong>inscrit·e confirmé·e</strong> ${w.article} <strong>${escapeHtml(name)}</strong> !`;
      break;
  }

  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.firstName)},</p><p style="margin:0;">${intro}</p>`;

  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading,
    introHtml,
    infoRows,
    ctaLabel: w.voir,
    ctaUrl: i.url,
    footerNote,
  });

  const text = [
    `Bonjour ${i.firstName},`,
    '',
    stripTags(intro),
    '',
    `Date : ${i.dateLabel}`,
    `Club : ${i.clubName}`,
    i.partnerName ? `Coéquipier : ${i.partnerName}` : '',
    '',
    `${w.voir} : ${i.url}`,
    footerNote ? `\n${footerNote}` : '',
  ].filter((l) => l !== '').join('\n');

  return { subject, html, text };
}

export interface OrganizerEmailInput {
  staffFirstName: string;
  kind: OrganizerKind;
  activityType: ActivityType;
  activityName: string;
  /** « Jean Dupont & Marie Martin » (binôme) ou « Lucas Moreau » (individuel). */
  playerNames: string;
  /** « confirmée » | « en liste d'attente » (inscription) ; libre pour une annulation. */
  statusLabel: string;
  confirmedCount?: number | null;
  url: string;
  brand: Brand;
}

/** Email envoyé à chaque organisateur (staff OWNER/ADMIN du club). */
export function buildOrganizerEmail(i: OrganizerEmailInput): BuiltEmail {
  const w = words(i.activityType);
  const name = i.activityName;
  const isReg = i.kind === 'registration';

  const subject = isReg ? `Nouvelle inscription — ${name}` : `Désinscription — ${name}`;
  const heading = isReg ? 'Nouvelle inscription' : 'Désinscription';
  const verb = isReg
    ? `vient de s'inscrire (${i.statusLabel})`
    : `vient de se désinscrire`;
  const intro = `<strong>${escapeHtml(i.playerNames)}</strong> ${verb} ${w.article} <strong>${escapeHtml(name)}</strong>.`;

  const infoRows: InfoRow[] = [];
  if (i.confirmedCount != null) infoRows.push({ label: 'Inscriptions confirmées', value: String(i.confirmedCount) });

  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.staffFirstName)},</p><p style="margin:0;">${intro}</p>`;

  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading,
    introHtml,
    infoRows,
    ctaLabel: w.gerer,
    ctaUrl: i.url,
  });

  const text = [
    `Bonjour ${i.staffFirstName},`,
    '',
    stripTags(intro),
    i.confirmedCount != null ? `\nInscriptions confirmées : ${i.confirmedCount}` : '',
    '',
    `${w.gerer} : ${i.url}`,
  ].filter((l) => l !== '').join('\n');

  return { subject, html, text };
}

export interface MatchJoinEmailInput {
  organizerFirstName: string;
  joinerName: string;
  resourceName: string;
  dateLabel: string;
  clubName: string;
  spotsLeft: number;
  url: string;
  brand: Brand;
}

/** Email à l'organisateur d'une partie ouverte quand un joueur la rejoint. */
export function buildMatchJoinEmail(i: MatchJoinEmailInput): BuiltEmail {
  const subject = `${i.joinerName} a rejoint votre partie`;
  const heading = 'Un joueur a rejoint votre partie 🎾';
  const spots = i.spotsLeft <= 0
    ? 'La partie est désormais complète.'
    : `Il reste ${i.spotsLeft} place${i.spotsLeft > 1 ? 's' : ''}.`;
  const intro = `<strong>${escapeHtml(i.joinerName)}</strong> a rejoint votre partie ouverte. ${spots}`;
  const infoRows: InfoRow[] = [
    { label: 'Terrain', value: i.resourceName },
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
  ];
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.organizerFirstName)},</p><p style="margin:0;">${intro}</p>`;
  const html = renderLayout({
    brand: i.brand, preheader: subject, heading, introHtml, infoRows,
    ctaLabel: 'Voir la partie', ctaUrl: i.url,
  });
  const text = [
    `Bonjour ${i.organizerFirstName},`, '',
    stripTags(intro), '',
    `Terrain : ${i.resourceName}`,
    `Date : ${i.dateLabel}`,
    `Club : ${i.clubName}`, '',
    `Voir la partie : ${i.url}`,
  ].join('\n');
  return { subject, html, text };
}

export interface MatchInviteEmailInput {
  recipientFirstName: string;
  /** Nom de l'organisateur qui a ajouté le joueur ; null = ajout par le club (caisse). */
  byName?: string | null;
  resourceName: string;
  dateLabel: string;
  clubName: string;
  url: string;
  brand: Brand;
}

/** Email à un membre qu'on vient d'ajouter à une partie (partenaire ou rattachement club). */
export function buildMatchInviteEmail(i: MatchInviteEmailInput): BuiltEmail {
  const subject = `Vous avez été ajouté·e à une partie — ${i.clubName}`;
  const heading = 'Vous jouez ! 🎾';
  const intro = i.byName
    ? `<strong>${escapeHtml(i.byName)}</strong> vous a ajouté·e à une partie de padel.`
    : 'Vous avez été ajouté·e à une partie de padel.';
  const infoRows: InfoRow[] = [
    { label: 'Terrain', value: i.resourceName },
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
  ];
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.recipientFirstName)},</p><p style="margin:0;">${intro}</p>`;
  const html = renderLayout({
    brand: i.brand, preheader: subject, heading, introHtml, infoRows,
    ctaLabel: 'Voir mes parties', ctaUrl: i.url,
  });
  const text = [
    `Bonjour ${i.recipientFirstName},`, '',
    stripTags(intro), '',
    `Terrain : ${i.resourceName}`,
    `Date : ${i.dateLabel}`,
    `Club : ${i.clubName}`, '',
    `Voir mes parties : ${i.url}`,
  ].join('\n');
  return { subject, html, text };
}

export interface MatchRemovedEmailInput {
  recipientFirstName: string; resourceName: string; dateLabel: string; clubName: string; url: string; brand: Brand;
}

/** Email à un joueur retiré d'une partie par l'organisateur. */
export function buildMatchRemovedEmail(i: MatchRemovedEmailInput): BuiltEmail {
  const subject = `Vous avez été retiré·e d'une partie — ${i.clubName}`;
  const heading = 'Changement dans une partie';
  const intro = "L'organisateur vous a retiré·e de cette partie de padel.";
  const infoRows: InfoRow[] = [
    { label: 'Terrain', value: i.resourceName },
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
  ];
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.recipientFirstName)},</p><p style="margin:0;">${escapeHtml(intro)}</p>`;
  const html = renderLayout({ brand: i.brand, preheader: subject, heading, introHtml, infoRows, ctaLabel: 'Voir les parties ouvertes', ctaUrl: i.url });
  const text = [`Bonjour ${i.recipientFirstName},`, '', intro, '', `Terrain : ${i.resourceName}`, `Date : ${i.dateLabel}`, `Club : ${i.clubName}`, '', `Parties ouvertes : ${i.url}`].join('\n');
  return { subject, html, text };
}

export interface MatchLeftEmailInput {
  organizerFirstName: string; leaverName: string; resourceName: string; dateLabel: string; clubName: string; spotsLeft: number; url: string; brand: Brand;
}

/** Email à l'organisateur quand un joueur quitte sa partie ouverte. */
export function buildMatchLeftEmail(i: MatchLeftEmailInput): BuiltEmail {
  const subject = `${i.leaverName} a quitté votre partie`;
  const heading = 'Un joueur a quitté votre partie';
  const intro = `<strong>${escapeHtml(i.leaverName)}</strong> a quitté votre partie ouverte. Il reste ${i.spotsLeft} place${i.spotsLeft > 1 ? 's' : ''}.`;
  const infoRows: InfoRow[] = [
    { label: 'Terrain', value: i.resourceName },
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
  ];
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.organizerFirstName)},</p><p style="margin:0;">${intro}</p>`;
  const html = renderLayout({ brand: i.brand, preheader: subject, heading, introHtml, infoRows, ctaLabel: 'Voir la partie', ctaUrl: i.url });
  const text = [`Bonjour ${i.organizerFirstName},`, '', stripTags(intro), '', `Terrain : ${i.resourceName}`, `Date : ${i.dateLabel}`, `Club : ${i.clubName}`, '', `Voir la partie : ${i.url}`].join('\n');
  return { subject, html, text };
}

export interface RefundEmailInput {
  recipientFirstName: string;
  resourceName: string;
  dateLabel: string;
  clubName: string;
  amountLabel: string;   // ex. "20,00 €"
  prepaid: boolean;      // au moins un remboursement a recrédité un carnet/porte-monnaie
  url: string;
  brand: Brand;
}

/** Email au joueur quand sa réservation annulée est remboursée automatiquement. */
export function buildRefundEmail(i: RefundEmailInput): BuiltEmail {
  const subject = `Remboursement de votre réservation — ${i.clubName}`;
  const heading = 'Réservation remboursée 💶';
  const intro = i.prepaid
    ? `Votre réservation annulée a été remboursée : <strong>${escapeHtml(i.amountLabel)}</strong> recrédité sur votre solde (carnet / porte-monnaie).`
    : `Votre réservation annulée a été remboursée : <strong>${escapeHtml(i.amountLabel)}</strong>.`;
  const infoRows: InfoRow[] = [
    { label: 'Terrain', value: i.resourceName },
    { label: 'Date', value: i.dateLabel },
    { label: 'Club', value: i.clubName },
    { label: 'Remboursé', value: i.amountLabel },
  ];
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.recipientFirstName)},</p><p style="margin:0;">${intro}</p>`;
  const html = renderLayout({ brand: i.brand, preheader: subject, heading, introHtml, infoRows, ctaLabel: 'Voir mes réservations', ctaUrl: i.url });
  const text = [
    `Bonjour ${i.recipientFirstName},`, '',
    stripTags(intro), '',
    `Terrain : ${i.resourceName}`, `Date : ${i.dateLabel}`, `Club : ${i.clubName}`, `Remboursé : ${i.amountLabel}`, '',
    `Voir mes réservations : ${i.url}`,
  ].join('\n');
  return { subject, html, text };
}

export interface MatchConfirmEmailInput {
  brand: Brand;
  recipientFirstName: string;
  /** ex. "6-4 / 6-3" */
  scoreLine: string;
  matchUrl: string;
  /** Prénom + nom de celui qui a saisi le résultat. */
  authorName: string;
}

/** Email envoyé aux 3 autres joueurs pour confirmer (ou contester) le résultat d'un match. */
export function buildMatchConfirmEmail(i: MatchConfirmEmailInput): BuiltEmail {
  const subject = `Confirme le résultat de ton match`;
  const heading = 'Résultat en attente de confirmation';
  const intro =
    `<strong>${escapeHtml(i.authorName)}</strong> a saisi le résultat de votre match : ` +
    `<strong>${escapeHtml(i.scoreLine)}</strong>. ` +
    `Confirmez ou contestez ce résultat depuis votre espace.`;
  const introHtml = `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.recipientFirstName)},</p><p style="margin:0;">${intro}</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: subject,
    heading,
    introHtml,
    ctaLabel: 'Voir mes matchs',
    ctaUrl: i.matchUrl,
  });
  const text = [
    `Bonjour ${i.recipientFirstName},`,
    '',
    `${i.authorName} a saisi le résultat de votre match : ${i.scoreLine}.`,
    'Confirmez ou contestez ce résultat depuis votre espace.',
    '',
    `Voir mes matchs : ${i.matchUrl}`,
  ].join('\n');
  return { subject, html, text };
}

/** Retire les balises HTML pour produire la version texte. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

export interface BroadcastEmailInput {
  title: string;
  body: string;
  /** URL explicite (deep link) ; si absent, on utilise l'app du club. */
  url?: string | null;
  brand: Brand;
}

/** Email de diffusion envoyé par un club à tous ses membres actifs. */
export function buildBroadcastEmail(i: BroadcastEmailInput): BuiltEmail {
  const subject = `${i.title} — ${i.brand.name}`;
  const introHtml = `<p style="margin:0;">${escapeHtml(i.body)}</p>`;
  const html = renderLayout({
    brand: i.brand,
    preheader: i.title,
    heading: i.title,
    introHtml,
    ctaLabel: 'Voir',
    ctaUrl: i.url ?? undefined,
  });
  const text = [i.title, '', i.body, '', i.url ? `Lien : ${i.url}` : ''].filter(Boolean).join('\n');
  return { subject, html, text };
}

/** Email de validation d'inscription : code à 6 chiffres mis en avant, au gabarit Palova. */
export function buildVerificationEmail(code: string, brand: Brand): BuiltEmail {
  const subject = 'Votre code de validation Palova';
  const introHtml =
    "<p style=\"margin:0;\">Voici votre code de validation. Saisissez-le sur la page d'inscription pour activer votre compte.</p>";
  const html = renderLayout({
    brand,
    preheader: `${subject} — il expire dans 15 minutes.`,
    heading: 'Bienvenue sur Palova 👋',
    introHtml,
    codeBlock: { code, caption: 'Votre code' },
    footerNote:
      "Ce code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.",
  });
  const text = [
    'Bienvenue sur Palova !',
    '',
    `Votre code de validation : ${code}`,
    'Il expire dans 15 minutes.',
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
  ].join('\n');
  return { subject, html, text };
}

/** Email de réinitialisation de mot de passe : code à 6 chiffres mis en avant. */
export function buildPasswordResetEmail(code: string, brand: Brand): BuiltEmail {
  const subject = 'Réinitialisation de votre mot de passe Palova';
  const introHtml =
    "<p style=\"margin:0;\">Vous avez demandé à réinitialiser votre mot de passe. Saisissez ce code pour en choisir un nouveau.</p>";
  const html = renderLayout({
    brand,
    preheader: `${subject} — il expire dans 15 minutes.`,
    heading: 'Réinitialisation du mot de passe 🔒',
    introHtml,
    codeBlock: { code, caption: 'Votre code' },
    footerNote:
      "Ce code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email : votre mot de passe reste inchangé.",
  });
  const text = [
    'Réinitialisation de votre mot de passe Palova',
    '',
    `Votre code : ${code}`,
    'Il expire dans 15 minutes.',
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.",
  ].join('\n');
  return { subject, html, text };
}

export interface MatchCommentEmailInput {
  recipientFirstName: string;
  authorName: string;
  isFirst: boolean;
  scoreLine: string;
  excerpt: string;
  matchUrl: string;
  brand: Brand;
}

/** Email « nouveau message sur le litige » (ou « a contesté » pour le 1er message). */
export function buildMatchCommentEmail(i: MatchCommentEmailInput): BuiltEmail {
  const subject = i.isFirst
    ? `${i.authorName} a contesté le résultat de votre match`
    : 'Nouveau message sur le litige de votre match';
  const heading = i.isFirst ? 'Résultat contesté' : 'Nouveau message';
  const lead = i.isFirst
    ? `<strong>${escapeHtml(i.authorName)}</strong> a contesté le résultat (<strong>${escapeHtml(i.scoreLine)}</strong>) et a laissé un message :`
    : `<strong>${escapeHtml(i.authorName)}</strong> a écrit dans la discussion du litige (<strong>${escapeHtml(i.scoreLine)}</strong>) :`;
  const introHtml =
    `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(i.recipientFirstName)},</p>` +
    `<p style="margin:0 0 12px;">${lead}</p>` +
    `<p style="margin:0;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-style:italic;">${escapeHtml(i.excerpt)}</p>`;
  const html = renderLayout({
    brand: i.brand, preheader: subject, heading, introHtml,
    ctaLabel: 'Voir la discussion', ctaUrl: i.matchUrl,
  });
  const text = [
    `Bonjour ${i.recipientFirstName},`, '',
    i.isFirst
      ? `${i.authorName} a contesté le résultat (${i.scoreLine}) et a laissé un message :`
      : `${i.authorName} a écrit dans la discussion du litige (${i.scoreLine}) :`,
    `« ${i.excerpt} »`, '',
    `Voir la discussion : ${i.matchUrl}`,
  ].join('\n');
  return { subject, html, text };
}
