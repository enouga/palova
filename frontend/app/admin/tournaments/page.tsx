'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Tournament, AdminTournamentDetail, CreateTournamentBody, AdminClubSport } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

const CATEGORIES = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000'];
const GENDERS: { value: 'MEN' | 'WOMEN' | 'MIXED'; label: string }[] = [
  { value: 'MEN', label: 'Messieurs' }, { value: 'WOMEN', label: 'Dames' }, { value: 'MIXED', label: 'Mixte' },
];

const emptyForm = (clubSportId: string): CreateTournamentBody => ({
  clubSportId, name: '', category: 'P100', gender: 'MEN',
  description: '', startTime: '', registrationDeadline: '', maxTeams: null, entryFee: null,
});

export default function AdminTournamentsPage() {
  const { club } = useClub();
  const { token } = useAuth();
  const { th } = useTheme();
  const [list, setList] = useState<Tournament[]>([]);
  const [sports, setSports] = useState<AdminClubSport[]>([]);
  const [form, setForm] = useState<CreateTournamentBody | null>(null);
  const [detail, setDetail] = useState<AdminTournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!club || !token) return;
    api.adminGetTournaments(club.id, token).then(setList).catch(() => setList([]));
  }, [club?.id, token]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!club || !token) return;
    api.adminGetSports(club.id, token).then(setSports).catch(() => setSports([]));
  }, [club?.id, token]);

  if (!club || !token) return null;

  const padelSportId = sports.find((s) => s.sport.key === 'padel')?.id ?? sports[0]?.id ?? '';

  const submit = async () => {
    if (!form) return;
    setError(null);
    try {
      await api.adminCreateTournament(club.id, {
        ...form,
        maxTeams: form.maxTeams ? Number(form.maxTeams) : null,
        entryFee: form.entryFee ? Number(form.entryFee) : null,
      }, token);
      setForm(null); reload();
    } catch (e) { setError((e as Error).message); }
  };

  const publish = async (t: Tournament, status: 'PUBLISHED' | 'CANCELLED' | 'DRAFT') => {
    await api.adminUpdateTournament(club.id, t.id, { status }, token); reload();
  };
  const openDetail = async (t: Tournament) => {
    setDetail(await api.adminGetTournament(club.id, t.id, token));
  };
  const promote = async (regId: string) => {
    if (!detail) return;
    await api.adminPromoteRegistration(club.id, detail.tournament.id, regId, token);
    openDetail(detail.tournament); reload();
  };
  const remove = async (regId: string) => {
    if (!detail) return;
    await api.adminRemoveRegistration(club.id, detail.tournament.id, regId, token);
    openDetail(detail.tournament); reload();
  };

  const label = { fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 5, marginTop: 12 } as const;
  const input = { width: '100%', boxSizing: 'border-box' as const, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 10, padding: '9px 11px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const btn = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 10, padding: '10px 14px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14 };
  const ghost = { border: `1px solid ${th.line}`, cursor: 'pointer', background: 'transparent', color: th.textMute, borderRadius: 9, padding: '7px 11px', fontFamily: th.fontUI, fontSize: 13 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0 }}>Tournois</h1>
        <button onClick={() => setForm(emptyForm(padelSportId))} style={btn}><Icon name="plus" size={15} color={th.onAccent} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Nouveau tournoi</button>
      </div>

      {error && <div style={{ background: '#3a1d1d', color: '#ff6b6b', borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 13.5, marginBottom: 14 }}>{error}</div>}

      {/* Formulaire de création */}
      {form && (
        <div style={{ background: th.surface, borderRadius: 14, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 20 }}>
          <div style={label}>Nom</div>
          <input style={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Open de printemps" />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Catégorie</div>
              <select style={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Genre</div>
              <select style={input} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as CreateTournamentBody['gender'] })}>
                {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Début</div>
              <input type="datetime-local" style={input} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Limite d&apos;inscription</div>
              <input type="datetime-local" style={input} value={form.registrationDeadline} onChange={(e) => setForm({ ...form, registrationDeadline: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Nb max de binômes (vide = illimité)</div>
              <input type="number" min={1} style={input} value={form.maxTeams ?? ''} onChange={(e) => setForm({ ...form, maxTeams: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={label}>Frais d&apos;inscription (€)</div>
              <input type="number" min={0} step="0.01" style={input} value={form.entryFee ?? ''} onChange={(e) => setForm({ ...form, entryFee: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          <div style={label}>Description</div>
          <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={submit} style={btn}>Créer (brouillon)</button>
            <button onClick={() => setForm(null)} style={ghost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Liste des tournois */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {list.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun tournoi.</div>}
        {list.map((t) => (
          <div key={t.id} style={{ background: th.surface, borderRadius: 12, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 15, color: th.text }}>
                {t.category} · {t.name} <span style={{ color: th.textFaint, fontWeight: 400 }}>· {t.status}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => openDetail(t)} style={ghost}>Inscrits ({t.confirmedCount}{t.maxTeams ? `/${t.maxTeams}` : ''}{t.waitlistCount ? ` +${t.waitlistCount}` : ''})</button>
                {t.status !== 'PUBLISHED' && <button onClick={() => publish(t, 'PUBLISHED')} style={ghost}>Publier</button>}
                {t.status === 'PUBLISHED' && <button onClick={() => publish(t, 'CANCELLED')} style={ghost}>Annuler</button>}
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
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text }}>{detail.tournament.name}</div>
              <button onClick={() => setDetail(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><Icon name="x" size={20} color={th.textMute} /></button>
            </div>
            {detail.registrations.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun inscrit.</div>}
            {detail.registrations.map((r) => (
              <div key={r.id} style={{ background: th.surface, borderRadius: 11, padding: '12px 14px', marginBottom: 10, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
                <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: r.status === 'CONFIRMED' ? th.accent : th.textMute }}>{r.status === 'CONFIRMED' ? 'Confirmé' : 'Liste d\'attente'}</div>
                {[{ p: r.captain, lic: r.captainLicense }, { p: r.partner, lic: r.partnerLicense }].map(({ p, lic }) => (
                  <div key={p.id} style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 6 }}>
                    {p.firstName} {p.lastName} <span style={{ color: th.textMute }}>· {p.phone ?? '—'} · licence {lic ?? '—'} · {p.sex === 'MALE' ? 'H' : p.sex === 'FEMALE' ? 'F' : '—'}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {r.status === 'WAITLISTED' && <button onClick={() => promote(r.id)} style={ghost}>Promouvoir</button>}
                  <button onClick={() => remove(r.id)} style={ghost}>Désinscrire</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
