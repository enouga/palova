'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { PlayerMembership, assetUrl } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { inkOn } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/platform/home/SectionHeader';

// « Mes clubs » : liste de clubs → un tap ouvre le Club-house du club (session partagée
// .palova.fr en prod). Toujours rendue : sans adhésion, la ligne « Trouver un club » invite.
export function MyClubsRow({ memberships }: { memberships: PlayerMembership[] }) {
  const { th } = useTheme();
  const active = memberships.filter((m) => m.status === 'ACTIVE');
  const row = { display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none', padding: '10px 13px' } as const;
  const tile = { flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, overflow: 'hidden' } as const;
  return (
    <section>
      <SectionHeader kicker="Mes clubs" />
      <div style={{ background: th.surface, borderRadius: 16, boxShadow: th.shadow, overflow: 'hidden' }}>
        {active.map((m, i) => (
          <a key={m.slug} href={clubUrl(m.slug, '/')} className="pl-lift" style={{ ...row, borderTop: i === 0 ? 'none' : `1px solid ${th.line}` }}>
            <span style={{ ...tile, background: m.club.accentColor }}>
              {m.club.logoUrl
                ? <img src={assetUrl(m.club.logoUrl) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <span style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 14, color: inkOn(m.club.accentColor) }}>{m.club.name.charAt(0)}</span>}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.club.name}</span>
              {m.club.city && <span style={{ display: 'block', fontFamily: th.fontUI, fontSize: 11.5, color: th.textMute }}>{m.club.city}</span>}
            </span>
            <Icon name="chevR" size={15} color={th.textFaint} />
          </a>
        ))}
        <a href="/decouvrir#clubs" className="pl-lift" style={{ ...row, borderTop: active.length ? `1px solid ${th.line}` : 'none' }}>
          <span style={{ ...tile, background: th.surface2, color: th.textMute }}><Icon name="plus" size={17} color={th.textMute} /></span>
          <span style={{ flex: 1, fontFamily: th.fontUI, fontWeight: 700, fontSize: 13.5, color: th.textMute }}>Trouver un club</span>
        </a>
      </div>
    </section>
  );
}
