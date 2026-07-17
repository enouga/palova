'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import type { CoachLessonRow } from '@/lib/api';

function fmtDate(iso: string, tz: string) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso));
}
function fmtHour(iso: string, tz: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export function CoachLessonCard({ lesson, tz, editable, onAddStudent, onRemoveStudent }: {
  lesson: CoachLessonRow;
  tz: string;
  editable: boolean;
  onAddStudent: (lessonId: string) => void;
  onRemoveStudent: (lessonId: string, enrollId: string) => void;
}) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* En-tête : date/heure, terrain, sport, capacité */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 16, color: th.text }}>
          {fmtDate(lesson.reservation.startTime, tz)} · {fmtHour(lesson.reservation.startTime, tz)}–{fmtHour(lesson.reservation.endTime, tz)}
        </span>
        <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{lesson.reservation.resource.name}</span>
        {lesson.series?.title && <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>· {lesson.series.title}</span>}
        <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>
          {lesson.confirmedCount}/{lesson.capacity}{lesson.waitlistCount > 0 ? ` · ${lesson.waitlistCount} en attente` : ''}
        </span>
      </div>

      {/* Roster */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lesson.students.length === 0 && (
          <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint }}>Aucun élève inscrit.</span>
        )}
        {lesson.students.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar firstName={s.firstName} lastName={s.lastName} avatarUrl={s.avatarUrl} size={32} color={colorForSeed(s.id)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
                {s.firstName} {s.lastName}
                {s.status === 'WAITLISTED' && <span style={{ marginLeft: 6, fontSize: 11, color: th.textMute }}>· liste d&apos;attente {s.waitlistPosition}</span>}
              </div>
              {s.phone && <a href={`tel:${s.phone}`} style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.accent, textDecoration: 'none' }}>{s.phone}</a>}
            </div>
            {editable && (
              <button aria-label={`Retirer ${s.firstName} ${s.lastName}`} onClick={() => onRemoveStudent(lesson.id, s.id)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <button onClick={() => onAddStudent(lesson.id)}
          style={{ alignSelf: 'flex-start', border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '8px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
          + Ajouter un élève
        </button>
      )}
    </div>
  );
}
