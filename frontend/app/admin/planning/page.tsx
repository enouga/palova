'use client';
import { useState, useEffect, useCallback, useRef, CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { api, AdminResource, ClubReservation, ReservationType, OffPeakHours, Member, CreateMemberBody, Coach, LessonStudent, PaymentMethod, MemberPackage, Payment, CaissePayment, ClubAdminDetail } from '@/lib/api';
import { capacityLabel } from '@/lib/lessons';
import { indexPackagesByUser } from '@/lib/packages';
import { courtFormat, playerCount, SINGLE_COLOR } from '@/lib/courtType';
import { toCents, dueCents, fmtEuros, participantPastilles, PastillesModel, PopoverAnchor, DEFAULT_QUICK_METHODS, QUICK_METHODS, applyOptimisticPayment, applyOptimisticRefund, PaymentIntent } from '@/lib/caisse';
import { endTimeFrom } from '@/lib/duration';
import { localMinutesOfDay, weekdayOf, fromMinutes, toMinutes, findOverlap, pxToMinutes, BusySlot } from '@/lib/planningTime';
import { moveTarget, resizeTarget, createTarget } from '@/lib/planningDrag';
import { TYPE_META, TYPE_ORDER } from '@/lib/reservationType';
import { SETTLED_COLOR } from '@/components/admin/PaymentDots';
import { PaymentInitials } from '@/components/admin/PaymentInitials';
import { TilePaymentPopover } from '@/components/admin/planning/TilePaymentPopover';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { CollectPanel } from '@/components/admin/CollectPanel';
import { CashRegister } from '@/components/admin/caisse/CashRegister';
import { Receipt } from '@/components/admin/Receipt';
import { Icon, IconName } from '@/components/ui/Icon';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useAdminChrome } from '../layout';
import { Btn } from '@/components/ui/atoms';
import NoShowChargeModal from '@/components/admin/NoShowChargeModal';
import { DateField } from '@/components/ui/DateField';
import { CreateEventModal, CreateEventFormState, CreateEventPrefill } from '@/components/admin/planning/CreateEventModal';

const STATUS_LABEL: Record<string, string> = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };
// Libellés / icônes des moyens de paiement pour la liste « Encaissements » (cohérent page Encaissement).
const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces', CARD: 'Carte', TRANSFER: 'Virement', ONLINE: 'En ligne', OTHER: 'Autre',
  VOUCHER: 'Ticket CE', CHEQUE: 'Chèque', CLUB: 'Au club', PACK_CREDIT: 'Carnet', WALLET: 'Porte-monnaie', MEMBER: 'Abo / Membre', SUBSCRIPTION: 'Abonnement',
};
const METHOD_ICON: Record<PaymentMethod, IconName> = {
  CASH: 'euro', CARD: 'card', TRANSFER: 'arrowR', ONLINE: 'card', OTHER: 'euro',
  VOUCHER: 'ticket', CHEQUE: 'ticket', CLUB: 'home', PACK_CREDIT: 'ticket', WALLET: 'euro', MEMBER: 'user', SUBSCRIPTION: 'user',
};
// Règlements « sans encaissement » (débités au joueur : coffre, offres, abonnement) : enregistrés
// en MEMBER (hors totaux caisse) avec la note = libellé. Affichés en boutons 1 clic dans la modale.
const SETTLEMENT_PRESETS = [
  { label: 'Coffre', note: 'Coffre' },
  { label: 'Offres', note: 'Offres' },
  { label: 'Abonnement', note: 'Abonnement' },
];

// Adapte un paiement de réservation au format attendu par le reçu (Receipt).
function toCaissePayment(p: Payment, rv: ClubReservation): CaissePayment {
  return {
    ...p,
    reservation: { id: rv.id, startTime: rv.startTime, resource: { name: rv.resource.name }, user: rv.user ? { firstName: rv.user.firstName, lastName: rv.user.lastName } : null },
    memberPackage: null,
  };
}
// Dimensions de la grille verticale (terrains en colonnes, heures en lignes).
const HOUR_H = 68, TIME_W = 56, COL_MIN_W = 120, HEADER_H = 52;
// Seuil (px) sous lequel un mousedown+mouseup vaut clic simple, pas un drag.
const DRAG_THRESHOLD_PX = 5;

// État du drag & drop de la grille — DELTA-based (lib/planningDrag), la colonne (terrain)
// survolée est résolue en DOM (document.elementFromPoint) pendant le déplacement.
type DragState =
  | { kind: 'move'; reservationId: string; durationMin: number; originResourceId: string; originStartMin: number; targetResourceId: string; targetStartMin: number; conflict: boolean }
  | { kind: 'resize'; reservationId: string; resourceId: string; startMin: number; originEndMin: number; targetEndMin: number; conflict: boolean }
  | { kind: 'create'; resourceId: string; anchorMin: number; targetEndMin: number }
  | null;

interface RescheduleToast {
  reservationId: string;
  label: string;
  previous: { resourceId: string; date: string; startTime: string; endTime: string };
}

// Ghost visuel d'un drag pour UNE colonne donnée (null si le drag ne concerne pas ce terrain).
function dragGhostFor(drag: DragState, resourceId: string): { startMin: number; endMin: number; conflict: boolean } | null {
  if (!drag) return null;
  if (drag.kind === 'move')   return drag.targetResourceId === resourceId ? { startMin: drag.targetStartMin, endMin: drag.targetStartMin + drag.durationMin, conflict: drag.conflict } : null;
  if (drag.kind === 'resize') return drag.resourceId === resourceId       ? { startMin: drag.startMin, endMin: drag.targetEndMin, conflict: drag.conflict } : null;
  return drag.resourceId === resourceId ? { startMin: drag.anchorMin, endMin: drag.targetEndMin, conflict: false } : null;
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

function nowMinutes(tz: string): number {
  const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date());
  const [h, m] = f.split(':').map(Number);
  return h * 60 + m;
}

function fmtHM(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export default function AdminPlanningPage() {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const { collapsed, setCollapsed } = useAdminChrome();
  const clubId = club?.id;
  // Étiquette d'une entrée : l'intitulé s'il existe, sinon le nom du joueur, sinon « Événement ».
  const labelOf = (r: ClubReservation) =>
    r.title?.trim()
      ? r.title
      : r.user
        ? `${r.user.firstName} ${r.user.lastName}`
        : 'Événement';
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [tz, setTz]               = useState('Europe/Paris');
  const [peak, setPeak]           = useState<OffPeakHours | null>(null);
  const [quickMethods, setQuickMethods] = useState<PaymentMethod[]>(DEFAULT_QUICK_METHODS);   // moyens rapides configurés par le club
  const [packagesByUser, setPackagesByUser] = useState<Record<string, MemberPackage[]>>({});
  const [resources, setResources] = useState<AdminResource[]>([]);
  const [reservations, setRes]    = useState<ClubReservation[]>([]);
  const [date, setDate]           = useState(todayISO());
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [hidden, setHidden]       = useState<Set<ReservationType>>(new Set());
  const [selected, setSelected]   = useState<ClubReservation | null>(null);
  const [clubDetail, setClubDetail] = useState<ClubAdminDetail | null>(null);   // nom/adresse pour les reçus
  const [receiptTarget, setReceiptTarget] = useState<{ payment: Payment; rv: ClubReservation } | null>(null);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());   // joueurs de la résa ouverte avec un abonnement ACTIF
  const [busy, setBusy]           = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [noShowTarget, setNoShowTarget] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);   // modale « Détails / options » (CollectPanel avancé) au-dessus de la caisse
  const optSeq = useRef(0);                                 // ids uniques des encaissements optimistes (CashRegister)
  const [isFs, setIsFs]           = useState(false);

  // Drag & drop de la grille (déplacer / étirer / créer en glissant).
  const [drag, setDragState] = useState<DragState>(null);
  const dragRef = useRef<DragState>(null);         // valeur "vive" lue au mouseup (setDragState est asynchrone)
  const dragOriginY = useRef(0);                   // clientY au mousedown (référence du delta)
  const draggedRef = useRef(false);                // un vrai drag a eu lieu → le clic de fin est ignoré
  const setDrag = (next: DragState) => { dragRef.current = next; setDragState(next); };
  const [toast, setToast] = useState<RescheduleToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Panneau de paiement au survol (~400 ms) d'un bloc COURT payant : nom + montants par joueur.
  const [hover, setHover] = useState<{ id: string; anchor: PopoverAnchor; model: PastillesModel } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const clearHoverTimer = () => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } };
  const scheduleHover = (rv: ClubReservation, model: PastillesModel, el: HTMLElement) => {
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      setHover({ id: rv.id, model, anchor: { left: r.left, right: r.right, top: r.top } });
    }, 400);
  };
  const cancelHover = (id: string) => {
    clearHoverTimer();
    setHover((cur) => (cur?.id === id ? null : cur));
  };

  const [members, setMembers]   = useState<Member[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<CreateEventPrefill | undefined>(undefined);
  const [coaches, setCoaches]               = useState<Coach[]>([]);
  const [students, setStudents]             = useState<LessonStudent[]>([]);

  const load = useCallback(async (): Promise<ClubReservation[]> => {
    if (!token || !clubId) return [] as ClubReservation[];
    setLoading(true);
    try {
      setError(null);
      const [c, res, resv, mem, pkgs] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetResources(clubId, token),
        api.adminGetReservations(clubId, { date }, token),
        api.adminGetMembers(clubId, token),
        api.adminGetActivePackages(clubId, token),
      ]);
      setClubDetail(c);
      setTz(c.timezone);
      setPeak(c.offPeakHours ?? null);
      setQuickMethods(c.quickPaymentMethods?.length ? c.quickPaymentMethods : DEFAULT_QUICK_METHODS);
      setResources(res.filter((r) => r.isActive));
      setRes(resv.reservations);
      setMembers(mem);
      setPackagesByUser(indexPackagesByUser(pkgs));
      api.adminListCoaches(clubId, token).then((cs) => setCoaches(cs.filter((c) => c.isActive))).catch(() => {});
      return resv.reservations;
    } catch (e) { setError((e as Error).message); return [] as ClubReservation[]; }
    finally { setLoading(false); }
  }, [token, clubId, date]);

  // Rechargement LÉGER des réservations après un encaissement (pas de setLoading → la
  // modale ne se démonte pas ; une seule requête au lieu des quatre de `load`).
  const reloadReservations = useCallback(async (): Promise<ClubReservation[]> => {
    if (!token || !clubId) return [];
    try {
      const resv = await api.adminGetReservations(clubId, { date }, token);
      setRes(resv.reservations);
      return resv.reservations;
    } catch (e) { setError((e as Error).message); return []; }
  }, [token, clubId, date]);

  // Recharge les soldes prépayés (après un règlement carnet/porte-monnaie). Best-effort.
  const reloadPackages = useCallback(async () => {
    if (!token || !clubId) return;
    try { setPackagesByUser(indexPackagesByUser(await api.adminGetActivePackages(clubId, token))); }
    catch { /* ignore */ }
  }, [token, clubId]);

  // Remplace UNE réservation dans la grille sans requête (mutation qui renvoie la résa à jour).
  const patchReservation = useCallback((updated: ClubReservation) => {
    setRes((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
  }, []);

  // Mutation d'encaissement/joueur réussie : patch (grille + modale) si la résa à jour est
  // fournie (association/retrait/remplacement), sinon rechargement léger + re-synchro de la modale.
  const onCollected = useCallback(async (updated?: ClubReservation) => {
    if (updated) { patchReservation(updated); setSelected((cur) => (cur && cur.id === updated.id ? updated : cur)); return; }
    const [list] = await Promise.all([reloadReservations(), reloadPackages()]);
    setSelected((cur) => (cur ? list.find((r) => r.id === cur.id) ?? cur : cur));
  }, [patchReservation, reloadReservations, reloadPackages]);

  // Encaissement OPTIMISTE (CashRegister) : reflète le paiement DÈS le clic dans la modale ET la
  // grille, et renvoie l'id synthétique (sert au toast « Annuler » avant réconciliation serveur).
  const applyPaymentLocally = useCallback((reservationId: string, intent: PaymentIntent): string => {
    const id = `opt:${(optSeq.current += 1)}`;
    const iso = new Date().toISOString();
    setSelected((cur) => (cur && cur.id === reservationId ? applyOptimisticPayment(cur, intent, id, iso) : cur));
    setRes((cur) => cur.map((r) => (r.id === reservationId ? applyOptimisticPayment(r, intent, id, iso) : r)));
    return id;
  }, []);
  const applyRefundLocally = useCallback((reservationId: string, paymentIds: string[]) => {
    setSelected((cur) => (cur && cur.id === reservationId ? applyOptimisticRefund(cur, paymentIds) : cur));
    setRes((cur) => cur.map((r) => (r.id === reservationId ? applyOptimisticRefund(r, paymentIds) : r)));
  }, []);

  // Caisse de la modale : mêmes boutons que la page Caisse (moyens rapides du club d'abord, puis les autres).
  const registerMethods = [...quickMethods, ...QUICK_METHODS.filter((m) => !quickMethods.includes(m))] as PaymentMethod[];

  // Annule (rembourse) un encaissement depuis la liste — couvre aussi les paiements ANONYMES
  // (réservation entière / place vide / préréglé Coffre-Offres-Abonnement / « Autre ») qui ne
  // s'accrochent à aucune ligne joueur du CollectPanel.
  const cancelPayment = async (p: Payment) => {
    if (!token || !clubId || busy) return;
    const rem = toCents(p.amount) - toCents(p.refundedAmount ?? '0');
    if (rem <= 0) return;
    setBusy(true);
    try { setError(null); await api.refundPayment(clubId, p.id, { amount: rem / 100, reason: 'Annulation au comptoir' }, token); await onCollected(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const loadStudents = useCallback((lessonId: string) => {
    if (!token || !clubId) return;
    api.adminListLessonStudents(clubId, lessonId, token).then(setStudents).catch(() => setStudents([]));
  }, [token, clubId]);

  // Charge la liste des élèves quand la modale de détail s'ouvre sur un cours.
  useEffect(() => {
    if (selected?.lesson?.id) {
      loadStudents(selected.lesson.id);
    } else {
      setStudents([]);
    }
  }, [selected?.lesson?.id, loadStudents]);

  // Abonnements ACTIFS des joueurs de la réservation ouverte (titulaire + participants) → garde des
  // règlements « sans encaissement ». Le carnet/porte-monnaie vient déjà de packagesByUser. Chargé à
  // l'ouverture (et si les joueurs changent). Un abonnement suffit sur au moins un joueur ciblable.
  const subsSig = selected ? [selected.user?.id, ...(selected.participants ?? []).map((p) => p.userId)].filter(Boolean).join(',') : '';
  useEffect(() => {
    if (!token || !clubId || !subsSig) { setSubscribedIds(new Set()); return; }
    const ids = [...new Set(subsSig.split(','))];
    let alive = true;
    Promise.all(ids.map((uid) =>
      api.adminGetMemberSubscriptions(clubId, uid, token)
        .then((subs) => (subs.some((s) => s.status === 'ACTIVE' && new Date(s.expiresAt).getTime() > Date.now()) ? uid : null))
        .catch(() => null),
    )).then((rows) => { if (alive) setSubscribedIds(new Set(rows.filter(Boolean) as string[])); });
    return () => { alive = false; };
  }, [token, clubId, subsSig]);

  // Suivi de l'état plein écran.
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    rootRef.current?.requestFullscreen?.();
  };

  const minOpen = resources.length ? Math.min(...resources.map((r) => r.openHour)) : 8;
  const maxClose = resources.length ? Math.max(...resources.map((r) => r.closeHour)) : 22;
  const hours: number[] = [];
  for (let h = minOpen; h < maxClose; h++) hours.push(h);

  const shown = reservations.filter((rv) => rv.status !== 'CANCELLED' && !hidden.has(rv.type));

  // Réservations visibles regroupées par terrain.
  const byResource = new Map<string, ClubReservation[]>();
  for (const rv of shown) {
    const arr = byResource.get(rv.resource.id) ?? [];
    arr.push(rv);
    byResource.set(rv.resource.id, arr);
  }

  // Terrains par id (format single/double, tarifs) ; nb de joueurs et montant dû
  // (= plafond d'encaissement, prix de la résa ou tarif heures pleines/creuses).
  const resById = new Map(resources.map((r) => [r.id, r]));
  const playersOf = (rv: ClubReservation) => {
    const r = resById.get(rv.resource.id);
    return playerCount(typeof r?.attributes?.format === 'string' ? r.attributes.format : undefined);
  };
  const dueOf = (rv: ClubReservation) => dueCents(rv, resById.get(rv.resource.id), peak, tz);

  // Créneaux occupés (tous terrains, résas non annulées) — conflits pendant un drag ET dans la
  // modale de création (chips/avertissement).
  const allBusySlots: BusySlot[] = reservations
    .filter((rv) => rv.status !== 'CANCELLED')
    .map((rv) => {
      const s = localMinutesOfDay(rv.startTime, tz);
      let e = localMinutesOfDay(rv.endTime, tz);
      if (e <= s) e = 24 * 60;
      return { id: rv.id, resourceId: rv.resource.id, startMin: s, endMin: e };
    });

  // Applique un nouveau terrain/horaire à une résa SANS appel réseau (patch optimiste) : le
  // delta en minutes (même jour affiché, même fuseau) est appliqué aux Date déjà correctes —
  // plus sûr qu'une reconstruction manuelle tz-aware, suffisant en attendant la réconciliation.
  const applyScheduleLocally = (rv: ClubReservation, resourceId: string, startMin: number, endMin: number): ClubReservation => {
    const startDeltaMin = startMin - localMinutesOfDay(rv.startTime, tz);
    const endDeltaMin = endMin - localMinutesOfDay(rv.endTime, tz);
    const newStartIso = new Date(new Date(rv.startTime).getTime() + startDeltaMin * 60_000).toISOString();
    const newEndIso = new Date(new Date(rv.endTime).getTime() + endDeltaMin * 60_000).toISOString();
    const targetRes = resById.get(resourceId);
    return { ...rv, resource: { ...rv.resource, id: resourceId, name: targetRes?.name ?? rv.resource.name }, startTime: newStartIso, endTime: newEndIso };
  };

  const armRescheduleToast = (t: RescheduleToast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  // Déplacement/étirement confirmé (drag relâché sans conflit) : optimiste + appel serveur +
  // toast « Annuler ». Un échec réseau revert le patch optimiste (pas de toast à annuler).
  const commitReschedule = async (rv: ClubReservation, targetResourceId: string, startMin: number, endMin: number, label: string) => {
    if (!token || !clubId) return;
    const previous = {
      resourceId: rv.resource.id, date,
      startTime: fromMinutes(localMinutesOfDay(rv.startTime, tz)),
      endTime: fromMinutes(localMinutesOfDay(rv.endTime, tz)),
    };
    patchReservation(applyScheduleLocally(rv, targetResourceId, startMin, endMin));
    armRescheduleToast({ reservationId: rv.id, label, previous });
    try {
      await api.adminRescheduleReservation(clubId, rv.id, { resourceId: targetResourceId, date, startTime: fromMinutes(startMin), endTime: fromMinutes(endMin) }, token);
    } catch (e) {
      patchReservation(rv); // revert
      setToast(null);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setError((e as Error).message);
    }
  };

  const undoReschedule = async () => {
    if (!toast || !token || !clubId) return;
    const { reservationId, previous } = toast;
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const rv = reservations.find((r) => r.id === reservationId);
    if (!rv) return;
    patchReservation(applyScheduleLocally(rv, previous.resourceId, toMinutes(previous.startTime), toMinutes(previous.endTime)));
    try {
      await api.adminRescheduleReservation(clubId, reservationId, previous, token);
    } catch (e) { setError((e as Error).message); }
  };

  // Démarre un drag « déplacer » (corps du bloc) ou « étirer » (poignée basse). Le bloc reste
  // un <button> (contrat des tests existants) ; la poignée fait stopPropagation pour ne pas
  // déclencher aussi le déplacement du bloc parent.
  const startBlockDrag = (evt: ReactMouseEvent, rv: ClubReservation, kind: 'move' | 'resize', startMin: number, endMin: number) => {
    if (rv.status === 'CANCELLED' || busy) return;
    cancelHover(rv.id);
    evt.preventDefault();
    draggedRef.current = false;
    dragOriginY.current = evt.clientY;
    if (kind === 'move') {
      setDrag({ kind: 'move', reservationId: rv.id, durationMin: endMin - startMin, originResourceId: rv.resource.id, originStartMin: startMin, targetResourceId: rv.resource.id, targetStartMin: startMin, conflict: false });
    } else {
      setDrag({ kind: 'resize', reservationId: rv.id, resourceId: rv.resource.id, startMin, originEndMin: endMin, targetEndMin: endMin, conflict: false });
    }
  };

  // Démarre un drag « créer en glissant » sur une case vide (départ aligné 30 min).
  const startCreateDrag = (evt: ReactMouseEvent, resourceId: string) => {
    if ((evt.target as HTMLElement).closest('button') || busy) return;
    const rect = (evt.currentTarget as HTMLDivElement).getBoundingClientRect();
    const raw = pxToMinutes(evt.clientY - rect.top, HOUR_H, minOpen * 60, 30);
    const anchorMin = Math.min(Math.max(raw, minOpen * 60), maxClose * 60 - 30);
    evt.preventDefault();
    draggedRef.current = false;
    dragOriginY.current = evt.clientY;
    setDrag({ kind: 'create', resourceId, anchorMin, targetEndMin: anchorMin + 30 });
  };

  // Suivi global (souris) du drag en cours : ghost + conflit en direct, résolution au relâché.
  useEffect(() => {
    if (!drag) return;
    const onMove = (evt: MouseEvent) => {
      const deltaPx = evt.clientY - dragOriginY.current;
      if (Math.abs(deltaPx) > DRAG_THRESHOLD_PX) draggedRef.current = true;
      const overEl = document.elementFromPoint(evt.clientX, evt.clientY) as HTMLElement | null;
      const hoveredResourceId = overEl?.closest('[data-resource-id]')?.getAttribute('data-resource-id') ?? null;
      const cur = dragRef.current;
      if (!cur) return;
      if (cur.kind === 'move') {
        const targetResourceId = hoveredResourceId ?? cur.targetResourceId;
        const targetRes = resById.get(targetResourceId);
        const rOpen = (targetRes?.openHour ?? minOpen) * 60;
        const rClose = (targetRes?.closeHour ?? maxClose) * 60;
        const { startMin } = moveTarget(cur.originStartMin, cur.durationMin, deltaPx, HOUR_H, rOpen, rClose);
        const conflict = !!findOverlap(allBusySlots, targetResourceId, startMin, cur.durationMin, cur.reservationId);
        setDrag({ ...cur, targetResourceId, targetStartMin: startMin, conflict });
      } else if (cur.kind === 'resize') {
        const r = resById.get(cur.resourceId);
        const rClose = (r?.closeHour ?? maxClose) * 60;
        const targetEndMin = resizeTarget(cur.startMin, cur.originEndMin, deltaPx, HOUR_H, rClose);
        const conflict = !!findOverlap(allBusySlots, cur.resourceId, cur.startMin, targetEndMin - cur.startMin, cur.reservationId);
        setDrag({ ...cur, targetEndMin, conflict });
      } else {
        const r = resById.get(cur.resourceId);
        const rClose = (r?.closeHour ?? maxClose) * 60;
        const targetEndMin = createTarget(cur.anchorMin, deltaPx, HOUR_H, rClose);
        setDrag({ ...cur, targetEndMin });
      }
    };
    const onUp = () => {
      const cur = dragRef.current;
      setDrag(null);
      if (!cur) return;
      if (cur.kind === 'create') {
        if (draggedRef.current) {
          openCreate({ resourceId: cur.resourceId, startTime: fromMinutes(cur.anchorMin), durationMin: cur.targetEndMin - cur.anchorMin });
        }
        return;
      }
      if (!draggedRef.current || cur.conflict) return;
      const rv = reservations.find((r) => r.id === cur.reservationId);
      if (!rv) return;
      if (cur.kind === 'move') {
        if (cur.targetResourceId === cur.originResourceId && cur.targetStartMin === cur.originStartMin) return;
        commitReschedule(rv, cur.targetResourceId, cur.targetStartMin, cur.targetStartMin + cur.durationMin, 'Déplacé');
      } else {
        if (cur.targetEndMin === cur.originEndMin) return;
        commitReschedule(rv, cur.resourceId, cur.startMin, cur.targetEndMin, 'Étiré');
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.kind]);

  // Stats (sur les réservations affichées).
  let openMin = 0, bookedMin = 0, outstandingCents = 0;
  for (const r of resources) openMin += (r.closeHour - r.openHour) * 60;
  for (const rv of shown) {
    const r = resources.find((x) => x.id === rv.resource.id);
    if (r) {
      const s = Math.max(localMinutesOfDay(rv.startTime, tz), r.openHour * 60);
      const e = Math.min(localMinutesOfDay(rv.endTime, tz), r.closeHour * 60);
      if (e > s) bookedMin += e - s;
    }
    outstandingCents += Math.max(0, dueOf(rv) - toCents(rv.paidAmount));
  }
  const occupancy = openMin > 0 ? Math.round((bookedMin / openMin) * 100) : 0;

  const nm = nowMinutes(tz);
  const nowVisible = date === todayISO() && resources.length > 0 && nm >= minOpen * 60 && nm <= maxClose * 60;
  const nowTop = ((nm - minOpen * 60) / 60) * HOUR_H;

  // Le jour J, ouvre la grille positionnée un peu au-dessus de l'heure courante.
  useEffect(() => {
    if (loading || date !== todayISO() || !gridRef.current) return;
    gridRef.current.scrollTop = Math.max(0, ((nowMinutes(tz) - minOpen * 60) / 60) * HOUR_H - 2 * HOUR_H);
  }, [loading, date, tz, minOpen]);

  const tint = (hex: string) => (th.mode === 'floodlit' ? `${hex}2e` : `${hex}24`);
  const hatch = `repeating-linear-gradient(135deg, ${th.line} 0 5px, transparent 5px 11px)`;

  const arrow: CSSProperties = {
    width: 34, height: 34, borderRadius: 10, border: `1px solid ${th.line}`, background: 'transparent',
    color: th.textMute, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1, flexShrink: 0,
  };
  const chromeBtn: CSSProperties = {
    border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 10, padding: '8px 12px',
    cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
  };

  const stat = (label: string, value: string) => (
    <div>
      <div style={{ fontFamily: th.fontMono, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: th.textFaint }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 600, color: th.text }}>{value}</div>
    </div>
  );

  // --- Actions modale ---
  const openRes = (rv: ClubReservation) => { setSelected(rv); setConfirmCancel(false); setError(null); };

  const changeType = async (t: ReservationType) => {
    if (!token || !clubId || !selected) return;
    setBusy(true);
    try { setError(null); await api.adminSetReservationType(clubId, selected.id, t, token); setSelected({ ...selected, type: t }); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const doCancel = async () => {
    if (!token || !clubId || !selected) return;
    setBusy(true);
    try { setError(null); await api.adminCancelReservation(clubId, selected.id, token); setSelected(null); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const cancelSeries = async () => {
    if (!token || !clubId || !selected?.seriesId) return;
    if (!confirm('Annuler toutes les séances FUTURES de cette série ? Le passé est conservé.')) return;
    setBusy(true);
    try {
      setError(null);
      const res = await api.adminCancelSeries(clubId, selected.seriesId, token);
      alert(`${res.cancelled} séance(s) future(s) annulée(s).`);
      setSelected(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  // Création à la volée + sélection (formulaire de création de résa) — la modale sélectionne
  // elle-même le membre créé via le champ `member` du résultat.
  const createForResa = async (body: CreateMemberBody) => {
    if (!token || !clubId) return { tempPassword: null, existed: false };
    const r = await api.adminCreateMember(clubId, body, token);
    const mem = await api.adminGetMembers(clubId, token);
    setMembers(mem);
    const created = mem.find((m) => m.email.toLowerCase() === body.email.toLowerCase());
    return { ...r, member: created };
  };

  const openCreate = (prefill?: CreateEventPrefill) => {
    setCreatePrefill(prefill);
    setError(null);
    setCreateOpen(true);
  };

  // Charge les résas d'un jour ≠ `date` (jour affiché sur la grille), pour que la modale garde
  // conflits/chips justes quand l'utilisateur choisit un autre jour dans le sélecteur.
  const loadReservationsForDate = useCallback(async (dateISO: string): Promise<ClubReservation[]> => {
    if (!token || !clubId) return [];
    const resv = await api.adminGetReservations(clubId, { date: dateISO }, token);
    return resv.reservations;
  }, [token, clubId]);

  const submitCreate = async (form: CreateEventFormState) => {
    if (!token || !clubId) return;
    if (!form.resourceId) { setError('Choisis un terrain.'); return; }
    const closeHour = resById.get(form.resourceId)?.closeHour ?? maxClose;
    const endTime = endTimeFrom(form.startTime, form.durationMin, closeHour);
    if (endTime <= form.startTime) { setError("La durée doit produire une fin après le début."); return; }
    setBusy(true);
    try {
      setError(null);
      const courseParams = (form.isCourse && form.type === 'COACHING')
        ? { coachId: form.coachId, capacity: Number(form.capacity), lessonKind: (Number(form.capacity) <= 1 ? 'INDIVIDUAL' : 'COLLECTIVE') as 'INDIVIDUAL' | 'COLLECTIVE', allowSelfEnroll: form.allowSelfEnroll }
        : null;
      if (form.recurring) {
        if (!form.endDate || form.endDate < form.date) { setError('La date de fin doit être après la date de début.'); setBusy(false); return; }
        const res = await api.adminCreateSeries(clubId, {
          resourceId: form.resourceId,
          type: form.type,
          title: form.title.trim() || undefined,
          weekday: weekdayOf(form.date),
          startLocal: form.startTime,
          durationMin: form.durationMin,
          startDate: form.date,
          endDate: form.endDate,
          ...(courseParams ? { ...courseParams, enrollmentMode: form.enrollMode } : {}),
        }, token);
        if (res.skipped.length > 0) {
          alert(`${res.created} séance(s) créée(s). ${res.skipped.length} ignorée(s) (créneau déjà pris).`);
        }
      } else {
        await api.adminCreateReservation(clubId, {
          resourceId: form.resourceId, date: form.date, startTime: form.startTime, endTime,
          type: form.type,
          title: form.title.trim() || undefined,
          memberUserId: form.member?.userId ?? undefined,
          price: form.price ? Number(form.price) : undefined,
          ...(courseParams ? { lessonParams: courseParams } : {}),
        }, token);
      }
      setCreateOpen(false);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div ref={rootRef} style={isFs ? { background: th.bg, padding: '22px 26px', minHeight: '100vh', overflow: 'auto' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 18px', flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>Planning du jour</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn type="button" icon="plus" onClick={() => openCreate()}>Ajouter</Btn>
          <button type="button" onClick={() => setCollapsed(!collapsed)} style={chromeBtn}>{collapsed ? 'Afficher le menu' : 'Masquer le menu'}</button>
          <button type="button" onClick={toggleFs} style={chromeBtn}>⛶ {isFs ? 'Quitter' : 'Plein écran'}</button>
        </div>
      </div>

      {/* barre : navigation jour + statistiques */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={() => setDate(shiftDate(date, -1))} aria-label="Jour précédent" style={arrow}>‹</button>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 17, color: th.text, textTransform: 'capitalize', lineHeight: 1.1 }}>{fmtDay(date)}</span>
            <div style={{ marginTop: 4 }}><DateField value={date} onChange={setDate} size="sm" /></div>
          </div>
          <button type="button" onClick={() => setDate(shiftDate(date, 1))} aria-label="Jour suivant" style={arrow}>›</button>
          {date !== todayISO() && (
            <button type="button" onClick={() => setDate(todayISO())} style={{ border: 'none', background: th.surface2, color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>Aujourd&apos;hui</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          {stat('Occupation', `${occupancy}%`)}
          {stat('Réservations', String(shown.length))}
          {stat('Reste dû', fmtEuros(outstandingCents))}
        </div>
      </div>

      {/* filtres par type (cliquer pour masquer/afficher) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {TYPE_ORDER.map((t) => {
          const off = hidden.has(t);
          const c = TYPE_META[t].color;
          return (
            <button key={t} type="button"
              onClick={() => setHidden((prev) => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                border: `1px solid ${off ? th.line : c}`, background: off ? 'transparent' : tint(c),
                borderRadius: 999, padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
                color: off ? th.textFaint : th.text, opacity: off ? 0.6 : 1,
              }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />
              {TYPE_META[t].label}
            </button>
          );
        })}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, border: `1px dashed ${th.textMute}` }} /> en attente
        </span>
      </div>

      {error && <div style={{ marginBottom: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : resources.length === 0 ? (
        <div style={{ padding: '24px 0', fontFamily: th.fontUI, color: th.textMute }}>Aucun terrain actif.</div>
      ) : (
        <>
        <div ref={gridRef} style={{ borderRadius: 18, background: th.surface, boxShadow: `inset 0 0 0 1px ${th.line}`, overflow: 'auto', maxHeight: isFs ? 'calc(100vh - 190px)' : 'calc(100vh - 300px)' }}>
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `${TIME_W}px repeat(${resources.length}, minmax(${COL_MIN_W}px, 1fr))`, minWidth: '100%' }}>
            {/* coin + en-têtes terrains (sticky en haut) */}
            <div style={{ position: 'sticky', top: 0, left: 0, zIndex: 11, background: th.surface, height: HEADER_H, boxSizing: 'border-box', borderBottom: `1px solid ${th.line}` }} />
            {resources.map((r) => (
              <div key={r.id} style={{ position: 'sticky', top: 0, zIndex: 10, background: th.surface, height: HEADER_H, boxSizing: 'border-box', borderLeft: `1px solid ${th.line}`, borderBottom: `1px solid ${th.line}`, padding: '0 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
                <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.name}
                  {courtFormat(typeof r.attributes?.format === 'string' ? r.attributes.format : undefined) && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: SINGLE_COLOR }}>Single</span>
                  )}
                </span>
                <span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>{Number(r.price)}€ / créneau</span>
              </div>
            ))}

            {/* gouttière des heures (sticky à gauche) */}
            <div style={{ position: 'sticky', left: 0, zIndex: 5, background: th.surface, height: hours.length * HOUR_H }}>
              {hours.map((h, i) => (
                <div key={h} style={{ position: 'absolute', top: i * HOUR_H + 4, right: 8, fontFamily: th.fontMono, fontSize: 11, color: th.textFaint }}>{String(h).padStart(2, '0')}:00</div>
              ))}
            </div>

            {/* une colonne par terrain */}
            {resources.map((r) => {
              const ghost = dragGhostFor(drag, r.id);
              return (
              <div key={r.id} data-resource-id={r.id}
                onMouseDown={(e) => startCreateDrag(e, r.id)}
                onClick={(e) => {
                  if (draggedRef.current) { draggedRef.current = false; return; }
                  if ((e.target as HTMLElement).closest('button')) return; // ne crée pas si on clique une réservation
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const h = Math.floor((e.clientY - rect.top) / HOUR_H) + minOpen;
                  openCreate({ resourceId: r.id, startHour: h });
                }}
                style={{ position: 'relative', height: hours.length * HOUR_H, boxSizing: 'border-box', borderLeft: `1px solid ${th.line}`, cursor: 'copy' }}>
                {hours.map((h, i) => i > 0 && (
                  <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: i * HOUR_H, height: 1, background: th.line }} />
                ))}
                {r.openHour > minOpen && (
                  <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 1, top: 0, height: (r.openHour - minOpen) * HOUR_H, background: th.takenBg, backgroundImage: hatch }} />
                )}
                {r.closeHour < maxClose && (
                  <div style={{ position: 'absolute', left: 0, right: 0, zIndex: 1, top: (r.closeHour - minOpen) * HOUR_H, height: (maxClose - r.closeHour) * HOUR_H, background: th.takenBg, backgroundImage: hatch }} />
                )}
                {(byResource.get(r.id) ?? []).map((rv) => {
                  const s = Math.max(localMinutesOfDay(rv.startTime, tz), minOpen * 60);
                  let e = Math.min(localMinutesOfDay(rv.endTime, tz), maxClose * 60);
                  if (e <= s) e = maxClose * 60; // résa finissant après minuit : clampe à la fermeture
                  const top = ((s - minOpen * 60) / 60) * HOUR_H;
                  const height = Math.max(((e - s) / 60) * HOUR_H - 4, 26);
                  const small = height < 46;
                  const pend = rv.status === 'PENDING';
                  const cancelled = rv.status === 'CANCELLED';
                  const dragging = drag?.kind === 'move' && drag.reservationId === rv.id;
                  const c = TYPE_META[rv.type].color;
                  const due = dueOf(rv);
                  const dots = participantPastilles(rv, playersOf(rv), due);
                  return (
                    <button key={rv.id} type="button"
                      onMouseDown={(evt) => startBlockDrag(evt, rv, 'move', s, e)}
                      onMouseEnter={(evt) => { if (dots) scheduleHover(rv, dots, evt.currentTarget); }}
                      onMouseLeave={() => cancelHover(rv.id)}
                      onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } openRes(rv); }}
                      title={`${labelOf(rv)} · ${TYPE_META[rv.type].label} · ${fmtHM(rv.startTime, tz)}–${fmtHM(rv.endTime, tz)}`}
                      style={{
                        position: 'absolute', top: top + 2, left: 3, right: 3, height, boxSizing: 'border-box',
                        borderRadius: 9, padding: small ? '3px 8px' : '5px 8px', overflow: 'hidden', zIndex: 2, textAlign: 'left',
                        cursor: cancelled ? 'pointer' : 'grab',
                        background: tint(c), boxShadow: `inset 3px 0 0 ${c}`,
                        border: pend ? `1px dashed ${c}` : '1px solid transparent', opacity: dragging ? 0.3 : (pend ? 0.85 : 1),
                        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 2,
                      }}>
                      <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text, lineHeight: 1.15, display: '-webkit-box', WebkitLineClamp: small ? 1 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{labelOf(rv)}</span>
                      {!small && <span style={{ fontFamily: th.fontMono, fontSize: 10, color: th.textMute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pend ? 'attente · ' : ''}{fmtHM(rv.startTime, tz)}–{fmtHM(rv.endTime, tz)}</span>}
                      {dots && !small && <span style={{ marginTop: 'auto', display: 'flex' }}><PaymentInitials model={dots} /></span>}
                      {dots && small && (dots.settled
                        ? <span style={{ position: 'absolute', right: 5, bottom: 3, fontSize: 9, fontWeight: 700, color: SETTLED_COLOR, lineHeight: 1 }}>✓</span>
                        : dots.seats.some(Boolean) && <span style={{ position: 'absolute', right: 6, bottom: 4 }}><PaymentInitials model={dots} compact /></span>)}
                      {rv.hasCardFingerprint && (
                        <span title="Empreinte bancaire enregistrée" style={{ fontSize: 11, position: 'absolute', right: small ? 5 : 8, top: small ? 2 : 4 }}>💳</span>
                      )}
                      {!cancelled && !pend && (
                        <div aria-label="Étirer la durée"
                          onMouseDown={(evt) => { evt.stopPropagation(); startBlockDrag(evt, rv, 'resize', s, e); }}
                          onClick={(evt) => evt.stopPropagation()}
                          style={{ position: 'absolute', left: '25%', right: '25%', bottom: -3, height: 8, cursor: 'ns-resize' }} />
                      )}
                    </button>
                  );
                })}
                {ghost && (
                  <div style={{
                    position: 'absolute', zIndex: 3, pointerEvents: 'none', borderRadius: 9,
                    top: ((ghost.startMin - minOpen * 60) / 60) * HOUR_H + 2, left: 3, right: 3,
                    height: Math.max(((ghost.endMin - ghost.startMin) / 60) * HOUR_H - 4, 20),
                    background: ghost.conflict ? 'rgba(224,90,78,0.16)' : `${th.accent}26`,
                    boxShadow: `inset 0 0 0 2px ${ghost.conflict ? '#e05a4e' : th.accent}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontFamily: th.fontMono, fontSize: 11, fontWeight: 800, color: ghost.conflict ? '#e05a4e' : th.accent }}>
                      {fromMinutes(ghost.startMin)}–{fromMinutes(ghost.endMin)}
                    </span>
                  </div>
                )}
              </div>
              );
            })}

            {/* barre d'heure courante */}
            {nowVisible && (
              <div style={{ position: 'absolute', top: HEADER_H + nowTop, left: TIME_W, right: 0, height: 2, background: '#ff7a4d', zIndex: 6, pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', top: -3, left: -3, width: 8, height: 8, borderRadius: 4, background: '#ff7a4d' }} />
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12, fontFamily: th.fontUI, fontSize: 12.5, color: th.textFaint }}>{resources.length} terrain{resources.length > 1 ? 's' : ''} · {shown.length} réservation{shown.length > 1 ? 's' : ''} affichée{shown.length > 1 ? 's' : ''}</div>
        </>
      )}

      {hover && !drag && <TilePaymentPopover model={hover.model} anchor={hover.anchor} />}

      {/* modale détail réservation */}
      {selected && (
        <div onClick={() => setSelected(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: isDesktop ? 880 : 460, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: isDesktop ? 24 : 18, fontFamily: th.fontUI, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: isDesktop ? 22 : 19, color: th.text, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.resource.name}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 2 }}>
                  <span style={{ fontFamily: th.fontMono }}>{fmtHM(selected.startTime, tz)} – {fmtHM(selected.endTime, tz)}</span> · {STATUS_LABEL[selected.status]} · <span style={{ color: th.text, fontWeight: 600 }}>{labelOf(selected)}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, color: th.textMute, fontSize: 16, flexShrink: 0 }}>✕</button>
            </div>

            {error && (
              <div style={{ marginTop: 10, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
            )}
            {/* Bandeau d'état — reste à encaisser / soldé. Pour une résa active, l'en-tête de la
                caisse (CashRegister) l'affiche déjà → on ne le garde que pour une résa annulée. */}
            {selected.status === 'CANCELLED' && (() => {
              const dueC = dueOf(selected);
              const paidC = toCents(selected.paidAmount);
              const restC = Math.max(0, dueC - paidC);
              const pct = dueC > 0 ? Math.min(100, Math.round((paidC / dueC) * 100)) : 0;
              const done = dueC > 0 && restC <= 0;
              const tariff = toCents(selected.totalPrice) <= 0 && dueC > 0;
              return (
                <div style={{ marginTop: 10, borderRadius: 12, padding: '9px 13px',
                  background: done ? 'rgba(52,184,136,0.10)' : th.surface2,
                  boxShadow: `inset 0 0 0 1px ${done ? 'rgba(52,184,136,0.30)' : th.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>
                        {dueC <= 0 ? 'Encaissé' : done ? 'Statut' : 'Reste'}
                      </span>
                      {dueC <= 0 ? (
                        <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 22, letterSpacing: -0.5, lineHeight: 1, color: th.text }}>{fmtEuros(paidC)}</span>
                      ) : done ? (
                        <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, lineHeight: 1, color: SETTLED_COLOR }}>✓ Soldé</span>
                      ) : (
                        <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, letterSpacing: -0.5, lineHeight: 1, color: '#ff7a4d' }}>{fmtEuros(restC)}</span>
                      )}
                    </div>
                    {dueC > 0 && (
                      <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, whiteSpace: 'nowrap' }}>
                        Payé <b style={{ color: th.text }}>{fmtEuros(paidC)}</b> / {fmtEuros(dueC)}{tariff ? <span style={{ color: th.textFaint }}> (tarif)</span> : null}
                      </span>
                    )}
                  </div>
                  {dueC > 0 && (
                    <div style={{ marginTop: 7, height: 5, borderRadius: 999, background: th.surfaceHi, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: SETTLED_COLOR, transition: 'width .35s ease' }} />
                    </div>
                  )}
                </div>
              );
            })()}

            {/* choix du type — libellé en ligne pour gagner de la place */}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginRight: 2 }}>Type</span>
              {TYPE_ORDER.map((t) => {
                const on = selected.type === t;
                const c = TYPE_META[t].color;
                return (
                  <button key={t} type="button" disabled={busy} onClick={() => changeType(t)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: busy ? 'default' : 'pointer', border: `1.5px solid ${on ? c : th.line}`, background: on ? tint(c) : 'transparent', borderRadius: 9, padding: '5px 10px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: th.text }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />{TYPE_META[t].label}
                  </button>
                );
              })}
            </div>

            {selected.status !== 'CANCELLED' && (
              <div style={{ marginTop: 12 }}>
                {/* Encaissement type « Caisse » : on sélectionne les joueurs en cliquant la ligne,
                    puis un tap sur le moyen encaisse (optimiste + toast « Annuler »). Le lien
                    « Montant libre, reçu, historique » ouvre la modale Détails (CollectPanel). */}
                <CashRegister
                  reservation={selected}
                  players={playersOf(selected)}
                  due={dueOf(selected)}
                  members={members}
                  quickMethods={registerMethods}
                  packagesByUser={packagesByUser}
                  clubId={clubId!}
                  slug={club?.slug ?? ''}
                  token={token!}
                  isDesktop={isDesktop}
                  payAtClubOnly={clubDetail?.payAtClubOnly ?? false}
                  onChanged={onCollected}
                  onOptimisticPay={(intent) => applyPaymentLocally(selected.id, intent)}
                  onOptimisticRefund={(ids) => applyRefundLocally(selected.id, ids)}
                  onOpenDetails={() => setDetailsOpen(true)}
                  onCancel={() => setConfirmCancel(true)}
                  onError={(msg) => setError(msg)}
                />
              </div>
            )}

            {/* Encaissements enregistrés + reçu imprimable (cohérent modale page Encaissement). */}
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
                            ? <><span style={{ color: th.text, fontWeight: 600 }}>{who}</span> · {p.note || METHOD_LABEL[p.method]}</>
                            : <><span style={{ color: th.textFaint }}>Réservation</span> · {p.note || METHOD_LABEL[p.method]}</>}
                        </span>
                        <span style={{ fontFamily: th.fontMono, fontSize: 12, color: th.textFaint }}>{fmtHM(p.createdAt, tz)}</span>
                        {toCents(p.amount) - toCents(p.refundedAmount ?? '0') > 0 && (
                          <button type="button" disabled={busy} onClick={() => cancelPayment(p)}
                            style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, textDecoration: 'underline', padding: '0 4px' }}>annuler</button>
                        )}
                        <button type="button" onClick={() => setReceiptTarget({ payment: p, rv: selected })} style={{ border: 'none', boxShadow: `inset 0 0 0 1px ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 9, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600 }}>Reçu</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* élèves (cours) */}
            {selected.lesson?.id && selected.status !== 'CANCELLED' && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${th.line}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginBottom: 8 }}>
                  Élèves {capacityLabel(students.filter((s) => s.status === 'CONFIRMED').length, selected.lesson.capacity)}
                </div>
                {students.length === 0 && (
                  <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginBottom: 8 }}>Aucun élève inscrit.</div>
                )}
                {students.filter((s) => s.status !== 'CANCELLED').map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '6px 10px', borderRadius: 9, background: th.surface2 }}>
                    <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text, flex: 1 }}>
                      {s.firstName} {s.lastName}
                      {s.status === 'WAITLISTED' && (
                        <span style={{ color: th.textMute }}> · attente {s.waitlistPosition}</span>
                      )}
                    </span>
                    {s.status === 'WAITLISTED' && (
                      <button type="button" disabled={busy}
                        onClick={() => { setBusy(true); api.adminPromoteStudent(clubId!, selected.lesson!.id, s.id, token!).then(() => loadStudents(selected.lesson!.id)).catch(() => {}).finally(() => setBusy(false)); }}
                        style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 8, padding: '4px 10px', cursor: busy ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600 }}>
                        Promouvoir
                      </button>
                    )}
                    <button type="button" disabled={busy} aria-label={`Retirer ${s.firstName} ${s.lastName}`}
                      onClick={() => { setBusy(true); api.adminRemoveStudent(clubId!, selected.lesson!.id, s.id, token!).then(() => loadStudents(selected.lesson!.id)).catch(() => {}).finally(() => setBusy(false)); }}
                      style={{ border: 'none', background: 'transparent', cursor: busy ? 'default' : 'pointer', color: th.textMute, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                  </div>
                ))}
                <div style={{ marginTop: 8 }}>
                  <PlayerPicker
                    members={members}
                    value={null}
                    onSelect={(m) => {
                      setBusy(true);
                      api.adminEnrollStudent(clubId!, selected.lesson!.id, m.userId, token!)
                        .then(() => loadStudents(selected.lesson!.id))
                        .catch(() => {})
                        .finally(() => setBusy(false));
                    }}
                    onClear={() => {}}
                    onCreate={async (body) => {
                      const r = await api.adminCreateMember(clubId!, body, token!);
                      const mem = await api.adminGetMembers(clubId!, token!);
                      setMembers(mem);
                      const created = mem.find((mm) => mm.email.toLowerCase() === body.email.toLowerCase());
                      if (created) {
                        setBusy(true);
                        await api.adminEnrollStudent(clubId!, selected.lesson!.id, created.userId, token!)
                          .then(() => loadStudents(selected.lesson!.id))
                          .catch(() => {})
                          .finally(() => setBusy(false));
                      }
                      return r;
                    }}
                    placeholder="+ Ajouter un élève…"
                  />
                </div>
              </div>
            )}

            {/* Annulation — le déclencheur « Annuler la réservation » est dans le pied de la caisse
                (onCancel → confirmCancel). Ici : la confirmation, et l'annulation de série si besoin. */}
            {selected.status !== 'CANCELLED' && (confirmCancel || selected.seriesId) && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${th.line}` }}>
                {confirmCancel ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text }}>Confirmer l&apos;annulation ?</span>
                    <button onClick={doCancel} disabled={busy} style={{ border: 'none', background: '#ff7a4d', color: '#fff', borderRadius: 9, padding: '7px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{busy ? '…' : 'Oui, annuler'}</button>
                    <button onClick={() => setConfirmCancel(false)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5 }}>Retour</button>
                  </div>
                ) : (
                  <button type="button" onClick={cancelSeries} disabled={busy}
                    style={{ border: '1px solid #ff7a4d', background: 'transparent', color: '#ff7a4d', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>
                    Annuler toute la série
                  </button>
                )}
              </div>
            )}

            {/* no-show charge */}
            {selected.hasCardFingerprint && selected.status !== 'CANCELLED' && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${th.line}` }}>
                <button onClick={() => setNoShowTarget(selected.id)}
                  style={{ border: '1px solid #ff7a4d', background: 'transparent', color: '#ff7a4d', borderRadius: 9, padding: '7px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>
                  💳 Facturer no-show
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modale « Détails / options » (au-dessus de la caisse) : montant libre, par joueur,
          Ticket CE avec référence, carnet/porte-monnaie, règlements sans encaissement. */}
      {detailsOpen && selected && (
        <div onClick={() => setDetailsOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 58, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: isDesktop ? 880 : 460, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: isDesktop ? 24 : 18, fontFamily: th.fontUI, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 18, color: th.text }}>Détails · options</div>
              <button onClick={() => setDetailsOpen(false)} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, color: th.textMute, fontSize: 16 }}>✕</button>
            </div>
            <CollectPanel
              reservation={selected}
              due={dueOf(selected)}
              players={playersOf(selected)}
              members={members}
              quickMethods={quickMethods}
              packagesByUser={packagesByUser}
              collectEmptyPlaces
              settlementPresets={SETTLEMENT_PRESETS}
              subscribedUserIds={subscribedIds}
              columns={isDesktop}
              payAtClubOnly={clubDetail?.payAtClubOnly ?? false}
              clubId={clubId!}
              token={token!}
              onChanged={onCollected}
              onError={(msg) => setError(msg)}
            />
          </div>
        </div>
      )}

      {noShowTarget && selected && (
        <NoShowChargeModal
          clubId={clubId ?? ''}
          reservationId={noShowTarget}
          defaultAmount={Math.max(0, Number(selected.totalPrice) - Number(selected.paidAmount))}
          token={token ?? ''}
          onSuccess={() => { setNoShowTarget(null); load(); }}
          onClose={() => setNoShowTarget(null)}
        />
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

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 55, width: 'min(360px, calc(100vw - 32px))', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, background: th.text, color: th.bg, borderRadius: 12, padding: '11px 16px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, boxShadow: th.shadow }}>
          <span style={{ flex: 1 }}>✓ {toast.label}</span>
          <button type="button" onClick={undoReschedule}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: 0 }}>Annuler</button>
        </div>
      )}

      <CreateEventModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setError(null); }}
        resources={resources}
        members={members}
        coaches={coaches}
        reservationsOfDay={reservations}
        gridDate={date}
        peak={peak}
        tz={tz}
        prefill={createPrefill}
        busy={busy}
        error={error}
        onSubmit={submitCreate}
        createForResa={createForResa}
        loadReservationsForDate={loadReservationsForDate}
      />
    </div>
  );
}
