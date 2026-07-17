'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, RefereeTournamentRow, RefereeRegistrationRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/atoms';
import { ClubNav } from '@/components/ClubNav';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RefereeTournamentCard } from '@/components/referee/RefereeTournamentCard';

const ERRORS: Record<string, string> = {
  TOURNAMENT_NOT_YOURS: "Vous n'êtes plus juge-arbitre de ce tournoi.",
  TOURNAMENT_NOT_FOUND: 'Ce tournoi est introuvable.',
};
const errorLabel = (e: unknown) => ERRORS[(e as Error).message] ?? (e as Error).message;

/**
 * Espace juge-arbitre « Arbitrage » : le J/A connecté gère les inscrits de SES tournois
 * (à venir + passés), sans être STAFF du club. Gate côté serveur = facette isReferee +
 * propriété du tournoi (NOT_A_REFEREE mappé sur un message dédié, jamais un écran d'erreur).
 *
 * « À venir » = pas encore fini : un tournoi EN COURS y figure, c'est là que le J/A le cherche.
 * Le roster est chargé au dépli, pas au chargement de la page (un J/A peut avoir plusieurs tournois).
 */
export default function MeRefereeingPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { slug, club } = useClub();
  const tz = club?.timezone ?? 'Europe/Paris';
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [tournaments, setTournaments] = useState<RefereeTournamentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notReferee, setNotReferee] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rosters, setRosters] = useState<Record<string, RefereeRegistrationRow[]>>({});
  const [rosterLoading, setRosterLoading] = useState<Set<string>>(new Set());
  const [removeFor, setRemoveFor] = useState<{ tournamentId: string; regId: string } | null>(null);
  // Horloge unique posée au mount : jamais de `new Date()` au rendu (hydration).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  const load = useCallback(async () => {
    if (!token || !slug) return;
    setLoading(true);
    try {
      setError(null); setNotReferee(false);
      setTournaments(await api.getRefereeTournaments(slug, scope, token));
    } catch (e) {
      if ((e as Error).message === 'NOT_A_REFEREE') setNotReferee(true);
      else setError(errorLabel(e));
    } finally { setLoading(false); }
  }, [token, slug, scope]);

  useEffect(() => { if (ready && token && slug) load(); }, [ready, token, slug, load]);

  const loadRoster = useCallback(async (tournamentId: string) => {
    if (!token || !slug) return;
    setRosterLoading((prev) => new Set(prev).add(tournamentId));
    try {
      const rows = await api.getRefereeRegistrations(slug, tournamentId, token);
      setRosters((prev) => ({ ...prev, [tournamentId]: rows }));
    } catch (e) {
      setError(errorLabel(e));
    } finally {
      setRosterLoading((prev) => { const n = new Set(prev); n.delete(tournamentId); return n; });
    }
  }, [token, slug]);

  const toggleRoster = (tournamentId: string) => {
    const open = expanded.has(tournamentId);
    setExpanded((prev) => { const n = new Set(prev); if (open) n.delete(tournamentId); else n.add(tournamentId); return n; });
    // (Re)chargé à chaque dépli, jamais au chargement de la page : le J/A déplie PENDANT son
    // tournoi, où les inscriptions bougent. Les lignes en cache restent affichées → pas de flash.
    if (!open) loadRoster(tournamentId);
  };

  // Après écriture : roster ET liste (les compteurs de la carte bougent).
  const refresh = async (tournamentId: string) => { await Promise.all([loadRoster(tournamentId), load()]); };

  const doPromote = async (tournamentId: string, regId: string) => {
    if (!token || !slug) return;
    try { await api.refereePromoteRegistration(slug, tournamentId, regId, token); await refresh(tournamentId); }
    catch (e) { setError(errorLabel(e)); }
  };

  const doRemove = async () => {
    if (!token || !slug || !removeFor) return;
    const { tournamentId, regId } = removeFor;
    try { await api.refereeRemoveRegistration(slug, tournamentId, regId, token); setRemoveFor(null); await refresh(tournamentId); }
    catch (e) { setError(errorLabel(e)); setRemoveFor(null); }
  };

  return (
    <Screen>
      {slug && club && <ClubNav club={club} />}
      {/* Pas de largeur par page : le ClubNav collant vit dans la colonne 1080 de Screen,
          une largeur locale ferait sauter la barre en naviguant (cf. Screen.tsx). */}
      <div style={{ padding: '16px 20px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, margin: 0, color: th.text }}>Arbitrage</h1>
          <span style={{ marginLeft: 'auto' }}><ProfileMenu /></span>
        </div>

        {notReferee ? (
          <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Cet espace est réservé aux juges-arbitres du club.</p>
        ) : (
          <>
            <Segmented<'upcoming' | 'past'> value={scope} onChange={setScope}
              options={[{ value: 'upcoming', label: 'À venir' }, { value: 'past', label: 'Passés' }]} />
            {/* Coral : une erreur ne se peint pas avec l'accent du club (bleu = état normal). */}
            {error && (
              <div style={{
                background: th.mode === 'floodlit' ? `${ACCENTS.coral}26` : `${ACCENTS.coral}40`,
                color: th.mode === 'floodlit' ? ACCENTS.coral : th.ink,
                borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600,
              }}>{error}</div>
            )}
            {loading ? (
              <span style={{ fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</span>
            ) : tournaments.length === 0 ? (
              <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textFaint }}>{scope === 'upcoming' ? 'Aucun tournoi à venir.' : 'Aucun tournoi passé.'}</p>
            ) : (
              tournaments.map((t) => (
                <RefereeTournamentCard key={t.id} tournament={t} tz={tz} now={now} editable={scope === 'upcoming'}
                  expanded={expanded.has(t.id)}
                  registrations={rosters[t.id] ?? null}
                  loadingRoster={rosterLoading.has(t.id)}
                  onToggleRoster={() => toggleRoster(t.id)}
                  onPromote={(regId) => doPromote(t.id, regId)}
                  onRemove={(regId) => setRemoveFor({ tournamentId: t.id, regId })} />
              ))
            )}
          </>
        )}
      </div>

      {removeFor && (
        <ConfirmDialog title="Retirer le binôme ?" message="Il sera désinscrit du tournoi. Le premier en attente sera promu." confirmLabel="Retirer"
          onConfirm={doRemove} onCancel={() => setRemoveFor(null)} />
      )}
    </Screen>
  );
}
