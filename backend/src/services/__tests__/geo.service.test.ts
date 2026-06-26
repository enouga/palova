import { geocodeAddress, haversineKm } from '../geo.service';

describe('geo.service — geocodeAddress', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const okBody = {
    features: [{
      geometry: { coordinates: [2.3522, 48.8566] },
      properties: { context: '75, Paris, Île-de-France', postcode: '75011', city: 'Paris' },
    }],
  };

  it('parse une réponse BAN (lat/lon/region/postalCode/city)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => okBody }) as any;
    const r = await geocodeAddress({ address: '12 rue du Padel', city: 'Paris' });
    expect(r).toEqual({ latitude: 48.8566, longitude: 2.3522, region: 'Île-de-France', postalCode: '75011', city: 'Paris' });
  });

  it('renvoie null si aucune adresse (pas d\'appel réseau)', async () => {
    const spy = jest.fn();
    global.fetch = spy as any;
    expect(await geocodeAddress({ address: '', city: '' })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('renvoie null si la réponse n\'a pas de feature', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }) as any;
    expect(await geocodeAddress({ address: 'nowhere' })).toBeNull();
  });

  it('renvoie null sur HTTP non-ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as any;
    expect(await geocodeAddress({ address: 'x' })).toBeNull();
  });

  it('renvoie null si fetch jette (réseau / timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as any;
    expect(await geocodeAddress({ address: 'x' })).toBeNull();
  });
});

describe('geo.service — haversineKm', () => {
  it('≈ 0 pour deux points identiques', () => {
    expect(haversineKm({ lat: 48.85, lng: 2.35 }, { lat: 48.85, lng: 2.35 })).toBeCloseTo(0, 5);
  });
  it('Paris→Lyon ≈ 390 km (±20)', () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 45.7640, lng: 4.8357 });
    expect(d).toBeGreaterThan(370);
    expect(d).toBeLessThan(410);
  });
});
