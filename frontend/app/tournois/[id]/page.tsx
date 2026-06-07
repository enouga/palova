'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { api, TournamentDetail, MyProfile, MyTournamentRegistration } from '@/lib/api';
import { Screen } from '@/components/ui/Screen';
import { Chip } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ClubNav } from '@/components/ClubNav';

const GENDER_LABEL: Record<string, string> = { MEN: 'Messieurs', WOMEN: 'Dames', MIXED: 'Mixte' };

const ERROR_FR: Record<string, string> = {
  TOURNAMENT_NOT_OPEN: 'Les inscriptions ne sont pas ouvertes.',
  REGISTRATION_CLOSED: 'Les inscriptions sont closes.',
  REGISTRATION_LOCKED: 'La date limite de modification est dépassée.',
  PARTNER_NOT_FOUND: "Aucun joueur trouvé avec cet e-mail (il doit avoir un compte et être membre du club).",
  PARTNER_IS_SELF: 'Vous ne pouvez pas être votre propre coéquipier.',
  MEMBERSHIP_REQUIRED: "{who} n'est pas membre du club.",
  MEMBERSHIP_BLOCKED: '{who} est bloqué(e) par le club.',
  PHONE_REQUIRED: "{who} doit renseigner un numéro de téléphone.",
  LICENSE_REQUIRED: "{who} doit renseigner un numéro de licence (auprès du club).",
  SEX_REQUIRED: '{who} doit renseigner son sexe dans son profil.',
  GENDER_MISMATCH: "La composition du binôme ne correspond pas à la catégorie du tournoi.",
  ALREADY_REGISTERED: "Un des deux joueurs est déjà inscrit à ce tournoi.",
};

function messageFor(err: unknown): string {
  const e = err as { message?: string; subject?: string };
  const tmpl = ERROR_FR[e.message ?? ''] ?? e.message ?? 'Une erreur est survenue.';
  const who = e.subject === 'partner' ? 'Votre coéquipier' : 'Vous';
  return tmpl.replace('{who}', who);
}

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)).replace(':', 'h');
}

export default function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { club } = useClub();
  const { th } = useTheme();
  const router = useRouter();
  const { token, ready } = useAuth();

  const [t, setT] = useState<TournamentDetail | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [myReg, setMyReg] = useState<MyTournamentRegistration | null>(null);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.getTournament(id).then(setT).catch(() => setT(null));
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (!ready || !token) return;
    api.getMyProfile(token).then(setProfile).catch(() => {});
    api.getMyTournaments(token).then((rs) => setMyReg(rs.find((r) => r.tournament.id === id) ?? null)).catch(() => {});
  }, [ready, token, id]);

  if (!t || !club) {
    return <div style={{ minHeight: '100vh', background: th.bg, color: th.textFaint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontUI }}>Chargement…</div>;
  }

  const tz = t.club.timezone;
  const closed = new Date(t.registrationDeadline) <= new Date();
  const full = t.maxTeams != null && t.confirmedCount >= t.maxTeams;
  const profileIncomplete = !!token && profile != null && (!profile.phone || !profile.sex);

  const saveProfile = async (phone: string, sex: 'MALE' | 'FEMALE') => {
    if (!token) return;
    setBusy(true); setError(null);
    try { setProfile(await api.updateMyProfile({ phone, sex }, token)); }
    catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const register = async () => {
    if (!token) { router.push('/login'); return; }
    setBusy(true); setError(null);
    try {
      await api.registerTournament(id, partnerEmail.trim(), token);
      setPartnerEmail('');
      await load();
      const rs = await api.getMyTournaments(token);
      setMyReg(rs.find((r) => r.tournament.id === id) ?? null);
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const changePartner = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await api.changeTournamentPartner(id, partnerEmail.trim(), token);
      setPartnerEmail('');
      const rs = await api.getMyTournaments(token);
      setMyReg(rs.find((r) => r.tournament.id === id) ?? null);
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await api.cancelTournamentRegistration(id, token);
      setMyReg(null);
      await load();
    } catch (e) { setError(messageFor(e)); }
    finally { setBusy(false); }
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const primaryBtn = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 11, padding: '12px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, opacity: busy ? 0.6 : 1 };

  return (
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        <ClubNav club={club} />

        <div style={{ padding: '14px 20px 0' }}>
          <button onClick={() => router.push('/tournois')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute, padding: 0 }}>
            <Icon name="chevL" size={16} color={th.textMute} />Tous les tournois
          </button>
        </div>

        {/* En-tête tournoi */}
        <div style={{ padding: '12px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Chip tone="accent">{t.category}</Chip><Chip>{GENDER_LABEL[t.gender]}</Chip>
          </div>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 28, color: th.text, marginTop: 10, letterSpacing: -0.5 }}>{t.name}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10, fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="calendar" size={15} color={th.textMute} />Début : {formatDateTime(t.startTime, tz)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="clock" size={15} color={th.textMute} />Inscriptions jusqu&apos;au {formatDateTime(t.registrationDeadline, tz)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="users" size={15} color={th.textMute} />{t.maxTeams != null ? `${t.confirmedCount}/${t.maxTeams} binômes` : `${t.confirmedCount} binômes`}{t.waitlistCount > 0 ? ` · ${t.waitlistCount} en attente` : ''}</span>
            {t.entryFee && <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="euro" size={15} color={th.textMute} />{t.entryFee} € par binôme</span>}
          </div>
          {t.description && <p style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute, marginTop: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{t.description}</p>}
        </div>

        <div style={{ padding: '24px 20px 0' }}>
          {error && <div style={{ background: '#3a1d1d', color: '#ff6b6b', borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 13.5, marginBottom: 14 }}>{error}</div>}

          {/* Non connecté */}
          {ready && !token && (
            <button onClick={() => router.push('/login')} style={primaryBtn}>Se connecter pour s&apos;inscrire</button>
          )}

          {/* Déjà inscrit */}
          {token && myReg && (
            <div style={{ background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Chip tone="accent" icon="check">{myReg.status === 'CONFIRMED' ? 'Inscrit' : 'Liste d\'attente'}</Chip>
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.text, marginTop: 12 }}>
                Votre binôme : <strong>{myReg.captain.firstName} {myReg.captain.lastName}</strong> &amp; <strong>{myReg.partner.firstName} {myReg.partner.lastName}</strong>
              </div>
              {!closed ? (
                <>
                  <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 16, marginBottom: 6 }}>Changer de coéquipier (e-mail)</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={partnerEmail} onChange={(e) => setPartnerEmail(e.target.value)} placeholder="email@coequipier.fr" style={inputStyle} />
                    <button onClick={changePartner} disabled={busy || !partnerEmail.trim()} style={{ ...primaryBtn, whiteSpace: 'nowrap' }}>Changer</button>
                  </div>
                  <button onClick={cancel} disabled={busy} style={{ marginTop: 12, border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, cursor: 'pointer', borderRadius: 11, padding: '10px 14px', fontFamily: th.fontUI, fontSize: 13.5 }}>Se désinscrire</button>
                </>
              ) : (
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, marginTop: 12 }}>Inscriptions closes : modification et annulation ne sont plus possibles.</div>
              )}
            </div>
          )}

          {/* Pas encore inscrit, inscriptions ouvertes */}
          {token && !myReg && !closed && (
            <div>
              {profileIncomplete && (
                <ProfileCompletion busy={busy} onSave={saveProfile} />
              )}
              <div style={{ opacity: profileIncomplete ? 0.4 : 1, pointerEvents: profileIncomplete ? 'none' : 'auto' }}>
                {full && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 10 }}>Tournoi complet : votre binôme sera placé en liste d&apos;attente.</div>}
                <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 8, lineHeight: 1.5 }}>
                  Votre coéquipier doit avoir un compte, être membre du club, et avoir renseigné téléphone, licence et sexe.
                </div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginBottom: 6 }}>E-mail du coéquipier</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={partnerEmail} onChange={(e) => setPartnerEmail(e.target.value)} placeholder="email@coequipier.fr" style={inputStyle} />
                  <button onClick={register} disabled={busy || !partnerEmail.trim()} style={{ ...primaryBtn, whiteSpace: 'nowrap' }}>S&apos;inscrire</button>
                </div>
              </div>
            </div>
          )}

          {token && !myReg && closed && (
            <div style={{ fontFamily: th.fontUI, fontSize: 14, color: th.textMute }}>Les inscriptions pour ce tournoi sont closes.</div>
          )}
        </div>
      </div>
    </Screen>
  );
}

function ProfileCompletion({ busy, onSave }: {
  busy: boolean;
  onSave: (phone: string, sex: 'MALE' | 'FEMALE') => void;
}) {
  const { th } = useTheme();
  const [phone, setPhone] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | ''>('');
  const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: th.surface2, border: `1px solid ${th.line}`, borderRadius: 11, padding: '11px 13px', fontFamily: th.fontUI, fontSize: 14, color: th.text };
  const primaryBtn: React.CSSProperties = { border: 'none', cursor: 'pointer', background: th.accent, color: th.onAccent, borderRadius: 11, padding: '12px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, opacity: busy ? 0.6 : 1 };
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}`, marginBottom: 16 }}>
      <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text }}>Complétez votre profil</div>
      <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 4, marginBottom: 12 }}>Téléphone et sexe sont requis pour s&apos;inscrire à un tournoi.</div>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Téléphone" style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['MALE', 'FEMALE'] as const).map((s) => (
          <button key={s} onClick={() => setSex(s)} style={{ flex: 1, cursor: 'pointer', borderRadius: 11, padding: '10px', fontFamily: th.fontUI, fontSize: 14, border: `1px solid ${sex === s ? th.accent : th.line}`, background: sex === s ? th.surface2 : 'transparent', color: th.text }}>
            {s === 'MALE' ? 'Homme' : 'Femme'}
          </button>
        ))}
      </div>
      <button onClick={() => sex && onSave(phone.trim(), sex)} disabled={busy || !phone.trim() || !sex} style={{ ...primaryBtn, width: '100%' }}>Enregistrer mon profil</button>
    </div>
  );
}
