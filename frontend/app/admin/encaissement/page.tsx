'use client';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { api, ClubReservation, ClubReservationsResponse, PaymentMethod, AdminResource, OffPeakHours, Member, ClubAdminDetail, Payment, CaissePayment, MemberPackage } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CollectPanel } from '@/components/admin/CollectPanel';
import { Receipt } from '@/components/admin/Receipt';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';
import { Icon, IconName } from '@/components/ui/Icon';
import { dueCents, toCents, fmtEuros, applyOptimisticPayment, applyOptimisticRefund, PaymentIntent, DEFAULT_QUICK_METHODS, QUICK_METHODS } from '@/lib/caisse';
import { playerCount } from '@/lib/courtType';
import { matchesQuery, isUpcoming, nextSlotWindow, isNextSlot, PeriodMode } from '@/lib/collect';
import { indexPackagesByUser } from '@/lib/packages';
import { ReservationFilters, SportFacet } from '@/components/admin/ReservationFilters';
import { QueueList } from '@/components/admin/caisse/QueueList';
import { CashRegister } from '@/components/admin/caisse/CashRegister';
import { queueGroups } from '@/lib/caisseRegister';
import { useIsDesktop } from '@/lib/useIsDesktop';

const CORAL = '#ff7a4d';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function fmtTime(iso: string): string { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

// Adapte un paiement de réservation au format attendu par le reçu (Receipt).
function toCaissePayment(p: Payment, rv: ClubReservation): CaissePayment {
  return {
    ...p,
    reservation: { id: rv.id, startTime: rv.startTime, resource: { name: rv.resource.name }, user: rv.user ? { firstName: rv.user.firstName, lastName: rv.user.lastName } : null },
    memberPackage: null,
  };
}

const STATUS_LABEL: Record<string, string> = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', CHEQUE: 'Chèque', CLUB: 'Au club', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre',
  SUBSCRIPTION: 'Abonnement',
};
const METHOD_ICON: Record<PaymentMethod, IconName> = {
  CASH: 'euro', CARD: 'card', TRANSFER: 'arrowR', ONLINE: 'card', OTHER: 'euro',
  VOUCHER: 'ticket', CHEQUE: 'ticket', CLUB: 'home', PACK_CREDIT: 'ticket', WALLET: 'euro', MEMBER: 'user',
  SUBSCRIPTION: 'user',
};

export default function AdminEncaissementPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club, slug } = useClub();
  const clubId = club?.id;
  const isDesktop = useIsDesktop(900);
  const [data, setData]   = useState<ClubReservationsResponse | null>(null);
  const [date, setDate]   = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);   // le loader plein écran ne s'affiche qu'au 1er chargement
  const loadSeq = useRef(0);          // « la dernière réponse gagne » : ignore les rechargements périmés
  const optSeq  = useRef(0);          // ids uniques des paiements optimistes (avant persistance)
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<ClubReservation | null>(null);
  const [cancelling, setCancelling]       = useState(false);
  const cancellingRef = useRef(false);    // garde synchrone anti double-annulation

  const [resources, setResources]     = useState<AdminResource[]>([]);
  const [peak, setPeak]               = useState<OffPeakHours | null>(null);
  const [tz, setTz]                   = useState('Europe/Paris');
  const [members, setMembers]         = useState<Member[]>([]);
  const [packagesByUser, setPackagesByUser] = useState<Record<string, MemberPackage[]>>({});
  const [clubDetail, setClubDetail]   = useState<ClubAdminDetail | null>(null);
  const [selected, setSelected]       = useState<ClubReservation | null>(null);   // modale « Détails »
  const [receiptTarget, setReceiptTarget] = useState<{ payment: Payment; rv: ClubReservation } | null>(null);
  const [selectedRvId, setSelectedRvId] = useState<string | null>(null);          // résa affichée dans la caisse

  const [query, setQuery]   = useState('');
  const [sportSel, setSportSel] = useState<Set<string> | null>(null);   // sports cochés (null = pas encore résolu)
  const [period, setPeriod]     = useState<PeriodMode>('upcoming');     // « À venir » par défaut
  const [dueOnly, setDueOnly]   = useState(false);                      // « À encaisser » par défaut off
  const [nowMs, setNowMs]       = useState<number | null>(null);        // heure courante (posée côté client)

  const statusStyle = (s: string): CSSProperties => ({
    borderRadius: 999, padding: '4px 11px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600,
    background: s === 'CONFIRMED' ? `${th.accent}22` : s === 'PENDING' ? th.surfaceHi : th.surface2,
    color: s === 'CONFIRMED' ? (th.mode === 'floodlit' ? th.accent : th.ink) : s === 'CANCELLED' ? th.textFaint : th.textMute,
  });

  // Chargement COMPLET (1er affichage + changement de jour). Protégé par `loadSeq`.
  const load = useCallback(async (): Promise<ClubReservation[]> => {
    if (!token || !clubId) return [];
    if (!loadedOnce.current) setLoading(true);
    const seq = ++loadSeq.current;
    try {
      setError(null);
      const [detail, res, resv, mem, pkgs] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetResources(clubId, token),
        api.adminGetReservations(clubId, date ? { date } : {}, token),
        api.adminGetMembers(clubId, token),
        api.adminGetActivePackages(clubId, token),
      ]);
      if (seq !== loadSeq.current) return resv.reservations;   // supplanté → ne pas écraser
      setClubDetail(detail);
      setTz(detail.timezone);
      setPeak(detail.offPeakHours ?? null);
      setResources(res.filter((r) => r.isActive));
      setMembers(mem);
      setPackagesByUser(indexPackagesByUser(pkgs));
      setData(resv);
      loadedOnce.current = true;
      return resv.reservations;
    } catch (e) { if (seq === loadSeq.current) setError((e as Error).message); return []; }
    finally { if (seq === loadSeq.current) setLoading(false); }
  }, [token, clubId, date]);

  // Rechargement LÉGER après une mutation : une seule requête (les réservations).
  const reloadReservations = useCallback(async (): Promise<ClubReservation[]> => {
    if (!token || !clubId) return [];
    const seq = ++loadSeq.current;
    try {
      const resv = await api.adminGetReservations(clubId, date ? { date } : {}, token);
      if (seq !== loadSeq.current) return resv.reservations;   // supplanté → ne pas écraser
      setData(resv);
      return resv.reservations;
    } catch (e) { if (seq === loadSeq.current) setError((e as Error).message); return []; }
  }, [token, clubId, date]);

  // Remplace UNE réservation dans la liste sans aucune requête.
  const patchReservation = useCallback((updated: ClubReservation) => {
    setData((cur) => (cur ? { ...cur, reservations: cur.reservations.map((r) => (r.id === updated.id ? updated : r)) } : cur));
  }, []);

  // Recharge les soldes prépayés (best-effort).
  const reloadPackages = useCallback(async () => {
    if (!token || !clubId) return;
    try { setPackagesByUser(indexPackagesByUser(await api.adminGetActivePackages(clubId, token))); }
    catch { /* ignore */ }
  }, [token, clubId]);

  // Mutation réussie : patch local si la résa à jour est fournie, sinon rechargement léger.
  const onMutated = useCallback(async (updated?: ClubReservation) => {
    if (updated) patchReservation(updated);
    else await Promise.all([reloadReservations(), reloadPackages()]);
  }, [patchReservation, reloadReservations, reloadPackages]);

  // Encaissement OPTIMISTE : reflète le paiement dans la liste DÈS le clic et renvoie
  // l'id synthétique (le CashRegister s'en sert pour annuler avant réconciliation).
  const applyPaymentLocally = useCallback((reservationId: string, intent: PaymentIntent): string => {
    const id = `opt:${(optSeq.current += 1)}`;
    const iso = new Date().toISOString();
    setData((cur) => (cur ? { ...cur, reservations: cur.reservations.map((r) => (r.id === reservationId ? applyOptimisticPayment(r, intent, id, iso) : r)) } : cur));
    return id;
  }, []);
  const applyRefundLocally = useCallback((reservationId: string, paymentIds: string[]) => {
    setData((cur) => (cur ? { ...cur, reservations: cur.reservations.map((r) => (r.id === reservationId ? applyOptimisticRefund(r, paymentIds) : r)) } : cur));
  }, []);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);
  // Heure courante (timestamp absolu) — posée côté client uniquement (hydratation).
  useEffect(() => { setNowMs(Date.now()); }, []);

  const cancel = async (r: ClubReservation) => {
    if (!token || !clubId || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    try { setError(null); await api.adminCancelReservation(clubId, r.id, token); setConfirmCancel(null); await reloadReservations(); }
    catch (e) { setError((e as Error).message); }
    finally { setCancelling(false); cancellingRef.current = false; }
  };

  // Derived helpers
  const resById = new Map(resources.map((r) => [r.id, r]));
  // Rang d'une ressource = sa position dans la liste des terrains (ordre de la page Terrains),
  // pour classer la file « à encaisser d'abord » par terrain (puis par heure).
  const resourceOrder = new Map(resources.map((r, i) => [r.id, i]));
  const rankOf = (id: string) => resourceOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  const dueOf = (r: ClubReservation) => dueCents(r, resById.get(r.resourceId), peak, tz);
  const playersOf = (r: ClubReservation) => playerCount(typeof resById.get(r.resourceId)?.attributes?.format === 'string' ? (resById.get(r.resourceId)!.attributes.format as string) : undefined);
  const remainingOf = (r: ClubReservation) => Math.max(0, dueOf(r) - toCents(r.paidAmount));
  const isCollectable = (r: ClubReservation) => r.status !== 'CANCELLED' && remainingOf(r) > 0;

  const refreshSelected = useCallback(async (updated?: ClubReservation) => {
    if (updated) { patchReservation(updated); setSelected(updated); return; }
    const [list] = await Promise.all([reloadReservations(), reloadPackages()]);
    setSelected((cur) => (cur ? list.find((r) => r.id === cur.id) ?? cur : cur));
  }, [reloadReservations, patchReservation, reloadPackages]);

  // Sports distincts présents parmi les terrains (ordre des terrains), pour le sélecteur.
  const sportsPresent: SportFacet[] = (() => {
    const seen = new Map<string, string>();
    for (const r of resources) if (!seen.has(r.clubSport.sport.key)) seen.set(r.clubSport.sport.key, r.clubSport.sport.name);
    return [...seen].map(([key, name]) => ({ key, name }));
  })();
  const sportByResource = new Map(resources.map((r) => [r.id, r.clubSport.sport.key]));
  // Préférence de sports partagée avec la page Encaissement (voulu).
  const sportStorageKey = clubId ? `palova:encaissement-sports:${clubId}` : null;

  useEffect(() => {
    if (sportSel !== null || sportsPresent.length === 0) return;
    const present = new Set(sportsPresent.map((s) => s.key));
    let initial: string[] = sportsPresent.map((s) => s.key);
    if (sportStorageKey) {
      try {
        const saved = JSON.parse(localStorage.getItem(sportStorageKey) ?? 'null');
        if (Array.isArray(saved)) {
          const kept = saved.filter((k: unknown): k is string => typeof k === 'string' && present.has(k));
          if (kept.length > 0) initial = kept;
        }
      } catch { /* ignore */ }
    }
    setSportSel(new Set(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportsPresent.length, sportStorageKey]);

  const changeSports = (keys: string[]) => {
    setSportSel(new Set(keys));
    if (sportStorageKey) { try { localStorage.setItem(sportStorageKey, JSON.stringify(keys)); } catch { /* ignore */ } }
  };

  // ── Prédicats de filtrage ───────────────────────────────────────────────
  const dayResas = data?.reservations ?? [];
  const multiSport = sportsPresent.length > 1;
  const sel = sportSel ?? new Set(sportsPresent.map((s) => s.key));

  const passSearch = (r: ClubReservation) => matchesQuery(r, query);
  const passSport  = (r: ClubReservation) => !multiSport || sel.has(sportByResource.get(r.resourceId) ?? '');
  const nextWindow = nowMs === null
    ? null
    : nextSlotWindow(dayResas.filter((r) => r.status !== 'CANCELLED').map((r) => new Date(r.startTime).getTime()), nowMs);
  const passWindow = (r: ClubReservation) =>
    period === 'all'  ? true
    : period === 'next' ? isNextSlot(r, nextWindow)
    : isUpcoming(r, nowMs);   // 'upcoming'
  const passDue    = (r: ClubReservation) => !dueOnly || isCollectable(r);
  const passActive = (r: ClubReservation) => r.status !== 'CANCELLED';   // annulées masquées

  const visible = dayResas.filter((r) => passActive(r) && passSearch(r) && passSport(r) && passWindow(r) && passDue(r));

  const activeCount =
    (dueOnly ? 1 : 0) +
    (period !== 'upcoming' ? 1 : 0) +
    (query.trim() ? 1 : 0) +
    (multiSport && sel.size !== sportsPresent.length ? 1 : 0);

  const resetFilters = () => {
    setDueOnly(false);
    setPeriod('upcoming');
    setQuery('');
    changeSports(sportsPresent.map((s) => s.key));
  };

  // ── File (deux zones) ─────────────────────────────────────────────────────
  // File sur les résas VISIBLES après filtres — recalculée à chaque rendu.
  const groups = queueGroups(visible, dueOf, rankOf);
  // La résa affichée dans la caisse : cherchée dans TOUTES les résas du jour (elle peut
  // sortir de `visible` après un filtre/encaissement sans casser la caisse).
  const currentRv = selectedRvId ? dayResas.find((r) => r.id === selectedRvId) ?? null : null;

  // Desktop : auto-sélection de la première résa à encaisser (jamais sur mobile).
  useEffect(() => {
    if (!isDesktop || loading || selectedRvId) return;
    const first = queueGroups(dayResas.filter((r) => r.status !== 'CANCELLED'), dueOf, rankOf).toCollect[0];
    if (first) setSelectedRvId(first.r.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, loading, selectedRvId, data]);

  // Résa soldée (toast expiré) → prochaine à encaisser.
  const selectNextDue = useCallback(() => {
    setSelectedRvId((cur) => {
      const g = queueGroups((data?.reservations ?? []).filter((r) => r.status !== 'CANCELLED'), dueOf, rankOf);
      const next = g.toCollect.find((e) => e.r.id !== cur);
      return next ? next.r.id : cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // KPI du jour (hors annulées).
  const kpiRows = visible.filter((r) => r.status !== 'CANCELLED');
  const totalDay = kpiRows.reduce((s, r) => s + dueOf(r), 0);
  const paidDay  = kpiRows.reduce((s, r) => s + toCents(r.paidAmount), 0);
  const restDay  = Math.max(0, totalDay - paidDay);
  const pctDay   = totalDay > 0 ? Math.max(0, Math.min(100, Math.round((paidDay / totalDay) * 100))) : 0;
  const dueCount = kpiRows.filter(isCollectable).length;
  const encCount = kpiRows.reduce((s, r) => s + r.payments.length, 0);

  // Moyens d'encaissement rapides configurés par le club (repli sur le défaut).
  const quickMethods = (clubDetail?.quickPaymentMethods?.length ? clubDetail.quickPaymentMethods : DEFAULT_QUICK_METHODS) as PaymentMethod[];
  // Caisse express : proposer TOUS les moyens de paiement — le(s) moyen(s) rapide(s) du club
  // d'abord (le 1er reste le bouton primaire), puis les autres moyens manuels en complément.
  const registerMethods = [...quickMethods, ...QUICK_METHODS.filter((m) => !quickMethods.includes(m))] as PaymentMethod[];
  const payAtClubOnly = clubDetail?.payAtClubOnly ?? false;   // option club : encaissement en un clic (moyen neutre CLUB)

  const kpiStat = (label: string, value: string, color: string, sub: string, bar?: number) => (
    <div style={{ padding: '2px 14px', minWidth: 88 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, marginTop: 2, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11, color: th.textFaint, marginTop: 1 }}>{sub}</div>
      {bar != null && <div style={{ marginTop: 5, height: 4, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}><div style={{ height: '100%', width: `${bar}%`, background: SETTLED_COLOR, transition: 'width .4s ease' }} /></div>}
    </div>
  );
  const kpiSep = <div style={{ width: 1, alignSelf: 'stretch', background: th.line, margin: '4px 0' }} />;

  // Panneau de filtres partagé (rail desktop + tiroir mobile).
  const filtersEl = (
    <ReservationFilters
      query={query} onQuery={setQuery}
      date={date} onDate={setDate} onClearDate={() => setDate('')}
      sports={sportsPresent}
      selectedSports={sel} onSports={changeSports}
      period={period} onPeriod={setPeriod}
      dueOnly={dueOnly} onDueOnly={setDueOnly}
      activeCount={activeCount} onReset={resetFilters}
    />
  );

  return (
    <div>
      {/* Titre + bandeau KPI compact aligné à droite. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '0 0 18px' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>Caisse</h1>
        {data && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', background: th.surface, borderRadius: 14, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: '6px 2px' }}>
            {kpiStat("Encaissé", fmtEuros(paidDay), th.mode === 'floodlit' ? th.accent : SETTLED_COLOR, `${encCount} enc.`)}
            {kpiSep}
            {kpiStat('Reste', fmtEuros(restDay), CORAL, `${dueCount} résa`, pctDay)}
            {kpiSep}
            {kpiStat('Total', fmtEuros(totalDay), th.text, `${kpiRows.length} résa`)}
          </div>
        )}
      </div>

      {filtersEl}

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          {/* ── zone 1 : la file ── */}
          <div data-testid="cx-queue" style={{ flex: isDesktop ? '0 0 340px' : 1, minWidth: 0 }}>
            <QueueList toCollect={groups.toCollect} settled={groups.settled} playersOf={playersOf}
              selectedId={selectedRvId} onSelect={(r) => setSelectedRvId(r.id)} />
          </div>
          {/* ── zone 2 : la caisse (desktop : colonne sticky) ── */}
          {isDesktop && (
            <div data-testid="cx-register" style={{ flex: 1, minWidth: 0, maxWidth: 900, position: 'sticky', top: 12 }}>
              {currentRv ? (
                <CashRegister reservation={currentRv} players={playersOf(currentRv)} due={dueOf(currentRv)}
                  members={members} quickMethods={registerMethods} packagesByUser={packagesByUser}
                  clubId={clubId!} slug={slug ?? ''} token={token!} isDesktop payAtClubOnly={payAtClubOnly}
                  onChanged={onMutated}
                  onOptimisticPay={(intent) => applyPaymentLocally(currentRv.id, intent)}
                  onOptimisticRefund={(ids) => applyRefundLocally(currentRv.id, ids)}
                  onOpenDetails={() => setSelected(currentRv)}
                  onCancel={() => setConfirmCancel(currentRv)}
                  onError={(m) => setError(m)} onSettled={selectNextDue} />
              ) : (
                <div style={{ padding: '48px 20px', textAlign: 'center', fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                  Sélectionnez une réservation dans la file
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── mobile : caisse en feuille plein écran ── */}
      {!isDesktop && currentRv && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: th.bg, overflowY: 'auto', padding: '14px 14px 24px' }}>
          <button type="button" onClick={() => setSelectedRvId(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, padding: '4px 0 12px' }}>‹ Retour à la file</button>
          <div data-testid="cx-register-mobile">
            <CashRegister reservation={currentRv} players={playersOf(currentRv)} due={dueOf(currentRv)}
              members={members} quickMethods={registerMethods} packagesByUser={packagesByUser}
              clubId={clubId!} slug={slug ?? ''} token={token!} isDesktop={false} payAtClubOnly={payAtClubOnly}
              onChanged={onMutated}
              onOptimisticPay={(intent) => applyPaymentLocally(currentRv.id, intent)}
              onOptimisticRefund={(ids) => applyRefundLocally(currentRv.id, ids)}
              onOpenDetails={() => setSelected(currentRv)}
              onCancel={() => setConfirmCancel(currentRv)}
              onError={(m) => setError(m)} />
          </div>
        </div>
      )}

      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: isDesktop ? 880 : 640, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 28, fontFamily: th.fontUI, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 25, letterSpacing: -0.3, color: th.text }}>{selected.resource.name}</div>
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontFamily: th.fontMono, fontSize: 13, color: th.textMute }}>{fmt(selected.startTime)}</span>
                  <span style={statusStyle(selected.status)}>{STATUS_LABEL[selected.status]}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 11, width: 34, height: 34, color: th.textMute, fontSize: 16, flexShrink: 0 }}>✕</button>
            </div>

            {/* Bandeau d'état — reste à encaisser / soldé */}
            {(() => {
              const dueC = dueOf(selected);
              const paidC = toCents(selected.paidAmount);
              const restC = Math.max(0, dueC - paidC);
              const pct = dueC > 0 ? Math.min(100, Math.round((paidC / dueC) * 100)) : 0;
              const done = dueC > 0 && restC <= 0;
              return (
                <div style={{ marginTop: 18, borderRadius: 16, padding: '16px 18px',
                  background: done ? 'rgba(52,184,136,0.10)' : th.surface2,
                  boxShadow: `inset 0 0 0 1px ${done ? 'rgba(52,184,136,0.30)' : th.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textMute }}>
                        {dueC <= 0 ? 'Encaissé' : done ? 'Statut' : 'Reste à encaisser'}
                      </div>
                      {dueC <= 0 ? (
                        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, letterSpacing: -0.5, lineHeight: 1, marginTop: 6, color: th.text }}>{fmtEuros(paidC)}</div>
                      ) : done ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, lineHeight: 1, marginTop: 6, color: SETTLED_COLOR }}>
                          <Icon name="check" size={24} color={SETTLED_COLOR} />Soldé
                        </div>
                      ) : (
                        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 32, letterSpacing: -1, lineHeight: 1, marginTop: 6, color: CORAL }}>{fmtEuros(restC)}</div>
                      )}
                    </div>
                    {dueC > 0 && (
                      <div style={{ textAlign: 'right', fontFamily: th.fontUI, fontSize: 13, color: th.textMute, lineHeight: 1.5 }}>
                        Payé <b style={{ color: th.text }}>{fmtEuros(paidC)}</b><br />sur {fmtEuros(dueC)}
                      </div>
                    )}
                  </div>
                  {dueC > 0 && (
                    <div style={{ marginTop: 14, height: 8, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: SETTLED_COLOR, transition: 'width .35s ease' }} />
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={{ marginTop: 20 }}>
              <CollectPanel reservation={selected} due={dueOf(selected)} players={playersOf(selected)} members={members} quickMethods={quickMethods} packagesByUser={packagesByUser} columns={isDesktop} payAtClubOnly={payAtClubOnly} clubId={clubId!} token={token!} onChanged={refreshSelected} onError={(msg) => setError(msg)} />
            </div>

            {selected.payments.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textMute }}>Encaissements</span>
                  <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>Total <b style={{ color: th.text }}>{fmtEuros(selected.payments.reduce((s, p) => s + toCents(p.amount), 0))}</b></span>
                </div>
                <div>
                  {selected.payments.map((p, i) => {
                    const payer = p.participantId ? (selected.participants ?? []).find((b) => b.id === p.participantId) : null;
                    const who = payer ? `${payer.firstName} ${payer.lastName}` : null;
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 2px', borderTop: i === 0 ? 'none' : `1px solid ${th.line}` }}>
                        <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: th.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={METHOD_ICON[p.method]} size={16} color={th.textMute} />
                        </span>
                        <span style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, minWidth: 62, color: th.text, fontVariantNumeric: 'tabular-nums' }}>{fmtEuros(toCents(p.amount))}</span>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 14, color: th.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {who
                            ? <><span style={{ color: th.text, fontWeight: 600 }}>{who}</span> · {METHOD_LABEL[p.method]}</>
                            : <><span style={{ color: th.textFaint }}>Réservation</span> · {METHOD_LABEL[p.method]}</>}
                        </span>
                        <span style={{ fontFamily: th.fontMono, fontSize: 12, color: th.textFaint }}>{fmtTime(p.createdAt)}</span>
                        <button type="button" onClick={() => setReceiptTarget({ payment: p, rv: selected })} style={{ border: 'none', boxShadow: `inset 0 0 0 1px ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600 }}>Reçu</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {receiptTarget && clubDetail && (
        <>
          <style>{`@media print { body * { visibility: hidden !important; } .receipt-print-overlay, .receipt-print-overlay * { visibility: visible !important; } .receipt-print-overlay { position: absolute; inset: 0; background: #fff !important; } .receipt-print-overlay .no-print { display: none !important; } }`}</style>
          <div className="receipt-print-overlay" onClick={() => setReceiptTarget(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
              <Receipt payment={toCaissePayment(receiptTarget.payment, receiptTarget.rv)} clubName={clubDetail.name} clubAddress={clubDetail.address} />
              <div className="no-print" style={{ display: 'flex', gap: 10, padding: '12px 24px 20px', background: '#fff' }}>
                <button type="button" onClick={() => window.print()} style={{ flex: 1, border: 'none', background: '#111', color: '#fff', borderRadius: 10, padding: '10px 0', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700 }}>Imprimer</button>
                <button type="button" onClick={() => setReceiptTarget(null)} style={{ border: '1px solid #ccc', background: 'transparent', color: '#555', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 14 }}>Fermer</button>
              </div>
            </div>
          </div>
        </>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Annuler la réservation ?"
          detail={
            <>
              {confirmCancel.resource.name} · {confirmCancel.title?.trim() ? confirmCancel.title : confirmCancel.user ? `${confirmCancel.user.firstName} ${confirmCancel.user.lastName}` : 'Événement'}
              {' · '}{fmt(confirmCancel.startTime)}
            </>
          }
          message="Cette action est définitive et libère le créneau. Le client n'est pas notifié automatiquement."
          confirmLabel="Annuler la réservation"
          cancelLabel="Retour"
          busy={cancelling}
          onConfirm={() => cancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
    </div>
  );
}
