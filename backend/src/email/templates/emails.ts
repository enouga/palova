import { Brand, InfoRow, escapeHtml, renderLayout } from './layout';

export type ActivityType = 'tournament' | 'event';
export type PlayerAction = 'confirmed' | 'waitlisted' | 'cancelled' | 'promoted';
export type OrganizerKind = 'registration' | 'cancellation';

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/** Vocabulaire selon le type d'activité (tournoi vs événement). */
function words(type: ActivityType) {
  return type === 'tournament'
    ? { article: 'au tournoi', noun: 'le tournoi', voir: 'Voir le tournoi', gerer: 'Gérer le tournoi' }
    : { article: "à l'événement", noun: "l'événement", voir: "Voir l'événement", gerer: "Gérer l'événement" };
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

/** Retire les balises HTML pour produire la version texte. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
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
