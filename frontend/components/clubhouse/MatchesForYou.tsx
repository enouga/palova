'use client';
import Link from 'next/link';
import { OpenMatch } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { recommendMatches } from '@/lib/recommend';
import { rangeLabel } from '@/lib/levelMatch';

function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(iso)).replace(':', 'h');
}

// Bloc Club-house « Parties pour toi » : top 3 des parties ouvertes à ton niveau.
// Masqué (null) si aucune reco ou niveau inconnu. Cartes compactes → /parties.
export function MatchesForYou({ matches, myLevel, timezone }: { matches: OpenMatch[]; myLevel: number | null; timezone: string }) {
  const { th } = useTheme();
  const recos = recommendMatches(matches, myLevel, new Date()).slice(0, 3);
  if (recos.length === 0) return null;
  return (
    <div style={{ background: th.surface, borderRadius: 16, padding: '14px 16px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="users" size={14} color={th.accent} />Parties pour toi
        </div>
        <Link href="/parties" style={{ marginLeft: 'auto', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, color: th.accent, textDecoration: 'none' }}>Voir tout →</Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {recos.map((m) => (
          <Link key={m.id} href="/parties" style={{ textDecoration: 'none', background: th.surface2, borderRadius: 10, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, fontFamily: th.fontUI, fontSize: 14, color: th.text }}>
              <strong>{m.resourceName}</strong> · {formatWhen(m.startTime, timezone)}
              <span style={{ color: th.textMute, fontSize: 12.5 }}> · {rangeLabel(m.targetLevelMin ?? null, m.targetLevelMax ?? null)}</span>
            </span>
            <span style={{ background: th.accent, color: th.onAccent, borderRadius: 999, padding: '3px 9px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {m.spotsLeft} place{m.spotsLeft > 1 ? 's' : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
