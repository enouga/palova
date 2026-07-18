'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, CoachLessonRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/atoms';
import { ClubNav } from '@/components/ClubNav';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CoachLessonCard } from '@/components/coach/CoachLessonCard';
import { AddStudentPicker } from '@/components/coach/AddStudentPicker';

/**
 * Espace coach « Mes cours » : le coach connecté voit et gère les élèves de SES cours
 * (à venir + passés), sans être STAFF. Gate côté serveur = ligne Coach active (NOT_A_COACH
 * mappé sur un message dédié, jamais un écran d'erreur générique).
 */
export default function MeCoachingPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();
  const tz = club?.timezone ?? 'Europe/Paris';
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [lessons, setLessons] = useState<CoachLessonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notCoach, setNotCoach] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [removeFor, setRemoveFor] = useState<{ lessonId: string; enrollId: string } | null>(null);
  // Horloge unique posée au mount : jamais de `new Date()` au rendu (hydration).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  const load = useCallback(async () => {
    if (!token || !slug) return;
    setLoading(true);
    try {
      setError(null); setNotCoach(false);
      setLessons(await api.getCoachLessons(slug, scope, token));
    } catch (e) {
      if ((e as Error).message === 'NOT_A_COACH') setNotCoach(true);
      else setError((e as Error).message);
    } finally { setLoading(false); }
  }, [token, slug, scope]);

  useEffect(() => { if (ready && token && slug) load(); }, [ready, token, slug, load]);

  const doRemove = async () => {
    if (!token || !slug || !removeFor) return;
    try { await api.coachRemoveStudent(slug, removeFor.lessonId, removeFor.enrollId, token); setRemoveFor(null); await load(); }
    catch (e) { setError((e as Error).message); setRemoveFor(null); }
  };

  return (
    <Screen>
      {slug && club && <ClubNav club={club} />}
      {/* Pas de largeur par page : le ClubNav collant vit dans la colonne 1080 de Screen,
          une largeur locale ferait sauter la barre en naviguant (cf. Screen.tsx). */}
      <div style={{ padding: '16px 20px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, margin: 0, color: th.text }}>Mes cours</h1>
          <span style={{ marginLeft: 'auto' }}><ProfileMenu /></span>
        </div>

        {notCoach ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Cet espace est réservé aux coachs du club.</p>
        ) : (
          <>
            <Segmented<'upcoming' | 'past'> value={scope} onChange={setScope}
              options={[{ value: 'upcoming', label: 'À venir' }, { value: 'past', label: 'Passés' }]} />
            {error && <div style={dangerBanner(th)}>{error}</div>}
            {loading ? (
              <span style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</span>
            ) : lessons.length === 0 ? (
              <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>{scope === 'upcoming' ? 'Aucun cours à venir.' : 'Aucun cours passé.'}</p>
            ) : (
              lessons.map((l) => (
                <CoachLessonCard key={l.id} lesson={l} tz={tz} now={now} editable={scope === 'upcoming'}
                  onAddStudent={(lessonId) => setAddFor(lessonId)}
                  onRemoveStudent={(lessonId, enrollId) => setRemoveFor({ lessonId, enrollId })} />
              ))
            )}
          </>
        )}
      </div>

      {addFor && slug && token && (
        <AddStudentPicker slug={slug} token={token}
          onClose={() => setAddFor(null)}
          onPick={async (userId) => { try { await api.coachEnrollStudent(slug, addFor, userId, token); setAddFor(null); await load(); } catch (e) { setError((e as Error).message); setAddFor(null); } }} />
      )}

      {removeFor && (
        <ConfirmDialog title="Retirer l'élève ?" message="Il sera désinscrit de ce cours." confirmLabel="Retirer"
          onConfirm={doRemove} onCancel={() => setRemoveFor(null)} />
      )}
    </Screen>
  );
}
