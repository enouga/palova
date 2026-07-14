'use client';
import { useEffect, useState } from 'react';
import { Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { colorForSeed } from '@/lib/playerColors';
import { FollowButton } from '@/components/social/FollowButton';
import { listRowStyle } from '@/components/clubhouse/SectionHeader';

// Pied discret « Qui me suit · N » (remplace l'onglet Abonnés) : repliable,
// « ★ Favori » en retour pour ceux que je ne suis pas encore.
export function FollowersFooter({ followers, slug, token, anchorOpen, onChange }: {
  followers: Friend[];
  slug: string;
  token: string;
  anchorOpen?: boolean;
  onChange: () => void;
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(!!anchorOpen);
  useEffect(() => { if (anchorOpen) setOpen(true); }, [anchorOpen]);

  return (
    <section id="fh-followers" aria-label="Qui me suit" style={{ borderTop: `1px solid ${th.line}`, paddingTop: 12 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
          fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.textMute }}>
        Qui me suit · {followers.length} {open ? '▴' : '▾'}
      </button>
      {open && (followers.length === 0
        ? <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, padding: '10px 0' }}>Personne ne vous suit pour l&apos;instant.</div>
        : followers.map((f) => (
          <div key={f.id} style={listRowStyle(th)}>
            <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={32} color={colorForSeed(f.id)} />
            <span style={{ flex: 1, fontFamily: th.fontUI, fontSize: 14, color: th.text, fontWeight: 600 }}>{f.firstName} {f.lastName}</span>
            {!f.mutual && <FollowButton slug={slug} userId={f.id} token={token} initial={{ iFollow: false }} size="xs" onChange={onChange} />}
          </div>
        )))}
    </section>
  );
}
