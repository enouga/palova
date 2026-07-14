'use client';
import { useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { MemberHistory, AdminMemberLevel, UserLevel } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { winRate } from '@/lib/memberStats';
import { LevelHistoryChart } from '@/components/player/LevelHistoryChart';
import { ReliabilityMeter } from '@/components/player/ReliabilityMeter';
import { LevelOverrideForm } from '@/components/admin/LevelOverrideForm';

export function GameCard({ history, levelData, clubId, userId, token, clubSports, onSaved }: {
  history: MemberHistory;
  levelData: AdminMemberLevel | null;
  clubId: string;
  userId: string;
  token: string;
  clubSports: { key: string; name: string }[];
  onSaved: () => void;
}) {
  const { th } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const g = history.game;
  const wr = winRate(g.wins, g.losses);

  const lbl: CSSProperties = { fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute };
  const stat = (label: string, value: string) => (
    <div style={{ minWidth: 70 }}>
      <div style={{ fontFamily: th.fontDisplay, fontSize: 20, fontWeight: 600, color: th.text }}>{value}</div>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>{label}</div>
    </div>
  );

  const nameByKey = new Map(clubSports.map((s) => [s.key, s.name]));
  const formSports = clubSports.length > 0
    ? clubSports
    : Object.keys(levelData?.levels ?? {}).map((key) => ({ key, name: key }));
  const levelEntries: [string, UserLevel][] = Object.entries(levelData?.levels ?? {});

  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: 16, boxShadow: th.shadow }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={lbl}>🎾 Jeu</span>
        {g.isProvisional && <span style={{ fontFamily: th.fontUI, fontSize: 11, color: th.textFaint }}>en calibrage</span>}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {stat('niveau', g.level != null ? g.level.toFixed(1) : '—')}
        {stat('matchs', String(g.matchesPlayed))}
        {stat('V – D', `${g.wins}–${g.losses}`)}
        {stat('victoires', wr != null ? `${wr} %` : '—')}
      </div>
      {g.frequentPartners.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {g.frequentPartners.slice(0, 3).map((p) => (
            <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
              <Avatar firstName={p.firstName} lastName={p.lastName} avatarUrl={null} size={24} color={colorForSeed(p.userId)} />
              {p.firstName} {p.lastName}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: th.textMute }}>×{p.count}</span>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: th.accent, fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, padding: '10px 0 0' }}>
        {expanded ? 'Réduire ▴' : 'Progression & correction ▾'}
      </button>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <LevelHistoryChart points={g.levelPoints} />
          {levelEntries.map(([key, lvl]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontFamily: th.fontUI, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: th.textMute, minWidth: 70 }}>{nameByKey.get(key) ?? key}</span>
              <span style={{ fontFamily: th.fontDisplay, fontSize: 18, fontWeight: 700, color: th.text }}>{lvl.level.toFixed(1)}</span>
              <span style={{ color: th.textMute }}>{lvl.tier}</span>
              <ReliabilityMeter pct={lvl.reliability} />
            </div>
          ))}
          <LevelOverrideForm clubId={clubId} userId={userId} token={token} sports={formSports} onSaved={onSaved} />
          {(levelData?.history ?? []).length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(levelData?.history ?? []).map((h) => (
                <li key={h.id} style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute }}>
                  <b style={{ color: th.text }}>{h.previousLevel != null ? h.previousLevel.toFixed(1) : '—'} → {h.newLevel.toFixed(1)}</b>
                  {' '}· par {h.staffFirstName} {h.staffLastName}
                  {h.reason ? ` · ${h.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
