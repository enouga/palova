/**
 * Flux SSE des notifications partagé (singleton par onglet).
 * Contexte : Chrome plafonne à 6 connexions HTTP/1.1 par origine ; chaque page ouvrait
 * 3+ EventSource identiques vers /api/notifications/stream (ClubNav ×2 + cloche…) →
 * 2 onglets suffisaient à saturer le quota et TOUTES les requêtes API restaient en file.
 * Le singleton garantit UNE connexion par onglet, partagée par tous les abonnés.
 */

jest.mock('../lib/api', () => ({
  notificationsStreamUrl: (token: string) => `http://x/stream?token=${token}`,
}));

class FakeES {
  static instances: FakeES[] = [];
  url: string;
  closed = false;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(url: string) { this.url = url; FakeES.instances.push(this); }
  close() { this.closed = true; }
  emit(payload: unknown) { this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) }); }
}

beforeAll(() => { (global as unknown as { EventSource: unknown }).EventSource = FakeES; });

// Le module porte un état singleton → module neuf pour chaque test.
let subscribeNotifications: (token: string, cb: () => void) => () => void;
beforeEach(() => {
  FakeES.instances = [];
  jest.resetModules();
  subscribeNotifications = require('../lib/notificationsStream').subscribeNotifications;
});

it('deux abonnés au même token partagent UNE seule connexion, tous deux notifiés', () => {
  const a = jest.fn();
  const b = jest.fn();
  subscribeNotifications('t1', a);
  subscribeNotifications('t1', b);
  expect(FakeES.instances).toHaveLength(1);
  expect(FakeES.instances[0].url).toBe('http://x/stream?token=t1');

  FakeES.instances[0].emit({ type: 'notification' });
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
});

it('seul le DERNIER désabonnement ferme la connexion', () => {
  const un1 = subscribeNotifications('t1', jest.fn());
  const un2 = subscribeNotifications('t1', jest.fn());
  un1();
  expect(FakeES.instances[0].closed).toBe(false);
  un2();
  expect(FakeES.instances[0].closed).toBe(true);
});

it('un désabonné ne reçoit plus rien, les autres si', () => {
  const a = jest.fn();
  const b = jest.fn();
  const unA = subscribeNotifications('t1', a);
  subscribeNotifications('t1', b);
  unA();
  FakeES.instances[0].emit({ type: 'notification' });
  expect(a).not.toHaveBeenCalled();
  expect(b).toHaveBeenCalledTimes(1);
});

it('un nouvel abonné après fermeture complète rouvre une connexion', () => {
  const un = subscribeNotifications('t1', jest.fn());
  un();
  subscribeNotifications('t1', jest.fn());
  expect(FakeES.instances).toHaveLength(2);
  expect(FakeES.instances[1].closed).toBe(false);
});

it('changement de token : ferme l’ancien flux, en ouvre un neuf', () => {
  subscribeNotifications('t1', jest.fn());
  const cb = jest.fn();
  subscribeNotifications('t2', cb);
  expect(FakeES.instances).toHaveLength(2);
  expect(FakeES.instances[0].closed).toBe(true);
  FakeES.instances[1].emit({ type: 'notification' });
  expect(cb).toHaveBeenCalledTimes(1);
});

it('ping non-JSON et events d’un autre type sont ignorés sans planter', () => {
  const cb = jest.fn();
  subscribeNotifications('t1', cb);
  FakeES.instances[0].emit('ping');               // pas du JSON
  FakeES.instances[0].emit({ type: 'connected' }); // autre type
  expect(cb).not.toHaveBeenCalled();
});

it('une erreur réseau ne ferme PAS le flux (reconnexion native d’EventSource)', () => {
  const cb = jest.fn();
  subscribeNotifications('t1', cb);
  FakeES.instances[0].onerror?.(new Error('boom'));
  expect(FakeES.instances[0].closed).toBe(false);
  // le flux vit toujours : une notification suivante arrive
  FakeES.instances[0].emit({ type: 'notification' });
  expect(cb).toHaveBeenCalledTimes(1);
});

it('le désabonnement d’un flux périmé (token changé) ne ferme pas le flux courant', () => {
  const unOld = subscribeNotifications('t1', jest.fn());
  subscribeNotifications('t2', jest.fn()); // remplace le flux t1
  unOld(); // ne doit PAS fermer le flux t2
  expect(FakeES.instances[1].closed).toBe(false);
});
