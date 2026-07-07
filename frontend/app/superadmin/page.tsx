'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api, PlatformStats } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { eurosFromCents } from '@/lib/payments';
import { KpiCard } from '@/components/superadmin/KpiCard';

export default function SuperAdminDashboard() {
  const { th } = useTheme();
  const { token } = useAuth();
  const [stats, setStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.platformStats(token)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 30, fontWeight: 600, color: th.text, marginBottom: 24 }}>
        Tableau de bord plateforme
      </h1>
      {!stats ? (
        <div style={{ color: th.textFaint, fontFamily: th.fontUI }}>Chargement…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <KpiCard label="Clubs" value={stats.clubs.total} sub={`${stats.clubs.active} actifs · ${stats.clubs.suspended} suspendus`} href="/superadmin/clubs" />
          <KpiCard label="Utilisateurs" value={stats.users} />
          <KpiCard label="Réservations" value={stats.reservations} href="/superadmin/stats" />
          <KpiCard label="Tournois" value={stats.tournaments} />
          <KpiCard label="MRR" value={eurosFromCents(stats.billing.mrrCents)}
            sub={`paliers : ${stats.billing.byTier.map((n, i) => `T${i}·${n}`).join('  ')}`} href="/superadmin/billing" />
          <KpiCard label="À régulariser" value={stats.billing.toRegularize} sub="clubs au-dessus du gratuit sans abonnement" href="/superadmin/billing" />
          <KpiCard label="Impayés" value={stats.billing.pastDue} sub="abonnements en échec de paiement" href="/superadmin/billing" />
        </div>
      )}
    </div>
  );
}
