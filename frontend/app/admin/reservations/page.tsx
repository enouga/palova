'use client';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { api, ClubReservation, ClubReservationsResponse, PaymentMethod, AdminResource, OffPeakHours, Member, ClubAdminDetail, Payment, CaissePayment, MemberPackage } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CollectPanel } from '@/components/admin/CollectPanel';
import { ReservationCollect } from '@/components/admin/ReservationCollect';
import { Receipt } from '@/components/admin/Receipt';
import { PaymentDots, SETTLED_COLOR } from '@/components/admin/PaymentDots';
import { Icon, IconName } from '@/components/ui/Icon';
import { dueCents, toCents, fmtEuros, paymentDots, applyOptimisticPayment, applyOptimisticRefund, PaymentIntent, DEFAULT_QUICK_METHODS } from '@/lib/caisse';
import { playerCount } from '@/lib/courtType';
import { matchesQuery, isUpcoming, nextSlotWindow, isNextSlot, PeriodMode, StatusMode, statusFilter, hasAnyMethod } from '@/lib/collect';
import { indexPackagesByUser } from '@/lib/packages';
import { ReservationFilters, SportFacet } from '@/components/admin/ReservationFilters';

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

export default function AdminReservationsPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const isDesktop = useIsDesktop();
  const clubId = club?.id;
  const [data, setData]   = useState<ClubReservationsResponse | null>(null);
  const [date, setDate]   = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);   // le loader plein écran ne s'affiche qu'au 1er chargement
  const loadSeq = useRef(0);          // « la dernière réponse gagne » : ignore les rechargements périmés (anti-clignotement / résa fantôme)
  const optSeq  = useRef(0);          // ids uniques des paiements optimistes (avant persistance)
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<ClubReservation | null>(null);
  const [cancelling, setCancelling]       = useState(false);
  const cancellingRef = useRef(false);    // garde synchrone anti double-annulation (avant que `disabled` ne s'applique)

  const [resources, setResources]     = useState<AdminResource[]>([]);
  const [peak, setPeak]               = useState<OffPeakHours | null>(null);
  const [tz, setTz]                   = useState('Europe/Paris');
  const [members, setMembers]         = useState<Member[]>([]);
  const [packagesByUser, setPackagesByUser] = useState<Record<string, MemberPackage[]>>({});
  const [clubDetail, setClubDetail]   = useState<ClubAdminDetail | null>(null);
  const [selected, setSelected]       = useState<ClubReservation | null>(null);   // modale « Détails »
  const [receiptTarget, setReceiptTarget] = useState<{ payment: Payment; rv: ClubReservation } | null>(null);

  const [query, setQuery]   = useState('');
  const [sportSel, setSportSel] = useState<Set<string> | null>(null);   // sports cochés (null = pas encore résolu)
  const [period, setPeriod]     = useState<PeriodMode>('upcoming');     // « À venir » par défaut
  const [dueOnly, setDueOnly]   = useState(false);                      // « À encaisser » par défaut off
  const [status, setStatus]     = useState<StatusMode>('all');          // filtre statut d'encaissement
  const [methodSel, setMethodSel] = useState<Set<string>>(new Set());   // moyens cochés (vide = tous)
  const [nowMs, setNowMs]       = useState<number | null>(null);        // heure courante (posée côté client)

  const statusStyle = (s: string): CSSProperties => ({
    borderRadius: 999, padding: '4px 11px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600,
    background: s === 'CONFIRMED' ? `${th.accent}22` : s === 'PENDING' ? th.surfaceHi : th.surface2,
    color: s === 'CONFIRMED' ? (th.mode === 'floodlit' ? th.accent : th.ink) : s === 'CANCELLED' ? th.textFaint : th.textMute,
  });

  // Chargement COMPLET (1er affichage + changement de jour) : config club, terrains,
  // membres et réservations. Protégé par `loadSeq` : si un rechargement plus récent
  // est parti entre-temps, on n'écrase PAS l'état avec une réponse périmée.
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

  // Rechargement LÉGER après une mutation (encaissement / annulation / remboursement) :
  // une seule requête (les réservations) au lieu de quatre — la config club, les terrains
  // et les membres ne changent pas en cours de session. Même garde « dernière réponse gagne ».
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

  // Remplace UNE réservation dans la liste sans aucune requête (mutation qui renvoie la
  // résa à jour : association de joueur, ajout/retrait). Instantané et insensible aux courses.
  const patchReservation = useCallback((updated: ClubReservation) => {
    setData((cur) => (cur ? { ...cur, reservations: cur.reservations.map((r) => (r.id === updated.id ? updated : r)) } : cur));
  }, []);

  // Recharge les soldes prépayés (après un encaissement par carnet/porte-monnaie,
  // pour que le solde affiché baisse). Best-effort.
  const reloadPackages = useCallback(async () => {
    if (!token || !clubId) return;
    try { setPackagesByUser(indexPackagesByUser(await api.adminGetActivePackages(clubId, token))); }
    catch { /* ignore */ }
  }, [token, clubId]);

  // Mutation réussie depuis une ligne : patch local si la résa à jour est fournie, sinon
  // rechargement léger des réservations (cas d'un encaissement, qui ne renvoie que le paiement).
  const onMutated = useCallback(async (updated?: ClubReservation) => {
    if (updated) patchReservation(updated);
    else await Promise.all([reloadReservations(), reloadPackages()]);
  }, [patchReservation, reloadReservations, reloadPackages]);

  // Encaissement OPTIMISTE : reflète le paiement dans la liste DÈS le clic (mise à jour
  // fonctionnelle → les clics rapides s'accumulent sans s'écraser). L'appel réseau et la
  // réconciliation sont gérés par la ligne (ReservationCollect) ; ici, juste l'affichage.
  const applyPaymentLocally = useCallback((reservationId: string, intent: PaymentIntent) => {
    const id = `opt:${(optSeq.current += 1)}`;
    const iso = new Date().toISOString();
    setData((cur) => (cur ? { ...cur, reservations: cur.reservations.map((r) => (r.id === reservationId ? applyOptimisticPayment(r, intent, id, iso) : r)) } : cur));
  }, []);
  const applyRefundLocally = useCallback((reservationId: string, paymentIds: string[]) => {
    setData((cur) => (cur ? { ...cur, reservations: cur.reservations.map((r) => (r.id === reservationId ? applyOptimisticRefund(r, paymentIds) : r)) } : cur));
  }, []);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);
  // Heure courante (timestamp absolu) — posée côté client uniquement (pas au rendu : hydratation).
  useEffect(() => { setNowMs(Date.now()); }, []);

  const cancel = async (r: ClubReservation) => {
    if (!token || !clubId || cancellingRef.current) return;   // garde synchrone : un seul appel même en double-clic rapide
    cancellingRef.current = true;
    setCancelling(true);
    try { setError(null); await api.adminCancelReservation(clubId, r.id, token); setConfirmCancel(null); await reloadReservations(); }
    catch (e) { setError((e as Error).message); }
    finally { setCancelling(false); cancellingRef.current = false; }
  };

  // Derived helpers
  const resById = new Map(resources.map((r) => [r.id, r]));
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
  const sportStorageKey = clubId ? `palova:encaissement-sports:${clubId}` : null;

  // Résout la sélection de sports une fois les terrains chargés : localStorage (ids périmés
  // filtrés) → sinon TOUS les sports présents.
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
  // Fenêtre « prochain créneau » : prochain départ réel du jour + marge retard de 20 min.
  const nextWindow = nowMs === null
    ? null
    : nextSlotWindow(dayResas.filter((r) => r.status !== 'CANCELLED').map((r) => new Date(r.startTime).getTime()), nowMs);
  const passWindow = (r: ClubReservation) =>
    period === 'all'  ? true
    : period === 'next' ? isNextSlot(r, nextWindow)
    : isUpcoming(r, nowMs);   // 'upcoming'
  const passDue    = (r: ClubReservation) => !dueOnly || isCollectable(r);
  // Le statut remplace le masquage des annulées : mode 'cancelled' → montre les annulées,
  // les autres modes ne montrent que l'actif (statusFilter gère les deux sens).
  const passStatus = (r: ClubReservation) => statusFilter(status, dueOf(r), toCents(r.paidAmount), r.status === 'CANCELLED');
  const passMethod = (r: ClubReservation) => hasAnyMethod(r.payments, methodSel);

  const visible = dayResas.filter((r) => passStatus(r) && passMethod(r) && passSearch(r) && passSport(r) && passWindow(r) && passDue(r));

  // Facettes « Moyen » : moyens réellement présents dans les encaissements du jour, ordre METHOD_LABEL.
  const methodsPresent = new Set(dayResas.flatMap((r) => r.payments.map((p) => p.method)));
  const methodFacets = (Object.keys(METHOD_LABEL) as PaymentMethod[])
    .filter((m) => methodsPresent.has(m))
    .map((m) => ({ key: m, label: METHOD_LABEL[m] }));

  const activeCount =
    (dueOnly ? 1 : 0) +
    (period !== 'upcoming' ? 1 : 0) +
    (status !== 'all' ? 1 : 0) +
    (methodSel.size > 0 ? 1 : 0) +
    (query.trim() ? 1 : 0) +
    (multiSport && sel.size !== sportsPresent.length ? 1 : 0);

  const resetFilters = () => {
    setDueOnly(false);
    setPeriod('upcoming');
    setStatus('all');
    setMethodSel(new Set());
    setQuery('');
    changeSports(sportsPresent.map((s) => s.key));   // tous cochés + persiste
  };

  // Tri + groupe par terrain (ordre de la page Terrains = ordre du tableau `resources`).
  const rankOf = new Map(resources.map((r, i) => [r.id, i]));
  const sortedVisible = [...visible].sort((a, b) => {
    const ra = rankOf.get(a.resourceId) ?? resources.length;
    const rb = rankOf.get(b.resourceId) ?? resources.length;
    return ra !== rb ? ra - rb : a.startTime.localeCompare(b.startTime);
  });
  const groups: { resource: { id: string; name: string }; rows: ClubReservation[] }[] = [];
  for (const r of sortedVisible) {
    const last = groups[groups.length - 1];
    if (last && last.resource.id === r.resourceId) last.rows.push(r);
    else groups.push({ resource: r.resource, rows: [r] });
  }

  // KPI du jour (hors annulées).
  const kpiRows = visible.filter((r) => r.status !== 'CANCELLED');
  const totalDay = kpiRows.reduce((s, r) => s + dueOf(r), 0);
  const paidDay  = kpiRows.reduce((s, r) => s + toCents(r.paidAmount), 0);
  const restDay  = Math.max(0, totalDay - paidDay);
  const pctDay   = totalDay > 0 ? Math.max(0, Math.min(100, Math.round((paidDay / totalDay) * 100))) : 0;
  const dueCount = kpiRows.filter(isCollectable).length;
  const encCount = kpiRows.reduce((s, r) => s + r.payments.length, 0);

  // Moyens d'encaissement rapides configurés par le club. Liste vide (le club a tout décoché)
  // OU pas encore chargée → repli sur le défaut, pour que la page reste utilisable en 1 clic.
  const quickMethods = (clubDetail?.quickPaymentMethods?.length ? clubDetail.quickPaymentMethods : DEFAULT_QUICK_METHODS) as PaymentMethod[];
  const payAtClubOnly = clubDetail?.payAtClubOnly ?? false;   // option club : encaissement en un clic (moyen neutre CLUB)

  // Stat KPI compacte (bandeau à droite du titre) — bien plus discrète que les anciennes grosses tuiles.
  const kpiStat = (label: string, value: string, color: string, sub: string, bar?: number) => (
    <div style={{ padding: '2px 14px', minWidth: 88 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, marginTop: 2, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11, color: th.textFaint, marginTop: 1 }}>{sub}</div>
      {bar != null && <div style={{ marginTop: 5, height: 4, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}><div style={{ height: '100%', width: `${bar}%`, background: SETTLED_COLOR, transition: 'width .4s ease' }} /></div>}
    </div>
  );
  const kpiSep = <div style={{ width: 1, alignSelf: 'stretch', background: th.line, margin: '4px 0' }} />;

  const renderRow = (r: ClubReservation) => {
    const cancelled = r.status === 'CANCELLED';
    const due = dueOf(r);
    const rem = remainingOf(r);
    const sttld = due > 0 && rem <= 0 && !cancelled;
    const partial = due > 0 && toCents(r.paidAmount) > 0 && rem > 0;
    const rail = cancelled ? th.textFaint : sttld ? SETTLED_COLOR : partial ? th.accentWarm : due > 0 ? CORAL : th.textFaint;
    const dots = paymentDots(r, playersOf(r), due);
    const who = r.title?.trim() ? r.title : r.user ? `${r.user.firstName} ${r.user.lastName}` : 'Événement';
    return (
      <div key={r.id}>
        {/* En-tête de la réservation : un clic ouvre la modale « Détails ». */}
        <button type="button" onClick={() => { if (!cancelled) setSelected(r); }}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', marginBottom: cancelled ? 8 : 6,
            padding: '11px 13px', borderRadius: 13, background: th.surface, boxShadow: `inset 0 0 0 1px ${th.line}`,
            cursor: cancelled ? 'default' : 'pointer', opacity: cancelled ? 0.55 : 1, fontFamily: th.fontUI }}>
          <span style={{ width: 4, height: 34, borderRadius: 999, background: rail, flexShrink: 0 }} />
          <span style={{ fontFamily: th.fontMono, fontSize: 13, fontWeight: 600, color: th.text, width: 46, flexShrink: 0 }}>{fmtTime(r.startTime)}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
          {dots && <PaymentDots dots={dots} color={th.accent} />}
          <span style={{ fontFamily: th.fontUI, fontSize: 13, whiteSpace: 'nowrap', color: th.textMute }}>
            {cancelled ? 'Annulée'
              : sttld ? <span style={{ color: SETTLED_COLOR, fontWeight: 600 }}>Soldé</span>
              : rem > 0 ? <>reste <b style={{ color: CORAL, fontVariantNumeric: 'tabular-nums' }}>{fmtEuros(rem)}</b></>
              : due > 0 ? <span style={{ color: SETTLED_COLOR, fontWeight: 600 }}>Soldé</span>
              : '—'}
          </span>
        </button>
        {!cancelled && (
          <ReservationCollect reservation={r} players={playersOf(r)} due={due} members={members} quickMethods={quickMethods}
            packagesByUser={packagesByUser}
            clubId={clubId!} token={token!} onChanged={onMutated}
            onOptimisticPay={(intent) => applyPaymentLocally(r.id, intent)}
            onOptimisticRefund={(ids) => applyRefundLocally(r.id, ids)}
            onOpenDetails={() => setSelected(r)}
            onCancel={() => setConfirmCancel(r)} onError={(m) => setError(m)} />
        )}
      </div>
    );
  };

  // Panneau de filtres partagé (rail desktop + tiroir mobile) — état dans la page.
  const filtersEl = (
    <ReservationFilters
      query={query} onQuery={setQuery}
      date={date} onDate={setDate} onClearDate={() => setDate('')}
      sports={sportsPresent}
      selectedSports={sel} onSports={changeSports}
      period={period} onPeriod={setPeriod}
      dueOnly={dueOnly} onDueOnly={setDueOnly}
      status={status} onStatus={setStatus}
      methodFacets={methodFacets} selectedMethods={methodSel} onMethods={(keys) => setMethodSel(new Set(keys))}
      activeCount={activeCount} onReset={resetFilters}
    />
  );

  return (
    <div>
      {/* Titre + bandeau KPI compact aligné à droite (gain de hauteur ; passe sous le titre si étroit). */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '0 0 18px' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>Paiements</h1>
        {data && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', background: th.surface, borderRadius: 14, boxShadow: `inset 0 0 0 1px ${th.line}`, padding: '6px 2px' }}>
            {kpiStat("Encaissé", fmtEuros(paidDay), th.mode === 'floodlit' ? th.accent : SETTLED_COLOR, `${encCount} enc.`)}
            {kpiSep}
            {kpiStat('Reste', fmtEuros(restDay), CORAL, `${dueCount} résa`, pctDay)}
            {kpiSep}
            {kpiStat('Total', fmtEuros(totalDay), th.text, `${kpiRows.length} résa · ${groups.length} terr.`)}
          </div>
        )}
      </div>

      {/* Barre de filtres sur deux niveaux (tout reste visible). */}
      {filtersEl}

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        // Liste groupée par terrain, triée par heure ; chaque réservation déplie ses lignes joueur.
        <div data-testid="resa-list" style={{ maxWidth: 960 }}>
          {groups.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', fontFamily: th.fontUI, color: th.textFaint, background: th.surface, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${th.line}` }}>Aucune réservation</div>
          ) : groups.map((g) => {
            const gRows = g.rows.filter((r) => r.status !== 'CANCELLED');
            const gDue = gRows.reduce((s, r) => s + dueOf(r), 0);
            const gPaid = gRows.reduce((s, r) => s + toCents(r.paidAmount), 0);
            const gRem = Math.max(0, gDue - gPaid);
            const gDueN = gRows.filter(isCollectable).length;
            // Plein quand tout est soldé ; sinon proportion payée, bornée à [0, 100].
            const gPct = gDueN === 0 ? 100 : gDue > 0 ? Math.max(0, Math.min(100, Math.round((gPaid / gDue) * 100))) : 100;
            return (
              <section key={g.resource.id} style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2, color: th.text }}>{g.resource.name}</span>
                  <div style={{ flex: 1, maxWidth: 200, height: 6, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}><div style={{ height: '100%', width: `${gPct}%`, background: SETTLED_COLOR }} /></div>
                  <span style={{ fontSize: 12.5, color: th.textMute, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                    {gDueN === 0 ? <span style={{ color: SETTLED_COLOR }}>✓ tout soldé</span> : <>{gDueN} à encaisser · <b style={{ color: CORAL }}>{fmtEuros(gRem)}</b></>}
                  </span>
                </div>
                {g.rows.map(renderRow)}
              </section>
            );
          })}
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

            {/* Bandeau d'état — reste à encaisser / soldé, lisible d'un coup d'œil */}
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
                    // Qui a payé : joueur attribué (participantId) ou « Réservation entière » (paiement anonyme).
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
