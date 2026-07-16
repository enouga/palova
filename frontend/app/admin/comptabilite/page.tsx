'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, MonthlySummary } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useClub } from '@/lib/ClubProvider';
import { useTheme } from '@/lib/ThemeProvider';
import { isClubAdmin, useAdminRole } from '@/lib/adminRole';
import { gaugeTrack } from '@/lib/theme';
import { monthLabel, monthRange, methodLabel, fmtAmount } from '@/lib/accounting';
import { toCents } from '@/lib/caisse';

export default function AdminComptabilitePage() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const { club } = useClub();
  const clubId = club?.id;
  const admin = isClubAdmin(useAdminRole());

  // Initialiser year/month à null — l'effet les fixera à la date courante (hydration-safe).
  const [year, setYear]   = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [error, setError]    = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Fixer la période courante une seule fois côté client (évite le mismatch SSR/client).
  useEffect(() => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  }, []);

  const load = useCallback(async () => {
    if (!token || !clubId || year === null || month === null) return;
    setLoading(true);
    try {
      setError(null);
      const data = await api.adminAccountingSummary(clubId, year, month, token);
      setSummary(data);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId, year, month]);

  useEffect(() => {
    if (ready && token && clubId && year !== null && month !== null && admin) load();
  }, [ready, token, clubId, year, month, admin, load]);

  const doExport = async () => {
    if (!token || !clubId || year === null || month === null) return;
    setExporting(true);
    try {
      setError(null);
      const { from, to } = monthRange(year, month);
      const blob = await api.adminAccountingExport(clubId, from, to, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `caisse_${from}_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  };

  // Styles réutilisés
  const card = { background: th.surface, borderRadius: 16, padding: 18, boxShadow: `inset 0 0 0 1px ${th.line}` } as const;
  const sectionTitle = { fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 as const, color: th.text, marginBottom: 12 };
  const label2 = { fontFamily: th.fontMono, fontSize: 10, fontWeight: 600 as const, letterSpacing: 0.5, textTransform: 'uppercase' as const, color: th.textFaint };

  // Valeur max des jours (pour les barres de progression)
  const maxNet = summary
    ? Math.max(1, ...summary.byDay.map((d) => Math.abs(toCents(d.net))))
    : 1;

  // Sélecteurs d'année/mois : années ±2 depuis l'année courante initialisée
  const currentYear = year ?? new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  if (!admin) {
    return <div style={{ padding: 24, fontFamily: th.fontUI, color: th.textMute }}>Cette page est réservée aux administrateurs du club.</div>;
  }

  return (
    <div>
      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 18px', flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: 0, color: th.text }}>
          Comptabilité
        </h1>
        {/* Sélecteurs mois / année */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={month ?? ''}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14 }}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {year !== null ? monthLabel(year, m).split(' ')[0] : String(m).padStart(2, '0')}
              </option>
            ))}
          </select>
          <select
            value={year ?? ''}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '7px 10px', fontFamily: th.fontUI, fontSize: 14 }}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={doExport}
            disabled={exporting || year === null || month === null}
            style={{
              border: `1px solid ${th.line}`, background: 'transparent', color: th.text,
              borderRadius: 9, padding: '7px 14px', cursor: exporting ? 'default' : 'pointer',
              fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            {exporting ? '…' : 'Exporter CSV'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 16, background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 16 }}>Chargement…</div>
      )}

      {summary && year !== null && month !== null && (
        <>
          {/* Titre de la période */}
          <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 18, textTransform: 'capitalize' }}>
            {monthLabel(year, month)}
          </div>

          {/* Cartes récap */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }}>
            <div style={card}>
              <div style={label2}>Encaissé net</div>
              <div style={{ fontFamily: th.fontDisplay, fontSize: 26, fontWeight: 600, color: th.text, marginTop: 4 }}>
                {fmtAmount(summary.collected)}
              </div>
            </div>
            <div style={card}>
              <div style={label2}>Remboursé</div>
              <div style={{ fontFamily: th.fontDisplay, fontSize: 26, fontWeight: 600, color: '#ff7a4d', marginTop: 4 }}>
                {fmtAmount(summary.refunded)}
              </div>
            </div>
          </div>

          {/* Répartition par méthode */}
          {Object.keys(summary.totalsByMethod).length > 0 && (
            <div style={{ ...card, marginBottom: 18 }}>
              <div style={sectionTitle}>Par moyen de paiement</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(Object.entries(summary.totalsByMethod) as [string, string][]).map(([method, amount]) => (
                  <div key={method} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: th.fontUI, fontSize: 13.5, color: th.text, borderTop: `1px solid ${th.line}`, paddingTop: 8 }}>
                    <span style={{ color: th.textMute }}>{methodLabel(method)}</span>
                    <b>{fmtAmount(amount)}</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Courbe / mini-barres par jour */}
          {summary.byDay.length > 0 && (
            <div style={card}>
              <div style={sectionTitle}>Activité par jour</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {summary.byDay.map((d) => {
                  const netCents = toCents(d.net);
                  const pct = Math.round((Math.abs(netCents) / maxNet) * 100);
                  const positive = netCents >= 0;
                  return (
                    <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: th.fontUI, fontSize: 12.5, color: th.text }}>
                      <span style={{ width: 68, color: th.textMute, flexShrink: 0 }}>{d.date.slice(5)}</span>
                      <div style={{ flex: 1, ...gaugeTrack(th, 8, 4) }}>
                        <div style={{
                          width: `${pct}%`, height: '100%', borderRadius: 4,
                          background: positive ? th.accent : '#ff7a4d',
                          transition: 'width 0.2s',
                        }} />
                      </div>
                      <span style={{ width: 72, textAlign: 'right', fontWeight: 600, color: positive ? th.text : '#ff7a4d', flexShrink: 0 }}>
                        {fmtAmount(d.net)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {summary.byDay.length === 0 && !loading && (
            <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>Aucune activité ce mois.</div>
          )}
        </>
      )}
    </div>
  );
}
