'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClub } from '@/lib/ClubProvider';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { api, Tournament, AdminTournamentDetail, CreateTournamentBody, AdminClubSport, ClubReferee } from '@/lib/api';
import { localInputToISO } from '@/lib/datetimeLocal';
import { DateTimeField } from '@/components/ui/DateTimeField';
import { Icon } from '@/components/ui/Icon';
import { ACCENTS } from '@/lib/theme';
import { GENDER_LABEL } from '@/lib/events';
import { formatDateShortTimeRange, fillRatio, waitlistPosition } from '@/lib/tournament';
import { groupAdminAgenda, agendaItemGroup } from '@/lib/adminAgenda';
import { AgendaAdminCard } from '@/components/admin/AgendaAdminCard';
import { AgendaAdminList } from '@/components/admin/AgendaAdminList';

const CATEGORIES = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000'];
const GENDERS: { value: 'MEN' | 'WOMEN' | 'MIXED'; label: string }[] = [
  { value: 'MEN', label: 'Messieurs' }, { value: 'WOMEN', label: 'Dames' }, { value: 'MIXED', label: 'Mixte' },
];

// Codes serveur → français. REFEREE_INVALID = la cible n'a pas (ou plus) la facette J/A :
// vivier périmé dans l'onglet, ou facette retirée entre-temps.
const ERROR_FR: Record<string, string> = {
  REFEREE_INVALID: 'Ce membre n’est pas juge-arbitre.',
};
const messageFor = (e: unknown) => {
  const code = (e as Error)?.message ?? '';
  return ERROR_FR[code] ?? (code || 'Une erreur est survenue.');
};

const emptyForm = (clubSportId: string): CreateTournamentBody => ({
  clubSportId, name: '', category: 'P100', gender: 'MEN', openToWomen: true,
  description: '', contactInfo: '', refereeUserId: null, startTime: '', endTime: null, registrationDeadline: '', maxTeams: null, entryFee: null,
  requirePrepayment: false,
});

export default function AdminTournamentsPage() {
  const { club } = useClub();
  const { token } = useAuth();
  const { th } = useTheme();
  const [list, setList] = useState<Tournament[]>([]);
  const [sports, setSports] = useState<AdminClubSport[]>([]);
  const [referees, setReferees] = useState<ClubReferee[]>([]);
  const [form, setForm] = useState<CreateTournamentBody | null>(null);
  const [detail, setDetail] = useState<AdminTournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stripeActive, setStripeActive] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => { setNow(new Date()); }, []);

  const reload = useCallback(() => {
    if (!club || !token) return;
    api.adminGetTournaments(club.id, token).then(setList).catch(() => setList([]));
  }, [club?.id, token]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!club || !token) return;
    api.adminGetSports(club.id, token).then(setSports).catch(() => setSports([]));
  }, [club?.id, token]);
  // Vivier des J/A (membres portant la facette). Vivier indisponible → liste vide : le
  // formulaire reste utilisable, le tournoi se crée simplement sans J/A désigné.
  useEffect(() => {
    if (!club || !token) return;
    api.adminGetReferees(club.id, token).then(setReferees).catch(() => setReferees([]));
  }, [club?.id, token]);
  useEffect(() => {
    if (!club || !token) return;
    api.adminGetClub(club.id, token).then((c) => setStripeActive(c.stripeAccountStatus === 'ACTIVE')).catch(() => {});
  }, [club?.id, token]);

  if (!club || !token) return null;

  const padelSportId = sports.find((s) => s.sport.key === 'padel')?.id ?? sports[0]?.id ?? '';

  const submit = async () => {
    if (!form) return;
    setError(null);
    try {
      await api.adminCreateTournament(club.id, {
        ...form,
        startTime: localInputToISO(form.startTime),
        registrationDeadline: localInputToISO(form.registrationDeadline),
        endTime: form.endTime ? localInputToISO(form.endTime) : null,
        maxTeams: form.maxTeams ? Number(form.maxTeams) : null,
        entryFee: form.entryFee ? Number(form.entryFee) : null,
        refereeUserId: form.refereeUserId ?? null, // explicite : « Aucun » doit envoyer null, jamais undefined
      }, token);
      setForm(null); reload();
    } catch (e) { setError(messageFor(e)); }
  };

  const publish = async (t: Tournament, status: 'PUBLISHED' | 'CANCELLED' | 'DRAFT') => {
    await api.adminUpdateTournament(club.id, t.id, { status }, token); reload();
  };

  // Désignation/retrait du J/A sur un tournoi déjà créé : le formulaire ne sert qu'à la
  // création, or un J/A se remplace (indisponibilité) et les tournois existants n'en ont aucun.
  const setReferee = async (t: Tournament, refereeUserId: string | null) => {
    setError(null);
    try {
      await api.adminUpdateTournament(club.id, t.id, { refereeUserId }, token);
      reload();
    } catch (e) { setError(messageFor(e)); }
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
  const ghost = { border: `1px solid ${th.line}`, cursor: 'pointer', background: 'transparent', color: th.textMute, borderRadius: 9, padding: '7px 12px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 };
  const primarySm = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 9, padding: '7px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 };

  const genderTag = (t: Tournament) => {
    const g = GENDER_LABEL[t.gender];
    return t.gender === 'MEN' && t.openToWomen ? `${t.category} · ${g} · open` : `${t.category} · ${g}`;
  };

  const renderCard = (t: Tournament) => {
    const key = agendaItemGroup(t.status, t.startTime, t.endTime, now!);
    const current = t.refereeUserId ?? null;
    // Le J/A garde sa mission si on lui retire la facette (spec §4) : il peut donc être absent
    // du vivier. Sans option pour lui, le select retomberait sur « Aucun » et mentirait.
    // Libellé neutre à dessein : hors vivier chargé, on ne sait pas *pourquoi* il n'y est pas
    // (facette retirée, vivier encore en vol, ou fetch en échec) — on ne l'invente pas.
    const orphan = current != null && !referees.some((r) => r.userId === current);
    const actions = (
      <>
        {key !== 'cancelled' && (
          <select
            aria-label={`Juge-arbitre — ${t.name}`}
            value={current ?? ''}
            onChange={(e) => setReferee(t, e.target.value || null)}
            style={{ ...ghost, cursor: 'pointer', maxWidth: 190 }}
          >
            <option value="">J/A : aucun</option>
            {orphan && <option value={current!}>J/A actuel (hors liste)</option>}
            {referees.map((r) => <option key={r.userId} value={r.userId}>{r.firstName} {r.lastName}</option>)}
          </select>
        )}
        <button onClick={() => openDetail(t)} style={ghost}>Inscrits</button>
        {(key === 'draft' || key === 'cancelled') && <button onClick={() => publish(t, 'PUBLISHED')} style={primarySm}>Publier</button>}
        {key === 'upcoming' && <button onClick={() => publish(t, 'CANCELLED')} style={ghost}>Annuler</button>}
      </>
    );
    return (
      <AgendaAdminCard
        icon="trophy"
        accent={ACCENTS.apricot}
        stripe={key}
        faded={key === 'past' || key === 'cancelled'}
        tag={genderTag(t)}
        title={t.name}
        dateLabel={formatDateShortTimeRange(t.startTime, t.endTime, club.timezone)}
        deadline={t.registrationDeadline}
        now={now}
        ratio={fillRatio(t)}
        full={t.maxTeams != null && t.confirmedCount >= t.maxTeams}
        countLabel={`${t.confirmedCount}${t.maxTeams != null ? ` / ${t.maxTeams}` : ''} binômes`}
        waitlist={t.waitlistCount}
        chips={[t.entryFee ? `${Number(t.entryFee)} €` : null, t.requirePrepayment ? 'CB en ligne' : null]}
        actions={actions}
      />
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, margin: 0 }}>Tournois</h1>
        <button onClick={() => setForm(emptyForm(padelSportId))} style={btn}><Icon name="plus" size={15} color={th.onAccent} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />Nouveau tournoi</button>
      </div>

      {error && (
        <div style={{ background: `${ACCENTS.coral}1f`, color: th.mode === 'floodlit' ? ACCENTS.coral : '#a83214', boxShadow: `inset 0 0 0 1px ${ACCENTS.coral}55`, borderRadius: 10, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, marginBottom: 14 }}>{error}</div>
      )}

      {/* Formulaire de création */}
      {form && (
        <div style={{ background: th.surface, borderRadius: 16, padding: 18, boxShadow: th.shadow, marginBottom: 22 }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 17, color: th.text }}>Nouveau tournoi</div>
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
          {form.gender === 'MEN' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>
                <input type="checkbox" checked={form.openToWomen ?? true} onChange={(e) => setForm({ ...form, openToWomen: e.target.checked })} />
                Ouvert aux femmes
              </label>
              <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 4 }}>
                Tableau « open » : une femme peut s&apos;inscrire (composition libre). Décochez pour un tournoi 100% masculin.
              </div>
            </>
          )}
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
          <div style={label}>Début</div>
          <DateTimeField value={form.startTime} onChange={(v) => setForm({ ...form, startTime: v })} />
          <div style={label}>Fin (optionnel)</div>
          <DateTimeField value={form.endTime ?? ''} onChange={(v) => setForm({ ...form, endTime: v || null })} clearable />
          <div style={label}>Limite d&apos;inscription</div>
          <DateTimeField value={form.registrationDeadline} onChange={(v) => setForm({ ...form, registrationDeadline: v })} />
          <div style={label}>Description</div>
          <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div style={label}>Contact (affiché une fois les inscriptions closes)</div>
          <textarea style={{ ...input, minHeight: 50, resize: 'vertical' }} value={form.contactInfo ?? ''} onChange={(e) => setForm({ ...form, contactInfo: e.target.value })} placeholder="Ex. Vous devez contacter le Juge Arbitre au 06 02 32 33 65" />
          <label style={{ ...label, display: 'block' }} htmlFor="referee">Juge-arbitre</label>
          <select id="referee" style={input} value={form.refereeUserId ?? ''} onChange={(e) => setForm({ ...form, refereeUserId: e.target.value || null })}>
            <option value="">Aucun</option>
            {referees.map((r) => <option key={r.userId} value={r.userId}>{r.firstName} {r.lastName}</option>)}
          </select>
          <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 4 }}>
            Il pourra gérer les inscrits de ce tournoi depuis son espace Arbitrage, sans autre accès au club.
            Cochez « Juge-arbitre » sur la fiche d&rsquo;un membre pour l&rsquo;ajouter à cette liste.
          </div>
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
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={submit} style={btn}>Créer (brouillon)</button>
            <button onClick={() => setForm(null)} style={ghost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Liste des tournois, groupée par statut */}
      <AgendaAdminList
        ready={now != null}
        groups={now ? groupAdminAgenda(list, now, { status: (t) => t.status, start: (t) => t.startTime, end: (t) => t.endTime }) : []}
        renderCard={renderCard}
        itemKey={(t) => t.id}
        emptyLabel="Aucun tournoi."
      />

      {/* Panneau inscrits */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', height: '100%', overflowY: 'auto', background: th.bgElev, padding: 24, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 19, color: th.text }}>{detail.tournament.name}</div>
              <button onClick={() => setDetail(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}><Icon name="x" size={20} color={th.textMute} /></button>
            </div>
            {detail.registrations.length === 0 && <div style={{ fontFamily: th.fontUI, color: th.textMute }}>Aucun inscrit.</div>}
            {detail.registrations.map((r) => {
              const confirmed = r.status === 'CONFIRMED';
              const pos = waitlistPosition(detail.registrations, r.id);
              return (
                <div key={r.id} style={{ background: th.surface, borderRadius: 13, padding: '12px 14px', marginBottom: 10, boxShadow: th.shadow }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '3px 9px', fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, background: confirmed ? `${ACCENTS.emerald}22` : th.surface2, color: confirmed ? (th.mode === 'floodlit' ? ACCENTS.emerald : '#1c7a4f') : th.textMute }}>
                    {confirmed ? 'Confirmé' : pos ? `Liste d'attente · ${pos}` : "Liste d'attente"}
                  </span>
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
