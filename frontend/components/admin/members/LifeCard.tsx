'use client';
import { useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { MemberHistory } from '@/lib/api';
import { Chip } from '@/components/ui/atoms';
import { DayHourHeatmap } from '@/components/admin/stats/DayHourHeatmap';
import { weekdayLabel, cancellationLabel } from '@/lib/memberStats';
import { fmtEuros, toCents } from '@/lib/caisse';

const STATUS_FR: Record<string, string> = { CONFIRMED: 'Confirmée', CANCELLED: 'Annulée', PENDING: 'En attente' };
const TYPE_FR: Record<string, string> = { COURT: 'Terrain', COACHING: 'Cours', TOURNAMENT: 'Tournoi', EVENT: 'Event' };
const TYPE_ICON: Record<string, string> = { COURT: '🎾', COACHING: '📋', TOURNAMENT: '🏆', EVENT: '⚡' };
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export function LifeCard({ history, multiSport }: { history: MemberHistory; multiSport: boolean }) {
  const { th } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [onlyLate, setOnlyLate] = useState(false);

  const { counts, favorites, loyalty } = history;
  const recent = history.reservations.slice(0, 4);
  const full = onlyLate ? history.reservations.filter((r) => r.lateCancel) : history.reservations;

  const lbl: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute };
  const line: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.text };
  const td: CSSProperties = { padding: '7px 10px', fontFamily: th.fontUI, fontSize: 12.5, color: th.text, whiteSpace: 'nowrap' };

  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: th.shadow }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={lbl}>📅 Vie au club</span>
        <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>
          {counts.confirmed} confirmées · {counts.upcoming} à venir · annule {cancellationLabel(loyalty.cancellationRate)}
        </span>
      </div>

      {recent.length === 0 ? (
        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, padding: '6px 0' }}>Aucune activité pour l'instant.</div>
      ) : recent.map((r) => (
        <div key={r.id} style={{ ...line, opacity: r.status === 'CANCELLED' ? 0.6 : 1 }}>
          <span aria-hidden>{TYPE_ICON[r.type] ?? '🎾'}</span>
          <span style={{ flex: 1, minWidth: 120 }}>{r.resourceName} · {fmtDateTime(r.startTime)}</span>
          <Chip tone={r.status === 'CANCELLED' ? 'line' : 'accent'}>{STATUS_FR[r.status] ?? r.status}{r.lateCancel ? ' (tardive)' : ''}</Chip>
        </div>
      ))}

      <div style={{ marginTop: 12 }}>
        <DayHourHeatmap matrix={history.heatmap} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {favorites.weekday && <Chip tone="mute">Plutôt le {weekdayLabel(favorites.weekday)}</Chip>}
        {favorites.resource && <Chip tone="mute">{favorites.resource.name} favori</Chip>}
        {multiSport && favorites.sportKey && <Chip tone="mute">Sport : {favorites.sportKey}</Chip>}
      </div>

      <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: '10px 0 0' }}>
        {expanded ? 'Réduire ▴' : `Tout l'historique (${counts.total}) ▾`}
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyLate} onChange={(e) => setOnlyLate(e.target.checked)} style={{ width: 15, height: 15, accentColor: th.accent, cursor: 'pointer' }} />
            Annulations tardives seulement ({counts.lateCancelled})
          </label>
          <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <tbody>
                {full.map((r) => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${th.line}`, opacity: r.status === 'CANCELLED' ? 0.6 : 1 }}>
                    <td style={td}>{fmtDateTime(r.startTime)}</td>
                    <td style={td}>{r.resourceName}</td>
                    <td style={td}>{TYPE_FR[r.type] ?? r.type}</td>
                    <td style={td}>{STATUS_FR[r.status] ?? r.status}{r.lateCancel ? ' (tardive)' : ''}</td>
                    <td style={{ ...td, fontWeight: 600, textAlign: 'right' }}>{fmtEuros(toCents(r.attributedAmount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, marginTop: 6 }}>
            {counts.cancelled} annulées · {counts.lateCancelled} tardives · {counts.noShow} no-show (estimation)
          </div>
        </div>
      )}
    </div>
  );
}
