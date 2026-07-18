'use client';
import { useEffect, useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { AdminResource, ClubReservation, Coach, CreateMemberBody, Member, ReservationType } from '@/lib/api';
import { effectiveDurations, defaultDuration, endTimeFrom } from '@/lib/duration';
import { tariffCents, fmtEuros } from '@/lib/caisse';
import {
  parseTimeInput, toMinutes, fromMinutes, findOverlap, smartChips, localMinutesOfDay, weekdayOf, BusySlot,
} from '@/lib/planningTime';
import { TYPE_META, TYPE_ORDER } from '@/lib/reservationType';
import { PlayerPicker } from '@/components/admin/PlayerPicker';
import { CoachPicker } from '@/components/admin/planning/CoachPicker';
import { DateField } from '@/components/ui/DateField';
import { Btn } from '@/components/ui/atoms';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

const WEEKDAY_NOUNS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const DURATION_CHIPS: { label: string; min: number }[] = [
  { label: '1h', min: 60 }, { label: '1h30', min: 90 }, { label: '2h', min: 120 },
];

/** Ce que la modale émet à la soumission — la composition du body API reste dans la page. */
export interface CreateEventFormState {
  type: ReservationType;
  resourceId: string;
  date: string;
  startTime: string;
  durationMin: number;
  title: string;
  member: Member | null;
  price: string;
  recurring: boolean;
  endDate: string;
  isCourse: boolean;
  coachId: string;
  capacity: string;
  allowSelfEnroll: boolean;
  enrollMode: 'SERIES' | 'PER_SESSION';
}

export interface CreateEventPrefill {
  resourceId?: string;
  /** Heure de début pleine (clic simple sur la grille). Ignoré si startTime fourni. */
  startHour?: number;
  /** Heure de début précise "HH:MM" (glisser-créer). Prioritaire sur startHour. */
  startTime?: string;
  durationMin?: number;
}

export interface CreateEventModalProps {
  open: boolean;
  onClose: () => void;
  resources: AdminResource[];
  members: Member[];
  coaches: Coach[];
  /** Réservations du jour affiché sur la grille (`gridDate`) — sert aux conflits + chips. */
  reservationsOfDay: ClubReservation[];
  gridDate: string;
  peak: import('@/lib/api').OffPeakHours | null;
  tz: string;
  prefill?: CreateEventPrefill;
  busy: boolean;
  error: string | null;
  onSubmit: (form: CreateEventFormState) => void;
  createForResa: (body: CreateMemberBody) => Promise<{ tempPassword: string | null; existed: boolean; member?: Member }>;
  /** Charge les résas d'un jour ≠ gridDate pour garder conflits/chips justes. Optionnel. */
  loadReservationsForDate?: (dateISO: string) => Promise<ClubReservation[]>;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

export function CreateEventModal({
  open, onClose, resources, members, coaches, reservationsOfDay, gridDate, peak, tz,
  prefill, busy, error, onSubmit, createForResa, loadReservationsForDate,
}: CreateEventModalProps) {
  const { th } = useTheme();
  const resById = new Map(resources.map((r) => [r.id, r]));
  const minOpen = resources.length ? Math.min(...resources.map((r) => r.openHour)) : 8;
  const maxClose = resources.length ? Math.max(...resources.map((r) => r.closeHour)) : 22;
  const defaultDurOf = (rid: string) => {
    const r = resById.get(rid);
    return r ? defaultDuration(effectiveDurations(r.clubSport.durationsMin, r.clubSport.sport.defaultDurationsMin)) : 60;
  };

  const [type, setType]             = useState<ReservationType>('COURT');
  const [resourceId, setResourceId] = useState('');
  const [date, setDate]             = useState(gridDate);
  const [startTime, setStartTime]   = useState('08:00');
  const [startInput, setStartInput] = useState('08:00');
  const [durationMin, setDurationMin] = useState(60);
  const [customDuration, setCustomDuration] = useState(false);
  const [title, setTitle]           = useState('');
  const [member, setMember]         = useState<Member | null>(null);
  const [price, setPrice]           = useState('');
  const [recurring, setRecurring]   = useState(false);
  const [endDate, setEndDate]       = useState(gridDate);
  const [isCourse, setIsCourse]         = useState(false);
  const [coachId, setCoachId]           = useState('');
  const [capacity, setCapacity]         = useState('1');
  const [allowSelfEnroll, setAllowSelfEnroll] = useState(false);
  const [enrollMode, setEnrollMode]     = useState<'SERIES' | 'PER_SESSION'>('SERIES');
  const [otherDayReservations, setOtherDayReservations] = useState<ClubReservation[] | null>(null);

  // Réinitialise le formulaire à chaque ouverture, depuis le préremplissage (clic grille / drag).
  useEffect(() => {
    if (!open) return;
    const rid = prefill?.resourceId ?? resources[0]?.id ?? '';
    const sh = Math.max(minOpen, Math.min(prefill?.startHour ?? minOpen, maxClose - 1));
    const start = prefill?.startTime ?? `${pad(sh)}:00`;
    const dur = prefill?.durationMin ?? defaultDurOf(rid);
    setType('COURT');
    setResourceId(rid);
    setDate(gridDate);
    setStartTime(start);
    setStartInput(start);
    setDurationMin(dur);
    setCustomDuration(!DURATION_CHIPS.some((d) => d.min === dur));
    setTitle(''); setMember(null); setPrice('');
    setRecurring(false); setEndDate(gridDate);
    setIsCourse(false); setCoachId(''); setCapacity('1'); setAllowSelfEnroll(false); setEnrollMode('SERIES');
    setOtherDayReservations(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Le champ affiché suit startTime (chips, changement de terrain…) tant qu'on ne tape pas.
  useEffect(() => { setStartInput(startTime); }, [startTime]);

  // Jour choisi ≠ jour de la grille : recharge les résas de ce jour pour garder conflit/chips justes.
  useEffect(() => {
    if (!open || date === gridDate) { setOtherDayReservations(null); return; }
    if (!loadReservationsForDate) { setOtherDayReservations([]); return; }
    let alive = true;
    loadReservationsForDate(date).then((list) => { if (alive) setOtherDayReservations(list); }).catch(() => { if (alive) setOtherDayReservations([]); });
    return () => { alive = false; };
  }, [open, date, gridDate, loadReservationsForDate]);

  if (!open) return null;

  const resource = resById.get(resourceId);
  const closeHour = resource?.closeHour ?? maxClose;
  const openMin = (resource?.openHour ?? minOpen) * 60;
  const closeMin = closeHour * 60;
  const endTime = endTimeFrom(startTime, durationMin, closeHour);

  const dayReservations = date === gridDate ? reservationsOfDay : (otherDayReservations ?? []);
  const busySlots: BusySlot[] = dayReservations
    .filter((rv) => rv.status !== 'CANCELLED')
    .map((rv) => {
      const s = localMinutesOfDay(rv.startTime, tz);
      let e = localMinutesOfDay(rv.endTime, tz);
      if (e <= s) e = 24 * 60;
      return { id: rv.id, resourceId: rv.resource.id, startMin: s, endMin: e };
    });

  const startMin = toMinutes(startTime);
  const conflictSlot = resourceId ? findOverlap(busySlots, resourceId, startMin, durationMin) : null;
  const conflictResa = conflictSlot ? dayReservations.find((rv) => rv.id === conflictSlot.id) : null;
  const conflictLabel = conflictResa
    ? (conflictResa.title?.trim() || (conflictResa.user ? `${conflictResa.user.firstName} ${conflictResa.user.lastName}` : 'Événement'))
    : '';

  const today = new Date().toISOString().slice(0, 10);
  const nowMin = date === today ? localMinutesOfDay(new Date().toISOString(), tz) : null;
  const chips = resourceId
    ? smartChips({ nowMin, fromMin: startMin, openMin, closeMin, durationMin, busy: busySlots, resourceId })
    : [];

  // Prix suggéré : ne dépend que du jour de semaine / heure LOCALE, jamais d'une conversion tz
  // réelle (la résa n'existe pas encore) — tz='UTC' avec des minuits factices traite les
  // horaires locaux tels quels, exactement comme `tariffCents` le ferait avec le vrai fuseau.
  const suggestedCents = resource
    ? tariffCents(`${date}T${startTime}:00.000Z`, `${date}T${endTime}:00.000Z`, 'UTC', peak, resource.price, resource.offPeakPrice)
    : 0;

  const commitStartInput = () => {
    const parsed = parseTimeInput(startInput);
    if (parsed) setStartTime(parsed); else setStartInput(startTime);
  };

  const handleResourceChange = (rid: string) => {
    setResourceId(rid);
    const def = defaultDurOf(rid);
    if (!customDuration) { setDurationMin(def); }
  };

  const handleCreateMember = async (body: CreateMemberBody) => {
    const r = await createForResa(body);
    if (r.member) setMember(r.member);
    return r;
  };

  const canSubmit = !busy && !!resourceId && !conflictSlot && !(isCourse && !coachId);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      type, resourceId, date, startTime, durationMin, title, member, price,
      recurring, endDate, isCourse, coachId, capacity, allowSelfEnroll, enrollMode,
    });
  };

  const label: CSSProperties = { fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 };
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 };
  const chip = (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? th.accent : th.line}`, background: active ? th.accent : th.surface2,
    color: active ? th.onAccent : th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
    fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
  });

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 700, background: th.surface, borderRadius: 20, boxShadow: th.shadow, overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 21, color: th.text }}>Nouvel événement</div>
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, color: th.textMute, fontSize: 16 }}>✕</button>
        </div>

        {error && (
          <div style={{ ...dangerBanner(th), margin: '12px 22px 0' }}>{error}</div>
        )}

        <div className="pl-create-grid" style={{ padding: 22, overflow: 'auto' }}>
          {/* ── Colonne formulaire ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: th.textMute, marginBottom: 8 }}>Type</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TYPE_ORDER.map((t) => {
                  const on = type === t;
                  const c = TYPE_META[t].color;
                  return (
                    <button key={t} type="button" onClick={() => setType(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', border: `1.5px solid ${on ? c : th.line}`, background: on ? `${c}1f` : 'transparent', borderRadius: 10, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{TYPE_META[t].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...label, flex: 1, minWidth: 140 }}>Terrain
                <select value={resourceId} onChange={(e) => handleResourceChange(e.target.value)} style={input}>
                  {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label style={{ ...label, minWidth: 140 }}>Jour
                <DateField value={date} onChange={setDate} size="sm" />
              </label>
            </div>

            <div>
              <div style={label}>Début</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <input
                  aria-label="Heure de début"
                  inputMode="numeric"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  onBlur={commitStartInput}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  style={{ ...input, width: 90, fontFamily: th.fontMono, fontSize: 22, fontWeight: 700, textAlign: 'center' }}
                />
              </div>
              {chips.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {chips.map((c) => (
                    <button key={c.key} type="button" onClick={() => setStartTime(fromMinutes(c.startMin))}
                      style={chip(startMin === c.startMin)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={label}>Durée</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {DURATION_CHIPS.map((d) => (
                  <button key={d.min} type="button" aria-pressed={durationMin === d.min && !customDuration}
                    onClick={() => { setDurationMin(d.min); setCustomDuration(false); }}
                    style={chip(durationMin === d.min && !customDuration)}>{d.label}</button>
                ))}
                <button type="button" aria-pressed={customDuration} onClick={() => setCustomDuration(true)} style={chip(customDuration)}>Autre…</button>
              </div>
              {customDuration && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => setDurationMin((d) => Math.max(30, d - 15))} style={{ ...input, cursor: 'pointer', padding: '4px 10px' }}>−15</button>
                  <span style={{ fontFamily: th.fontMono, fontSize: 14, color: th.text }}>{durationMin} min</span>
                  <button type="button" onClick={() => setDurationMin((d) => d + 15)} style={{ ...input, cursor: 'pointer', padding: '4px 10px' }}>+15</button>
                </div>
              )}
            </div>

            <label style={label}>Intitulé (optionnel)
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Maintenance, Tournoi P100…" style={input} />
            </label>

            <div>
              <div style={{ ...label, marginBottom: 4 }}>Membre (optionnel)</div>
              <PlayerPicker
                members={members}
                value={member}
                onSelect={setMember}
                onClear={() => setMember(null)}
                onCreate={handleCreateMember}
                placeholder="Cliquez pour voir les membres, ou tapez un nom…"
              />
            </div>

            {type === 'COACHING' && (
              <div style={{ borderTop: `1px solid ${th.line}`, paddingTop: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isCourse} onChange={(e) => setIsCourse(e.target.checked)} />
                  Cours encadré (coach + élèves)
                </label>
                {isCourse && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div style={{ ...label, marginBottom: 4 }}>Coach</div>
                      <CoachPicker
                        coaches={coaches}
                        value={coaches.find((c) => c.id === coachId) ?? null}
                        onSelect={(c) => setCoachId(c.id)}
                        onClear={() => setCoachId('')}
                      />
                    </div>
                    <label style={label}>Capacité (élèves max)
                      <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} style={{ ...input, width: 90 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, color: th.text, cursor: 'pointer' }}>
                      <input type="checkbox" checked={allowSelfEnroll} onChange={(e) => setAllowSelfEnroll(e.target.checked)} />
                      Ouvert à l&apos;auto-inscription des joueurs
                    </label>
                    {recurring && (
                      <label style={label}>Inscription
                        <select value={enrollMode} onChange={(e) => setEnrollMode(e.target.value as 'SERIES' | 'PER_SESSION')} style={input}>
                          <option value="SERIES">À la série (trimestre)</option>
                          <option value="PER_SESSION">Séance par séance</option>
                        </select>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ borderTop: `1px solid ${th.line}`, paddingTop: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, cursor: 'pointer' }}>
                <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
                Répéter chaque semaine
              </label>
              {recurring && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: th.textMute, marginBottom: 6 }}>
                    Tous les <strong style={{ color: th.text }}>{WEEKDAY_NOUNS[weekdayOf(date) - 1]}s</strong> à {startTime}, jusqu&apos;au :
                  </div>
                  <DateField value={endDate} onChange={setEndDate} size="sm" />
                  <div style={{ fontSize: 11.5, color: th.textMute, marginTop: 6 }}>Le membre et le prix ne s&apos;appliquent pas à une série.</div>
                </div>
              )}
            </div>
          </div>

          {/* ── Colonne récap vivant ── */}
          <div className="pl-create-recap" style={{ background: HERO_GRADIENT, borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: HERO_INK_MUTED }}>Sur le planning</div>
            <div style={{ background: th.surface, borderRadius: 10, padding: '12px 14px', boxShadow: `inset 3px 0 0 ${TYPE_META[type].color}` }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>{resource?.name ?? '—'}</div>
              <div style={{ fontFamily: th.fontMono, fontSize: 16, fontWeight: 700, color: th.accent, marginTop: 2 }}>{startTime} → {endTime}</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 2 }}>{date} · {durationMin} min</div>
            </div>

            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: conflictSlot ? '#c0392b' : HERO_INK }}>
              {conflictSlot ? `⚠ Chevauche ${conflictLabel}` : 'Créneau libre ✓'}
            </div>

            {type === 'COURT' && resource && (
              <label style={{ fontSize: 12, color: HERO_INK_MUTED, display: 'flex', flexDirection: 'column', gap: 4 }}>
                Prix suggéré {fmtEuros(suggestedCents)}
                <input type="number" min={0} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)}
                  placeholder={String(suggestedCents / 100)}
                  style={{ border: `1px solid ${th.line}`, background: th.surface, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14, width: 100 }} />
              </label>
            )}

            {recurring && (
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: HERO_INK_MUTED }}>
                Série tous les {WEEKDAY_NOUNS[weekdayOf(date) - 1]}s jusqu&apos;au {endDate}
              </div>
            )}

            <div style={{ flex: 1 }} />
            <Btn type="button" icon="check" onClick={handleSubmit} disabled={!canSubmit}>
              {busy ? '…' : recurring ? 'Créer la série' : "Créer l'événement"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
