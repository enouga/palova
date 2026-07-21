'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { CANONICAL_ROOT } from '@/lib/roots';
import { gaId } from '@/lib/gtag';
import { CONSENT_EVENT } from '@/lib/consent';

// Pages où le footer n'a pas sa place (espaces de travail plein écran, écrans d'auth).
const HIDDEN_PREFIXES = ['/admin', '/superadmin', '/login', '/register'];

export function Footer() {
  const { th } = useTheme();
  const { slug, club } = useClub();
  const pathname = usePathname() || '/';

  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return null;

  // Liens selon le contexte : un club met en avant ses offres, la plateforme ses tarifs.
  const links = slug
    ? [
        { href: '/aide', label: 'Aide' },
        { href: '/offres', label: 'Nos offres' },
        { href: '/faq', label: 'FAQ' },
        { href: '/cgv', label: 'CGV' },
        { href: `https://${CANONICAL_ROOT}/cgu`, label: 'CGU Palova' },
        { href: '/mentions-legales', label: 'Mentions légales' },
        { href: '/confidentialite', label: 'Confidentialité' },
      ]
    : [
        { href: '/tarifs', label: 'Tarifs' },
        { href: '/faq', label: 'FAQ' },
        { href: '/cgu', label: 'CGU' },
        { href: '/cgv', label: 'CGV' },
        { href: '/mentions-legales', label: 'Mentions légales' },
        { href: '/confidentialite', label: 'Confidentialité' },
      ];

  return (
    <footer style={{ borderTop: `1px solid ${th.line}`, background: th.bg, color: th.textMute, fontFamily: th.fontUI }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 18px 28px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
          {links.map((l) => l.href.startsWith('http') ? (
            <a key={l.href} href={l.href} style={{ color: th.textMute, textDecoration: 'none', fontSize: 13.5, fontWeight: 500 }}>
              {l.label}
            </a>
          ) : (
            <Link key={l.href} href={l.href} style={{ color: th.textMute, textDecoration: 'none', fontSize: 13.5, fontWeight: 500 }}>
              {l.label}
            </Link>
          ))}
          {gaId() && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(CONSENT_EVENT))}
              style={{ color: th.textMute, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13.5, fontWeight: 500, fontFamily: 'inherit' }}
            >
              Gérer les cookies
            </button>
          )}
        </nav>
        <div style={{ fontSize: 12.5, color: th.textFaint }}>
          {slug ? (
            <>
              {club?.name ? `${club.name} · ` : ''}
              <a href={`https://${CANONICAL_ROOT}`} target="_blank" rel="noreferrer" style={{ color: th.textFaint, textDecoration: 'none' }}>
                Propulsé par Palova
              </a>
            </>
          ) : (
            <>© {new Date().getFullYear()} Palova</>
          )}
        </div>
      </div>
    </footer>
  );
}
