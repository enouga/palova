import { lessonKindLabel, capacityLabel, fillRatioLesson, splitCoachName } from '@/lib/lessons';

describe('lessons helpers', () => {
  it('libellés de type', () => {
    expect(lessonKindLabel('INDIVIDUAL')).toBe('Individuel');
    expect(lessonKindLabel('COLLECTIVE')).toBe('Collectif');
  });
  it('capacityLabel', () => {
    expect(capacityLabel(3, 4)).toBe('3 / 4');
  });
  it('fillRatioLesson borné [0,1]', () => {
    expect(fillRatioLesson(2, 4)).toBe(0.5);
    expect(fillRatioLesson(9, 4)).toBe(1);
    expect(fillRatioLesson(0, 0)).toBe(0);
  });
  it('splitCoachName sépare prénom / reste du nom (initiales de repli de l\'Avatar)', () => {
    expect(splitCoachName('Lucas Moreau')).toEqual({ first: 'Lucas', last: 'Moreau' });
    expect(splitCoachName('Jean-Paul Delacroix Martin')).toEqual({ first: 'Jean-Paul', last: 'Delacroix Martin' });
    expect(splitCoachName('Cher')).toEqual({ first: 'Cher', last: '' });
    expect(splitCoachName('  Léa   Roy  ')).toEqual({ first: 'Léa', last: 'Roy' });
  });
});
