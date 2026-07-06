'use client';
import { useRef, useState } from 'react';
import { api, assetUrl, ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS, inkOn } from '@/lib/theme';
import { WIZ, WizHeader, WizLabel, WizError, WizActions } from './wizardUi';

const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function StepIdentity({ club, clubId, token, onLocal, onPatched, advance }: {
  club: ClubAdminDetail;
  clubId: string;
  token: string;
  onLocal: (patch: Partial<ClubAdminDetail>) => void;   // maj instantanée (aperçu vivant), sans réseau
  onPatched: (club: ClubAdminDetail) => void;           // vérité serveur après save
  advance: () => void;
}) {
  const { th } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accent = club.accentColor;

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setError('Format d’image non supporté (JPEG, PNG ou WebP)'); return; }
    if (file.size > MAX_LOGO_BYTES) { setError('Image trop lourde (2 Mo max)'); return; }
    setError(null);
    setUploading(true);
    try {
      const res = await api.uploadClubLogo(clubId, file, token);
      onLocal({ logoUrl: res.logoUrl });
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(false); }
  };

  // save lit les props au moment du clic — le shell doit réappliquer chaque onLocal dans `club`.
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.adminUpdateClub(clubId, { accentColor: club.accentColor, defaultThemeMode: club.defaultThemeMode }, token);
      onPatched(updated);
      advance();
    } catch { setError('Impossible d’enregistrer. Réessayez.'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <WizHeader accent={accent} surtitle={`Identité · ${club.name}`}
        title={<>Donnez un visage<br />à votre club.</>}
        sub="Logo et couleur — c’est ce que vos joueurs verront en premier. Tout reste modifiable." />

      {error && <WizError>{error}</WizError>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        {club.logoUrl ? (
          <img src={assetUrl(club.logoUrl) ?? ''} alt="Logo du club"
            style={{ width: 64, height: 64, borderRadius: 16, objectFit: 'contain', background: '#fff', opacity: uploading ? 0.5 : 1, flexShrink: 0 }} />
        ) : (
          <span style={{ width: 64, height: 64, borderRadius: 16, background: accent, color: inkOn(accent), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 24, flexShrink: 0 }}>
            {(club.name[0] ?? '?').toUpperCase()}
          </span>
        )}
        <div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
            aria-label="Importer votre logo"
            onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
            style={{ border: `1.5px dashed ${WIZ.line}`, background: 'transparent', borderRadius: 11, padding: '9px 16px', color: '#cfd6e2', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {uploading ? 'Envoi…' : club.logoUrl ? '📷 Changer le logo' : '📷 Importer votre logo'}
          </button>
          <div style={{ color: WIZ.faint, fontFamily: th.fontUI, fontSize: 11, marginTop: 5 }}>
            {club.logoUrl ? 'JPEG, PNG ou WebP · 2 Mo max' : 'ou gardez le monogramme, très chic aussi'}
          </div>
        </div>
      </div>

      <WizLabel>Votre couleur</WizLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.values(ACCENTS).map((hex) => (
          <button key={hex} type="button" onClick={() => onLocal({ accentColor: hex })} aria-label={`Accent ${hex}`}
            style={{
              width: 34, height: 34, borderRadius: 10, background: hex, cursor: 'pointer',
              border: 'none',
              outline: accent.toLowerCase() === hex.toLowerCase() ? '2px solid #fff' : 'none', outlineOffset: 2,
            }} />
        ))}
      </div>

      <WizLabel>Ambiance de l’app</WizLabel>
      <div style={{ display: 'flex', gap: 8 }}>
        {([['floodlit', 'Sombre 🌙'], ['daylight', 'Clair ☀️']] as const).map(([mode, label]) => (
          <button key={mode} type="button" onClick={() => onLocal({ defaultThemeMode: mode })}
            style={{
              borderRadius: 20, padding: '7px 16px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: club.defaultThemeMode === mode ? accent : WIZ.card,
              color: club.defaultThemeMode === mode ? inkOn(accent) : WIZ.mute,
              border: `1px solid ${club.defaultThemeMode === mode ? accent : WIZ.line}`,
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* verrouillé aussi pendant l'upload : avancer en plein vol laisserait onPatched écraser le logo */}
      <WizActions accent={accent} busy={busy} disabled={uploading} onNext={save} onSkip={advance} />
    </div>
  );
}
