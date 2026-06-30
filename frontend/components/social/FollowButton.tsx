'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

// Toggle de suivi réutilisable, optimiste. 3 états : Suivre / Suivi(e) / Amis (mutuel).
export function FollowButton({ slug, userId, token, initial, size = 'sm', onChange }: {
  slug: string;
  userId: string;
  token: string;
  initial: { iFollow: boolean; mutual?: boolean };
  size?: 'sm' | 'xs';
  onChange?: (iFollow: boolean) => void;
}) {
  const { th } = useTheme();
  const [iFollow, setIFollow] = useState(initial.iFollow);
  const [mutual, setMutual]   = useState(!!initial.mutual);
  const [busy, setBusy]       = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !iFollow;
    setBusy(true);
    setIFollow(next);                 // optimiste
    if (!next) setMutual(false);
    try {
      const rel = next ? await api.followUser(slug, userId, token) : await api.unfollowUser(slug, userId, token);
      setIFollow(rel.iFollow);
      setMutual(rel.mutual);
      onChange?.(rel.iFollow);
    } catch {
      setIFollow(!next);              // rollback
      setMutual(!!initial.mutual);
    } finally {
      setBusy(false);
    }
  };

  const pad = size === 'xs' ? '3px 8px' : '5px 11px';
  const fs  = size === 'xs' ? 12 : 13;
  const label = mutual ? 'Amis' : iFollow ? 'Suivi(e)' : 'Suivre';
  const filled = iFollow;
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${th.accent}`,
    background: filled ? th.accent : 'transparent', color: filled ? th.onAccent : th.accent,
    borderRadius: 999, padding: pad, fontFamily: th.fontUI, fontSize: fs, fontWeight: 600, cursor: 'pointer',
    opacity: busy ? 0.7 : 1, whiteSpace: 'nowrap',
  };
  return (
    <button type="button" onClick={toggle} disabled={busy} style={style} aria-pressed={iFollow}>
      <Icon name={mutual ? 'users' : iFollow ? 'check' : 'plus'} size={fs} color={filled ? th.onAccent : th.accent} />
      {label}
    </button>
  );
}
