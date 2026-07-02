import { shortNamesById } from '@/lib/names';

describe('shortNamesById', () => {
  it('rend « Prénom N. »', () => {
    expect(shortNamesById([{ id: 'a', firstName: 'Adam', lastName: 'Bernard' }]))
      .toEqual({ a: 'Adam B.' });
  });

  it('nom vide → prénom seul', () => {
    expect(shortNamesById([{ id: 'a', firstName: 'Adam', lastName: '' }]))
      .toEqual({ a: 'Adam' });
  });

  it("nom d'une seule lettre → nom complet (aussi court que l'abréviation)", () => {
    expect(shortNamesById([{ id: 'a', firstName: 'Marc', lastName: 'A' }]))
      .toEqual({ a: 'Marc A' });
  });

  it('collision → initiales allongées, les non-collidants restent à 1 lettre', () => {
    expect(shortNamesById([
      { id: 'a', firstName: 'Adam', lastName: 'Bernard' },
      { id: 'b', firstName: 'Adam', lastName: 'Bonnet' },
      { id: 'c', firstName: 'Ines', lastName: 'Andre' },
    ])).toEqual({ a: 'Adam Be.', b: 'Adam Bo.', c: 'Ines A.' });
  });

  it('prénom + nom identiques → nom complet (rendu identique accepté)', () => {
    expect(shortNamesById([
      { id: 'a', firstName: 'Adam', lastName: 'Bernard' },
      { id: 'b', firstName: 'Adam', lastName: 'Bernard' },
    ])).toEqual({ a: 'Adam Bernard', b: 'Adam Bernard' });
  });

  it('nom composé : initiale = 1er caractère majusculé, préfixe de collision sans espaces', () => {
    expect(shortNamesById([{ id: 'a', firstName: 'Jean', lastName: 'de la Fuente' }]))
      .toEqual({ a: 'Jean D.' });
    expect(shortNamesById([
      { id: 'a', firstName: 'Jean', lastName: 'de la Fuente' },
      { id: 'b', firstName: 'Jean', lastName: 'Dupont' },
    ])).toEqual({ a: 'Jean De.', b: 'Jean Du.' });
  });
});
