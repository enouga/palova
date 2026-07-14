'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { api, Member, MemberHistory, MemberNote, AdminMemberLevel, PaymentMethod } from '@/lib/api';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { resasLast30, spent12moCents, reliabilityPct, unpaidTotalCents } from '@/lib/memberCockpit';
import { fmtEuros } from '@/lib/caisse';
import { StaffRole } from '@/components/admin/StaffRoleMenu';
import { CockpitHeader } from './CockpitHeader';
import { MoneyCard } from './MoneyCard';
import { LifeCard } from './LifeCard';
import { GameCard } from './GameCard';
import { NotesCard } from './NotesCard';

const CORAL = '#ff7a4d';

export function MemberCockpit({ member, viewerUserId, canManageStaff, quickMethods, payAtClubOnly, onChanged, onSetRole, onToggleBlocked, onDelete, onClose }: {
  member: Member;
  viewerUserId: string | null;
  canManageStaff: boolean;
  /** Moyens rapides + option « paiement au club » du club — vivent sur ClubAdminDetail (pas la ClubDetail publique de useClub()), donc fournis par la page. */
  quickMethods: PaymentMethod[];
  payAtClubOnly: boolean;
  onChanged: () => void;            // recharge la liste côté page
  onSetRole: (role: StaffRole) => void;
  onToggleBlocked: () => void;
  onDelete: () => void;
  onClose?: () => void;             // mobile
}) {
  const { th } = useTheme();
  const { token } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const levelEnabled = club?.levelSystemEnabled !== false;
  const multiSport = clubIsMultiSport(club as Parameters<typeof clubIsMultiSport>[0]);
  const clubSports = ((club as { clubSports?: { sport: { key: string; name: string } }[] } | null)?.clubSports ?? [])
    .map((cs) => ({ key: cs.sport.key, name: cs.sport.name }));

  const [history, setHistory] = useState<MemberHistory | null>(null);
  const [notes, setNotes] = useState<MemberNote[]>([]);
  const [levelData, setLevelData] = useState<AdminMemberLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watch, setWatch] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      setError(null);
      const [h, n, lvl] = await Promise.all([
        api.adminGetMemberHistory(clubId, member.userId, token),
        api.adminGetMemberNotes(clubId, member.userId, token).catch(() => [] as MemberNote[]),
        levelEnabled ? api.adminGetMemberLevel(clubId, member.userId, token).catch(() => null) : Promise.resolve(null),
      ]);
      if (reqId !== reqIdRef.current) return;
      setHistory(h); setNotes(n); setLevelData(lvl); setWatch(h.member.watch); setNowMs(Date.now());
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError((e as Error).message === 'MEMBER_NOT_FOUND' ? 'Membre introuvable dans ce club.' : (e as Error).message);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [token, clubId, member.userId, levelEnabled]);

  useEffect(() => { load(); }, [load]);

  const toggleWatch = async () => {
    if (!token || !clubId) return;
    const next = !watch;
    setWatch(next);
    try { await api.adminSetMemberWatch(clubId, member.userId, next, token); onChanged(); }
    catch (e) { setWatch(!next); setError((e as Error).message); }
  };

  const refresh = () => { load(); onChanged(); };

  if (loading && !history) return <div style={{ padding: '28px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>;
  if (error && !history) return <div style={{ padding: '18px 0', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: CORAL }}>{error}</div>;
  if (!history || !token || !clubId) return null;

  const unpaidCents = unpaidTotalCents(history.finance.unpaid);
  const kpi = (label: string, value: string, coral?: boolean) => (
    <div style={{ flex: 1, minWidth: 96, background: th.surface, borderRadius: 12, padding: '8px 12px', boxShadow: th.shadow }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute }}>{label}</div>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 19, fontWeight: 600, marginTop: 2, color: coral ? CORAL : th.text, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <CockpitHeader
        member={member} history={history} watch={watch} unpaidCents={unpaidCents}
        canManageStaff={canManageStaff} viewerUserId={viewerUserId}
        onToggleWatch={toggleWatch} onToggleBlocked={onToggleBlocked} onSetRole={onSetRole} onDelete={onDelete}
        onCollect={() => document.getElementById('cockpit-money')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        onClose={onClose}
      />

      {error && <div style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: CORAL }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {kpi('Résas 30 j', String(resasLast30(history.reservations, nowMs)))}
        {kpi('Reste dû', fmtEuros(unpaidCents), unpaidCents > 0)}
        {kpi('Niveau', history.game.level != null ? history.game.level.toFixed(1) : '—')}
        {kpi('Fiabilité', `${reliabilityPct(history.loyalty.cancellationRate)} %`)}
        {kpi('Dépensé 12 mois', fmtEuros(spent12moCents(history.finance.revenueByMonth, nowMs)))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, alignItems: 'start' }}>
        <MoneyCard member={member} history={history} clubId={clubId} token={token}
          quickMethods={quickMethods} payAtClubOnly={payAtClubOnly}
          onChanged={refresh} onError={setError} />
        <LifeCard history={history} multiSport={multiSport} />
        {levelEnabled && (
          <GameCard history={history} levelData={levelData} clubId={clubId} userId={member.userId}
            token={token} clubSports={clubSports} onSaved={refresh} />
        )}
        <NotesCard member={member} notes={notes} clubId={clubId} token={token}
          onChanged={refresh} onNotesChanged={setNotes} onError={setError} />
      </div>
    </div>
  );
}
