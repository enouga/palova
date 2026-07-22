'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { PlayerMembership, assetUrl } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { inkOn } from '@/lib/theme';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « Mes clubs » : un tap → le Club-house du club (session partagée .palova.fr en prod).
// Toujours rendue : sans adhésion, la carte « + Trouver un club » est l'invitation.
export function MyClubsRow({ memberships }: { memberships: PlayerMembership[] }) {
  const { th } = useTheme();
  const active = memberships.filter((m) => m.status === 'ACTIVE');
  const card = { flex: '0 0 132px', display: 'block', textDecoration: 'none', background: th.surface, borderRadius: 14, padding: '11px 12px', boxShadow: `inset 0 0 0 1px ${th.line}`, textAlign: 'center' as const };
  return (
    <section>
      <SectionHeader kicker="Mes clubs" />
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {active.map((m) => (
          <a key={m.slug} href={clubUrl(m.slug, '/')} style={card}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, margin: '0 auto 7px', background: m.club.accentColor, overflow: 'hidden' }}>
              {m.club.logoUrl
                ? <img src={assetUrl(m.club.logoUrl) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: inkOn(m.club.accentColor) }}>{m.club.name.charAt(0)}</span>}
            </span>
            <span style={{ display: 'block', fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, color: th.text }}>{m.club.name}</span>
            {m.club.city && <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11, color: th.textMute, marginTop: 1 }}>{m.club.city}</span>}
          </a>
        ))}
        <a href="/decouvrir#clubs" style={{ ...card, boxShadow: `inset 0 0 0 1.5px ${th.line}` }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, margin: '0 auto 7px', background: th.surface2, fontSize: 17, color: th.textMute }}>+</span>
          <span style={{ display: 'block', fontFamily: th.fontUI, fontWeight: 700, fontSize: 12.5, color: th.textMute }}>Trouver un club</span>
        </a>
      </div>
    </section>
  );
}
