'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon, IconName } from '@/components/ui/Icon';

interface Props { icon: IconName; title: string; hint?: string; }

/** État vide « pro » partagé par les sections compte : tuile icône + titre lisible + sous-titre. */
export function AccountEmpty({ icon, title, hint }: Props) {
  const { th } = useTheme();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 13,
      background: th.surface2, borderRadius: 14, padding: '15px 16px',
    }}>
      <span aria-hidden="true" style={{
        width: 38, height: 38, flexShrink: 0, borderRadius: 11, background: th.surface,
        boxShadow: `inset 0 0 0 1px ${th.line}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={19} color={th.textMute} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text }}>{title}</span>
        {hint && <span style={{ fontFamily: th.fontUI, fontSize: 12.5, lineHeight: 1.35, color: th.textFaint }}>{hint}</span>}
      </div>
    </div>
  );
}
