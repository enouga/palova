import { siretIsValidFormat, checkSiret } from '../siret.service';

describe('siretIsValidFormat', () => {
  it('accepte un SIRET valide (14 chiffres + clé de Luhn)', () => {
    // SIRET de test valide au sens Luhn (Google France, établissement connu).
    expect(siretIsValidFormat('44306184100047')).toBe(true);
  });

  it('rejette une longueur incorrecte', () => {
    expect(siretIsValidFormat('4430618410004')).toBe(false);  // 13
    expect(siretIsValidFormat('443061841000470')).toBe(false); // 15
  });

  it('rejette les caractères non numériques', () => {
    expect(siretIsValidFormat('4430618410004A')).toBe(false);
    expect(siretIsValidFormat('443 061 841 00047')).toBe(false);
  });

  it('rejette une clé de Luhn invalide', () => {
    expect(siretIsValidFormat('44306184100048')).toBe(false);
  });

  it('rejette vide/espace', () => {
    expect(siretIsValidFormat('')).toBe(false);
    expect(siretIsValidFormat('   ')).toBe(false);
  });
});

describe('checkSiret', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  function mockFetch(body: unknown, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;
  }

  it('renvoie exists+active+legalName pour un établissement ouvert', async () => {
    mockFetch({ results: [{ nom_complet: 'PADEL ARENA SARL',
      matching_etablissements: [{ siret: '44306184100047', etat_administratif: 'A', libelle_commune: 'PARIS' }] }] });
    const r = await checkSiret('44306184100047');
    expect(r).toEqual({ exists: true, active: true, legalName: 'PADEL ARENA SARL', city: 'PARIS' });
  });

  it('renvoie exists=true, active=false pour un établissement fermé', async () => {
    mockFetch({ results: [{ nom_complet: 'CLUB FERME',
      matching_etablissements: [{ siret: '44306184100047', etat_administratif: 'F', libelle_commune: 'LYON' }] }] });
    const r = await checkSiret('44306184100047');
    expect(r).toEqual({ exists: true, active: false, legalName: 'CLUB FERME', city: 'LYON' });
  });

  it('renvoie exists=false quand aucun établissement ne correspond au SIRET', async () => {
    mockFetch({ results: [] });
    const r = await checkSiret('44306184100047');
    expect(r).toEqual({ exists: false, active: false, legalName: null, city: null });
  });

  it('renvoie null si l\'API répond en erreur HTTP', async () => {
    mockFetch({}, false);
    expect(await checkSiret('44306184100047')).toBeNull();
  });

  it('renvoie null si fetch throw (API injoignable)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    expect(await checkSiret('44306184100047')).toBeNull();
  });
});
