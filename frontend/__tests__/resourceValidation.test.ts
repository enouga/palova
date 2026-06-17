import { validateResourceFields } from '@/lib/resourceValidation';

const valid = {
  name: 'Terrain 11',
  price: '52',
  offPeakPrice: '38',
  openHour: '9',
  closeHour: '22',
  slotStepMin: '90',
};

describe('validateResourceFields', () => {
  it('renvoie un objet vide quand tout est valide', () => {
    expect(validateResourceFields(valid)).toEqual({});
  });

  it('le cas de la capture (Ouv. 9 / Ferm. 0) signale closeHour', () => {
    const errs = validateResourceFields({ ...valid, openHour: '9', closeHour: '0' });
    expect(errs.closeHour).toBeTruthy();
    expect(errs.openHour).toBeUndefined();
  });

  it('accepte une fermeture à 24 (fin de journée)', () => {
    expect(validateResourceFields({ ...valid, closeHour: '24' }).closeHour).toBeUndefined();
  });

  it('refuse ouverture == fermeture', () => {
    expect(validateResourceFields({ ...valid, openHour: '10', closeHour: '10' }).closeHour).toBeTruthy();
  });

  it('refuse un nom vide', () => {
    expect(validateResourceFields({ ...valid, name: '   ' }).name).toBeTruthy();
  });

  it('refuse un tarif plein <= 0 ou vide', () => {
    expect(validateResourceFields({ ...valid, price: '0' }).price).toBeTruthy();
    expect(validateResourceFields({ ...valid, price: '' }).price).toBeTruthy();
  });

  it('tarif creux vide est valide, 0 invalide', () => {
    expect(validateResourceFields({ ...valid, offPeakPrice: '' }).offPeakPrice).toBeUndefined();
    expect(validateResourceFields({ ...valid, offPeakPrice: null }).offPeakPrice).toBeUndefined();
    expect(validateResourceFields({ ...valid, offPeakPrice: '0' }).offPeakPrice).toBeTruthy();
  });

  it('refuse une ouverture hors bornes', () => {
    expect(validateResourceFields({ ...valid, openHour: '-1' }).openHour).toBeTruthy();
    expect(validateResourceFields({ ...valid, openHour: '25' }).openHour).toBeTruthy();
  });

  it('créneau: vide valide, 30 valide, 20 invalide', () => {
    expect(validateResourceFields({ ...valid, slotStepMin: '' }).slotStepMin).toBeUndefined();
    expect(validateResourceFields({ ...valid, slotStepMin: '30' }).slotStepMin).toBeUndefined();
    expect(validateResourceFields({ ...valid, slotStepMin: '20' }).slotStepMin).toBeTruthy();
  });

  it('créneau: bornes 15 et 240 valides, 241 invalide', () => {
    expect(validateResourceFields({ ...valid, slotStepMin: '15' }).slotStepMin).toBeUndefined();
    expect(validateResourceFields({ ...valid, slotStepMin: '240' }).slotStepMin).toBeUndefined();
    expect(validateResourceFields({ ...valid, slotStepMin: '241' }).slotStepMin).toBeTruthy();
  });

  it('signale les deux champs quand ouverture et fermeture sont mal formées', () => {
    const errs = validateResourceFields({ ...valid, openHour: 'abc', closeHour: 'xyz' });
    expect(errs.openHour).toBeTruthy();
    expect(errs.closeHour).toBeTruthy();
  });

  it('accepte des entrées numériques (pas seulement string)', () => {
    expect(validateResourceFields({ ...valid, price: 52, openHour: 9, closeHour: 22 })).toEqual({});
  });
});
