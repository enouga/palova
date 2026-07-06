'use client';
import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useClub } from '@/lib/ClubProvider';
import { assetUrl } from '@/lib/api';
import type { ClubDetail } from '@/lib/api';
import { AuthAudience, CLUB_PANEL_LINE, PANEL_COPY, clubPanelWash } from '@/lib/authShell';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';

/** Tuile blanche portant le logo du club (repli : initiale sur l'accent du club). */
function ClubTile({ club, size }: { club: Pick<ClubDetail, 'name' | 'logoUrl' | 'accentColor'>; size: number }) {
  const { th } = useTheme();
  const logo = assetUrl(club.logoUrl);
  return (
    <span style={{
      width: size, height: size, borderRadius: Math.round(size * 0.26), background: '#ffffff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 6px 18px rgba(24,21,14,0.10)', overflow: 'hidden', flexShrink: 0,
    }}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" style={{ width: Math.round(size * 0.72), height: Math.round(size * 0.72), objectFit: 'contain' }} />
      ) : (
        <span style={{ fontFamily: th.fontDisplay, fontWeight: 700, fontSize: Math.round(size * 0.42), color: club.accentColor }}>
          {club.name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/**
 * Coquille des pages d'auth : écran scindé en desktop (panneau de marque à
 * gauche, formulaire à droite), bandeau de marque compact + colonne en mobile.
 * Sur un hôte club, le panneau prend l'identité du club (lavis clair dérivé de
 * son accent, encre fixe HERO_INK) — sauf `audience: 'club'` (créer un NOUVEAU
 * club → toujours le panneau Palova B2B). `title` omis sur les étapes
 * verify/reset : ces formulaires portent leur propre heading.
 */
export function AuthShell({ title, subtitle, audience = 'player', children }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  audience?: AuthAudience;
  children: ReactNode;
}) {
  const { th } = useTheme();
  const { club } = useClub();
  const clubIdentity = audience === 'club' ? null : club;
  const wash = clubIdentity ? clubPanelWash(clubIdentity.accentColor) : HERO_GRADIENT;
  const copy = PANEL_COPY[audience];
  const line = clubIdentity ? CLUB_PANEL_LINE : copy.line;

  const chipRow = (compact: boolean) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: compact ? 10 : 18, position: 'relative' }}>
      {copy.chips.map((c) => (
        <span key={c.label} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.62)',
          borderRadius: 999, padding: compact ? '4px 10px' : '6px 12px',
          fontFamily: th.fontUI, fontSize: compact ? 11.5 : 12.5, fontWeight: 600, color: HERO_INK,
        }}>
          <Icon name={c.icon} size={12} color={HERO_INK} />
          {c.label}
        </span>
      ))}
    </div>
  );

  // Filigrane : traces du logo Palova (même motif que le hero de la vitrine).
  const filigrane = (
    <svg viewBox="0 0 100 100" aria-hidden="true"
      style={{ position: 'absolute', right: -70, bottom: -58, width: 300, height: 300, opacity: 0.1, pointerEvents: 'none' }}>
      <g fill="none" stroke={HERO_INK} strokeWidth={3.4} strokeLinecap="round">
        <circle cx="50" cy="50" r="37" />
        <path d="M20 30 Q50 50 20 70" />
        <path d="M80 30 Q50 50 80 70" />
      </g>
    </svg>
  );

  return (
    <div className="auth-shell" style={{ background: th.bg }}>
      {/* ── Panneau de marque (desktop) ── */}
      <aside className="auth-panel" style={{
        background: wash, color: HERO_INK, position: 'relative', overflow: 'hidden',
        flexDirection: 'column', justifyContent: 'space-between', padding: '30px 36px 24px',
      }}>
        {filigrane}
        <div style={{ position: 'relative' }}>
          {clubIdentity ? <ClubTile club={clubIdentity} size={54} /> : <Logotype size={28} color={HERO_INK} />}
        </div>
        <div style={{ position: 'relative', padding: '40px 0' }}>
          {clubIdentity ? (
            <>
              <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.6, lineHeight: 1.1 }}>
                {clubIdentity.name}
              </div>
              {clubIdentity.city && (
                <div style={{ fontFamily: th.fontUI, fontSize: 14, color: HERO_INK_MUTED, marginTop: 6 }}>{clubIdentity.city}</div>
              )}
            </>
          ) : (
            <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 34, letterSpacing: -0.6, lineHeight: 1.14 }}>
              {copy.headline}
            </div>
          )}
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, color: HERO_INK_MUTED, lineHeight: 1.55, margin: '12px 0 0', maxWidth: 340 }}>
            {line}
          </p>
          {chipRow(false)}
        </div>
        <div style={{ position: 'relative', minHeight: 18 }}>
          {clubIdentity && (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, fontFamily: th.fontUI, fontSize: 12, color: HERO_INK_MUTED }}>
              propulsé par <Logotype size={15} color={HERO_INK} />
            </span>
          )}
        </div>
      </aside>

      {/* ── Bandeau de marque (mobile) ── */}
      <div className="auth-banner" style={{ background: wash, color: HERO_INK, position: 'relative', overflow: 'hidden', padding: '16px 20px 15px' }}>
        {filigrane}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
          {clubIdentity ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <ClubTile club={clubIdentity} size={34} />
              <span style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 17, letterSpacing: -0.3 }}>{clubIdentity.name}</span>
            </span>
          ) : (
            <Logotype size={24} color={HERO_INK} />
          )}
          <ThemeToggle />
        </div>
        <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: HERO_INK_MUTED, margin: '10px 0 0', position: 'relative' }}>{line}</p>
        {chipRow(true)}
      </div>

      {/* ── Colonne formulaire ── */}
      <main className="auth-main">
        <div className="auth-toggle" style={{ justifyContent: 'flex-end', padding: '20px 24px 0' }}>
          <ThemeToggle />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '26px 24px 44px' }}>
          {/* margin auto (≠ align-items:center) : centre verticalement SANS clipper
              le haut quand le formulaire dépasse l'écran (register, clubs/new). */}
          <div className="sp-hero-rise" style={{ width: '100%', maxWidth: 460, margin: 'auto 0' }}>
            {title != null && (
              <h1 className="auth-title" style={{ fontFamily: th.fontDisplay, fontWeight: 500, color: th.text, letterSpacing: -0.5, lineHeight: 1.06, margin: 0 }}>
                {title}
              </h1>
            )}
            {subtitle != null && (
              <p style={{ fontFamily: th.fontUI, fontSize: 15, color: th.textMute, lineHeight: 1.5, margin: '12px 0 0', maxWidth: 400 }}>
                {subtitle}
              </p>
            )}
            {(title != null || subtitle != null) && <div style={{ height: 26 }} />}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
