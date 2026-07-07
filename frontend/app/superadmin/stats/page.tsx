'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { api, PlatformUsageStats } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { CountBarsChart } from '@/components/superadmin/CountBarsChart';
import { daysSince } from '@/lib/platformStats';
import { lastVisitLabel } from '@/lib/memberStats';

function seriesFor(months: string[], counts: number[]) {
  return months.map((month, i) => ({ month, count: counts[i] ?? 0 }));
}

export default function SuperAdminStats() {
  const { th } = useTheme();
  const { token } = useAuth();
  const [stats, setStats] = useState<PlatformUsageStats | null>(null);
  const [nowIso, setNowIso] = useState<string | null>(null); // posé au montage → hydration-safe

  useEffect(() => {
    setNowIso(new Date().toISOString());
    if (!token) return;
    let cancelled = false;
    api.platformUsageStats(token)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => { cancelled = true; };
  }, [token]);

  const card: React.CSSProperties = {
    background: th.bgElev, border: `1px solid ${th.line}`, borderRadius: 14, padding: '18px 20px',
  };

  const growthCards = stats ? [
    { key: 'clubs', label: 'Nouveaux clubs / mois', series: seriesFor(stats.months, stats.growth.newClubs), unit: 'clubs' },
    { key: 'users', label: 'Nouveaux joueurs / mois', series: seriesFor(stats.months, stats.growth.newUsers), unit: 'joueurs' },
    { key: 'resa', label: 'Réservations / mois', series: seriesFor(stats.months, stats.growth.reservations), unit: 'résas' },
  ] : [];

  return (
    <div>
      <h1 style={{ fontFamily: th.fontDisplay, fontSize: 28, fontWeight: 700, color: th.text, marginBottom: 20 }}>Statistiques</h1>

      {!stats ? (
        <div style={{ color: th.textFaint, fontFamily: th.fontUI }}>Chargement…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
            {growthCards.map((g) => (
              <section key={g.key} style={card}>
                <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, marginBottom: 4 }}>{g.label}</div>
                <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginBottom: 12 }}>
                  {g.series.reduce((s, x) => s + x.count, 0)} sur 12 mois
                </div>
                <CountBarsChart series={g.series} unit={g.unit} />
              </section>
            ))}
          </div>

          <section style={card}>
            <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14, color: th.text, marginBottom: 12 }}>
              Activité par club (30 jours)
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead><tr>
                  {['#', 'Club', 'Résas 30 j', 'Membres actifs', 'Dernier signe de vie', 'Statut'].map((h, i) => (
                    <th key={i} style={{ textAlign: i === 2 || i === 3 ? 'right' : 'left', padding: '6px 8px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${th.line}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {stats.activity.map((a, i) => {
                    const days = nowIso ? daysSince(a.lastReservationAt, nowIso) : null;
                    return (
                      <tr key={a.clubId}>
                        <td style={{ padding: '9px 8px', fontFamily: th.fontMono, fontSize: 12.5, color: th.textFaint, borderBottom: `1px solid ${th.line}` }}>{i + 1}</td>
                        <td style={{ padding: '9px 8px', fontSize: 13.5, borderBottom: `1px solid ${th.line}` }}>
                          <Link href={`/superadmin/clubs/${a.clubId}`} style={{ color: th.text, textDecoration: 'none', fontWeight: 600 }}>{a.name}</Link>
                        </td>
                        <td style={{ padding: '9px 8px', fontSize: 13.5, textAlign: 'right', fontFamily: th.fontMono, color: th.text, borderBottom: `1px solid ${th.line}` }}>{a.reservations30d}</td>
                        <td style={{ padding: '9px 8px', fontSize: 13.5, textAlign: 'right', fontFamily: th.fontMono, color: th.textMute, borderBottom: `1px solid ${th.line}` }}>{a.activeMembers}</td>
                        <td style={{ padding: '9px 8px', fontSize: 12.5, color: th.textFaint, borderBottom: `1px solid ${th.line}` }}>
                          {days == null ? 'Jamais' : lastVisitLabel(days)}
                        </td>
                        <td style={{ padding: '9px 8px', fontSize: 12.5, fontWeight: 700, color: a.status === 'ACTIVE' ? th.accent : th.textFaint, borderBottom: `1px solid ${th.line}` }}>
                          {a.status === 'ACTIVE' ? 'Actif' : 'Suspendu'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
