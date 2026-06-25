'use client';
import { CSSProperties, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { AppNotification } from '@/lib/api';
import { notificationVisual, relativeTime } from '@/lib/notifications';

interface Props {
  n: AppNotification;
  now: Date | null;             // null avant le mount (hydration-safe)
  onClick: () => void;
  variant?: 'panel' | 'page';   // ligne du dropdown vs carte de la page
}

// Ligne de notification : tuile d'icône teintée par catégorie, titre + corps (2 lignes),
// horodatage relatif, pastille d'accent pour les non-lus. Les lues s'effacent (tuile neutre).
export function NotificationRow({ n, now, onClick, variant = 'panel' }: Props) {
  const { th } = useTheme();
  const [hover, setHover] = useState(false);
  const { icon, accent } = notificationVisual(n.category, n.type);
  const unread = !n.readAt;
  const floodlit = th.mode === 'floodlit';

  const tileBg = unread ? (floodlit ? `${accent}24` : `${accent}40`) : th.surface2;
  const iconColor = unread ? (floodlit ? accent : th.ink) : th.textFaint;
  const when = now ? relativeTime(n.createdAt, now) : '';

  const base: CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', textAlign: 'left',
    cursor: 'pointer', fontFamily: th.fontUI, transition: 'background .12s ease',
  };
  const restBg = variant === 'page'
    ? (unread ? th.surface2 : th.surface)
    : (unread ? th.surface2 : 'transparent');
  const variantStyle: CSSProperties = variant === 'page'
    ? { border: 'none', borderRadius: 14, padding: '13px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` }
    : { border: 'none', borderBottom: `1px solid ${th.line}`, padding: '12px 14px' };

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...variantStyle, background: hover ? th.surfaceHi : restBg }}
    >
      <span aria-hidden="true" style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0, marginTop: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', background: tileBg,
      }}>
        <Icon name={icon} size={19} color={iconColor} />
      </span>

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            flex: 1, minWidth: 0, fontWeight: unread ? 700 : 600, fontSize: 13.5, color: th.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{n.title}</span>
          {when && <span style={{ flexShrink: 0, fontSize: 11, color: th.textFaint, fontWeight: 500 }}>{when}</span>}
          {unread && <span aria-hidden="true" style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: accent }} />}
        </span>
        <span style={{
          fontSize: 12.5, color: th.textMute, lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{n.body}</span>
      </span>
    </button>
  );
}
