'use client';
import { useEffect, useState, useCallback, useRef, CSSProperties, ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  api, MemberHistory, MemberNote, AdminMemberLevel, UserLevel,
  UpdateMemberBody, SubscriptionPlan, SubscriptionPlanSummary,
} from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { isClubAdmin, useAdminRole } from '@/lib/adminRole';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, dangerBanner } from '@/lib/theme';
import { Chip, BackButton, Segmented, Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { fmtEuros, toCents } from '@/lib/caisse';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';
import { ReliabilityMeter } from '@/components/player/ReliabilityMeter';
import { LevelOverrideForm } from '@/components/admin/LevelOverrideForm';
import { MonthlyRevenueChart } from '@/components/admin/stats/MonthlyRevenueChart';
import { DayHourHeatmap } from '@/components/admin/stats/DayHourHeatmap';
import { PaymentMethodChart } from '@/components/admin/stats/PaymentMethodChart';
import { PackageBalanceDialog } from '@/components/admin/members/PackageBalanceDialog';
import { MemberProfileCard } from '@/components/admin/members/MemberProfileCard';
import { MemberAccessCard } from '@/components/admin/members/MemberAccessCard';
import { MemberWalletCard } from '@/components/admin/members/MemberWalletCard';
import { MemberReservationsCard } from '@/components/admin/members/MemberReservationsCard';
import { MemberUpcomingCard, MemberPaymentsCard, MemberLoyaltyCard } from '@/components/admin/members/MemberOverviewCards';
import { SubscriptionActions } from '@/components/admin/subscriptions/SubscriptionActions';
import { StaffRole } from '@/lib/members';
import {
  winRate, lastVisitLabel, cancellationLabel, tenureLabel, weekdayLabel, methodLabel, memberAlerts,
} from '@/lib/memberStats';

type DetailTab = 'activite' | 'finances' | 'niveau' | 'fidelite';

const money = (v: string) => fmtEuros(toCents(v));
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
// Date d'une correction de niveau (jour + heure courts, locale FR) — robuste aux dates invalides.
const fmtAdjustDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const STATUS_FR: Record<string, string> = { CONFIRMED: 'Confirmée', CANCELLED: 'Annulée', PENDING: 'En attente' };
const TYPE_FR: Record<string, string> = { COURT: 'Terrain', COACHING: 'Cours', TOURNAMENT: 'Tournoi', EVENT: 'Event' };

// Messages mappés des gardes serveur sur les mutations de rôle/blocage/suppression (miroir de
// l'ex-page liste maître-détail, cf. git show c2a8174e~1:frontend/app/admin/members/page.tsx).
const STAFF_ERRORS: Record<string, string> = {
  CANNOT_CHANGE_OWNER: 'Le rôle du gérant ne peut pas être modifié.',
  CANNOT_CHANGE_SELF: 'Vous ne pouvez pas modifier votre propre rôle.',
  MEMBER_IS_STAFF: "Ce membre a un rôle staff : retirez d'abord son rôle (carte « Rôle & accès ») avant de le bloquer ou de le supprimer.",
};

function StatCard({ label, value, unit, hint, accent, danger }: { label: string; value: string | number; unit?: string; hint?: string; accent?: boolean; danger?: boolean }) {
  const { th } = useTheme();
  return (
    <div style={{ flex: 1, minWidth: 140, background: th.surface, borderRadius: 18, padding: '16px 18px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <span style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: th.textMute }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 10 }}>
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 32, lineHeight: 0.9, color: danger ? th.danger : accent ? th.accent : th.text, letterSpacing: -0.5 }}>{value}</span>
        {unit && <span style={{ fontFamily: th.fontUI, fontSize: 15, color: th.textMute, fontWeight: 600 }}>{unit}</span>}
      </div>
      {hint && <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}`, marginTop: 14 }}>
      <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 17, margin: '0 0 14px', color: th.text }}>{title}</h2>
      {children}
    </div>
  );
}

export default function MemberHistoryPage() {
  const { th } = useTheme();
  const params = useParams();
  const router = useRouter();
  const userId = Array.isArray(params.userId) ? params.userId[0] : (params.userId as string);
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  // Le système de niveau peut être désactivé pour le club : on masque alors la partie
  // correction/fiabilité/historique de l'onglet Niveau (le reste de la fiche reste actif).
  const levelEnabled = club?.levelSystemEnabled !== false;
  // Les blocs override de niveau (formulaire + données /members/:userId/level) sont réservés
  // ADMIN côté serveur : un viewer STAFF ne doit ni les voir ni déclencher l'appel (403).
  // Réutilisé tel quel comme garde « gestion staff » de la carte Accès (même sémantique
  // OWNER/ADMIN que l'ancien viewer.role de la liste maître-détail) — évite un second aller-retour
  // réseau (getMyClubs) alors que le layout /admin a déjà posé ce rôle dans le contexte.
  const admin = isClubAdmin(useAdminRole());

  const [data, setData] = useState<MemberHistory | null>(null);
  const [notes, setNotes] = useState<MemberNote[]>([]);
  const [levelData, setLevelData] = useState<AdminMemberLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Erreur de chargement initial (page-level, voir ci-dessous) vs erreur d'une mutation
  // post-chargement (rôle, blocage, notes…) : un canal distinct pour ne pas faire disparaître
  // tout le cockpit derrière un bandeau plein écran quand une simple action échoue.
  const [actionError, setActionError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailTab>('activite');
  const [watch, setWatch] = useState(false);
  const [onlyLate, setOnlyLate] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [subAction, setSubAction] = useState<'renew' | 'change' | 'cancel' | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  // Recharge/correction d'un solde prépayé : ouvertes à tout STAFF (la correction est journalisée).
  const [pkgAction, setPkgAction] = useState<{ mode: 'recharge' | 'adjust'; bal: MemberHistory['finance']['prepaid']['balances'][number] } | null>(null);
  // Garde anti-race : un reload (onSaved après correction de niveau) peut chevaucher
  // un chargement en cours ; on ignore le résultat d'une requête périmée.
  const reqIdRef = useRef(0);
  // Ancre de scroll du bloc « Le plus — détails complets » (cible du lien « Tout l'historique → »).
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token || !clubId || !userId) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      setError(null);
      const [h, n, lvl] = await Promise.all([
        api.adminGetMemberHistory(clubId, userId, token),
        api.adminGetMemberNotes(clubId, userId, token).catch(() => [] as MemberNote[]),
        // Niveau (override admin) — uniquement si le système de niveau est actif ET que le
        // viewer est admin (route requireClubMember('ADMIN')) ; tolérant à l'échec.
        levelEnabled && admin
          ? api.adminGetMemberLevel(clubId, userId, token).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (reqId !== reqIdRef.current) return; // réponse périmée : un reload plus récent a pris la main
      setData(h); setNotes(n); setLevelData(lvl); setWatch(h.member.watch);
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError((e as Error).message === 'MEMBER_NOT_FOUND' ? 'Membre introuvable dans ce club.' : (e as Error).message);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [token, clubId, userId, levelEnabled, admin]);

  useEffect(() => { if (ready && token && clubId && userId) load(); }, [ready, token, clubId, userId, load]);

  // Identité du viewer (pour interdire l'édition de son propre rôle staff dans la carte Accès).
  useEffect(() => {
    if (!ready || !token) return;
    api.getMyProfile(token).then((me) => setViewerUserId(me.id)).catch(() => setViewerUserId(null));
  }, [ready, token]);

  const toggleWatch = async () => {
    if (!token || !clubId) return;
    const next = !watch;
    setWatch(next); // optimiste
    try { await api.adminSetMemberWatch(clubId, userId, next, token); }
    catch (e) { setWatch(!next); setActionError((e as Error).message); }
  };

  const addNote = async () => {
    if (!token || !clubId || !noteBody.trim()) return;
    setAddingNote(true);
    try {
      const created = await api.adminAddMemberNote(clubId, userId, noteBody.trim(), token);
      setNotes((prev) => [created, ...prev]);
      setNoteBody('');
    } catch (e) { setActionError((e as Error).message); }
    finally { setAddingNote(false); }
  };

  const deleteNote = async (id: string) => {
    if (!token || !clubId) return;
    try {
      await api.adminDeleteMemberNote(clubId, userId, id, token);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setConfirmDelete(null);
    } catch (e) { setActionError((e as Error).message); }
  };

  const saveProfile = async (body: UpdateMemberBody) => {
    if (!token || !clubId || !data) return;
    try { setActionError(null); await api.adminUpdateMember(clubId, data.member.membershipId, body, token); await load(); }
    catch (e) { setActionError((e as Error).message === 'VALIDATION_ERROR' ? 'Vérifiez les champs saisis.' : (e as Error).message); }
  };

  const setRole = async (role: StaffRole) => {
    if (!token || !clubId || !data) return;
    if ((data.member.staffRole ?? null) === role) return;
    try { setActionError(null); await api.adminSetMemberStaffRole(clubId, data.member.userId, role, token); await load(); }
    catch (e) { const msg = (e as Error).message; setActionError(STAFF_ERRORS[msg] ?? msg); }
  };

  const setCoach = async (v: boolean) => {
    if (!token || !clubId || !data) return;
    try { setActionError(null); await api.adminSetMemberCoach(clubId, data.member.userId, v, token); await load(); }
    catch (e) { setActionError((e as Error).message); }
  };

  const setReferee = async (v: boolean) => {
    if (!token || !clubId || !data) return;
    try { setActionError(null); await api.adminSetMemberReferee(clubId, data.member.userId, v, token); await load(); }
    catch (e) { setActionError((e as Error).message); }
  };

  const setSubscriber = async (v: boolean) => {
    if (!token || !clubId || !data) return;
    try { setActionError(null); await api.adminUpdateMember(clubId, data.member.membershipId, { isSubscriber: v }, token); await load(); }
    catch (e) { setActionError((e as Error).message); }
  };

  const toggleBlocked = async () => {
    if (!token || !clubId || !data) return;
    try { setActionError(null); await api.adminSetMemberBlocked(clubId, data.member.membershipId, data.member.status !== 'BLOCKED', token); await load(); }
    catch (e) { const msg = (e as Error).message; setActionError(STAFF_ERRORS[msg] ?? msg); }
  };

  const remove = async () => {
    if (!token || !clubId || !data) return;
    try { setActionError(null); await api.adminRemoveMember(clubId, data.member.membershipId, token); router.push('/admin/members'); }
    catch (e) { const msg = (e as Error).message; setActionError(STAFF_ERRORS[msg] ?? msg); setConfirmRemove(false); }
  };

  // Chargement paresseux des forfaits (une seule fois) au premier clic Renouveler/Changer/Résilier.
  const openSubAction = (kind: 'renew' | 'change' | 'cancel') => {
    setSubAction(kind);
    if (token && clubId && plans.length === 0) {
      api.adminGetSubscriptionPlans(clubId, token).then(setPlans).catch(() => {});
    }
  };

  // « Tout l'historique → » : bascule sur l'onglet Activité du bloc « Le plus » et y défile.
  const openDetail = (t: DetailTab) => {
    setDetail(t);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 };
  const td: CSSProperties = { padding: '9px 12px', fontFamily: th.fontUI, fontSize: 13, color: th.text, whiteSpace: 'nowrap' };

  if (loading) return <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (error) return (
    <div>
      <BackButton href="/admin/members" label="Membres" />
      <div style={{ ...dangerBanner(th), marginTop: 16 }}>{error}</div>
    </div>
  );
  if (!data) return null;

  const m = data.member;
  const { counts, finance, game, loyalty, favorites } = data;
  const reservations = onlyLate ? data.reservations.filter((r) => r.lateCancel) : data.reservations;

  const alerts = memberAlerts({
    outstandingCents: toCents(finance.outstanding),
    balances: finance.prepaid.balances,
    subscriptionExpiresAt: data.subscription?.expiresAt ?? null,
  }, new Date());

  // --- Données pour la partie « correction de niveau » (C2), à l'intérieur du bloc Niveau ---
  // Sports proposés par le club (pour le sélecteur du formulaire de correction).
  const clubSports = (club?.clubSports ?? []).map((cs) => ({ key: cs.sport.key, name: cs.sport.name }));
  // Carte clé→nom unique, alimentée par les sports du club ET les noms portés par l'historique.
  const nameByKey = new Map<string, string>();
  for (const s of clubSports) nameByKey.set(s.key, s.name);
  for (const h of levelData?.history ?? []) if (!nameByKey.has(h.sportKey)) nameByKey.set(h.sportKey, h.sportName);
  const sportName = (key: string) => nameByKey.get(key) ?? key;
  // Si le club n'a pas de sports configurés, on retombe sur les sports présents dans les niveaux.
  const formSports = clubSports.length > 0
    ? clubSports
    : Object.keys(levelData?.levels ?? {}).map((key) => ({ key, name: sportName(key) }));
  const levelEntries: [string, UserLevel][] = Object.entries(levelData?.levels ?? {});
  const adjustments = levelData?.history ?? [];

  return (
    <div>
      <BackButton href="/admin/members" label="Membres" />

      {/* Hero identité */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '16px 0 12px', flexWrap: 'wrap' }}>
        <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} size={56} color={colorForSeed(m.userId)} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 30, letterSpacing: -0.5, margin: 0, color: th.text }}>{m.firstName} {m.lastName}</h1>
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 3 }}>
            <a href={`mailto:${m.email}`} style={{ color: 'inherit' }}>{m.email}</a>
            {m.phone && <> · <a href={`tel:${m.phone}`} style={{ color: 'inherit' }}>{m.phone}</a></>}
            {m.city && <> · {m.city}</>}
            {' '}· membre depuis {fmtDate(m.since)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {m.isSubscriber && <Chip tone="accent">Abonné</Chip>}
          {m.hasActivePackage && <Chip tone="accent">Carnet actif</Chip>}
          <Chip tone={m.status === 'BLOCKED' ? 'line' : 'accent'}>{m.status === 'BLOCKED' ? 'Bloqué' : 'Actif'}</Chip>
          {levelEnabled && game.level != null && <Chip tone="mute">Niv. {game.level.toFixed(1)}</Chip>}
          {loyalty.atRisk && (
            <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: '#fff', background: ACCENTS.coral, borderRadius: 999, padding: '4px 11px' }}>
              ⚠ À risque
            </span>
          )}
          <button
            onClick={toggleWatch}
            aria-pressed={watch}
            style={{
              cursor: 'pointer', borderRadius: 999, padding: '5px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
              border: watch ? 'none' : `1px solid ${th.line}`,
              background: watch ? ACCENTS.coral : 'transparent',
              color: watch ? '#fff' : th.textMute,
            }}
          >👁 {watch ? 'À surveiller' : 'Marquer à surveiller'}</button>
        </div>
      </div>

      {/* Bandeau d'alertes (impayé / carnet presque vide / abonnement qui expire) */}
      {alerts.length > 0 && (
        <div style={{ ...dangerBanner(th), display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
          {alerts.map((a) => <span key={a.key}>⚠ {a.label}</span>)}
        </div>
      )}
      {actionError && <div style={{ ...dangerBanner(th), marginBottom: 12 }}>{actionError}</div>}

      <div className="mb-cols">
        {/* ───────── Colonne gauche : profil, accès, contact, notes ───────── */}
        <div className="mb-left" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MemberProfileCard member={m} onSave={saveProfile} error={null} />
          <MemberAccessCard
            member={m}
            viewer={viewerUserId ? { userId: viewerUserId } : null}
            canManageStaff={admin}
            onSetRole={setRole}
            onSetCoach={setCoach}
            onSetReferee={setReferee}
            onSetSubscriber={setSubscriber}
            onToggleBlocked={toggleBlocked}
            onDelete={() => setConfirmRemove(true)}
          />

          {/* Contact — email/tel cliquables (le bouton « Envoyer un message » arrive avec la
              spec messages ciblés, hors périmètre ici). */}
          <section aria-label="Contact" style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow }}>
            <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, margin: '0 0 8px', color: th.text }}>Contact</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: th.fontUI, fontSize: 13.5 }}>
              <a href={`mailto:${m.email}`} style={{ color: th.accent, fontWeight: 600 }}>{m.email}</a>
              {m.phone
                ? <a href={`tel:${m.phone}`} style={{ color: th.accent, fontWeight: 600 }}>{m.phone}</a>
                : <span style={{ color: th.textFaint }}>Pas de téléphone renseigné.</span>}
            </div>
          </section>

          {/* Notes (commentaires staff) — reprend le contenu de l'ex-onglet Notes. */}
          <section aria-label="Notes du staff" style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow }}>
            <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 16, margin: '0 0 12px', color: th.text }}>
              Notes{notes.length ? ` (${notes.length})` : ''}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Ajouter un commentaire sur ce membre…"
                rows={3}
                style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 12, padding: '10px 12px', fontFamily: th.fontUI, fontSize: 13.5, resize: 'vertical' }}
              />
              <div>
                <Btn onClick={addNote} icon="plus" disabled={addingNote || !noteBody.trim()}>{addingNote ? '…' : 'Ajouter'}</Btn>
              </div>
            </div>

            {notes.length === 0 ? (
              <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Aucun commentaire pour l&apos;instant.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {notes.map((n) => (
                  <div key={n.id} style={{ borderLeft: `3px solid ${th.line}`, paddingLeft: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.text }}>
                        {n.author ? `${n.author.firstName} ${n.author.lastName}` : 'Staff'}
                      </span>
                      <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>{fmtDateTime(n.createdAt)}</span>
                      {confirmDelete === n.id ? (
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                          <button onClick={() => deleteNote(n.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: ACCENTS.coral, fontFamily: th.fontUI, fontSize: 12, fontWeight: 700 }}>Confirmer</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.textMute, fontFamily: th.fontUI, fontSize: 12 }}>Annuler</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDelete(n.id)} aria-label="Supprimer le commentaire" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontFamily: th.fontUI, fontSize: 12 }}>Supprimer</button>
                      )}
                    </div>
                    <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text, marginTop: 3, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ───────── Colonne droite : aperçus + le plus (détails complets) ───────── */}
        <div className="mb-right" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="mb-grid2">
            <MemberUpcomingCard data={data} />
            <MemberWalletCard data={data} onSubAction={openSubAction} onPkgAction={(mode, bal) => setPkgAction({ mode, bal })} />
          </div>

          <MemberReservationsCard data={data} onSeeAll={() => openDetail('activite')} />

          <div className="mb-grid2">
            <MemberPaymentsCard data={data} onCollect={() => router.push('/admin/encaissement')} />
            <MemberLoyaltyCard data={data} />
          </div>

          {/* ───────── Le plus — détails complets ───────── */}
          <div ref={detailRef}>
            <h2 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, letterSpacing: -0.3, margin: '6px 0 12px', color: th.text }}>
              Le plus — détails complets
            </h2>
            <Segmented<DetailTab>
              value={detail}
              onChange={setDetail}
              options={[
                { value: 'activite', label: 'Activité' },
                { value: 'finances', label: 'Finances' },
                { value: 'niveau', label: 'Niveau' },
                { value: 'fidelite', label: 'Fidélité' },
              ]}
            />

            <div style={{ marginTop: 16 }}>
              {/* ───────── Activité & réservations ───────── */}
              {detail === 'activite' && (
                <>
                  <div style={row}>
                    <StatCard label="Réservations" value={counts.total} accent hint={`${counts.upcoming} à venir`} />
                    <StatCard label="Confirmées" value={counts.confirmed} />
                    <StatCard label="Annulées" value={counts.cancelled} hint={cancellationLabel(loyalty.cancellationRate) + ' du total'} />
                    <StatCard label="Annulations tardives" value={counts.lateCancelled} hint="hors délai d'annulation" />
                    <StatCard label="No-show" value={counts.noShow} hint="estimation" />
                    <StatCard
                      label="No-show facturés"
                      value={counts.noShowCharged}
                      danger={counts.noShowCharged > 0}
                      hint={data.noShowChargedLastAt ? `dernier le ${fmtDate(data.noShowChargedLastAt)}` : 'aucun'}
                    />
                  </div>

                  <Section title="Habitudes de jeu">
                    <DayHourHeatmap matrix={data.heatmap} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                      {favorites.resource && <Chip tone="mute">Terrain favori : {favorites.resource.name}</Chip>}
                      {favorites.weekday && <Chip tone="mute">Jour favori : {weekdayLabel(favorites.weekday)}</Chip>}
                      {favorites.sportKey && <Chip tone="mute">Sport : {favorites.sportKey}</Chip>}
                    </div>
                  </Section>

                  <Section title="Historique des réservations">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, fontFamily: th.fontUI, fontSize: 13, color: th.textMute, cursor: 'pointer' }}>
                      <input type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} style={{ width: 16, height: 16, accentColor: th.accent, cursor: 'pointer' }} />
                      Annulations tardives seulement
                    </label>
                    {reservations.length === 0 ? (
                      <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>{onlyLate ? 'Aucune annulation tardive.' : 'Aucune réservation.'}</p>
                    ) : (
                      <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${th.line}`, textAlign: 'left' }}>
                              {['Date', 'Terrain', 'Type', 'Statut', 'Montant'].map((h) => (
                                <th key={h} style={{ padding: '8px 12px', fontFamily: th.fontUI, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: th.textMute }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {reservations.map((r) => (
                              <tr key={r.id} style={{ borderBottom: `1px solid ${th.line}`, opacity: r.status === 'CANCELLED' ? 0.6 : 1 }}>
                                <td style={td}>{fmtDateTime(r.startTime)}</td>
                                <td style={td}>{r.resourceName}</td>
                                <td style={td}>{TYPE_FR[r.type] ?? r.type}</td>
                                <td style={td}>
                                  <Chip tone={r.status === 'CANCELLED' ? 'line' : 'accent'}>
                                    {STATUS_FR[r.status] ?? r.status}{r.lateCancel ? ' (tardive)' : ''}
                                  </Chip>
                                </td>
                                <td style={{ ...td, fontWeight: 600 }}>{money(r.attributedAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Section>
                </>
              )}

              {/* ───────── Finances & valeur client ───────── */}
              {detail === 'finances' && (
                <>
                  <div style={row}>
                    <StatCard label="Total dépensé" value={money(finance.totalSpent)} accent />
                    <StatCard label="Panier moyen" value={money(finance.averageBasket)} />
                    <StatCard label="Reste dû" value={money(finance.outstanding)} hint={toCents(finance.outstanding) > 0 ? 'à encaisser' : 'soldé'} />
                  </div>

                  <Section title="Chiffre d'affaires par mois">
                    <MonthlyRevenueChart series={finance.revenueByMonth} />
                  </Section>

                  <Section title="Répartition des paiements">
                    <PaymentMethodChart byMethod={finance.paymentsByMethod} />
                  </Section>

                  <Section title="Prépayé (carnets / porte-monnaie)">
                    {finance.prepaid.balances.length === 0 ? (
                      <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Aucune formule prépayée.</p>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {finance.prepaid.balances.map((b) => {
                          const expired = !!b.expiresAt && new Date(b.expiresAt).getTime() < Date.now();
                          return (
                          <div key={b.id} style={{ background: th.surface2, borderRadius: 12, padding: '10px 14px', minWidth: 180 }}>
                            <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.text }}>{b.name}</div>
                            <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 3 }}>
                              {b.kind === 'ENTRIES' ? `${b.creditsRemaining ?? 0} entrée(s)` : `${b.amountRemaining ? money(b.amountRemaining) : '0 €'} restant`}
                              {b.expiresAt ? ` · expire le ${fmtDate(b.expiresAt)}` : ''}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                              <button
                                aria-label={`Recharger ${b.name}`}
                                disabled={expired}
                                onClick={() => setPkgAction({ mode: 'recharge', bal: b })}
                                title={expired ? 'Solde expiré — vendez une nouvelle offre' : undefined}
                                style={{ border: `1px solid ${th.line}`, background: 'transparent', color: expired ? th.textFaint : th.text, borderRadius: 8, padding: '5px 10px', cursor: expired ? 'default' : 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, opacity: expired ? 0.6 : 1 }}
                              >{expired ? 'Expiré' : 'Recharger'}</button>
                              <button
                                aria-label={`Corriger ${b.name}`}
                                onClick={() => setPkgAction({ mode: 'adjust', bal: b })}
                                style={{ border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600 }}
                              >Corriger</button>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                    {finance.prepaid.consumption.length > 0 && (
                      <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {finance.prepaid.consumption.slice(0, 12).map((c, i) => (
                          <li key={i} style={{ display: 'flex', gap: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                            <span>{fmtDateTime(c.at)}</span>
                            <span>· {c.packageName}</span>
                            <span style={{ marginLeft: 'auto', fontWeight: 600, color: th.text }}>{methodLabel(c.method)} {money(c.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                </>
              )}

              {/* ───────── Niveau & jeu ───────── */}
              {detail === 'niveau' && (
                <>
                  {/* (C2) Niveau courant par sport + fiabilité — données de la route ADMIN /level. */}
                  {levelEnabled && admin && (
                    <Section title="Niveau par sport">
                      {levelEntries.length === 0 ? (
                        <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, margin: 0 }}>Aucun niveau enregistré pour ce membre.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {levelEntries.map(([key, lvl]) => (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.textMute, minWidth: 90 }}>{sportName(key)}</span>
                              <span style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 700, color: th.text }}>{lvl.level.toFixed(1)}</span>
                              <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>{lvl.tier}</span>
                              {lvl.isProvisional && (
                                <span style={{ borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: '#ffb020', color: '#1a1a1a' }}>en calibrage</span>
                              )}
                              <ReliabilityMeter pct={lvl.reliability} />
                            </div>
                          ))}
                        </div>
                      )}
                    </Section>
                  )}

                  {/* (C2) Correction manuelle du niveau (override ADMIN 0–8) → recharge la fiche après succès. */}
                  {levelEnabled && admin && clubId && token && (
                    <div style={{ marginTop: 14 }}>
                      <LevelOverrideForm
                        clubId={clubId}
                        userId={userId}
                        token={token}
                        sports={formSports}
                        onSaved={load}
                      />
                    </div>
                  )}

                  {/* (C2) Historique des corrections (récent d'abord) — données de la route ADMIN /level. */}
                  {levelEnabled && admin && (
                    <Section title="Historique des corrections">
                      {adjustments.length === 0 ? (
                        <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textFaint, margin: 0 }}>Aucune correction manuelle pour l&apos;instant.</p>
                      ) : (
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {adjustments.map((h) => (
                            <li key={h.id} style={{ borderBottom: `1px solid ${th.line}`, paddingBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>
                                <span style={{ fontWeight: 700 }}>{h.previousLevel != null ? h.previousLevel.toFixed(1) : '—'} → {h.newLevel.toFixed(1)}</span>
                                {formSports.length > 1 && <span style={{ color: th.textMute }}>· {h.sportName}</span>}
                                <span style={{ color: th.textMute }}>· par {h.staffFirstName} {h.staffLastName}</span>
                                <span style={{ color: th.textFaint, fontSize: 12.5 }}>· {fmtAdjustDate(h.createdAt)}</span>
                              </div>
                              {h.reason && <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 3 }}>{h.reason}</div>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </Section>
                  )}

                  {/* (WIP) Statistiques de jeu — complémentaires : matchs, victoires, courbe, partenaires. */}
                  <div style={{ ...row, marginTop: 14 }}>
                    <StatCard label="Niveau" value={game.level != null ? game.level.toFixed(1) : '—'} accent hint={game.tier ? (game.isProvisional ? `${game.tier} · en calibrage` : game.tier) : 'à calibrer'} />
                    <StatCard label="Matchs" value={game.matchesPlayed} />
                    <StatCard label="Victoires" value={game.wins} hint={`${game.losses} défaite${game.losses > 1 ? 's' : ''}`} />
                    <StatCard label="Taux de victoire" value={winRate(game.wins, game.losses) != null ? `${winRate(game.wins, game.losses)}` : '—'} unit={winRate(game.wins, game.losses) != null ? '%' : undefined} />
                  </div>

                  <Section title="Progression du niveau">
                    <LevelHistoryChart points={game.levelPoints} />
                  </Section>

                  <Section title="Partenaires fréquents">
                    {game.frequentPartners.length === 0 ? (
                      <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Pas encore de partenaire récurrent.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {game.frequentPartners.map((p) => (
                          <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={30} color={colorForSeed(p.userId)} />
                            <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.text }}>{p.firstName} {p.lastName}</span>
                            <span style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>{p.count} match{p.count > 1 ? 's' : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                </>
              )}

              {/* ───────── Fidélité & risque ───────── */}
              {detail === 'fidelite' && (
                <>
                  <div style={row}>
                    <StatCard label="Ancienneté" value={tenureLabel(loyalty.tenureDays)} accent />
                    <StatCard label="Dernière visite" value={lastVisitLabel(loyalty.daysSinceLastVisit) ?? '—'} />
                    <StatCard label="Fréquence" value={loyalty.playsPerMonth} unit="/ mois" />
                    <StatCard label="Taux d'annulation" value={cancellationLabel(loyalty.cancellationRate)} />
                  </div>

                  <Section title="Engagement">
                    <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, lineHeight: 1.6 }}>
                      {loyalty.firstVisitAt
                        ? <>Première partie le <strong style={{ color: th.text }}>{fmtDate(loyalty.firstVisitAt)}</strong>. </>
                        : <>Aucune partie confirmée à ce jour. </>}
                      {loyalty.atRisk
                        ? <span style={{ color: ACCENTS.coral, fontWeight: 600 }}>Joueur à relancer : sans visite depuis plus de 45 jours.</span>
                        : loyalty.lastVisitAt && <>Joueur actif.</>}
                    </div>
                  </Section>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {pkgAction && token && clubId && (
        <PackageBalanceDialog
          clubId={clubId} userId={userId} token={token}
          mode={pkgAction.mode} bal={pkgAction.bal}
          onClose={() => setPkgAction(null)} onDone={load}
        />
      )}

      {subAction && data.subscription && token && clubId && (
        <SubscriptionActions
          action={subAction}
          clubId={clubId}
          token={token}
          plans={plans.map((p): SubscriptionPlanSummary => ({
            id: p.id, name: p.name, monthlyPrice: p.monthlyPrice, benefit: p.benefit,
            discountPercent: p.discountPercent, sportKeys: p.sportKeys, isActive: p.isActive, activeCount: 0,
          }))}
          sub={{
            id: data.subscription.id, planId: data.subscription.planId, planName: data.subscription.planName,
            expiresAt: data.subscription.expiresAt, monthlyPriceSnapshot: data.subscription.monthlyPriceSnapshot,
          }}
          onClose={() => setSubAction(null)}
          onDone={() => { setSubAction(null); void load(); }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Supprimer ce membre ?"
          detail={<>{m.firstName} {m.lastName} · {m.email}</>}
          message="Le membre est retiré du fichier (ses réservations existantes sont conservées). Il pourra re-rejoindre automatiquement en réservant. Pour couper l'accès durablement, utilisez plutôt « Bloquer »."
          confirmLabel="Supprimer"
          cancelLabel="Retour"
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}
