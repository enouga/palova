'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, SubscriptionOverview, SubscriberRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { Theme, ACCENTS } from '@/lib/theme';
import { Icon, IconName } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { clubIsMultiSport } from '@/lib/sportBadge';
import { filterRegistry, isActiveSub, expiresSoon, daysUntil, RegistryMode } from '@/lib/subscriptionAdmin';
import { SubscriptionActions } from '@/components/admin/subscriptions/SubscriptionActions';

const eur = (cents: number) => (cents % 100 === 0 ? `${cents / 100} €` : `${(cents / 100).toFixed(2).replace('.', ',')} €`);
const eurStr = (s: string) => { const n = Number(s); return n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ','); };
const fdate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

export default function AdminSubscribersPage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const multiSport = clubIsMultiSport(club as any);
  const [data, setData] = useState<SubscriptionOverview | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<RegistryMode>('active');
  const [planId, setPlanId] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: 'renew' | 'change' | 'cancel'; sub: SubscriberRow } | null>(null);

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setData(await api.adminGetSubscriptionOverview(clubId, token));
  }, [token, clubId]);
  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);
  useEffect(() => { setNow(Date.now()); }, []);

  if (!data || now === null) return <div style={{ padding: 24, color: th.textMute }}>Chargement…</div>;
  const rows = filterRegistry(data.subscribers, { query, mode, planId }, now);
  const totalActive = data.kpis.activeCount || 1;

  return (
    <div style={{ padding: '20px 22px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 28, fontWeight: 800, letterSpacing: -0.6, color: th.text, margin: '0 0 4px' }}>Abonnés</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 18 }}>Les abonnements vendus par le club — qui, à quel forfait, jusqu’à quand.</p>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Kpi th={th} icon="bolt" tint={ACCENTS.blue} value={String(data.kpis.activeCount)} label="Abonnés actifs" />
        <Kpi th={th} icon="euro" tint={ACCENTS.emerald} value={eur(data.kpis.monthlyRevenueCents)} label="Revenu / mois" />
        <Kpi th={th} icon="clock" tint={ACCENTS.coral} value={String(data.kpis.expiringSoonCount)} label="Expirent sous 30 j" />
      </div>

      {/* Cartes forfait */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {data.plans.map((p, i) => {
          const c = ACCENTS[(['blue', 'coral', 'apricot', 'cyan', 'emerald'] as const)[i % 5]] ?? th.accent;
          const on = planId === p.id;
          return (
            <button key={p.id} type="button" onClick={() => setPlanId(on ? null : p.id)}
              style={{ flex: '1 1 200px', textAlign: 'left', background: th.surface, borderRadius: 14, padding: '13px 15px', border: 'none',
                boxShadow: on ? `0 0 0 2px ${c}` : th.shadow, borderLeft: `4px solid ${c}`, opacity: p.activeCount === 0 ? 0.6 : 1, cursor: 'pointer' }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, color: th.text }}>{p.name}
                {multiSport && p.sportKeys[0] && <span style={{ marginLeft: 6, fontSize: 10.5, color: th.textFaint }}>· {p.sportKeys.join(', ')}</span>}
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textMute }}>{eurStr(p.monthlyPrice)} €/mois</div>
              <div style={{ fontFamily: th.fontDisplay, fontSize: 20, fontWeight: 800, letterSpacing: -0.6, color: th.text, marginTop: 4 }}>{p.activeCount} <small style={{ fontSize: 11, color: th.textMute, fontWeight: 600 }}>abonné{p.activeCount > 1 ? 's' : ''}</small></div>
              <div style={{ height: 5, background: th.surface2, borderRadius: 3, marginTop: 8 }}>
                <div style={{ height: '100%', width: `${Math.round((p.activeCount / totalActive) * 100)}%`, background: c, borderRadius: 3 }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un membre…"
          style={{ flex: '1 1 200px', border: `1px solid ${th.lineStrong}`, borderRadius: 999, padding: '8px 14px', background: th.surface, color: th.text, fontFamily: th.fontUI, fontSize: 12.5 }} />
        {(['active', 'soon', 'history'] as RegistryMode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
            style={{ border: `1px solid ${mode === m ? th.text : th.lineStrong}`, background: mode === m ? th.text : th.surface, color: mode === m ? th.bg : th.textMute, borderRadius: 999, padding: '7px 13px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
            {m === 'active' ? 'Actifs' : m === 'soon' ? 'Expirent bientôt' : 'Historique'}
          </button>
        ))}
      </div>

      {/* Registre */}
      {rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13, background: th.surface, borderRadius: 14 }}>Aucun abonné.</div>
      ) : rows.map((s) => {
        const soon = expiresSoon(s, now);
        const active = isActiveSub(s, now);
        return (
          <div key={s.id} data-sub-row style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 12, padding: '11px 13px', marginBottom: 6, borderLeft: `4px solid ${soon ? ACCENTS.coral : 'transparent'}`, boxShadow: th.shadow }}>
            <Avatar firstName={s.user.firstName} lastName={s.user.lastName} avatarUrl={s.user.avatarUrl} color={colorForSeed(s.user.id)} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, color: th.text }}>{s.user.firstName} {s.user.lastName}</div>
              <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>{s.planName} · depuis le {fdate(s.startedAt)}</div>
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {active
                ? <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px', background: soon ? '#fdeee2' : '#e3f0e6', color: soon ? '#b45309' : '#2c7a44' }}>{soon ? `Expire J-${daysUntil(s.expiresAt, now)}` : 'Actif'}</span>
                : <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px', background: th.surface2, color: th.textMute }}>Terminé</span>}
              <div style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint, marginTop: 2 }}>{fdate(s.expiresAt)}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {active && <>
                <IconBtn th={th} label="Renouveler" onClick={() => setAction({ kind: 'renew', sub: s })}><Icon name="arrowR" size={14} color={th.textMute} /></IconBtn>
                <IconBtn th={th} label="Changer" onClick={() => setAction({ kind: 'change', sub: s })}><Icon name="settings" size={14} color={th.textMute} /></IconBtn>
                <IconBtn th={th} label="Résilier" onClick={() => setAction({ kind: 'cancel', sub: s })}><Icon name="x" size={14} color={ACCENTS.coral} /></IconBtn>
              </>}
            </div>
          </div>
        );
      })}

      {action && (
        <SubscriptionActions action={action.kind} sub={action.sub} plans={data.plans} clubId={clubId!} token={token!}
          onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />
      )}
    </div>
  );
}

function Kpi({ th, icon, tint, value, label }: { th: Theme; icon: IconName; tint: string; value: string; label: string }) {
  return (
    <div style={{ flex: '1 1 180px', display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 14, padding: '14px 16px', boxShadow: th.shadow }}>
      <span style={{ width: 38, height: 38, borderRadius: 11, background: `${tint}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={17} color={tint} /></span>
      <div>
        <div style={{ fontFamily: th.fontDisplay, fontSize: 22, fontWeight: 800, letterSpacing: -0.7, color: th.text }}>{value}</div>
        <div style={{ fontFamily: th.fontUI, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: th.textMute }}>{label}</div>
      </div>
    </div>
  );
}
function IconBtn({ th, label, onClick, children }: { th: Theme; label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${th.lineStrong}`, background: th.surface, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</button>;
}
