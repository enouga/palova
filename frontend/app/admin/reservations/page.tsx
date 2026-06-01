'use client';
import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { api, ClubReservation, ClubReservationsResponse } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_LABEL: Record<string, string> = { PENDING: 'En attente', CONFIRMED: 'Confirmée', CANCELLED: 'Annulée' };

export default function AdminReservationsPage() {
  const { th } = useTheme();
  const { token, clubId, ready } = useAuth();
  const [data, setData]   = useState<ClubReservationsResponse | null>(null);
  const [date, setDate]   = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cell: CSSProperties = { padding: '12px 16px', fontFamily: th.fontUI, fontSize: 14, color: th.text };

  const statusStyle = (s: string): CSSProperties => ({
    borderRadius: 999, padding: '4px 11px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600,
    background: s === 'CONFIRMED' ? `${th.accent}22` : s === 'PENDING' ? th.surfaceHi : th.surface2,
    color: s === 'CONFIRMED' ? (th.mode === 'floodlit' ? th.accent : th.ink) : s === 'CANCELLED' ? th.textFaint : th.textMute,
  });

  const load = useCallback(async () => {
    if (!token || !clubId) return;
    setLoading(true);
    try { setError(null); setData(await api.adminGetReservations(clubId, date ? { date } : {}, token)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [token, clubId, date]);

  useEffect(() => { if (ready && token && clubId) load(); }, [ready, token, clubId, load]);

  const cancel = async (r: ClubReservation) => {
    if (!token || !clubId) return;
    try { setError(null); await api.adminCancelReservation(clubId, r.id, token); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div>
      <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.5, margin: '0 0 20px', color: th.text }}>Réservations</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <label style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, display: 'flex', alignItems: 'center', gap: 8 }}>
          Jour
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '6px 8px', fontFamily: th.fontUI, fontSize: 14 }} />
        </label>
        {date && <button onClick={() => setDate('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, color: th.accent }}>Tout afficher</button>}
      </div>

      {error && <div style={{ marginBottom: 16, background: th.accent, color: th.onAccent, borderRadius: 12, padding: '11px 14px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600 }}>{error}</div>}

      {data && (
        <div style={{ display: 'flex', gap: 24, marginBottom: 16, fontFamily: th.fontUI, fontSize: 14 }}>
          <span style={{ color: th.textMute }}>Total : <b style={{ color: th.text }}>{data.summary.total} €</b></span>
          <span style={{ color: th.textMute }}>Encaissé : <b style={{ color: th.mode === 'floodlit' ? th.accent : th.ink }}>{data.summary.paidTotal} €</b></span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px 0', fontFamily: th.fontUI, color: th.textFaint }}>Chargement…</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 18, background: th.surface, boxShadow: `inset 0 0 0 1px ${th.line}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${th.line}`, textAlign: 'left' }}>
                {['Ressource', 'Client', 'Début', 'Fin', 'Montant', 'Statut', ''].map((h, i) => (
                  <th key={i} style={{ padding: '12px 16px', fontFamily: th.fontUI, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: th.textMute }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.reservations.length === 0 && (
                <tr><td colSpan={7} style={{ ...cell, textAlign: 'center', color: th.textFaint, padding: '32px 16px' }}>Aucune réservation</td></tr>
              )}
              {data?.reservations.map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${th.line}` }}>
                  <td style={{ ...cell, fontWeight: 600 }}>{r.resource.name}</td>
                  <td style={cell}>{r.user.firstName} {r.user.lastName}<div style={{ fontSize: 12, color: th.textFaint }}>{r.user.email}</div></td>
                  <td style={{ ...cell, fontFamily: th.fontMono, fontSize: 13 }}>{fmt(r.startTime)}</td>
                  <td style={{ ...cell, fontFamily: th.fontMono, fontSize: 13 }}>{fmt(r.endTime)}</td>
                  <td style={cell}>{r.totalPrice} €</td>
                  <td style={cell}><span style={statusStyle(r.status)}>{STATUS_LABEL[r.status]}</span></td>
                  <td style={cell}>
                    {r.status !== 'CANCELLED' && (
                      <button onClick={() => cancel(r)} style={{ border: `1px solid ${th.line}`, background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '6px 12px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, color: '#ff7a4d' }}>Annuler</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
