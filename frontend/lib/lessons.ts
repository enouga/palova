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

// « Lucas Moreau » → { first: 'Lucas', last: 'Moreau' } — initiales de repli de l'Avatar
// (Coach.name est un champ texte unique, pas de firstName/lastName séparés).
export function splitCoachName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}
