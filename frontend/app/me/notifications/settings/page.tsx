'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, NotifPrefRow } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { Screen } from '@/components/ui/Screen';
import { ClubNav } from '@/components/ClubNav';
import { BackButton, ThemeToggle } from '@/components/ui/atoms';
import { ProfileMenu } from '@/components/ProfileMenu';
import { usePush } from '@/lib/usePush';
import {
  CATEGORY_META, CHANNELS, CHANNEL_LABEL, NotifCategory, NotifChannel, effective, isLocked,
} from '@/lib/notifications';

export default function NotificationSettingsPage() {
  const { token, ready } = useAuth();
  const { th } = useTheme();
  const { slug, club } = useClub();
  const { status: pushStatus, subscribe, unsubscribe } = usePush();
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
    <Screen>
      <div style={{ paddingBottom: 48 }}>
        {slug && club ? (
          <ClubNav club={club} />
        ) : (
          <div style={{ padding: '28px 20px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton href="/clubs" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ThemeToggle />
                <ProfileMenu />
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: '18px 20px 0', fontFamily: th.fontDisplay, fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: th.text, letterSpacing: -0.5 }}>
          Notifications
        </div>

        <div style={{ padding: '18px 20px 0' }}>
      <p style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginBottom: 16 }}>
        Choisis comment tu veux être prévenu. Active le push pour être prévenu même l'app fermée.
      </p>

      {pushStatus === 'default' && (
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => subscribe()} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700, fontSize: 14,
          }}>Activer les notifications push</button>
        </div>
      )}
      {pushStatus === 'ios-needs-install' && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: th.surface2, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          Installe Palova sur ton écran d'accueil pour activer le push
        </div>
      )}
      {pushStatus === 'denied' && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: th.surface2, fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>
          Notifications push bloquées dans les réglages du navigateur
        </div>
      )}
      {pushStatus === 'granted' && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute }}>Push activé</span>
          <button onClick={() => unsubscribe()} style={{
            padding: '6px 14px', borderRadius: 8, border: `1px solid ${th.line}`, cursor: 'pointer',
            background: 'transparent', color: th.textMute, fontFamily: th.fontUI, fontWeight: 600, fontSize: 13,
          }}>Désactiver</button>
        </div>
      )}

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
                const pushDisabled = ch === 'PUSH' && pushStatus !== 'granted';
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
      </div>
    </Screen>
  );
}
