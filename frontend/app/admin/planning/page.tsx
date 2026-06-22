'use client';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { api, AdminResource, ClubReservation, ReservationType, OffPeakHours, Member, CreateMemberBody, Coach, LessonStudent } from '@/lib/api';
import { capacityLabel } from '@/lib/lessons';
import { courtFormat, playerCount, SINGLE_COLOR } from '@/lib/courtType';
import { toCents, dueCents, fmtEuros, paymentDots } from '@/lib/caisse';
import { effectiveDurations, defaultDuration, endTimeFrom } from '@/lib/duration';
import { PaymentDots, SETTLED_COLOR } from '@/components/admin/PaymentDots';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { CollectPanel } from '@/components/admin/CollectPanel';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useAdminChrome } from '../layout';
import { Btn } from '@/components/ui/atoms';
import NoShowChargeModal from '@/components/admin/NoShowChargeModal';
import { TimePicker } from '@/components/ui/TimePicker';
import { DateField } from '@/components/ui/DateField';

const TYPE_META: Record<ReservationType, { label: string; color: string }> = {
  COURT:      { label: 'Terrain',   color: '#5e93da' },
  COACHING:   { label: 'Coaching',  color: '#34b888' },
  TOURNAMENT: { label: 'Tournoi',   color: '#f0913c' },
  EVENT:      { label: 'Événement', color: '#a98bf0' },
};
const TYPE_ORDER: ReservationType[] = ['COURT', 'COACHING', 'TOURNAMENT', 'EVENT'];
const STATUS_LABEL: Record<string, string> = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };
// Dimensions de la grille verticale (terrains en colonnes, heures en lignes).
const HOUR_H = 68, TIME_W = 56, COL_MIN_W = 120, HEADER_H = 52;

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

// Minutes locales (fuseau du club) depuis minuit pour un instant ISO.
function localMinutes(iso: string, tz: string): number {
  const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
  const [h, m] = f.split(':').map(Number);
  return h * 60 + m;
}

function nowMinutes(tz: string): number {
  const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date());
  const [h, m] = f.split(':').map(Number);
  return h * 60 + m;
}

function fmtHM(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

// weekday Luxon (1=lundi..7=dimanche) depuis une date "YYYY-MM-DD".
function weekdayOf(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const js = d.getUTCDay(); // 0=dimanche..6=samedi
  return js === 0 ? 7 : js;
}
// durée en minutes entre deux "HH:mm" (>0 supposé, validé à la soumission).
function durationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
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
  const [resources, setResources] = useState<AdminResource[]>([]);
  const [reservations, setRes]    = useState<ClubReservation[]>([]);
  const [date, setDate]           = useState(todayISO());
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [hidden, setHidden]       = useState<Set<ReservationType>>(new Set());
  const [selected, setSelected]   = useState<ClubReservation | null>(null);
  const [busy, setBusy]           = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [noShowTarget, setNoShowTarget] = useState<string | null>(null);
  const [isFs, setIsFs]           = useState(false);

  const [members, setMembers]   = useState<Member[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [cType, setCType]       = useState<ReservationType>('COURT'); // Terrain par défaut
  const [cResourceId, setCResId] = useState('');
  const [cDate, setCDate]       = useState(date);
  const [cStart, setCStart]     = useState('18:00');
  const [cEnd, setCEnd]         = useState('19:00');
  const [cTitle, setCTitle]     = useState('');
  const [cMember, setCMember] = useState<Member | null>(null);
  const [cPrice, setCPrice]     = useState('');
  const [cRecurring, setCRecurring] = useState(false);
  const [cEndDate, setCEndDate]     = useState('');
  const [cIsCourse, setCIsCourse]           = useState(false);
  const [cCoachId, setCCoachId]             = useState('');
  const [cCapacity, setCCapacity]           = useState('1');
  const [cAllowSelfEnroll, setCAllowSelfEnroll] = useState(false);
  const [cEnrollMode, setCEnrollMode]       = useState<'SERIES' | 'PER_SESSION'>('SERIES');
  const [coaches, setCoaches]               = useState<Coach[]>([]);
  const [students, setStudents]             = useState<LessonStudent[]>([]);

  const load = useCallback(async (): Promise<ClubReservation[]> => {
    if (!token || !clubId) return [] as ClubReservation[];
    setLoading(true);
    try {
      setError(null);
      const [c, res, resv, mem] = await Promise.all([
        api.adminGetClub(clubId, token),
        api.adminGetResources(clubId, token),
        api.adminGetReservations(clubId, { date }, token),
        api.adminGetMembers(clubId, token),
      ]);
      setTz(c.timezone);
      setPeak(c.offPeakHours ?? null);
      setResources(res.filter((r) => r.isActive));
      setRes(resv.reservations);
      setMembers(mem);
      api.adminListCoaches(clubId, token).then((cs) => setCoaches(cs.filter((c) => c.isActive))).catch(() => {});
      return resv.reservations;
    } catch (e) { setError((e as Error).message); return [] as ClubReservation[]; }
    finally { setLoading(false); }
  }, [token, clubId, date]);

  // Après une mutation du CollectPanel : recharge et garde la modale à jour.
  const refreshSelected = useCallback(async (updated?: ClubReservation) => {
    const list = await load();
    setSelected((cur) => (updated ?? (cur ? list.find((r) => r.id === cur.id) ?? cur : cur)));
  }, [load]);

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
  // Durée de créneau par défaut d'un terrain (durées du sport-de-club, 1h30 si proposée).
  const defaultDurOf = (rid: string) => {
    const r = resById.get(rid);
    return r ? defaultDuration(effectiveDurations(r.clubSport.durationsMin, r.clubSport.sport.defaultDurationsMin)) : 60;
  };

  // Stats (sur les réservations affichées).
  let openMin = 0, bookedMin = 0, outstandingCents = 0;
  for (const r of resources) openMin += (r.closeHour - r.openHour) * 60;
  for (const rv of shown) {
    const r = resources.find((x) => x.id === rv.resource.id);
    if (r) {
      const s = Math.max(localMinutes(rv.startTime, tz), r.openHour * 60);
      const e = Math.min(localMinutes(rv.endTime, tz), r.closeHour * 60);
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

  // Création à la volée + sélection (formulaire de création de résa).
  const createForResa = async (body: CreateMemberBody) => {
    if (!token || !clubId) return { tempPassword: null, existed: false };
    const r = await api.adminCreateMember(clubId, body, token);
    const mem = await api.adminGetMembers(clubId, token);
    setMembers(mem);
    const created = mem.find((m) => m.email.toLowerCase() === body.email.toLowerCase());
    if (created) setCMember(created);
    return r;
  };

  const openCreate = (prefill?: { resourceId?: string; startHour?: number }) => {
    const sh = Math.max(minOpen, Math.min(prefill?.startHour ?? minOpen, maxClose - 1));
    const rid = prefill?.resourceId ?? resources[0]?.id ?? '';
    const start = `${String(sh).padStart(2, '0')}:00`;
    setCType('COURT'); // Terrain par défaut (le cas le plus fréquent en caisse)
    setCResId(rid);
    setCDate(date);
    setCStart(start);
    setCEnd(endTimeFrom(start, defaultDurOf(rid), resById.get(rid)?.closeHour ?? maxClose));
    setCTitle(''); setCMember(null); setCPrice('');
    setError(null);
    setCRecurring(false);
    setCEndDate(date);
    setCIsCourse(false);
    setCCoachId('');
    setCCapacity('1');
    setCAllowSelfEnroll(false);
    setCEnrollMode('SERIES');
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!token || !clubId) return;
    if (!cResourceId) { setError('Choisis un terrain.'); return; }
    if (cEnd <= cStart) { setError("L'heure de fin doit être après le début."); return; }
    setBusy(true);
    try {
      setError(null);
      const courseParams = (cIsCourse && cType === 'COACHING')
        ? { coachId: cCoachId, capacity: Number(cCapacity), lessonKind: (Number(cCapacity) <= 1 ? 'INDIVIDUAL' : 'COLLECTIVE') as 'INDIVIDUAL' | 'COLLECTIVE', allowSelfEnroll: cAllowSelfEnroll }
        : null;
      if (cRecurring) {
        if (!cEndDate || cEndDate < cDate) { setError('La date de fin doit être après la date de début.'); setBusy(false); return; }
        const res = await api.adminCreateSeries(clubId, {
          resourceId: cResourceId,
          type: cType,
          title: cTitle.trim() || undefined,
          weekday: weekdayOf(cDate),
          startLocal: cStart,
          durationMin: durationMinutes(cStart, cEnd),
          startDate: cDate,
          endDate: cEndDate,
          ...(courseParams ? { ...courseParams, enrollmentMode: cEnrollMode } : {}),
        }, token);
        if (res.skipped.length > 0) {
          alert(`${res.created} séance(s) créée(s). ${res.skipped.length} ignorée(s) (créneau déjà pris).`);
        }
      } else {
        await api.adminCreateReservation(clubId, {
          resourceId: cResourceId, date: cDate, startTime: cStart, endTime: cEnd,
          type: cType,
          title: cTitle.trim() || undefined,
          memberUserId: cMember?.userId ?? undefined,
          price: cPrice ? Number(cPrice) : undefined,
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
            {resources.map((r) => (
              <div key={r.id}
                onClick={(e) => {
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
                  const s = Math.max(localMinutes(rv.startTime, tz), minOpen * 60);
                  let e = Math.min(localMinutes(rv.endTime, tz), maxClose * 60);
                  if (e <= s) e = maxClose * 60; // résa finissant après minuit : clampe à la fermeture
                  const top = ((s - minOpen * 60) / 60) * HOUR_H;
                  const height = Math.max(((e - s) / 60) * HOUR_H - 4, 26);
                  const small = height < 46;
                  const pend = rv.status === 'PENDING';
                  const c = TYPE_META[rv.type].color;
                  const due = dueOf(rv);
                  const dots = paymentDots(rv, playersOf(rv), due);
                  return (
                    <button key={rv.id} type="button" onClick={() => openRes(rv)}
                      title={`${labelOf(rv)} · ${TYPE_META[rv.type].label} · ${fmtHM(rv.startTime, tz)}–${fmtHM(rv.endTime, tz)}${dots ? ` · payé ${fmtEuros(toCents(rv.paidAmount))} / ${fmtEuros(due)}` : ''}`}
                      style={{
                        position: 'absolute', top: top + 2, left: 3, right: 3, height, boxSizing: 'border-box',
                        borderRadius: 9, padding: small ? '3px 8px' : '5px 8px', overflow: 'hidden', zIndex: 2, textAlign: 'left', cursor: 'pointer',
                        background: tint(c), boxShadow: `inset 3px 0 0 ${c}`,
                        border: pend ? `1px dashed ${c}` : '1px solid transparent', opacity: pend ? 0.85 : 1,
                        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 2,
                      }}>
                      <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text, lineHeight: 1.15, display: '-webkit-box', WebkitLineClamp: small ? 1 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{labelOf(rv)}</span>
                      {!small && <span style={{ fontFamily: th.fontMono, fontSize: 10, color: th.textMute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pend ? 'attente · ' : ''}{fmtHM(rv.startTime, tz)}–{fmtHM(rv.endTime, tz)}</span>}
                      {dots && !small && <span style={{ marginTop: 'auto', display: 'flex' }}><PaymentDots dots={dots} color={c} /></span>}
                      {dots && small && (dots.settled
                        ? <span style={{ position: 'absolute', right: 5, bottom: 3, fontSize: 9, fontWeight: 700, color: SETTLED_COLOR, lineHeight: 1 }}>✓</span>
                        : dots.filled > 0 && <span style={{ position: 'absolute', right: 6, bottom: 5, width: 6, height: 6, borderRadius: '50%', background: c }} />)}
                      {rv.hasCardFingerprint && (
                        <span title="Empreinte bancaire enregistrée" style={{ fontSize: 11, position: 'absolute', right: small ? 5 : 8, top: small ? 2 : 4 }}>💳</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

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

      {/* modale détail réservation */}
      {selected && (
        <div onClick={() => setSelected(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: isDesktop ? 640 : 460, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: isDesktop ? 30 : 22, fontFamily: th.fontUI, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: isDesktop ? 26 : 21, color: th.text }}>{selected.resource.name}</div>
                <div style={{ fontFamily: th.fontMono, fontSize: isDesktop ? 14 : 13, color: th.textMute, marginTop: 2 }}>{fmtHM(selected.startTime, tz)} – {fmtHM(selected.endTime, tz)} · {STATUS_LABEL[selected.status]}</div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 32, height: 32, color: th.textMute, fontSize: 16 }}>✕</button>
            </div>

            {error && (
              <div style={{ marginTop: 14, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{ marginTop: 14, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              {labelOf(selected)}
              {selected.user && <div style={{ fontSize: 12.5, color: th.textFaint }}>{selected.user.email}</div>}
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 18, fontFamily: th.fontUI, fontSize: 13 }}>
              <span style={{ color: th.textMute }}>Total : <b style={{ color: th.text }}>{fmtEuros(dueOf(selected))}</b>{toCents(selected.totalPrice) <= 0 && dueOf(selected) > 0 ? <span style={{ color: th.textFaint }}> (tarif)</span> : null}</span>
              <span style={{ color: th.textMute }}>Payé : <b style={{ color: th.text }}>{fmtEuros(toCents(selected.paidAmount))}</b></span>
              <span style={{ color: th.textMute }}>Reste : <b style={{ color: '#ff7a4d' }}>{fmtEuros(Math.max(0, dueOf(selected) - toCents(selected.paidAmount)))}</b></span>
            </div>

            {/* choix du type */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginBottom: 8 }}>Type</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TYPE_ORDER.map((t) => {
                  const on = selected.type === t;
                  const c = TYPE_META[t].color;
                  return (
                    <button key={t} type="button" disabled={busy} onClick={() => changeType(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: busy ? 'default' : 'pointer', border: `1.5px solid ${on ? c : th.line}`, background: on ? tint(c) : 'transparent', borderRadius: 10, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{TYPE_META[t].label}
                    </button>
                  );
                })}
              </div>
            </div>

            {selected.status !== 'CANCELLED' && (
              <div style={{ marginTop: 16 }}>
                <CollectPanel
                  reservation={selected}
                  due={dueOf(selected)}
                  players={playersOf(selected)}
                  members={members}
                  clubId={clubId!}
                  token={token!}
                  onChanged={refreshSelected}
                  onPaid={() => setSelected(null)}
                  onError={(msg) => setError(msg)}
                />
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

            {/* annulation */}
            {selected.status !== 'CANCELLED' && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${th.line}` }}>
                {confirmCancel ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.text }}>Confirmer l&apos;annulation ?</span>
                    <button onClick={doCancel} disabled={busy} style={{ border: 'none', background: '#ff7a4d', color: '#fff', borderRadius: 9, padding: '7px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{busy ? '…' : 'Oui, annuler'}</button>
                    <button onClick={() => setConfirmCancel(false)} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5 }}>Retour</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={() => setConfirmCancel(true)} style={{ border: `1px solid ${th.line}`, background: 'transparent', color: '#ff7a4d', borderRadius: 9, padding: '7px 13px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>Annuler la réservation</button>
                    {selected.seriesId && (
                      <button type="button" onClick={cancelSeries} disabled={busy}
                        style={{ border: '1px solid #ff7a4d', background: 'transparent', color: '#ff7a4d', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>
                        Annuler toute la série
                      </button>
                    )}
                  </div>
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

      {createOpen && (
        <div onClick={() => { setCreateOpen(false); setError(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 460, background: th.surface, borderRadius: 18, boxShadow: th.shadow, padding: 22, fontFamily: th.fontUI, maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 21, color: th.text }}>Nouvel événement</div>
              <button onClick={() => { setCreateOpen(false); setError(null); }} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, color: th.textMute, fontSize: 16 }}>✕</button>
            </div>

            {error && (
              <div style={{ marginTop: 12, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginBottom: 8 }}>Type</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TYPE_ORDER.map((t) => {
                  const on = cType === t;
                  const c = TYPE_META[t].color;
                  return (
                    <button key={t} type="button" onClick={() => setCType(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', border: `1.5px solid ${on ? c : th.line}`, background: on ? tint(c) : 'transparent', borderRadius: 10, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{TYPE_META[t].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 }}>Terrain
                <select value={cResourceId}
                  onChange={(e) => {
                    const rid = e.target.value;
                    setCResId(rid);
                    // Réaligne la fin sur la durée de créneau par défaut du terrain choisi.
                    setCEnd(endTimeFrom(cStart, defaultDurOf(rid), resById.get(rid)?.closeHour ?? maxClose));
                  }}
                  style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 }}>
                  {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: th.textMute, marginBottom: 8 }}>Jour &amp; début</div>
                <TimePicker value={cStart} onChange={setCStart} presets={['08:00', '12:00', '18:00', '20:00']}
                  leading={<DateField value={cDate} onChange={setCDate} size="sm" />} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: th.textMute, marginBottom: 8 }}>Fin</div>
                <TimePicker value={cEnd} onChange={setCEnd} presets={['09:00', '13:00', '19:00', '21:00']} />
              </div>
            </div>

            <label style={{ marginTop: 12, fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Intitulé (optionnel)
              <input type="text" value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="Ex. Maintenance, Tournoi P100…" style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 }} />
            </label>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: th.textMute, marginBottom: 4 }}>Membre (optionnel)</div>
              <PlayerPicker
                members={members}
                value={cMember}
                onSelect={setCMember}
                onClear={() => setCMember(null)}
                onCreate={createForResa}
                placeholder="Cliquez pour voir les membres, ou tapez un nom…"
              />
            </div>

            {cType === 'COACHING' && (
              <div style={{ marginTop: 14, borderTop: `1px solid ${th.line}`, paddingTop: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' }}>
                  <input type="checkbox" checked={cIsCourse} onChange={(e) => setCIsCourse(e.target.checked)} />
                  Cours encadré (coach + élèves)
                </label>
                {cIsCourse && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Coach
                      <select value={cCoachId} onChange={(e) => setCCoachId(e.target.value)}
                        style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 }}>
                        <option value="">— choisir —</option>
                        {coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Capacité (élèves max)
                      <input type="number" min={1} value={cCapacity} onChange={(e) => setCCapacity(e.target.value)}
                        style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14, width: 90 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, color: th.text, cursor: 'pointer' }}>
                      <input type="checkbox" checked={cAllowSelfEnroll} onChange={(e) => setCAllowSelfEnroll(e.target.checked)} />
                      Ouvert à l&apos;auto-inscription des joueurs
                    </label>
                    {cRecurring && (
                      <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Inscription
                        <select value={cEnrollMode} onChange={(e) => setCEnrollMode(e.target.value as 'SERIES' | 'PER_SESSION')}
                          style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 }}>
                          <option value="SERIES">À la série (trimestre)</option>
                          <option value="PER_SESSION">Séance par séance</option>
                        </select>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 14, borderTop: `1px solid ${th.line}`, paddingTop: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={cRecurring} onChange={(e) => setCRecurring(e.target.checked)} />
                Répéter chaque semaine
              </label>
              {cRecurring && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: th.textMute, marginBottom: 6 }}>
                    Tous les <strong style={{ color: th.text }}>{['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][weekdayOf(cDate) - 1]}s</strong> à {cStart}, jusqu&apos;au :
                  </div>
                  <DateField value={cEndDate} onChange={setCEndDate} size="sm" />
                  <div style={{ fontSize: 11.5, color: th.textMute, marginTop: 6 }}>Le membre et le prix ne s&apos;appliquent pas à une série.</div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 }}>Prix €
                <input type="number" min={0} step="0.5" value={cPrice} onChange={(e) => setCPrice(e.target.value)} placeholder="0" style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14, width: 90 }} />
              </label>
              <div style={{ flex: 1 }} />
              <Btn type="button" icon="check" onClick={submitCreate} disabled={busy || (cIsCourse && !cCoachId)}>{busy ? '…' : 'Créer'}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
