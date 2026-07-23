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
import { ACCENTS, dangerBanner, inkOn } from '@/lib/theme';
import { Chip, BackButton, Btn } from '@/components/ui/atoms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Icon, type IconName } from '@/components/ui/Icon';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Kicker, MEMBER_CARD_TINTS, memberCardStyle } from '@/components/admin/members/memberCardUi';
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

// Les quatre « portes » du bloc détails complets (repliées par défaut — c'est ce bloc
// qui faisait les deux tiers de la hauteur de page ; on n'en paie le scroll que sur demande).
const DETAIL_DOORS: { key: DetailTab; label: string; icon: IconName; tint: string }[] = [
  { key: 'activite', label: 'Activité', icon: 'chart', tint: MEMBER_CARD_TINTS.blue },
  { key: 'finances', label: 'Finances', icon: 'euro', tint: MEMBER_CARD_TINTS.green },
  { key: 'niveau', label: 'Niveau', icon: 'ball', tint: MEMBER_CARD_TINTS.violet },
  { key: 'fidelite', label: 'Fidélité', icon: 'user', tint: MEMBER_CARD_TINTS.amber },
];

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
    <div style={{ flex: 1, minWidth: 140, background: th.surface, borderRadius: 18, padding: '16px 18px', boxShadow: th.shadow }}>
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
    <div style={{ background: th.surface, borderRadius: 18, padding: 18, boxShadow: th.shadow, marginTop: 14 }}>
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
  // null = bloc détails replié (défaut) : on n'affiche les tableaux/graphes qu'à la demande.
  const [detail, setDetail] = useState<DetailTab | null>(null);
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
  // userId pour lequel on a déjà des données affichées — sert à distinguer le chargement
  // initial (plein écran « Chargement… » légitime) d'un reload déclenché par une mutation
  // réussie (rôle, coach, blocage…) : ce dernier ne doit PAS faire disparaître tout le
  // cockpit derrière l'écran de chargement (juste rafraîchir les données une fois arrivées).
  // Un ref (pas un état) évite d'avoir à ajouter `data` aux deps de `load` — ce qui
  // recréerait son identité à chaque reload et bouclerait l'effet de montage ci-dessous.
  const loadedForRef = useRef<string | null>(null);
  // Ancre de scroll du bloc « Le plus — détails complets » (cible du lien « Tout l'historique → »).
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token || !clubId || !userId) return;
    const reqId = ++reqIdRef.current;
    // Plein écran « Chargement… » seulement pour le tout premier chargement de CE membre
    // (loadedForRef pas encore posé sur ce userId) — un reload déclenché par une mutation
    // réussie (rôle, coach, blocage…) sur un membre déjà affiché ne doit pas faire
    // disparaître le cockpit, juste rafraîchir les données une fois la réponse arrivée.
    if (loadedForRef.current !== userId) setLoading(true);
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
      loadedForRef.current = userId;
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
  // Chips du hero brume bleue : encre fixe sur pastille translucide (statuts) ou corail (alertes).
  const heroChip: CSSProperties = { background: 'rgba(255,255,255,.72)', color: HERO_INK, borderRadius: 999, padding: '3px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700 };
  const heroAlertChip: CSSProperties = { background: ACCENTS.coral, color: inkOn(ACCENTS.coral), borderRadius: 999, padding: '3px 10px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 700 };

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

      {/* Hero « carte de joueur » — brume bleue à encres fixes (lisible clair + sombre),
          alertes fondues en chips corail (plus de bandeau séparé). */}
      <div style={{ background: HERO_GRADIENT, borderRadius: 20, padding: '18px 22px', margin: '14px 0 14px', position: 'relative', overflow: 'hidden' }}>
        <div aria-hidden style={{ position: 'absolute', right: -34, top: -52, width: 180, height: 180, border: '16px solid rgba(255,255,255,.3)', borderRadius: '50%' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', position: 'relative' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} size={64} color={colorForSeed(m.userId)} />
            {levelEnabled && game.level != null && (
              <span style={{
                position: 'absolute', bottom: -5, right: -10, background: HERO_INK, color: '#fff',
                borderRadius: 8, padding: '2px 8px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 800,
                border: '2px solid #dde9f7', whiteSpace: 'nowrap',
              }}>Niv. {game.level.toFixed(1)}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 27, letterSpacing: -0.5, margin: 0, color: HERO_INK }}>{m.firstName} {m.lastName}</h1>
            <div style={{ fontFamily: th.fontUI, fontSize: 13, color: HERO_INK_MUTED, marginTop: 3 }}>
              <a href={`mailto:${m.email}`} style={{ color: 'inherit' }}>{m.email}</a>
              {m.phone && <> · <a href={`tel:${m.phone}`} style={{ color: 'inherit' }}>{m.phone}</a></>}
              {m.city && <> · {m.city}</>}
              {' '}· membre depuis {fmtDate(m.since)}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
              <span style={heroChip}>{m.status === 'BLOCKED' ? 'Bloqué' : 'Actif'}</span>
              {m.isSubscriber && <span style={heroChip}>Abonné</span>}
              {m.hasActivePackage && <span style={heroChip}>Carnet actif</span>}
              {alerts.map((a) => <span key={a.key} style={heroAlertChip}>⚠ {a.label}</span>)}
              {loyalty.atRisk && <span style={heroAlertChip}>⚠ À risque</span>}
            </div>
          </div>
          <button
            onClick={toggleWatch}
            aria-pressed={watch}
            style={{
              cursor: 'pointer', borderRadius: 999, padding: '6px 13px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
              border: watch ? 'none' : `1px solid rgba(24,21,14,0.3)`,
              background: watch ? ACCENTS.coral : 'rgba(255,255,255,.55)',
              color: watch ? inkOn(ACCENTS.coral) : HERO_INK,
              alignSelf: 'flex-start', flexShrink: 0,
            }}
          >👁 {watch ? 'À surveiller' : 'Marquer à surveiller'}</button>
        </div>
      </div>

      {actionError && <div style={{ ...dangerBanner(th), marginBottom: 12 }}>{actionError}</div>}

      <div className="mb-grid">
        {/* ───────── Colonne 1 : profil éditable ───────── */}
        <MemberProfileCard member={m} onSave={saveProfile} error={null} />

        {/* ───────── Colonne 2 : accès + notes ───────── */}
        <div className="mb-col">
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

          {/* Notes (commentaires staff) — reprend le contenu de l'ex-onglet Notes.
              (Le contact email/tel vit dans le hero ; le bouton « Envoyer un message »
              arrive avec la spec messages ciblés, hors périmètre ici.) */}
          <section aria-label="Notes du staff" style={memberCardStyle(th)}>
            <Kicker color={MEMBER_CARD_TINTS.teal}>Notes{notes.length ? ` · ${notes.length}` : ''}</Kicker>
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

        {/* ───────── Colonne 3 : à venir + portefeuille ───────── */}
        <div className="mb-col">
          <MemberUpcomingCard data={data} />
          <MemberWalletCard data={data} onSubAction={openSubAction} onPkgAction={(mode, bal) => setPkgAction({ mode, bal })} />
        </div>

        {/* ───────── Rangée 2 : réservations (large) + argent/fidélité ───────── */}
        <div className="mb-wide">
          <MemberReservationsCard data={data} onSeeAll={() => openDetail('activite')} />
        </div>
        <div className="mb-col">
          <MemberPaymentsCard data={data} onCollect={() => router.push('/admin/encaissement')} />
          <MemberLoyaltyCard data={data} />
        </div>
      </div>

      {/* ───────── Les portes du détail (repliées par défaut) — cliquer ouvre le bloc
          correspondant sous la rangée, re-cliquer referme. ───────── */}
      <div ref={detailRef}>
        <div className="mb-doors">
          {DETAIL_DOORS.map((d) => {
            const open = detail === d.key;
            return (
              <button
                key={d.key}
                onClick={() => setDetail(open ? null : d.key)}
                aria-expanded={open}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', cursor: 'pointer',
                  background: th.surface, border: 'none', borderRadius: 14, padding: '12px 14px',
                  boxShadow: open ? `inset 0 0 0 2px ${d.tint}, ${th.shadow}` : th.shadow,
                  fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, color: th.text,
                }}
              >
                <span aria-hidden style={{
                  width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: `${d.tint}26`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name={d.icon} size={16} color={d.tint} />
                </span>
                {d.label}
                <span aria-hidden style={{ marginLeft: 'auto', color: th.textFaint, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
              </button>
            );
          })}
        </div>

        {detail != null && (
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
        )}
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
