'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { gaId, loadGtag, pageview } from '@/lib/gtag';
import { readConsent, writeConsent, CONSENT_EVENT, type ConsentValue } from '@/lib/consent';

// Back-offices authentifiés : jamais de mesure d'audience ni de bannière (se tracer soi-même
// en superadmin ou coller une bannière au gérant dans son outil n'a aucune valeur « audience »).
function isBackOffice(path: string): boolean {
  return path.startsWith('/admin') || path.startsWith('/superadmin');
}

export function AnalyticsConsent() {
  const pathname = usePathname() || '/';
  const { th } = useTheme();
  const id = gaId();
  const active = !!id && !isBackOffice(pathname);

  const [consent, setConsent] = useState<ConsentValue | null>(null);
  const [open, setOpen] = useState(false);

  // Montage : lit le choix, charge GA s'il est accordé, ouvre la bannière si aucun choix.
  useEffect(() => {
    if (!active) return;
    const c = readConsent();
    setConsent(c);
    if (c === 'granted') loadGtag(id);
    if (c === null) setOpen(true);
  }, [active, id]);

  // « Gérer les cookies » (Footer) → rouvre la bannière.
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(CONSENT_EVENT, h);
    return () => window.removeEventListener(CONSENT_EVENT, h);
  }, []);

  // Page vue à chaque navigation cliente, seulement si le consentement est accordé.
  useEffect(() => {
    if (active && consent === 'granted') pageview(pathname);
  }, [active, consent, pathname]);

  if (!active || !open) return null;

  const accept = () => { writeConsent('granted'); loadGtag(id); setConsent('granted'); setOpen(false); };
  const refuse = () => { writeConsent('denied'); setConsent('denied'); setOpen(false); };

  return (
    <div
      role="dialog"
      aria-label="Consentement aux cookies"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, background: th.surface2, borderTop: `1px solid ${th.line}`, padding: '14px 16px', boxShadow: th.shadow, fontFamily: th.fontUI }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <p style={{ margin: 0, color: th.text, fontSize: 14, lineHeight: 1.4, flex: '1 1 320px' }}>
          Nous utilisons des cookies de mesure d&apos;audience (Google Analytics) pour comprendre
          la fréquentation du site. Aucun cookie publicitaire.{' '}
          <a href="/confidentialite" style={{ color: th.accent, textDecoration: 'underline' }}>En savoir plus</a>.
        </p>
        <div style={{ display: 'flex', gap: 10, flex: '0 0 auto' }}>
          <button type="button" onClick={refuse} style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${th.line}`, background: 'transparent', color: th.text, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Refuser
          </button>
          <button type="button" onClick={accept} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: th.accent, color: th.onAccent, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
