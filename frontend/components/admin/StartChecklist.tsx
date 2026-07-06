'use client';
import { useEffect, useState } from 'react';
import { api, OnboardingStatus } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { buildChecklist, checklistProgress, ONBOARDING_HIDDEN_KEY } from '@/lib/onboarding';

/**
 * Carte « Guide de démarrage » du dashboard admin.
 * Dérivée de l'état réel (onboarding-status) : se coche toute seule, disparaît à 8/8,
 * masquable par appareil (localStorage). Ne rend rien tant qu'elle n'est pas sûre d'être utile.
 */
export function StartChecklist({ clubId, token }: { clubId: string; token: string }) {
  const { th } = useTheme();
  const [hidden, setHidden] = useState<boolean | null>(null); // null = pas encore lu (hydration-safe)
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    setStatus(null); // ne jamais afficher le statut d'un autre club pendant le refetch
    setHidden(window.localStorage.getItem(ONBOARDING_HIDDEN_KEY(clubId)) === 'hidden');
  }, [clubId]);

  useEffect(() => {
    if (hidden !== false) return;
    let alive = true;
    api.adminGetOnboardingStatus(clubId, token)
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, [hidden, clubId, token]);

  if (hidden !== false || !status) return null;
  const items = buildChecklist(status);
  const { done, total } = checklistProgress(items);
  if (done === total) return null;

  const dismiss = () => {
    window.localStorage.setItem(ONBOARDING_HIDDEN_KEY(clubId), 'hidden');
    setHidden(true);
  };

  const accent = th.accent;
  const R = 24;
  const C = 2 * Math.PI * R;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #101623, #1a2438)', borderRadius: 16,
      padding: '18px 20px', marginBottom: 18, position: 'relative',
      boxShadow: '0 10px 30px rgba(20,40,80,.18)',
    }}>
      <button type="button" onClick={dismiss} aria-label="Masquer le guide de démarrage"
        style={{ position: 'absolute', top: 10, right: 12, background: 'transparent', border: 'none', color: '#5d6676', fontSize: 15, cursor: 'pointer', padding: 4 }}>
        ✕
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 58, height: 58, flexShrink: 0 }}>
          <svg width={58} height={58} viewBox="0 0 58 58" aria-hidden>
            <circle cx={29} cy={29} r={R} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={6} />
            <circle cx={29} cy={29} r={R} fill="none" stroke={accent} strokeWidth={6} strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - done / total)} transform="rotate(-90 29 29)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 800 }}>
            {done}/{total}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ color: '#fff', fontFamily: th.fontDisplay, fontSize: 18, fontWeight: 600 }}>Votre club prend forme 🚀</div>
          <div style={{ color: '#94a0b8', fontFamily: th.fontUI, fontSize: 12.5, marginTop: 3 }}>
            Encore {total - done} étape{total - done > 1 ? 's' : ''} pour un club irrésistible.{' '}
            <a href="/admin/onboarding" style={{ color: accent, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 3 }}>
              Rouvrir le guide de démarrage →
            </a>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 7, marginTop: 14 }}>
        {items.map((it) => it.done ? (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: `${accent}14`, borderRadius: 9, padding: '8px 10px' }}>
            <span aria-hidden style={{ color: accent, fontSize: 12 }}>✓</span>
            <span style={{ color: '#8f9bb0', fontFamily: th.fontUI, fontSize: 12.5, textDecoration: 'line-through' }}>{it.label}</span>
            {/* cue lecteur d'écran : le barré visuel ne s'entend pas */}
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>(fait)</span>
          </div>
        ) : (
          <a key={it.key} href={it.href ?? '#'} style={{
            display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.09)', borderRadius: 9, padding: '8px 10px', textDecoration: 'none',
          }}>
            <span aria-hidden style={{ color: '#7a8aa5', fontSize: 12 }}>○</span>
            <span style={{ color: '#e8ecf4', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600 }}>{it.label}</span>
            <span aria-hidden style={{ marginLeft: 'auto', color: accent, fontSize: 12 }}>→</span>
          </a>
        ))}
      </div>
    </div>
  );
}
