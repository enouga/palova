'use client';
import { useState } from 'react';
import { api, FriendRelation } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

// Bouton d'amitié réutilisable, optimiste. 5 états dérivés de FriendRelation :
//   none+requestable → Ajouter en ami | pending_out → Demande envoyée (clic = annuler)
//   pending_in → Accepter (+ Refuser) | friends → Amis (clic = retirer)
//   none+!requestable → « N'accepte pas les demandes » (désactivé)
export function FriendButton({ slug, userId, token, relation, size = 'sm', onChange }: {
  slug: string;
  userId: string;
  token: string;
  relation: FriendRelation;
  size?: 'sm' | 'xs';
  onChange?: (rel: FriendRelation) => void;
}) {
  const { th } = useTheme();
  const [rel, setRel] = useState<FriendRelation>(relation);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<FriendRelation>, optimistic: FriendRelation) => {
    if (busy) return;
    setBusy(true);
    const prev = rel;
    setRel(optimistic);
    try {
      const next = await fn();
      setRel(next);
      onChange?.(next);
    } catch {
      setRel(prev);
    } finally {
      setBusy(false);
    }
  };

  const pad = size === 'xs' ? '3px 8px' : '5px 11px';
  const fs = size === 'xs' ? 12 : 13;
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${th.accent}`,
    borderRadius: 999, padding: pad, fontFamily: th.fontUI, fontSize: fs, fontWeight: 600,
    whiteSpace: 'nowrap', opacity: busy ? 0.7 : 1,
  };
  const filled: React.CSSProperties = { ...base, background: th.accent, color: th.onAccent, cursor: 'pointer' };
  const hollow: React.CSSProperties = { ...base, background: 'transparent', color: th.accent, cursor: 'pointer' };
  const muted: React.CSSProperties = {
    ...base, border: `1px solid ${th.line}`, background: 'transparent', color: th.textMute, cursor: 'default',
  };

  if (rel.status === 'friends') {
    return (
      <button type="button" disabled={busy} style={filled}
        onClick={() => run(() => api.removeFriend(slug, userId, token), { status: 'none', requestable: true })}>
        <Icon name="users" size={fs} color={th.onAccent} />Amis
      </button>
    );
  }
  if (rel.status === 'pending_out') {
    return (
      <button type="button" disabled={busy} style={hollow}
        onClick={() => run(() => api.removeFriend(slug, userId, token), { status: 'none', requestable: true })}>
        <Icon name="check" size={fs} color={th.accent} />Demande envoyée
      </button>
    );
  }
  if (rel.status === 'pending_in') {
    return (
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <button type="button" disabled={busy} style={filled}
          onClick={() => run(() => api.respondFriend(slug, userId, true, token), { status: 'friends', requestable: false })}>
          <Icon name="check" size={fs} color={th.onAccent} />Accepter
        </button>
        <button type="button" disabled={busy} style={hollow}
          onClick={() => run(() => api.respondFriend(slug, userId, false, token), { status: 'none', requestable: false })}>
          Refuser
        </button>
      </span>
    );
  }
  if (!rel.requestable) {
    return <button type="button" disabled style={muted}>N&apos;accepte pas les demandes</button>;
  }
  return (
    <button type="button" disabled={busy} style={hollow}
      onClick={() => run(() => api.requestFriend(slug, userId, token), { status: 'pending_out', requestable: false })}>
      <Icon name="plus" size={fs} color={th.accent} />Ajouter en ami
    </button>
  );
}
