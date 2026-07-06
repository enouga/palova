'use client';
import { useEffect, useState } from 'react';
import { api, ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { clubUrl } from '@/lib/clubUrl';
import { PreviewState, pluralNoun } from '@/lib/onboarding';
import { LivePhonePreview } from './LivePhonePreview';
import { WIZ, WizHeader, WizError } from './wizardUi';

// Confettis déterministes (pas de Math.random au rendu — positions dérivées de l'index).
const CONFETTI_COLORS = Object.values(ACCENTS);
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: (i % 7) * 0.3,
  duration: 2.8 + (i % 5) * 0.45,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  round: i % 3 === 0,
}));

export function StepLaunch({ club, preview, clubId, token, onPatched, onFinished }: {
  club: ClubAdminDetail;
  preview: PreviewState;
  clubId: string;
  token: string;
  onPatched: (club: ClubAdminDetail) => void;
  onFinished: () => void;
}) {
  const { th } = useTheme();
  const accent = club.accentColor;
  const [listed, setListed] = useState(club.listedInDirectory);
  const [phase, setPhase] = useState<'form' | 'done'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // « Copié ✓ » revient à « 📋 Copier » après 2 s (timer nettoyé si démontage entre-temps).
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.adminUpdateClub(clubId, { listedInDirectory: listed }, token);
      onPatched(updated);
      setPhase('done');
      onFinished();
    } catch { setError('Impossible d’enregistrer. Réessayez.'); }
    finally { setBusy(false); }
  };

  const copy = () => {
    navigator.clipboard.writeText(clubUrl(club.slug, '/')).then(() => setCopied(true)).catch(() => {});
  };

  if (phase === 'form') {
    return (
      <div>
        <WizHeader accent={accent} surtitle={`Mise en ligne · ${club.name}`}
          title={<>Prêt pour le<br />coup d’envoi ?</>}
          sub="Dernier choix : votre visibilité sur Palova. Ensuite, place au jeu." />
        {error && <WizError>{error}</WizError>}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', marginBottom: 8 }}>
          <input type="checkbox" checked={listed} aria-label="Afficher mon club dans l’annuaire Palova"
            onChange={(e) => setListed(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: accent, cursor: 'pointer', marginTop: 2 }} />
          <span>
            <span style={{ display: 'block', color: WIZ.text, fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600 }}>Afficher mon club dans l’annuaire Palova</span>
            <span style={{ display: 'block', color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12.5, marginTop: 3 }}>
              Décoché, votre club reste accessible par son adresse directe.
            </span>
          </span>
        </label>
        <div style={{ marginTop: 22 }}>
          <button type="button" onClick={launch} disabled={busy} style={{
            background: accent, color: inkOn(accent), border: 'none', borderRadius: 13,
            padding: '13px 28px', fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 800,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Mise en ligne…' : 'Mettre mon club en ligne 🎉'}
          </button>
        </div>
      </div>
    );
  }

  // ---- Final festif ----
  const courtsTotal = preview.sports.reduce((n, s) => n + s.courtCount, 0);
  return (
    <div style={{ textAlign: 'center', padding: '30px 0 10px' }}>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes ob-fall {
            from { transform: translateY(-8vh) rotate(0deg); opacity: 1; }
            to   { transform: translateY(85vh) rotate(340deg); opacity: 0; }
          }
          .ob-confetti { animation-name: ob-fall; animation-timing-function: linear; animation-iteration-count: 1; animation-fill-mode: both; }
        }
        @media (prefers-reduced-motion: reduce) { .ob-confetti { display: none; } }
      `}</style>
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {CONFETTI.map((c, i) => (
          <span key={i} className="ob-confetti" style={{
            position: 'absolute', top: 0, left: `${c.left}%`,
            width: c.round ? 7 : 8, height: c.round ? 7 : 14,
            borderRadius: c.round ? '50%' : 2, background: c.color,
            animationDelay: `${c.delay}s`, animationDuration: `${c.duration}s`,
          }} />
        ))}
      </div>

      <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
        Félicitations 🎉
      </div>
      <div style={{ color: WIZ.text, fontFamily: th.fontDisplay, fontSize: 38, fontWeight: 600, lineHeight: 1.1 }}>
        {club.name}<br />est <em style={{ color: accent }}>en ligne.</em>
      </div>

      <div style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 10, background: WIZ.card, border: `1px solid ${WIZ.line}`, borderRadius: 24, padding: '9px 18px' }}>
        <span style={{ color: accent, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700 }}>{club.slug}.palova.fr</span>
        <button type="button" onClick={copy} style={{ background: 'transparent', border: 'none', borderLeft: `1px solid ${WIZ.line}`, paddingLeft: 10, color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12, cursor: 'pointer' }}>
          <span aria-live="polite">{copied ? 'Copié ✓' : '📋 Copier'}</span>
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <span style={{ background: `${accent}20`, color: accent, borderRadius: 16, padding: '4px 12px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700 }}>✓ Identité</span>
        {preview.sports.map((s) => (
          <span key={s.key} style={{ background: `${accent}20`, color: accent, borderRadius: 16, padding: '4px 12px', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700 }}>
            {s.courtCount > 0 ? `✓ ${s.name} · ${s.courtCount} ${pluralNoun(s.noun, s.courtCount)}` : `✓ ${s.name}`}
          </span>
        ))}
        {courtsTotal === 0 && (
          <span style={{ background: 'rgba(255,255,255,.08)', color: WIZ.mute, borderRadius: 16, padding: '4px 12px', fontFamily: th.fontUI, fontSize: 11.5 }}>Terrains · plus tard</span>
        )}
        {club.stripeAccountStatus !== 'ACTIVE' && (
          <span style={{ background: 'rgba(255,255,255,.08)', color: WIZ.mute, borderRadius: 16, padding: '4px 12px', fontFamily: th.fontUI, fontSize: 11.5 }}>Paiement en ligne · plus tard</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 24 }}>
        <a href="/" style={{ background: accent, color: inkOn(accent), borderRadius: 13, padding: '12px 24px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>
          Découvrir mon club-house →
        </a>
        <a href="/admin" style={{ border: `1.5px solid ${WIZ.line}`, color: WIZ.text, borderRadius: 13, padding: '12px 24px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
          Aller à l’espace de gestion
        </a>
      </div>

      <div style={{ marginTop: 30, display: 'flex', justifyContent: 'center', opacity: 0.95 }}>
        <LivePhonePreview preview={preview} />
      </div>
    </div>
  );
}
