'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, MarkTableView, MarkTableSide } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { nextPresence, benchSelectionNext, markTableErrorLabel } from '@/lib/markTable';
import { MarkTableTile } from './MarkTableTile';
import { BenchBar } from './BenchBar';
import { MemberPicker } from './MemberPicker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { HERO_GRADIENT, HERO_INK } from '@/components/agenda/AgendaHero';

type Mode = 'referee' | 'staff';

/** Sélectionne le bon jeu de méthodes api.* selon le mode (deux portes, un seul composant). */
function bindApi(mode: Mode, idOrSlug: string, token: string) {
  return mode === 'referee' ? {
    get: (tid: string) => api.getRefereeMarkTable(idOrSlug, tid, token),
    setPresence: (tid: string, r: string, s: MarkTableSide, p: 'UNSEEN' | 'PRESENT' | 'ABSENT') => api.refereeSetPresence(idOrSlug, tid, r, s, p, token),
    forfeit: (tid: string, r: string, s: MarkTableSide) => api.refereeForfeit(idOrSlug, tid, r, s, token),
    replace: (tid: string, r: string, s: MarkTableSide, u: string) => api.refereeReplacePlayer(idOrSlug, tid, r, s, u, token),
    addWalkIn: (tid: string, u: string) => api.refereeAddToBench(idOrSlug, tid, u, token),
    removeBench: (tid: string, u: string) => api.refereeRemoveFromBench(idOrSlug, tid, u, token),
    pair: (tid: string, a: string, b: string) => api.refereePairFromBench(idOrSlug, tid, a, b, token),
    addLate: (tid: string, a: string, b: string) => api.refereeAddLateRegistration(idOrSlug, tid, a, b, token),
    promote: (tid: string, r: string) => api.refereeMarkTablePromote(idOrSlug, tid, r, token),
  } : {
    get: (tid: string) => api.adminGetMarkTable(idOrSlug, tid, token),
    setPresence: (tid: string, r: string, s: MarkTableSide, p: 'UNSEEN' | 'PRESENT' | 'ABSENT') => api.adminSetPresence(idOrSlug, tid, r, s, p, token),
    forfeit: (tid: string, r: string, s: MarkTableSide) => api.adminForfeit(idOrSlug, tid, r, s, token),
    replace: (tid: string, r: string, s: MarkTableSide, u: string) => api.adminReplacePlayer(idOrSlug, tid, r, s, u, token),
    addWalkIn: (tid: string, u: string) => api.adminAddToBench(idOrSlug, tid, u, token),
    removeBench: (tid: string, u: string) => api.adminRemoveFromBench(idOrSlug, tid, u, token),
    pair: (tid: string, a: string, b: string) => api.adminPairFromBench(idOrSlug, tid, a, b, token),
    addLate: (tid: string, a: string, b: string) => api.adminAddLateRegistration(idOrSlug, tid, a, b, token),
    promote: (tid: string, r: string) => api.adminMarkTablePromote(idOrSlug, tid, r, token),
  };
}

/**
 * Orchestrateur de la table de marque — pointage, geste banc→place (remplacement/appariement),
 * retardataire, et menu contextuel ⋮ (forfait/appeler/promouvoir). Un seul composant partagé
 * entre l'espace J/A (`mode="referee"`, scopé par `slug`) et le back-office staff
 * (`mode="staff"`, scopé par `clubId`) — cf. `bindApi`.
 *
 * Le forfait est une action lourde (annule toute l'inscription) : il ne se déclenche JAMAIS
 * directement depuis le menu, toujours via `ConfirmDialog` (cf. plan, Task 14, note
 * d'implémenteur).
 */
export function MarkTable({ mode, slug, clubId, tournamentId, token, memberSearchSlug }: {
  mode: Mode;
  slug?: string;      // requis en mode 'referee'
  clubId?: string;    // requis en mode 'staff'
  tournamentId: string;
  token: string;
  memberSearchSlug: string; // GET /members/search est scopé par slug dans les deux cas
}) {
  const { th } = useTheme();
  const idOrSlug = (mode === 'referee' ? slug : clubId)!;
  const bound = useMemo(() => bindApi(mode, idOrSlug, token), [mode, idOrSlug, token]);

  const [view, setView] = useState<MarkTableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [benchSelection, setBenchSelection] = useState<string[]>([]);
  const [showWalkIn, setShowWalkIn] = useState(false);
  // Menu contextuel ⋮ (forfait / appeler / promouvoir) + confirmation avant l'acte lourd.
  const [menuFor, setMenuFor] = useState<{ regId: string; side: MarkTableSide } | null>(null);
  const [confirmForfeit, setConfirmForfeit] = useState<{ regId: string; side: MarkTableSide } | null>(null);

  const load = useCallback(async () => {
    try { setError(null); setView(await bound.get(tournamentId)); }
    catch (e) { setError(markTableErrorLabel(e)); }
  }, [bound, tournamentId]);

  useEffect(() => { void load(); }, [load]);

  // Si la vue se recharge et que la registration ciblée par le menu/la confirmation a
  // disparu (ex. promotion qui fait bouger les ids), on ferme proprement plutôt que de
  // laisser un état pointant sur du vide (le rendu est déjà gardé, mais autant nettoyer).
  useEffect(() => {
    if (!view) return;
    if (menuFor && !view.registrations.some((r) => r.id === menuFor.regId)) setMenuFor(null);
  }, [view, menuFor]);
  useEffect(() => {
    if (!view) return;
    if (confirmForfeit && !view.registrations.some((r) => r.id === confirmForfeit.regId)) setConfirmForfeit(null);
  }, [view, confirmForfeit]);

  const withReload = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); }
    catch (e) { setError(markTableErrorLabel(e)); }
  };

  const tapPlayer = (regId: string, side: MarkTableSide) => {
    if (benchSelection.length > 0 || !view) return; // en mode remplacement, la grille ne pointe plus
    const reg = view.registrations.find((r) => r.id === regId);
    if (!reg) return;
    const current = side === 'CAPTAIN' ? reg.captain.presence : reg.partner.presence;
    void withReload(() => bound.setPresence(tournamentId, regId, side, nextPresence(current)));
  };

  const tapBench = (userId: string) => setBenchSelection((sel) => benchSelectionNext(sel, userId));

  const tapReplaceTarget = (regId: string, side: MarkTableSide) => {
    if (benchSelection.length !== 1) return;
    const userId = benchSelection[0];
    setBenchSelection([]);
    void withReload(() => bound.replace(tournamentId, regId, side, userId));
  };

  const doPair = () => {
    if (benchSelection.length !== 2) return;
    const [a, b] = benchSelection;
    setBenchSelection([]);
    void withReload(() => bound.pair(tournamentId, a, b));
  };

  const doForfeitConfirmed = () => {
    if (!confirmForfeit) return;
    const { regId, side } = confirmForfeit;
    setConfirmForfeit(null);
    void withReload(() => bound.forfeit(tournamentId, regId, side));
  };

  const replaceTargetName = benchSelection.length === 1
    ? view?.bench.find((b) => b.userId === benchSelection[0])?.firstName
    : undefined;

  if (!view) return <div style={{ padding: 20, fontFamily: th.fontUI, color: th.textFaint }}>{error ?? 'Chargement…'}</div>;

  // Calculés seulement une fois `view` garanti non-null (TS narrowing du early-return ci-dessus).
  const menuReg = menuFor ? view.registrations.find((r) => r.id === menuFor.regId) : undefined;
  const menuPlayer = menuReg && menuFor ? (menuFor.side === 'CAPTAIN' ? menuReg.captain : menuReg.partner) : undefined;
  const confirmReg = confirmForfeit ? view.registrations.find((r) => r.id === confirmForfeit.regId) : undefined;
  const confirmPlayer = confirmReg && confirmForfeit ? (confirmForfeit.side === 'CAPTAIN' ? confirmReg.captain : confirmReg.partner) : undefined;

  return (
    <div style={{ minHeight: '100vh', background: th.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: HERO_GRADIENT, padding: '16px 16px 14px', color: HERO_INK }}>
        <div style={{ fontFamily: th.fontUI, fontSize: 10, letterSpacing: 1.2, fontWeight: 800, opacity: 0.7 }}>TABLE DE MARQUE</div>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 800 }}>{view.tournament.name}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ background: 'rgba(255,255,255,.78)', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 800 }}>{view.pointedCount} / {view.totalSlots} pointés</span>
          {view.waitlistCount > 0 && <span style={{ background: 'rgba(255,255,255,.78)', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 800, color: ACCENTS.violet }}>{view.waitlistCount} attente</span>}
          {view.bench.length > 0 && <span style={{ background: ACCENTS.coral, color: '#fff', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 800 }}>banc {view.bench.length}</span>}
        </div>
      </div>

      {error && <div style={{ margin: 12, background: `${ACCENTS.coral}33`, color: ACCENTS.coral, borderRadius: 10, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <div style={{ flex: 1, padding: '10px 11px 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, alignContent: 'start' }}>
        {view.registrations.map((reg) => (
          <MarkTableTile key={reg.id} reg={reg}
            replaceHighlight={benchSelection.length === 1 ? benchSelection[0] : null}
            replaceTargetName={replaceTargetName}
            onTapPlayer={tapPlayer}
            onTapReplaceTarget={tapReplaceTarget}
            onOpenMenu={(regId, side) => setMenuFor({ regId, side })} />
        ))}
      </div>

      <div style={{ height: 90 }} />{/* respire au-dessus du banc sticky */}
      <BenchBar bench={view.bench} selection={benchSelection} onTapPlayer={tapBench} onAddWalkIn={() => setShowWalkIn(true)} onPair={doPair} />

      {showWalkIn && (
        <MemberPicker slug={memberSearchSlug} token={token} onClose={() => setShowWalkIn(false)}
          onPick={(userId) => { setShowWalkIn(false); void withReload(() => bound.addWalkIn(tournamentId, userId)); }} />
      )}

      {/* Menu contextuel ⋮ — de vraies options (forfait/appeler/promouvoir), jamais une action
          directe. Ferme au clic sur le backdrop. */}
      {menuFor && menuPlayer && (
        <div role="dialog" aria-modal="true" aria-label={`Options pour ${menuPlayer.firstName} ${menuPlayer.lastName}`}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 65, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setMenuFor(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: th.bg, borderRadius: '18px 18px 0 0', padding: 14, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.textMute, padding: '0 4px' }}>{menuPlayer.firstName} {menuPlayer.lastName}</span>
            <button onClick={() => { setMenuFor(null); setConfirmForfeit({ regId: menuFor.regId, side: menuFor.side }); }}
              style={{ textAlign: 'left', border: 'none', background: th.surface, borderRadius: 10, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 700, color: ACCENTS.coral, cursor: 'pointer' }}>
              Déclarer forfait
            </button>
            {menuPlayer.phone && (
              <a href={`tel:${menuPlayer.phone}`} onClick={() => setMenuFor(null)}
                style={{ textAlign: 'left', textDecoration: 'none', border: 'none', background: th.surface, borderRadius: 10, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>
                Appeler {menuPlayer.phone}
              </a>
            )}
            {menuReg?.status === 'WAITLISTED' && (
              <button onClick={() => { const regId = menuFor.regId; setMenuFor(null); void withReload(() => bound.promote(tournamentId, regId)); }}
                style={{ textAlign: 'left', border: 'none', background: th.surface, borderRadius: 10, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' }}>
                Promouvoir
              </button>
            )}
          </div>
        </div>
      )}

      {confirmForfeit && confirmPlayer && (
        <ConfirmDialog title="Déclarer forfait ?"
          message={`${confirmPlayer.firstName} ${confirmPlayer.lastName} et son binôme quittent le tournoi. Le premier en attente sera promu.`}
          confirmLabel="Confirmer" onConfirm={doForfeitConfirmed} onCancel={() => setConfirmForfeit(null)} />
      )}
    </div>
  );
}
