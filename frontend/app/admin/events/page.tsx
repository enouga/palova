'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubEvent, AdminEventDetail, CreateEventBody, ClubEventKind } from '@/lib/api';
import { KIND_LABEL } from '@/lib/events';
import { localInputToISO, isoToLocalInput } from '@/lib/datetimeLocal';
import { shiftDatesToNextFuture } from '@/lib/duplicateAgenda';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { Icon } from '@/components/ui/Icon';
import { ACCENTS, dangerBanner } from '@/lib/theme';
import { formatDateShortTimeRange, waitlistPosition } from '@/lib/tournament';
import { groupAdminAgenda, agendaItemGroup } from '@/lib/adminAgenda';
import { AgendaAdminCard } from '@/components/admin/AgendaAdminCard';
import { AgendaAdminList } from '@/components/admin/AgendaAdminList';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RecurrenceFields, RecurrenceState } from '@/components/admin/events/RecurrenceFields';
import { SeriesManageDialog } from '@/components/admin/events/SeriesManageDialog';

const KINDS: ClubEventKind[] = ['MELEE', 'STAGE', 'SOIREE', 'INITIATION', 'AUTRE'];

const emptyForm = (): CreateEventBody => ({
  name: '', kind: 'MELEE', description: '', startTime: '', endTime: null,
  registrationDeadline: '', capacity: null, price: null, memberOnly: true,
  clubSportId: null, requirePrepayment: false,
});

export default function AdminEventsPage() {
  const { club } = useClub();
  const { token } = useAuth();
  const { th } = useTheme();
  const [list, setList] = useState<ClubEvent[]>([]);
  const [form, setForm] = useState<CreateEventBody | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stripeActive, setStripeActive] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClubEvent | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceState>({ weekday: 1, endDate: '', deadlineLeadHours: 4 });
  const [managingSeriesId, setManagingSeriesId] = useState<string | null>(null);

  useEffect(() => { setNow(new Date()); }, []);

  const reload = useCallback(() => {
    if (!club || !token) return;
    api.adminGetEvents(club.id, token).then(setList).catch(() => setList([]));
  }, [club?.id, token]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!club || !token) return;
    api.adminGetClub(club.id, token).then((c) => setStripeActive(c.stripeAccountStatus === 'ACTIVE')).catch(() => {});
  }, [club?.id, token]);

  if (!club || !token) return null;

  const save = async () => {
    if (!form) return;
    setError(null);
    try {
      if (!editingId && recurring) {
        if (!form.endTime) { setError("Une heure de fin est requise pour une animation récurrente (elle fixe la durée de chaque occurrence)."); return; }
        const durationMin = Math.round((new Date(form.endTime).getTime() - new Date(form.startTime).getTime()) / 60000);
        if (durationMin <= 0) { setError('La fin doit être après le début.'); return; }
        await api.adminCreateEventSeries(club.id, {
          name: form.name, kind: form.kind, description: form.description,
          capacity: form.capacity, price: form.price, memberOnly: form.memberOnly,
          requirePrepayment: form.requirePrepayment, clubSportId: form.clubSportId,
          weekday: recurrence.weekday, startLocal: form.startTime.slice(11, 16),
          durationMin, deadlineLeadMinutes: recurrence.deadlineLeadHours * 60,
          startDate: form.startTime.slice(0, 10), endDate: recurrence.endDate,
          status: 'PUBLISHED',
        }, token);
      } else {
        const body = { ...form, startTime: localInputToISO(form.startTime), registrationDeadline: localInputToISO(form.registrationDeadline), endTime: form.endTime ? localInputToISO(form.endTime) : null };
        if (editingId) await api.adminUpdateEvent(club.id, editingId, body, token);
        else await api.adminCreateEvent(club.id, body, token);
      }
      setForm(null); setEditingId(null); setRecurring(false); reload();
    } catch (e) { setError((e as Error).message); }
  };

  const extendSeries = async (seriesId: string, endDate: string) => {
    try { await api.adminExtendEventSeries(club.id, seriesId, endDate, token); setManagingSeriesId(null); reload(); }
    catch (e) { setError((e as Error).message); }
  };
  const cancelSeries = async (seriesId: string) => {
    try { await api.adminCancelEventSeries(club.id, seriesId, token); setManagingSeriesId(null); reload(); }
    catch (e) { setError((e as Error).message); }
  };

  const setStatus = async (id: string, status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED') => {
    setError(null);
    try { await api.adminUpdateEvent(club.id, id, { status }, token); reload(); }
    catch (e) { setError((e as Error).message); }
  };

  const removeEvent = async (id: string) => {
    setError(null);
    try { await api.adminDeleteEvent(club.id, id, token); reload(); }
    catch (e) { setError((e as Error).message); }
  };

  const startEdit = (e: ClubEvent) => {
    setEditingId(e.id);
    setForm({
      name: e.name, kind: e.kind, description: e.description ?? '',
      startTime: isoToLocalInput(e.startTime), endTime: e.endTime ? isoToLocalInput(e.endTime) : null,
      registrationDeadline: isoToLocalInput(e.registrationDeadline),
      capacity: e.capacity, price: e.price != null ? Number(e.price) : null, memberOnly: e.memberOnly,
      clubSportId: e.clubSportId ?? null, requirePrepayment: e.requirePrepayment ?? false,
    });
  };

  const startDuplicate = (ev: ClubEvent) => {
    setError(null);
    setEditingId(null);   // mode création : la sauvegarde empruntera adminCreateEvent
    setRecurring(false);  // un duplicata est un ponctuel, jamais une série
    const dates = shiftDatesToNextFuture(
      {
        startTime: isoToLocalInput(ev.startTime),
        endTime: ev.endTime ? isoToLocalInput(ev.endTime) : null,
        registrationDeadline: isoToLocalInput(ev.registrationDeadline),
      },
      new Date(),
    );
    setForm({
      name: `${ev.name} (copie)`, kind: ev.kind, description: ev.description ?? '',
      startTime: dates.startTime, endTime: dates.endTime, registrationDeadline: dates.registrationDeadline,
      capacity: ev.capacity, price: ev.price != null ? Number(ev.price) : null, memberOnly: ev.memberOnly,
      clubSportId: ev.clubSportId ?? null, requirePrepayment: (ev.requirePrepayment ?? false) && stripeActive,
    });
  };

  const openDetail = (id: string) =>
    api.adminGetEvent(club.id, id, token).then(setDetail).catch(() => setDetail(null));

  const removeReg = async (eventId: string, regId: string) => {
    await api.adminRemoveEventRegistration(club.id, eventId, regId, token);
    openDetail(eventId); reload();
  };
  const promoteReg = async (eventId: string, regId: string) => {
    await api.adminPromoteEventRegistration(club.id, eventId, regId, token);
    openDetail(eventId); reload();
  };

  const label = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 5, marginTop: 12 } as const;
  const input = { width: '100%', boxSizing: 'border-box' as const, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 10, padding: '9px 11px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const btn = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 10, padding: '10px 14px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14 };
  const ghost = { border: `1px solid ${th.line}`, cursor: 'pointer', background: 'transparent', color: th.textMute, borderRadius: 9, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 };
  const primarySm = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 9, padding: '7px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 };

  const renderCard = (e: ClubEvent) => {
    const key = agendaItemGroup(e.status, e.startTime, e.endTime, now!);
    const actions = (
      <>
        <button onClick={() => openDetail(e.id)} style={ghost}>Inscrits</button>
        <button onClick={() => startEdit(e)} style={ghost}>Modifier</button>
        <button onClick={() => startDuplicate(e)} style={ghost}>Dupliquer</button>
        {e.seriesId && <button onClick={() => setManagingSeriesId(e.seriesId!)} style={ghost}>Série…</button>}
        {(key === 'draft' || key === 'cancelled') && <button onClick={() => setStatus(e.id, 'PUBLISHED')} style={primarySm}>Publier</button>}
        {key === 'upcoming' && <button onClick={() => setStatus(e.id, 'DRAFT')} style={ghost}>Repasser en brouillon</button>}
        {key === 'upcoming' && <button onClick={() => setStatus(e.id, 'CANCELLED')} style={ghost}>Annuler</button>}
        {e.confirmedCount === 0 && e.waitlistCount === 0 && <button onClick={() => setPendingDelete(e)} style={ghost}>Supprimer</button>}
      </>
    );
    return (
      <AgendaAdminCard
        icon="bolt"
        accent={ACCENTS.cyan}
        stripe={key}
        faded={key === 'past' || key === 'cancelled'}
        tag={KIND_LABEL[e.kind]}
        title={e.name}
        dateLabel={formatDateShortTimeRange(e.startTime, e.endTime, club.timezone)}
        deadline={e.registrationDeadline}
        now={now}
        ratio={e.capacity != null && e.capacity > 0 ? Math.min(1, e.confirmedCount / e.capacity) : null}
        full={e.capacity != null && e.confirmedCount >= e.capacity}
        countLabel={`${e.confirmedCount}${e.capacity != null ? ` / ${e.capacity}` : ''} inscrits`}
        waitlist={e.waitlistCount}
        chips={[e.sport?.name ?? null, e.price != null ? `${Number(e.price)} €` : null, e.memberOnly ? 'Membres' : null, e.requirePrepayment ? 'CB en ligne' : null, e.seriesId ? 'Série' : null]}
        actions={actions}
        stackActions
      />
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0 }}>Events</h1>
        <button onClick={() => { setEditingId(null); setForm(emptyForm()); }} style={btn}><Icon name="plus" size={15} color={th.onAccent} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Nouvel event</button>
      </div>

      {error && (
        <div style={{ ...dangerBanner(th), marginBottom: 14 }}>{error}</div>
      )}

      {/* Formulaire création / édition */}
      {form && (
        <div style={{ background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow, marginBottom: 22 }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.text }}>{editingId ? "Modifier l'event" : 'Nouvel event'}</div>
          <div style={label}>Nom</div>
          <input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mêlée du vendredi" />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Type</div>
              <select style={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ClubEventKind })}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Sport (optionnel)</div>
              <select
                style={input}
                value={form.clubSportId ?? ''}
                onChange={(e) => setForm({ ...form, clubSportId: e.target.value || null })}
              >
                <option value="">Tous sports</option>
                {(club.clubSports ?? []).map((cs) => (
                  <option key={cs.id} value={cs.id}>{cs.sport.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Nb de places (vide = illimité)</div>
              <input type="number" min={1} style={input} value={form.capacity ?? ''} onChange={(e) => setForm({ ...form, capacity: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Prix (€, vide = gratuit)</div>
              <input type="number" min={0} step="0.01" style={input} value={form.price ?? ''} onChange={(e) => setForm({ ...form, price: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div style={{ flex: 1 }} />
          </div>
          <div style={label}>Début</div>
          <DateTimeField value={form.startTime} onChange={(v) => setForm({ ...form, startTime: v })} />
          <div style={label}>Fin (optionnel)</div>
          <DateTimeField value={form.endTime ?? ''} onChange={(v) => setForm({ ...form, endTime: v || null })} clearable />
          <div style={label}>Limite d&apos;inscription</div>
          <DateTimeField value={form.registrationDeadline} onChange={(v) => setForm({ ...form, registrationDeadline: v })} />
          <div style={label}>Description</div>
          <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.memberOnly ?? true} onChange={(e) => setForm({ ...form, memberOnly: e.target.checked })} />
            Réservé aux membres
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: stripeActive ? 'pointer' : 'default', fontFamily: th.fontUI, fontSize: 13.5, color: th.text, opacity: stripeActive ? 1 : 0.5 }}>
            <input type="checkbox" checked={form.requirePrepayment ?? false} disabled={!stripeActive}
              onChange={(e) => setForm({ ...form, requirePrepayment: e.target.checked })} />
            Inscription à régler en ligne (CB)
          </label>
          {!stripeActive && (
            <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 4 }}>
              Activez d&apos;abord le paiement en ligne dans{' '}
              <a href="/admin/payments" style={{ color: th.accent }}>Paiement en ligne →</a>
            </div>
          )}
          {!editingId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={recurring} onChange={(e) => {
                const checked = e.target.checked;
                setRecurring(checked);
                // Pré-coche le jour de la semaine du début déjà saisi (Luxon : 1=lundi … 7=dimanche).
                if (checked && form.startTime) {
                  const jsDay = new Date(form.startTime).getDay(); // 0=dimanche … 6=samedi (natif)
                  setRecurrence((r) => ({ ...r, weekday: jsDay === 0 ? 7 : jsDay }));
                }
              }} />
              Se répète chaque semaine
            </label>
          )}
          {!editingId && recurring && (
            <RecurrenceFields state={recurrence} onChange={setRecurrence} />
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={save} style={btn}>{editingId ? 'Enregistrer' : 'Créer (brouillon)'}</button>
            <button onClick={() => { setForm(null); setEditingId(null); }} style={ghost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Liste des events, groupée par statut */}
      <AgendaAdminList
        ready={now != null}
        groups={now ? groupAdminAgenda(list, now, { status: (e) => e.status, start: (e) => e.startTime, end: (e) => e.endTime }) : []}
        renderCard={renderCard}
        itemKey={(e) => e.id}
        emptyLabel="Aucun event."
        columns={2}
      />

      {/* Panneau inscrits */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', height: '100%', overflowY: 'auto', background: th.bgElev, padding: 24, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text }}>{detail.event.name}</div>
              <button onClick={() => setDetail(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><Icon name="x" size={20} color={th.textMute} /></button>
            </div>
            {detail.registrations.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun inscrit.</div>}
            {detail.registrations.map((r) => {
              const confirmed = r.status === 'CONFIRMED';
              const pos = waitlistPosition(detail.registrations, r.id);
              return (
                <div key={r.id} style={{ background: th.surface, borderRadius: 13, padding: '12px 14px', marginBottom: 10, boxShadow: th.shadow }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '3px 9px', fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, background: confirmed ? `${ACCENTS.emerald}22` : th.surface2, color: confirmed ? th.successInk : th.textMute }}>
                    {confirmed ? 'Confirmé' : pos ? `Liste d'attente · ${pos}` : "Liste d'attente"}
                  </span>
                  <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 6 }}>
                    {r.user.firstName} {r.user.lastName} <span style={{ color: th.textMute }}>· {r.user.email} · {r.user.phone ?? '—'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    {r.status === 'WAITLISTED' && <button onClick={() => promoteReg(detail.event.id, r.id)} style={ghost}>Promouvoir</button>}
                    <button onClick={() => removeReg(detail.event.id, r.id)} style={ghost}>Retirer</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Supprimer cet event ?"
          detail={pendingDelete.name}
          message="Cette action est définitive."
          confirmLabel="Supprimer"
          onConfirm={() => { const ev = pendingDelete; setPendingDelete(null); removeEvent(ev.id); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {managingSeriesId && (
        <SeriesManageDialog
          onExtend={(endDate) => extendSeries(managingSeriesId, endDate)}
          onCancelSeries={() => cancelSeries(managingSeriesId)}
          onClose={() => setManagingSeriesId(null)}
        />
      )}
    </div>
  );
}
