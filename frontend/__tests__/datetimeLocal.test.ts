import { localInputToISO, isoToLocalInput, splitLocal, joinLocal } from '@/lib/datetimeLocal';

describe('localInputToISO', () => {
  it('chaîne vide → "" (champ non renseigné)', () => {
    expect(localInputToISO('')).toBe('');
  });
  it('produit un ISO UTC (suffixe Z) parseable', () => {
    const iso = localInputToISO('2026-07-09T14:00');
    expect(iso).toMatch(/Z$/);
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false);
  });
});

describe('isoToLocalInput', () => {
  it('null / vide / invalide → ""', () => {
    expect(isoToLocalInput(null)).toBe('');
    expect(isoToLocalInput('')).toBe('');
    expect(isoToLocalInput('pas une date')).toBe('');
  });
  it('format YYYY-MM-DDThh:mm (sans secondes)', () => {
    expect(isoToLocalInput('2026-07-09T12:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

// Indépendant du fuseau de la machine de test : les deux conversions s'annulent.
describe('aller-retour', () => {
  it('ISO → datetime-local → ISO conserve l’instant', () => {
    const iso = '2026-07-09T12:00:00.000Z';
    expect(localInputToISO(isoToLocalInput(iso))).toBe(iso);
  });
  it('datetime-local → ISO → datetime-local conserve l’heure murale', () => {
    const local = '2026-07-09T14:30';
    expect(isoToLocalInput(localInputToISO(local))).toBe(local);
  });
});

describe('splitLocal', () => {
  it('découpe date et heure', () => {
    expect(splitLocal('2026-07-09T14:30')).toEqual({ date: '2026-07-09', time: '14:30' });
  });
  it('ignore d’éventuelles secondes', () => {
    expect(splitLocal('2026-07-09T14:30:00')).toEqual({ date: '2026-07-09', time: '14:30' });
  });
  it('vide → moitiés vides', () => {
    expect(splitLocal('')).toEqual({ date: '', time: '' });
  });
  it('date seule (sans T) → heure vide', () => {
    expect(splitLocal('2026-07-09')).toEqual({ date: '2026-07-09', time: '' });
  });
});

describe('joinLocal', () => {
  it('recompose un datetime-local', () => {
    expect(joinLocal('2026-07-09', '14:30')).toBe('2026-07-09T14:30');
  });
  it('moitié manquante → "" (jamais de datetime partiel)', () => {
    expect(joinLocal('2026-07-09', '')).toBe('');
    expect(joinLocal('', '14:30')).toBe('');
    expect(joinLocal('', '')).toBe('');
  });
  it('aller-retour split → join', () => {
    const v = '2026-07-09T14:30';
    const { date, time } = splitLocal(v);
    expect(joinLocal(date, time)).toBe(v);
  });
});
