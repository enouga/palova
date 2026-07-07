'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { api, PlatformBillingOverview, PlatformClub } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { eurosFromCents } from '@/lib/payments';
import { KpiCard } from '@/components/superadmin/KpiCard';
import { MonthlyRevenueChart } from '@/components/admin/stats/MonthlyRevenueChart';
import { centsSeriesToDecimal } from '@/lib/platformStats';
import { BILLING_STATE_LABEL, intervalLabel, formatDate } from '@/lib/platformBilling';
import { tierLabel } from '@/lib/platformTiers';

/** Barres horizontales de répartition par palier (observé vs souscrit). */
function TierBars({ title, counts }: { title: string; counts: number[] }) {
  const { th } = useTheme();
  const max = Math.max(1, ...counts);
  return (
    <div>
      <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.textMute, marginBottom: 8 }}>{title}</div>
      {counts.map((n, tier) => (
        <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontFamily: th.fontMono, fontSize: 12, color: th.textMute, width: 26 }}>T{tier}</span>
          <div style={{ flex: 1, height: 14, borderRadius: 7, background: th.surface2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(n / max) * 100}%`, background: th.accent, borderRadius: 7 }} />
          </div>
          <span style={{ fontFamily: th.fontMono, fontSize: 12.5, color: th.text, width: 26, textAlign: 'right' }}>{n}</span>
        </div>
      ))}
      <div style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint, marginTop: 6 }}>
        T0 gratuit · T1–T4 : {tierLabel(1).replace('0+ ', '')}…
      </div>
    </div>
  );
}

export default function SuperAdminBilling() {
  const { th } = useTheme();
  const { token } = useAuth();
  const [overview, setOverview] = useState<PlatformBillingOverview | null>(null);
  const [clubs, setClubs] = useState<PlatformClub[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    api.platformBillingOverview(token).then(setOverview).catch(() => setOverview(null));
    api.platformClubs(token).then(setClubs).catch(() => setClubs([]));
  }, [token]);

  useEffect(load, [load]);

  async function sync() {
    if (!token || syncing) return;
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await api.platformSyncInvoices(token);
      setSyncMsg(`${r.imported} facture${r.imported > 1 ? 's' : ''} synchronisée${r.imported > 1 ? 's' : ''} sur ${r.clubs} club${r.clubs > 1 ? 's' : ''}.`);
      load();
    } catch {
      setSyncMsg('Échec de la synchronisation Stripe. Réessayez.');
    } finally { setSyncing(false); }
  }

  const card: React.CSSProperties = {
    background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 14, padding: '18px 20px', marginBottom: 16,
  };

  // Clubs facturables : hors palier gratuit ou avec un abonnement live.
  const payingClubs = clubs.filter((c) => c.billing.state !== 'FREE' || c.billing.subscription != null);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontSize: 28, fontWeight: 700, color: th.text, margin: 0 }}>Facturation</h1>
        <button onClick={sync} disabled={syncing} style={{
          border: `1px solid ${th.line}`, background: 'transparent', color: th.text,
          borderRadius: 9, padding: '8px 14px', cursor: syncing ? 'default' : 'pointer', fontSize: 13.5, fontWeight: 600,
        }}>
          {syncing ? 'Synchronisation…' : 'Synchroniser Stripe'}
        </button>
      </div>
      {syncMsg && (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginBottom: 16 }}>{syncMsg}</div>
      )}

      {!overview ? (
        <div style={{ color: th.textFaint, fontFamily: th.fontUI }}>Chargement…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 22 }}>
            <KpiCard label="MRR" value={eurosFromCents(overview.mrrCents)} sub="revenu mensuel récurrent" />
            <KpiCard label="Encaissé (total)" value={eurosFromCents(overview.totalCollectedCents)} sub={`${overview.invoiceCount} factures payées`} />
            <KpiCard label="À régulariser" value={overview.toRegularize} sub="au-dessus du gratuit sans abonnement" />
            <KpiCard label="Impayés" value={overview.pastDue} sub="paiements en échec" />
          </div>

          <section style={card}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text, marginBottom: 12 }}>
              Chiffre d&apos;affaires encaissé / mois
            </div>
            <MonthlyRevenueChart series={centsSeriesToDecimal(overview.revenueByMonth)} />
          </section>

          <section style={card}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
              <TierBars title="Clubs par palier observé" counts={overview.byTierObserved} />
              <TierBars title="Clubs par palier souscrit" counts={overview.byTierSubscribed} />
            </div>
          </section>

          <section style={card}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text, marginBottom: 12 }}>
              Clubs facturables ({payingClubs.length})
            </div>
            {payingClubs.length === 0 ? (
              <p style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, margin: 0 }}>Aucun club au-dessus du palier gratuit.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead><tr>
                    {['Club', 'État', 'Souscrit', 'Observé', 'Cadence', 'Échéance'].map((h, i) => (
                      <th key={i} style={{ textAlign: 'left', padding: '6px 8px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${th.line}` }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {payingClubs.map((c) => (
                      <tr key={c.id}>
                        <td style={{ padding: '9px 8px', fontSize: 13.5, borderBottom: `1px solid ${th.line}` }}>
                          <Link href={`/superadmin/clubs/${c.id}`} style={{ color: th.text, textDecoration: 'none', fontWeight: 600 }}>{c.name}</Link>
                        </td>
                        <td style={{ padding: '9px 8px', fontSize: 12.5, fontWeight: 700, borderBottom: `1px solid ${th.line}`, color:
                          c.billing.state === 'OK' ? th.accent : c.billing.state === 'PAST_DUE' ? '#c4472e'
                          : c.billing.state === 'TO_REGULARIZE' ? '#e8804f' : th.textFaint }}>
                          {BILLING_STATE_LABEL[c.billing.state]}
                        </td>
                        <td style={{ padding: '9px 8px', fontSize: 13, color: th.textMute, borderBottom: `1px solid ${th.line}` }}>
                          {c.billing.subscribedTier != null ? `T${c.billing.subscribedTier}` : '—'}
                        </td>
                        <td style={{ padding: '9px 8px', fontSize: 13, color: th.textMute, borderBottom: `1px solid ${th.line}` }}>T{c.billing.observedTier}</td>
                        <td style={{ padding: '9px 8px', fontSize: 13, color: th.textMute, borderBottom: `1px solid ${th.line}` }}>
                          {c.billing.subscription ? intervalLabel(c.billing.subscription.interval) : '—'}
                          {c.billing.subscription?.cancelAtPeriodEnd && <span style={{ color: '#e8804f' }}> · annulé</span>}
                        </td>
                        <td style={{ padding: '9px 8px', fontSize: 12.5, color: th.textFaint, borderBottom: `1px solid ${th.line}` }}>
                          {c.billing.subscription ? formatDate(c.billing.subscription.currentPeriodEnd) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
