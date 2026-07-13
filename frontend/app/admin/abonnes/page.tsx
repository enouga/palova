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

  // Regroupement par sport (le sport d'un abonnement = le snapshot de son forfait).
  const sportName = (key: string) => {
    const cs = (club as { clubSports?: { sport?: { key: string; name: string } }[] } | null)?.clubSports?.find((c) => c.sport?.key === key)?.sport?.name;
    return cs ?? key.charAt(0).toUpperCase() + key.slice(1);
  };
  const bySport = new Map<string, SubscriberRow[]>();
  for (const s of rows) { const k = s.sportKeys[0] ?? 'autre'; const a = bySport.get(k); if (a) a.push(s); else bySport.set(k, [s]); }
  const sportGroups = [...bySport.entries()];
  const showSportHeaders = sportGroups.length > 1;

  return (
    <div style={{ maxWidth: 1080 }}>
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

      {/* Registre groupé par sport */}
      {rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: th.textFaint, fontFamily: th.fontUI, fontSize: 13, background: th.surface, borderRadius: 14 }}>Aucun abonné.</div>
      ) : sportGroups.map(([sportKey, list]) => (
        <div key={sportKey} style={{ marginBottom: 8 }}>
          {showSportHeaders && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
              <Icon name="ball" size={14} color={th.textMute} />
              <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.6, color: th.textMute }}>{sportName(sportKey)}</span>
              <span style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textFaint }}>{list.length}</span>
              <div style={{ flex: 1, height: 1, background: th.line }} />
            </div>
          )}
          {list.map((s) => {
            const soon = expiresSoon(s, now);
            const active = isActiveSub(s, now);
            return (
              <div key={s.id} data-sub-row style={{ display: 'flex', alignItems: 'center', gap: 12, background: th.surface, borderRadius: 12, padding: '11px 14px', marginBottom: 6, borderLeft: `3px solid ${soon ? ACCENTS.coral : active ? th.accent : th.lineStrong}`, boxShadow: th.shadow, flexWrap: 'wrap' }}>
                <Avatar firstName={s.user.firstName} lastName={s.user.lastName} avatarUrl={s.user.avatarUrl} color={colorForSeed(s.user.id)} size={34} />
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text }}>{s.user.firstName} {s.user.lastName}</div>
                  <div style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, marginTop: 1 }}>{s.planName} · {eurStr(s.monthlyPriceSnapshot)} €/mois</div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {active
                    ? <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: soon ? '#fdeee2' : '#e3f0e6', color: soon ? '#b45309' : '#2c7a44' }}>{soon ? `Expire dans ${daysUntil(s.expiresAt, now)} j` : 'Actif'}</span>
                    : <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: th.surface2, color: th.textMute }}>Terminé</span>}
                  <div style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint, marginTop: 3 }}>{active ? `échéance ${fdate(s.expiresAt)}` : `depuis le ${fdate(s.startedAt)}`}</div>
                </div>
                {active && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => setAction({ kind: 'renew', sub: s })} style={actionBtn(th, false)}>Renouveler</button>
                    <button type="button" onClick={() => setAction({ kind: 'change', sub: s })} style={actionBtn(th, false)}>Changer</button>
                    <button type="button" onClick={() => setAction({ kind: 'cancel', sub: s })} style={actionBtn(th, true)}>Résilier</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

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
const actionBtn = (th: Theme, danger: boolean): React.CSSProperties => ({
  border: `1px solid ${danger ? '#f0b8a4' : th.lineStrong}`, background: th.surface,
  color: danger ? ACCENTS.coral : th.textMute, borderRadius: 999, padding: '6px 13px',
  fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});
