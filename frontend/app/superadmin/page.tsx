'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api, PlatformStats } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';

function Card({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 12.5, color: th.textMute, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color: th.text, fontFamily: th.fontMono, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: th.textFaint, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

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
          <Card label="Clubs" value={stats.clubs.total} sub={`${stats.clubs.active} actifs · ${stats.clubs.suspended} suspendus`} />
          <Card label="Utilisateurs" value={stats.users} />
          <Card label="Réservations" value={stats.reservations} />
          <Card label="Tournois" value={stats.tournaments} />
        </div>
      )}
    </div>
  );
}
