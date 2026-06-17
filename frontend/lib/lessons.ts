export type LessonKind = 'INDIVIDUAL' | 'COLLECTIVE';

export function lessonKindLabel(k: LessonKind): string {
  return k === 'INDIVIDUAL' ? 'Individuel' : 'Collectif';
}

export function capacityLabel(confirmed: number, capacity: number): string {
  return `${confirmed} / ${capacity}`;
}

export function fillRatioLesson(confirmed: number, capacity: number): number {
  if (!capacity || capacity <= 0) return 0;
  return Math.max(0, Math.min(1, confirmed / capacity));
}
