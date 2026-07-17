'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { AgendaCardHeader } from '@/components/agenda/AgendaCardHeader';
import { colorForSeed } from '@/lib/playerColors';
import { formatDateShortTimeRange, heroPlacesLabel } from '@/lib/tournament';
import { lessonKindLabel, fillRatioLesson, type LessonKind } from '@/lib/lessons';
import type { CoachLessonRow } from '@/lib/api';

/** « 3 / 4 élèves · 1 en attente » — la capacité d'un cours est toujours connue. */
function studentsLabel(l: CoachLessonRow): string {
  const base = `${l.confirmedCount} / ${l.capacity} élève${l.confirmedCount > 1 ? 's' : ''}`;
  return l.waitlistCount > 0 ? `${base} · ${l.waitlistCount} en attente` : base;
}

/**
 * Carte d'un cours de l'espace coach : en-tête au langage AgendaCard (tuile sifflet bleue,
 * type de cours, compte à rebours avant le début, jauge de remplissage) puis le roster d'élèves.
 *
 * Les élèves arrivent avec la liste (payload `CoachLessonRow.students`) → affichés d'emblée,
 * pas de dépli : le coach ouvre la page pour voir qui vient.
 *
 * Pas un <button> comme AgendaCard : la carte contient des boutons et des liens `tel:`.
 */
export function CoachLessonCard({ lesson, tz, now, editable, onAddStudent, onRemoveStudent }: {
  lesson: CoachLessonRow;
  tz: string;
  /** Horloge posée au mount par la page. Absente/null → pas de compte à rebours (hydration-safe). */
  now?: Date | null;
  editable: boolean;
  onAddStudent: (lessonId: string) => void;
  onRemoveStudent: (lessonId: string, enrollId: string) => void;
}) {
  const { th } = useTheme();
  const urgent = heroPlacesLabel(lesson.confirmedCount, lesson.capacity)?.urgent ?? false;

  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
        <AgendaCardHeader
          icon="whistle"
          accent={ACCENTS.blue}
          tag={lessonKindLabel(lesson.lessonKind as LessonKind)}
          // Pour un coach, le cours s'identifie par SON créneau — le titre porte la date.
          title={formatDateShortTimeRange(lesson.reservation.startTime, lesson.reservation.endTime, tz)}
          dateLabel={lesson.reservation.resource.name}
          extra={lesson.series?.title ?? null}
          // Compte à rebours jusqu'au début du cours (même convention que la carte Cours d'/events).
          deadline={lesson.reservation.startTime}
          now={now ?? null}
          ratio={fillRatioLesson(lesson.confirmedCount, lesson.capacity)}
          places={{ text: studentsLabel(lesson), urgent }}
          sportLabel={lesson.sport?.name ?? null}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${th.line}` }}>
        {lesson.students.length === 0 && (
          <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Aucun élève inscrit.</span>
        )}
        {lesson.students.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar firstName={s.firstName} lastName={s.lastName} avatarUrl={s.avatarUrl} size={32} color={colorForSeed(s.id)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
                  {s.firstName} {s.lastName}
                </span>
                {s.status === 'WAITLISTED' && (
                  <span style={{
                    fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                    borderRadius: 999, padding: '2px 8px',
                    background: th.mode === 'floodlit' ? `${ACCENTS.violet}26` : `${ACCENTS.violet}40`,
                    color: th.mode === 'floodlit' ? ACCENTS.violet : th.ink,
                  }}>
                    Liste d&apos;attente {s.waitlistPosition}
                  </span>
                )}
              </div>
              {s.phone && <a href={`tel:${s.phone}`} style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.accent, textDecoration: 'none' }}>{s.phone}</a>}
            </div>
            {editable && (
              <button aria-label={`Retirer ${s.firstName} ${s.lastName}`} onClick={() => onRemoveStudent(lesson.id, s.id)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 4 }}>
                <Icon name="x" size={15} color={th.textMute} />
              </button>
            )}
          </div>
        ))}

        {editable && (
          <button onClick={() => onAddStudent(lesson.id)}
            style={{
              alignSelf: 'flex-start', marginTop: 4,
              fontFamily: th.fontUI, fontWeight: 600, fontSize: 14, letterSpacing: 0.1,
              border: 'none', borderRadius: 14, padding: '0 16px', height: 42, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: th.mode === 'floodlit' ? `${th.accent}1f` : `${th.accent}40`,
              color: th.mode === 'floodlit' ? th.accent : th.ink,
              WebkitTapHighlightColor: 'transparent',
            }}>
            <Icon name="plus" size={15} color={th.mode === 'floodlit' ? th.accent : th.ink} />
            Ajouter un élève
          </button>
        )}
      </div>
    </div>
  );
}
