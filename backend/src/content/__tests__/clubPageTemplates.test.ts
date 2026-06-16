import { renderClubPageTemplate, TemplateClubContext, HOSTING_PROVIDER } from '../clubPageTemplates';

const full: TemplateClubContext = {
  name: 'Padel Arena',
  legalEntityName: 'Padel Arena SAS',
  legalForm: 'SAS',
  siret: '12345678900012',
  vatNumber: 'FR40123456789',
  legalRepresentative: 'Camille Martin',
  legalEmail: 'contact@arena.fr',
  legalPhone: '01 23 45 67 89',
  address: '12 rue du Padel',
  city: 'Lyon',
};

const empty: TemplateClubContext = {
  name: 'Padel Arena',
  legalEntityName: null,
  legalForm: null,
  siret: null,
  vatNumber: null,
  legalRepresentative: null,
  legalEmail: null,
  legalPhone: null,
  address: '12 rue du Padel',
  city: null,
};

describe('renderClubPageTemplate — MENTIONS_LEGALES', () => {
  it('interpole l\'identité légale et nomme l\'hébergeur Palova', () => {
    const md = renderClubPageTemplate('MENTIONS_LEGALES', full);
    expect(md).toContain('Padel Arena SAS');
    expect(md).toContain('12345678900012');
    expect(md).toContain('FR40123456789');
    expect(md).toContain('Camille Martin');
    expect(md).toContain('12 rue du Padel');
    expect(md).toContain(HOSTING_PROVIDER.name);
    expect(md).toContain(HOSTING_PROVIDER.detail);
  });

  it('insère un repère « à compléter » quand l\'identité légale manque', () => {
    const md = renderClubPageTemplate('MENTIONS_LEGALES', empty);
    expect(md).toContain('à compléter');
    expect(md).toContain('Padel Arena');      // le nom d'usage reste présent
    expect(md).toContain(HOSTING_PROVIDER.name);
    expect(md).not.toContain('null');
  });
});

describe('renderClubPageTemplate — autres types', () => {
  it('CGV : titre + raison sociale du marchand', () => {
    const md = renderClubPageTemplate('CGV', full);
    expect(md.toLowerCase()).toContain('conditions générales de vente');
    expect(md).toContain('Padel Arena SAS');
  });

  it('CONFIDENTIALITE : données personnelles + contact', () => {
    const md = renderClubPageTemplate('CONFIDENTIALITE', full);
    expect(md.toLowerCase()).toContain('données personnelles');
    expect(md).toContain('contact@arena.fr');
  });

  it('OFFRES : intro mentionnant le club', () => {
    const md = renderClubPageTemplate('OFFRES', full);
    expect(md).toContain('Padel Arena');
    expect(md.toLowerCase()).toContain('offre');
  });

  it('aucun modèle ne laisse traîner « null » ni « undefined »', () => {
    for (const kind of ['CGV', 'MENTIONS_LEGALES', 'CONFIDENTIALITE', 'OFFRES'] as const) {
      const md = renderClubPageTemplate(kind, empty);
      expect(md).not.toContain('null');
      expect(md).not.toContain('undefined');
      expect(md.length).toBeGreaterThan(0);
    }
  });
});
