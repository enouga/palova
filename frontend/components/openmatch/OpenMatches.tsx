'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, ClubDetail, OpenMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { Btn, Chip, Segmented } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { Leaderboard } from '@/components/openmatch/Leaderboard';
import { PartnerSearch } from '@/components/tournament/PartnerSearch';
import { PlayerPills } from '@/components/player/PlayerPills';
import { AddPlayerPill } from '@/components/player/AddPlayerPill';
import { MatchResultModal } from '@/components/match/MatchResultModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { inRange, rangeLabel } from '@/lib/levelMatch';

const JOIN_ERRORS: Record<string, string> = {
  MATCH_FULL:            'Cette partie est complète.',
  MATCH_IN_PAST:         'Cette partie a déjà eu lieu.',
  MATCH_NOT_JOINABLE:    "Cette partie n'est plus ouverte.",
  ALREADY_JOINED:        'Vous participez déjà à cette partie.',
  ORGANIZER_CANNOT_LEAVE: "Vous organisez cette partie : annulez la réservation pour la retirer.",
  MEMBERSHIP_REQUIRED:   'Réservé aux membres du club.',
  MEMBERSHIP_BLOCKED:    'Votre accès au club est bloqué.',
  NOT_ORGANIZER:          "Seul l'organisateur peut retirer un joueur.",
  CANNOT_REMOVE_ORGANIZER: "L'organisateur ne peut pas être retiré.",
  PARTICIPANT_NOT_FOUND:  "Ce joueur n'est plus dans la partie.",
};

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

// /parties — découverte des parties ouvertes (PUBLIC) du club : rejoindre / quitter.
export function OpenMatches({ club }: { club: ClubDetail }) {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const [matches, setMatches] = useState<OpenMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [error, setError]     = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [recordingFor, setRecordingFor] = useState<OpenMatch | null>(null);
  const [myLevel, setMyLevel] = useState<number | null>(null);
  const [filterMyLevel, setFilterMyLevel] = useState(false);
  const [joinWarning, setJoinWarning] = useState<OpenMatch | null>(null);
  const [view, setView] = useState<'parties' | 'classement'>('parties');

  const load = useCallback(async () => {
    if (!token) { setMatches([]); setLoading(false); return; }
    setLoading(true);
    try { setMatches(await api.getOpenMatches(club.slug, token)); }
    catch { setMatches([]); }
    finally { setLoading(false); }
  }, [club.slug, token]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  useEffect(() => {
    if (!token) return;
    api.getMyRating(token).then((r) => setMyLevel(r?.level ?? null)).catch(() => {});
  }, [token]);

  const act = async (m: OpenMatch, fn: () => Promise<unknown>) => {
    if (!token) return;
    setBusyId(m.id); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(JOIN_ERRORS[(e as Error).message] ?? (e as Error).message); }
    finally { setBusyId(null); }
  };

  const handleJoin = (m: OpenMatch) => {
    const min = m.targetLevelMin ?? null;
    const max = m.targetLevelMax ?? null;
    if (!inRange(myLevel, min, max)) {
      setJoinWarning(m);
    } else {
      act(m, () => api.joinOpenMatch(club.slug, m.id, token!));
    }
  };

  const visibleMatches = filterMyLevel
    ? matches.filter((m) => inRange(myLevel, m.targetLevelMin ?? null, m.targetLevelMax ?? null))
    : matches;

  return (
    <Screen>
      <div style={{ paddingBottom: 40 }}>
        <ClubNav club={club} />
        <div style={{ padding: '16px 20px 0' }}>
          <Segmented<'parties' | 'classement'>
            value={view}
            onChange={setView}
            options={[{ value: 'parties', label: 'Parties' }, { value: 'classement', label: 'Classement' }]}
          />
        </div>
        {view === 'parties' ? (
          <>
        <div style={{ padding: '18px 20px 0' }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0, letterSpacing: -0.4 }}>Parties ouvertes</h1>
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, lineHeight: 1.5, margin: '8px 0 0' }}>
            Rejoignez la partie publique d&apos;un autre membre, ou créez la vôtre en choisissant « Partie ouverte » au moment de réserver.
          </p>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, userSelect: 'none' }}>
            <input type="checkbox" checked={filterMyLevel} onChange={(e) => setFilterMyLevel(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'pointer' }} />
            À mon niveau
          </label>
        </div>

        {error && (
          <div style={{ margin: '14px 20px 0', background: th.accent, color: th.onAccent, borderRadius: 12, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>
        )}

        <div style={{ padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!ready || loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
          ) : !token ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>Connectez-vous pour voir les parties ouvertes.</div>
          ) : visibleMatches.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: th.fontUI, color: th.textMute }}>
              {filterMyLevel && matches.length > 0 ? 'Aucune partie à ton niveau pour le moment.' : 'Aucune partie ouverte pour le moment.'}
            </div>
          ) : visibleMatches.map((m) => {
            const busy = busyId === m.id;
            return (
              <div key={m.id} style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Icon name="users" size={18} color={th.accent} />
                  <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>{m.resourceName}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {(m.targetLevelMin != null || m.targetLevelMax != null) && (
                      <Chip tone="line">{rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</Chip>
                    )}
                    <Chip tone={m.full ? 'mute' : 'accent'}>{m.full ? 'Complet' : `${m.spotsLeft} place${m.spotsLeft > 1 ? 's' : ''}`}</Chip>
                  </span>
                </div>
                <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 12 }}>
                  {formatWhen(m.startTime, club.timezone)} → {formatWhen(m.endTime, club.timezone)}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PlayerPills
                      players={m.players}
                      spotsLeft={m.spotsLeft}
                      onRemove={(p) => act(m, () => api.removeOpenMatchPlayer(club.slug, m.id, p.userId, token!))}
                      canRemove={(p) => m.viewerIsOrganizer && !p.isOrganizer}
                      busy={busy}
                      firstSpotSlot={m.viewerIsOrganizer ? (
                        <AddPlayerPill disabled={busy} ariaLabel={`Ajouter un joueur à ${m.resourceName}`}
                          onClick={() => setAddingId((prev) => (prev === m.id ? null : m.id))} />
                      ) : undefined}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    {m.viewerIsOrganizer ? (
                      <Chip tone="line" icon="check">Vous organisez</Chip>
                    ) : m.viewerIsParticipant ? (
                      <Btn variant="surface" disabled={busy} onClick={() => act(m, () => api.leaveOpenMatch(club.slug, m.id, token!))}>Quitter</Btn>
                    ) : (
                      <Btn icon="plus" disabled={busy || m.full} onClick={() => handleJoin(m)}>Rejoindre</Btn>
                    )}
                    {new Date(m.endTime).getTime() <= Date.now() && m.players.length === 4 && (
                      <Btn variant="surface" disabled={busy} onClick={() => setRecordingFor(m)}>Saisir le résultat</Btn>
                    )}
                  </div>
                </div>
                {m.viewerIsOrganizer && addingId === m.id && (
                  <div style={{ marginTop: 12 }}>
                    <PartnerSearch
                      slug={club.slug} token={token!} selected={null}
                      excludeIds={m.players.map((p) => p.userId)}
                      onSelect={(member) => { setAddingId(null); act(m, () => api.addOpenMatchPlayer(club.slug, m.id, member.id, token!)); }}
                      onClear={() => {}}
                      disabled={busy}
                    />
                    <button type="button" onClick={() => setAddingId(null)} style={{ marginTop: 8, border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13 }}>Annuler</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
          </>
        ) : (
          <Leaderboard club={club} viewerUserId={null} />
        )}
      </div>
      {recordingFor && token && (
        <MatchResultModal
          reservationId={recordingFor.id}
          players={recordingFor.players.map(({ userId, firstName, lastName, avatarUrl }) => ({ userId, firstName, lastName, avatarUrl }))}
          token={token}
          onClose={() => setRecordingFor(null)}
          onSaved={() => { setRecordingFor(null); load(); }}
        />
      )}
      {joinWarning && (
        <ConfirmDialog
          title="Niveau hors fourchette"
          message="Cette partie est hors de ta fourchette de niveau. Rejoindre quand même ?"
          confirmLabel="Rejoindre quand même"
          cancelLabel="Annuler"
          busy={busyId === joinWarning.id}
          onConfirm={() => { const m = joinWarning; setJoinWarning(null); act(m, () => api.joinOpenMatch(club.slug, m.id, token!)); }}
          onCancel={() => setJoinWarning(null)}
        />
      )}
    </Screen>
  );
}
