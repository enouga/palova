'use client';
import { useEffect, useState } from 'react';
import { api, LegalDocumentKey, MyProfile } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/ThemeProvider';

const DOCS: { key: 'cgu' | 'privacy' | 'cgvSaas'; api: LegalDocumentKey; label: string; href: string }[] = [
  { key: 'cgu', api: 'CGU', label: 'CGU', href: '/cgu' },
  { key: 'privacy', api: 'PRIVACY', label: 'politique de confidentialité', href: '/confidentialite' },
  { key: 'cgvSaas', api: 'CGV_SAAS', label: 'CGV Palova', href: '/cgv' },
];

/**
 * Bandeau global non bloquant : la version courante d'un document légal dépasse la dernière
 * version acceptée (ou aucune acceptation — comptes antérieurs à la feature). « J'ai compris »
 * écrit l'acceptation (context update_banner). Réaffiché à chaque session tant que non acté.
 */
export function LegalUpdateBanner() {
  const { th } = useTheme();
  const { token, ready } = useAuth();
  const [legal, setLegal] = useState<MyProfile['legal'] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    api.getMyProfile(token)
      .then((p) => { if (!cancelled) setLegal(p.legal ?? null); })
      .catch(() => { /* silencieux : le bandeau est best-effort */ });
    return () => { cancelled = true; };
  }, [ready, token]);

  if (!token || hidden || !legal) return null;
  const outdated = DOCS.filter((d) => {
    const s = legal[d.key];
    return s && (s.accepted === null || s.accepted < s.current);
  });
  if (outdated.length === 0) return null;

  const acknowledge = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await Promise.all(outdated.map((d) => api.acceptLegal(d.api, token)));
      setHidden(true);
    } finally { setBusy(false); }
  };

  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: th.surface2, borderBottom: `1px solid ${th.line}`, padding: '10px 16px',
      fontFamily: th.fontUI, fontSize: 13.5, color: th.text,
    }}>
      <span style={{ flex: 1, minWidth: 220 }}>
        Nos conditions ont évolué :{' '}
        {outdated.map((d, i) => (
          <span key={d.key}>{i > 0 && ' · '}<a href={d.href} target="_blank" rel="noopener noreferrer" style={{ color: th.accent, textDecoration: 'underline' }}>{d.label}</a></span>
        ))}
        . En continuant à utiliser Palova, vous les acceptez.
      </span>
      <button onClick={acknowledge} disabled={busy} style={{
        border: 'none', cursor: 'pointer', borderRadius: 9, padding: '7px 14px',
        background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontWeight: 700, fontSize: 13,
      }}>J&apos;ai compris</button>
    </div>
  );
}
