'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, NotifPrefRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import {
  CATEGORY_META, CHANNELS, CHANNEL_LABEL, NotifCategory, NotifChannel, effective, isLocked,
} from '@/lib/notifications';

export default function NotificationSettingsPage() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const [prefs, setPrefs] = useState<NotifPrefRow[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.getNotificationPreferences(token).then((r) => setPrefs(r.preferences)).catch(() => {});
    api.getMyClubs(token).then((cl) => setIsStaff(cl.length > 0)).catch(() => {});
  }, [token]);

  const categories = useMemo(() => CATEGORY_META.filter((c) => !c.staffOnly || isStaff), [isStaff]);

  const setCell = (category: NotifCategory, channel: NotifChannel, value: boolean) => {
    if (isLocked(category, channel)) return;
    setSaved(false);
    setPrefs((prev) => {
      const rest = prev.filter((p) => !(p.category === category && p.channel === channel));
      return [...rest, { category, channel, enabled: value }];
    });
  };

  const save = () => {
    if (!token) return;
    const rows: NotifPrefRow[] = [];
    for (const cat of categories) {
      for (const ch of CHANNELS) {
        if (isLocked(cat.key, ch)) continue;
        rows.push({ category: cat.key, channel: ch, enabled: effective(prefs, cat.key, ch) });
      }
    }
    api.updateNotificationPreferences(rows, token).then(() => setSaved(true)).catch(() => {});
  };

  if (ready && !token) return null;

  const cell: React.CSSProperties = { textAlign: 'center', padding: '10px 8px' };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontFamily: th.fontUI, fontWeight: 800, fontSize: 22, color: th.text, marginBottom: 4 }}>Notifications</h1>
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 16 }}>
        Choisis comment tu veux être prévenu. Le push arrive bientôt.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: th.fontUI }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '10px 8px', color: th.textFaint, fontSize: 12 }}></th>
            {CHANNELS.map((ch) => (
              <th key={ch} style={{ ...cell, color: th.textFaint, fontSize: 12, fontWeight: 600 }}>{CHANNEL_LABEL[ch]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat.key} style={{ borderTop: `1px solid ${th.line}` }}>
              <td style={{ padding: '12px 8px' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: th.text }}>{cat.label}</div>
                <div style={{ fontSize: 12, color: th.textMute }}>{cat.desc}</div>
              </td>
              {CHANNELS.map((ch) => {
                const locked = isLocked(cat.key, ch);
                const pushDisabled = ch === 'PUSH';
                return (
                  <td key={ch} style={cell}>
                    <input type="checkbox"
                      aria-label={`${cat.label} – ${CHANNEL_LABEL[ch]}`}
                      checked={effective(prefs, cat.key, ch)}
                      disabled={locked || pushDisabled}
                      onChange={(e) => setCell(cat.key, ch, e.target.checked)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <button onClick={save} style={{
          padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700,
        }}>Enregistrer</button>
        {saved && <span style={{ color: th.textMute, fontFamily: th.fontUI, fontSize: 13 }}>Enregistré ✓</span>}
      </div>
    </div>
  );
}
