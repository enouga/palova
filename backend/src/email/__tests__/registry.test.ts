import {
  substituteText,
  substituteHtml,
  sanitizeBodyHtml,
  decorateBodyHtml,
  collectPlaceholders,
} from '../registry';
import { EMAIL_DEFS, sampleVars } from '../registry';
import { renderClubEmail, brandFromClub } from '../registry';

const brand = brandFromClub({ name: 'Padel Arena', logoUrl: null, accentColor: '#1a2b3c' });

describe('substituteText', () => {
  it('remplace les variables connues par leur valeur brute', () => {
    expect(substituteText('Bonjour {{prenom}} !', { prenom: 'Léa & Co' }))
      .toBe('Bonjour Léa & Co !');
  });
  it('retire les placeholders inconnus', () => {
    expect(substituteText('A {{x}} B', {})).toBe('A  B');
  });
  it('retire les clés héritées du prototype (toString, constructor)', () => {
    expect(substituteText('a {{toString}} z', {})).toBe('a  z');
  });
  it('tolère les espaces autour du nom de variable', () => {
    expect(substituteText('a {{ prenom }} z', { prenom: 'X' })).toBe('a X z');
  });
});

describe('substituteHtml', () => {
  it('échappe la valeur insérée dans le HTML', () => {
    expect(substituteHtml('<p>{{nom}}</p>', { nom: '<b>x</b>' }))
      .toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });
  it('retire les placeholders inconnus', () => {
    expect(substituteHtml('<p>{{y}}</p>', {})).toBe('<p></p>');
  });
});

describe('sanitizeBodyHtml', () => {
  it('garde les balises autorisées', () => {
    const out = sanitizeBodyHtml('<p>Salut <strong>toi</strong> <a href="https://x.fr">ici</a></p>');
    expect(out).toContain('<strong>toi</strong>');
    expect(out).toContain('href="https://x.fr"');
  });
  it('supprime script et attributs on*', () => {
    const out = sanitizeBodyHtml('<p onclick="evil()">hi</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
  });
  it('supprime les schémas de lien dangereux', () => {
    const out = sanitizeBodyHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
});

describe('sanitizeBodyHtml — images', () => {
  it('conserve les img /uploads et http(s), rejette les autres sources', () => {
    expect(sanitizeBodyHtml('<img src="/uploads/email-images/a.png" alt="x">')).toContain('/uploads/email-images/a.png');
    expect(sanitizeBodyHtml('<img src="https://exemple.fr/a.png">')).toContain('https://exemple.fr/a.png');
    expect(sanitizeBodyHtml('<img src="javascript:alert(1)">')).not.toContain('<img');
    expect(sanitizeBodyHtml('<img alt="sans src">')).not.toContain('<img');
    expect(sanitizeBodyHtml('<img src="/etc/passwd">')).not.toContain('<img');
  });
});

describe('decorateBodyHtml', () => {
  it('absolutise les /uploads, style les images, colore les liens', () => {
    const out = decorateBodyHtml('<p><img src="/uploads/email-images/a.png" alt="" /><a href="https://x.fr">x</a></p>', '#5e93da');
    expect(out).toContain('/uploads/email-images/a.png');
    expect(out).toMatch(/src="https?:\/\/[^"]+\/uploads\/email-images\/a\.png"/);
    expect(out).toContain('max-width:100%');
    expect(out).toContain('<a style="color:#5e93da;"');
  });

  it('style les blockquotes sans style', () => {
    const out = decorateBodyHtml('<blockquote>citation</blockquote>', '#5e93da');
    expect(out).toContain('border-left:3px solid');
  });
});

describe('collectPlaceholders', () => {
  it('liste les clés uniques utilisées', () => {
    expect(collectPlaceholders('{{a}} {{b}} {{a}}').sort()).toEqual(['a', 'b']);
  });
});

describe('EMAIL_DEFS', () => {
  const entries = Object.entries(EMAIL_DEFS);

  it('contient 20 définitions et la clé == type', () => {
    expect(entries).toHaveLength(22);
    for (const [key, def] of entries) expect(def.type).toBe(key);
  });

  it('chaque défaut ne référence que des variables déclarées', () => {
    for (const [, def] of entries) {
      const declared = new Set(def.vars.map((v) => v.key));
      const used = new Set<string>([
        ...collectPlaceholders(def.defaults.subject),
        ...collectPlaceholders(def.defaults.heading),
        ...collectPlaceholders(def.defaults.bodyHtml),
        ...collectPlaceholders(def.defaults.ctaLabel ?? ''),
        ...collectPlaceholders(def.defaults.footerNote ?? ''),
      ]);
      for (const k of used) expect(declared.has(k)).toBe(true);
    }
  });

  it('champs requis non vides', () => {
    for (const [, def] of entries) {
      expect(def.defaults.subject.trim()).not.toBe('');
      expect(def.defaults.heading.trim()).not.toBe('');
      expect(def.defaults.bodyHtml.trim()).not.toBe('');
      expect(def.title.trim()).not.toBe('');
    }
  });

  it('sampleVars renvoie une valeur par variable déclarée', () => {
    const def = EMAIL_DEFS['registration.confirmed'];
    const s = sampleVars(def);
    for (const v of def.vars) expect(s[v.key]).toBe(v.sample);
  });
});

describe('renderClubEmail', () => {
  const vars = {
    prenom: 'Marie', activite: 'Tournoi P100', ref_activite: 'le tournoi',
    club: 'Padel Arena', date: 'dim. 6 juil. 14h00', coequipier: '', phrase_coequipier: '',
    lien: 'https://x.fr/t/1',
  };

  it('utilise les défauts quand pas de surcharge', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, null);
    expect(mail.subject).toBe('Inscription confirmée — Tournoi P100');
    expect(mail.html).toContain('Inscription confirmée ✅');
    expect(mail.html).toContain('<strong>Tournoi P100</strong>');
    expect(mail.html).toContain('href="https://x.fr/t/1"');
    expect(mail.text).toContain('Marie');
    expect(mail.text).toContain('Club : Padel Arena');
  });

  it('ajoute la ligne « Annulable jusqu’au » quand date_limite_annulation est fournie', () => {
    const mail = renderClubEmail(
      'registration.confirmed',
      { ...vars, date_limite_annulation: 'mardi 30 juin 2026 à 23h59' },
      brand,
      null,
    );
    expect(mail.html).toContain('Annulable jusqu’au');
    expect(mail.html).toContain('mardi 30 juin 2026 à 23h59');
    expect(mail.text).toContain('Annulable jusqu’au : mardi 30 juin 2026 à 23h59');
  });

  it('omet la ligne « Annulable jusqu’au » quand date_limite_annulation est absente', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, null);
    expect(mail.html).not.toContain('Annulable jusqu’au');
  });

  it('applique la surcharge club', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, {
      subject: 'Bienvenue {{prenom}} !', heading: 'Yes', bodyHtml: '<p>OK {{activite}}</p>',
      ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.subject).toBe('Bienvenue Marie !');
    expect(mail.html).toContain('OK Tournoi P100');
  });

  it('échappe les valeurs et retire les placeholders inconnus dans le corps', () => {
    const mail = renderClubEmail('registration.confirmed', { ...vars, activite: '<b>x</b>' }, brand, {
      subject: 's', heading: 'h', bodyHtml: '<p>{{activite}} {{inconnu}}</p>', ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(mail.html).not.toContain('{{inconnu}}');
  });

  it('assainit le corps personnalisé', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, {
      subject: 's', heading: 'h', bodyHtml: '<p>hi<script>alert(1)</script></p>', ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.html).not.toContain('<script');
  });

  it('lève EMAIL_TYPE_UNKNOWN pour un type inconnu', () => {
    expect(() => renderClubEmail('nope', {}, brand, null)).toThrow('EMAIL_TYPE_UNKNOWN');
  });

  it('produit un texte brut lisible (valeurs brutes, paragraphes séparés)', () => {
    const mail = renderClubEmail('registration.confirmed', {
      prenom: 'Léa', activite: 'Tennis & Padel', ref_activite: 'le tournoi',
      club: 'Smith & Co', date: 'dim. 6 juil. 14h00', coequipier: '', phrase_coequipier: '',
      lien: 'https://x.fr/t/1',
    }, brand, null);
    expect(mail.text).toContain('Bonjour Léa,');
    expect(mail.text).toContain('Tennis & Padel');
    expect(mail.text).toContain('Club : Smith & Co');
    expect(mail.text).not.toContain('&amp;');
    expect(mail.text).not.toContain('&lt;');
    expect(mail.text).not.toContain('Léa,Votre');
  });

  it('renderClubEmail : une image uploadée dans un corps personnalisé arrive absolutisée et stylée', () => {
    const mail = renderClubEmail('registration.confirmed', vars, brand, {
      subject: 's', heading: 'h',
      bodyHtml: '<p>ok</p><img src="/uploads/email-images/a.png" alt="affiche">',
      ctaLabel: null, footerNote: null,
    } as any);
    expect(mail.html).toMatch(/src="https?:\/\/[^"]+\/uploads\/email-images\/a\.png"/);
    expect(mail.html).toContain('max-width:100%');
  });

  it('ne nettoie PAS le corps par défaut (blockquote décoré, contenu préservé)', () => {
    const mail = renderClubEmail('match.disputed', {
      prenom: 'Marie', auteur: 'Éric', score: '6-4 / 6-3', extrait: 'Litige',
      lien: 'https://x.fr/m/1',
    }, brand, null);
    expect(mail.html).toContain('Éric');
    expect(mail.html).toContain('Litige');
    expect(mail.html).toContain('border-left:3px solid');
  });
});

describe('brandFromClub — coordonnées & manageUrl', () => {
  it('construit adresse jointe, téléphone, email et manageUrl depuis le slug', () => {
    const b = brandFromClub({
      name: 'Arena', logoUrl: null, accentColor: '#5e93da',
      slug: 'arena', address: '12 rue du Padel', city: 'Paris',
      contactPhone: '01 23 45 67 89', contactEmail: 'c@arena.fr',
    });
    expect(b.address).toBe('12 rue du Padel, Paris');
    expect(b.phone).toBe('01 23 45 67 89');
    expect(b.email).toBe('c@arena.fr');
    expect(b.manageUrl).toContain('arena');
    expect(b.manageUrl).toContain('/me/profile');
  });

  it('manageUrl vise l’onglet Préférences (le lien « Gérer mes notifications » y atterrit)', () => {
    // La page profil est en onglets et s'ouvre sur Identité par défaut : sans ?tab=,
    // le lien du pied de tous les emails raterait les préférences de notification.
    const b = brandFromClub({
      name: 'Arena', logoUrl: null, accentColor: '#5e93da',
      slug: 'arena', address: '12 rue du Padel', city: 'Paris',
      contactPhone: '01 23 45 67 89', contactEmail: 'c@arena.fr',
    });
    expect(b.manageUrl).toContain('/me/profile?tab=preferences');
  });

  it('champs absents → null (jamais undefined dans le rendu)', () => {
    const b = brandFromClub({ name: 'Arena', logoUrl: null, accentColor: '#5e93da' });
    expect(b.address).toBeNull();
    expect(b.phone).toBeNull();
    expect(b.email).toBeNull();
    expect(b.manageUrl).toBeNull();
  });
});

describe("email open_match.alert", () => {
  it('est déclaré avec ses variables et rend un sujet substitué', () => {
    const def = EMAIL_DEFS['open_match.alert'];
    expect(def).toBeDefined();
    expect(def.group).toBe('parties');
    const keys = def.vars.map((v) => v.key).sort();
    expect(keys).toEqual(['club', 'date', 'lien', 'niveau', 'phrase_places', 'prenom', 'terrain'].sort());
    const mail = renderClubEmail('open_match.alert', sampleVars(def), brand);
    expect(mail.subject).toContain('alerte');
    expect(mail.html).toContain(sampleVars(def).terrain);
  });
});

describe('renderClubEmail — rappels tournoi/event', () => {
  it('registration.deadline_reminder utilise les défauts', () => {
    const mail = renderClubEmail('registration.deadline_reminder', {
      prenom: 'Marie', activite: 'Tournoi P100', ref_activite: 'le tournoi',
      club: 'Padel Arena', date_limite: 'mardi 30 juin 2026 à 23h59',
      coequipier: '', phrase_coequipier: '', lien: 'https://x.fr/t/1',
    }, brand, null);
    expect(mail.subject).toBe('Dernier délai pour Tournoi P100');
    expect(mail.html).toContain('La clôture des inscriptions approche');
    expect(mail.html).toContain('mardi 30 juin 2026 à 23h59');
  });

  it('registration.upcoming_reminder distingue J-1 (demain) et H-2 (dans 2 heures) via la variable delai', () => {
    const base = {
      prenom: 'Marie', activite: 'Tournoi P100', ref_activite: 'le tournoi',
      club: 'Padel Arena', date: 'dim. 6 juil. 14h00',
      coequipier: '', phrase_coequipier: '', lien: 'https://x.fr/t/1',
    };
    const j1 = renderClubEmail('registration.upcoming_reminder', { ...base, delai: 'demain' }, brand, null);
    expect(j1.subject).toBe('Tournoi P100, c\'est demain !');
    expect(j1.html).toContain('c’est demain');

    const h2 = renderClubEmail('registration.upcoming_reminder', { ...base, delai: 'dans 2 heures' }, brand, null);
    expect(h2.subject).toBe('Tournoi P100, c\'est dans 2 heures !');
    expect(h2.html).toContain('c’est dans 2 heures');
  });
});
