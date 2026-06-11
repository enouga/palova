'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, ClubEvent, AdminEventDetail, CreateEventBody, ClubEventKind } from '@/lib/api';
import { KIND_LABEL } from '@/lib/events';
import { Icon } from '@/components/ui/Icon';

const KINDS: ClubEventKind[] = ['MELEE', 'STAGE', 'SOIREE', 'INITIATION', 'AUTRE'];

const emptyForm = (): CreateEventBody => ({
  name: '', kind: 'MELEE', description: '', startTime: '', endTime: null,
  registrationDeadline: '', capacity: null, price: null, memberOnly: true,
});

/** ISO → valeur d'un input datetime-local (heure locale du navigateur). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminEventsPage() {
  const { club } = useClub();
  const { token } = useAuth();
  const { th } = useTheme();
  const [list, setList] = useState<ClubEvent[]>([]);
  const [form, setForm] = useState<CreateEventBody | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!club || !token) return;
    api.adminGetEvents(club.id, token).then(setList).catch(() => setList([]));
  }, [club?.id, token]);

  useEffect(() => { reload(); }, [reload]);

  if (!club || !token) return null;

  const toISO = (v: string) => (v ? new Date(v).toISOString() : '');

  const save = async () => {
    if (!form) return;
    setError(null);
    try {
      const body = { ...form, startTime: toISO(form.startTime), registrationDeadline: toISO(form.registrationDeadline), endTime: form.endTime ? toISO(form.endTime) : null };
      if (editingId) await api.adminUpdateEvent(club.id, editingId, body, token);
      else await api.adminCreateEvent(club.id, body, token);
      setForm(null); setEditingId(null); reload();
    } catch (e) { setError((e as Error).message); }
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
      startTime: toLocalInput(e.startTime), endTime: e.endTime ? toLocalInput(e.endTime) : null,
      registrationDeadline: toLocalInput(e.registrationDeadline),
      capacity: e.capacity, price: e.price != null ? Number(e.price) : null, memberOnly: e.memberOnly,
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
  const ghost = { border: `1px solid ${th.line}`, cursor: 'pointer', background: 'transparent', color: th.textMute, borderRadius: 9, padding: '7px 11px', fontFamily: th.fontUI, fontSize: 13 };

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: club.timezone }).format(new Date(iso));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0 }}>Events</h1>
        <button onClick={() => { setEditingId(null); setForm(emptyForm()); }} style={btn}><Icon name="plus" size={15} color={th.onAccent} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Nouvel event</button>
      </div>

      {error && <div style={{ background: '#3a1d1d', color: '#ff6b6b', borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 13.5, marginBottom: 14 }}>{error}</div>}

      {/* Formulaire création / édition */}
      {form && (
        <div style={{ background: th.surface, borderRadius: 14, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 20 }}>
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
              <div style={label}>Limite d&apos;inscription</div>
              <input type="datetime-local" style={input} value={form.registrationDeadline} onChange={(e) => setForm({ ...form, registrationDeadline: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Début</div>
              <input type="datetime-local" style={input} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Fin (optionnel)</div>
              <input type="datetime-local" style={input} value={form.endTime ?? ''} onChange={(e) => setForm({ ...form, endTime: e.target.value || null })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Nb de places (vide = illimité)</div>
              <input type="number" min={1} style={input} value={form.capacity ?? ''} onChange={(e) => setForm({ ...form, capacity: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Prix (€, vide = gratuit)</div>
              <input type="number" min={0} step="0.01" style={input} value={form.price ?? ''} onChange={(e) => setForm({ ...form, price: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          <div style={label}>Description</div>
          <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.memberOnly ?? true} onChange={(e) => setForm({ ...form, memberOnly: e.target.checked })} />
            Réservé aux membres
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={save} style={btn}>{editingId ? 'Enregistrer' : 'Créer (brouillon)'}</button>
            <button onClick={() => { setForm(null); setEditingId(null); }} style={ghost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Liste des events */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun event.</div>}
        {list.map((e) => (
          <div key={e.id} style={{ background: th.surface, borderRadius: 12, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>
                {KIND_LABEL[e.kind]} · {e.name} <span style={{ color: th.textFaint, fontWeight: 400 }}>· {fmtDate(e.startTime)} · {e.status}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => openDetail(e.id)} style={ghost}>Inscrits ({e.confirmedCount}{e.capacity ? `/${e.capacity}` : ''}{e.waitlistCount ? ` +${e.waitlistCount}` : ''})</button>
                <button onClick={() => startEdit(e)} style={ghost}>Modifier</button>
                {e.status !== 'PUBLISHED' && <button onClick={() => setStatus(e.id, 'PUBLISHED')} style={ghost}>Publier</button>}
                {e.status === 'PUBLISHED' && <button onClick={() => setStatus(e.id, 'DRAFT')} style={ghost}>Repasser en brouillon</button>}
                {e.status === 'PUBLISHED' && <button onClick={() => setStatus(e.id, 'CANCELLED')} style={ghost}>Annuler</button>}
                {e.confirmedCount === 0 && e.waitlistCount === 0 && <button onClick={() => removeEvent(e.id)} style={ghost}>Supprimer</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Panneau inscrits */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', height: '100%', overflowY: 'auto', background: th.bgElev, padding: 24, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text }}>{detail.event.name}</div>
              <button onClick={() => setDetail(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><Icon name="x" size={20} color={th.textMute} /></button>
            </div>
            {detail.registrations.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun inscrit.</div>}
            {detail.registrations.map((r) => (
              <div key={r.id} style={{ background: th.surface, borderRadius: 11, padding: '12px 14px', marginBottom: 10, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: r.status === 'CONFIRMED' ? th.accent : th.textMute }}>{r.status === 'CONFIRMED' ? 'Confirmé' : 'Liste d\'attente'}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 6 }}>
                  {r.user.firstName} {r.user.lastName} <span style={{ color: th.textMute }}>· {r.user.email} · {r.user.phone ?? '—'}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {r.status === 'WAITLISTED' && <button onClick={() => promoteReg(detail.event.id, r.id)} style={ghost}>Promouvoir</button>}
                  <button onClick={() => removeReg(detail.event.id, r.id)} style={ghost}>Retirer</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
