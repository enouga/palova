'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { Btn } from '@/components/ui/atoms';
import { slugify } from '@/lib/slug';
import { CANONICAL_ROOT } from '@/lib/roots';

// Aperçu d'URL : on affiche le domaine canonique (multi-domaines → palova.fr).
const ROOT = CANONICAL_ROOT;

/**
 * Dialog top-sheet de changement d'alias (même langage visuel que ConfirmDialog).
 * Partagé par la table /superadmin/clubs et la fiche club /superadmin/clubs/[id].
 */
export function ChangeSlugDialog({ club, onDone, onCancel }: {
  club: { id: string; slug: string; name: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const { th } = useTheme();
  const { token } = useAuth();
  // Suggestion : slug dérivé du nom ACTUEL du club (renommer un club ne touche jamais son slug).
  const [value, setValue] = useState(slugify(club.name));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = slugify(value);
  const unchanged = next === club.slug;

  async function submit() {
    if (!token || !next || unchanged) return;
    setBusy(true); setError(null);
    try {
      await api.platformChangeClubSlug(club.id, next, token);
      onDone();
    } catch (err) {
      const m = (err as Error).message;
      setError(m === 'SLUG_TAKEN' ? 'Cet alias est déjà utilisé ou réservé par un autre club.'
        : m === 'SLUG_RESERVED' ? 'Cet alias est réservé par la plateforme (www, app, api…).'
        : m === 'SLUG_INVALID' ? 'Alias invalide : utilisez des lettres, chiffres et tirets.'
        : "Échec du changement d'alias. Réessayez.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={busy ? undefined : onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div role="dialog" aria-modal="true" style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '12px 20px 36px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, letterSpacing: -0.3 }}>
          Changer l&apos;alias de {club.name}
        </div>

        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 14 }}>
          Adresse actuelle : <span style={{ fontFamily: th.fontMono, color: th.text }}>{club.slug}.{ROOT}</span>
        </div>

        <label style={{ display: 'block', marginTop: 14 }}>
          <span style={{ fontSize: 12.5, color: th.textMute, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Nouvel alias</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            style={{
              display: 'block', width: '100%', marginTop: 6, padding: '11px 14px',
              borderRadius: 12, border: `1px solid ${th.line}`, background: th.surface2,
              color: th.text, fontFamily: th.fontMono, fontSize: 14.5, outline: 'none',
            }}
          />
        </label>

        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 10 }}>
          Nouvelle adresse : <span style={{ fontFamily: th.fontMono, color: th.accent }}>{next || '…'}.{ROOT}</span>
        </div>

        <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 12, lineHeight: 1.45 }}>
          L&apos;ancienne adresse <span style={{ fontFamily: th.fontMono }}>{club.slug}.{ROOT}</span> restera
          réservée et redirigera définitivement les anciens liens vers la nouvelle adresse.
        </div>

        {error && (
          <div style={{ ...dangerBanner(th), marginTop: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 11, marginTop: 24 }}>
          <Btn variant="surface" onClick={onCancel} disabled={busy} style={{ flex: '0 0 42%' }}>Retour</Btn>
          <Btn onClick={submit} disabled={busy || !next || unchanged} style={{ flex: 1 }}>
            {busy ? '…' : "Changer l'alias"}
          </Btn>
        </div>
        <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
      </div>
    </div>
  );
}
