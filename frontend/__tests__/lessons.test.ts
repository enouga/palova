import { lessonKindLabel, capacityLabel, fillRatioLesson } from '@/lib/lessons';

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
});
