'use client';
import { useRef, useState, CSSProperties, ReactNode, RefObject } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { assetUrl } from '@/lib/api';
import { Btn } from '@/components/ui/atoms';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { LOGO_WARNING_LABEL, wideLogo, iconLogo, clientRatioWarning, type LogoWarning } from '@/lib/clubLogos';

type Variant = 'icon' | 'wide' | 'wide-dark';
interface ClubLike {
  logoUrl: string | null; logoWideUrl: string | null; logoWideDarkUrl: string | null;
  name: string; accentColor: string;
}
interface Props {
  club: ClubLike;
  uploading: Variant | null;
  warnings: Partial<Record<Variant, LogoWarning>>;
  onPick: (variant: Variant, file: File) => void;
  onDelete: (variant: 'wide' | 'wide-dark') => void; // l'icône n'est pas supprimable
}

const CHIP: CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 };

export function LogoStudio({ club, uploading, warnings, onPick, onDelete }: Props) {
  const { th } = useTheme();
  const [showAdvanced, setShowAdvanced] = useState(!!club.logoWideDarkUrl);
  const iconRef = useRef<HTMLInputElement>(null);
  const wideRef = useRef<HTMLInputElement>(null);
  const darkRef = useRef<HTMLInputElement>(null);
  // Avertissement PERSISTANT sur l'icône en place (mesurée au chargement de l'aperçu), en plus
  // du warning transitoire renvoyé par le serveur au dernier upload.
  const [iconWarn, setIconWarn] = useState<LogoWarning | null>(null);

  const chip = (text: string, bg: string, color: string) => (
    <span style={{ ...CHIP, background: bg, color }}>{text}</span>
  );
  const warnBox = (code: LogoWarning | null | undefined) => code ? (
    <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 9, background: `${th.accentWarm}22`, color: th.text, fontSize: 12.5 }}>
      {LOGO_WARNING_LABEL[code]}
    </div>
  ) : null;
  const warn = (v: Variant) => warnBox(warnings[v]);

  const hiddenInput = (ref: RefObject<HTMLInputElement | null>, v: Variant, label: string) => (
    <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} aria-label={label}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(v, f); e.target.value = ''; }} />
  );

  const iconUrl = assetUrl(iconLogo(club));
  const wideUrlLight = assetUrl(club.logoWideUrl ?? club.logoUrl);
  const wideUrlDark = assetUrl(wideLogo(club, 'floodlit'));

  return (
    <div className="pl-create-grid">
      {/* Colonne gauche — emplacements */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Icône carrée */}
        <div style={{ background: th.surface2, borderRadius: 14, padding: 14, boxShadow: th.shadow }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {iconUrl
              ? <img src={iconUrl} alt="Icône du club"
                  onLoad={(e) => setIconWarn(clientRatioWarning(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight, 'icon'))}
                  style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'contain', background: '#fff', flexShrink: 0 }} />
              : <span style={{ width: 64, height: 64, borderRadius: 14, background: club.accentColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24, flexShrink: 0 }}>{(club.name[0] ?? '?').toUpperCase()}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>Icône carrée</strong>
                {chip('En place ✓', `${th.accent}1f`, th.accent)}
              </div>
              <div style={{ fontSize: 12.5, color: th.textFaint, margin: '3px 0 7px' }}>Le symbole seul, sans texte fin — app installée, notifications, favicon, pastilles.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {chip('PNG / WebP', th.bg, th.text)}{chip('Carré ≥ 512 px', th.bg, th.text)}{chip('Fond transparent', th.bg, th.text)}
              </div>
              <Btn type="button" variant="surface" disabled={uploading === 'icon'} onClick={() => iconRef.current?.click()}>
                {uploading === 'icon' ? 'Envoi…' : 'Changer l’icône'}
              </Btn>
            </div>
          </div>
          {hiddenInput(iconRef, 'icon', 'Choisir l’icône du club')}
          {warnBox(warnings.icon ?? iconWarn)}
        </div>

        {/* Logotype horizontal */}
        <div style={{ background: th.surface2, borderRadius: 14, padding: 14, boxShadow: th.shadow }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {wideUrlLight
              ? <img src={wideUrlLight} alt="Logotype du club" style={{ height: 34, maxWidth: 150, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: '2px 6px', flexShrink: 0 }} />
              : <span style={{ fontSize: 12, color: th.textFaint, width: 150 }}>Aucun logotype</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>Logotype horizontal</strong>
                {!club.logoWideUrl && chip('Recommandé', `${th.accentWarm}26`, th.text)}
              </div>
              <div style={{ fontSize: 12.5, color: th.textFaint, margin: '3px 0 7px' }}>Votre logo avec le nom — bandeau du site et en-tête des emails. À défaut, l’icône est utilisée.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {chip('PNG / WebP', th.bg, th.text)}{chip('Hauteur ≥ 160 px', th.bg, th.text)}{chip('Fond transparent', th.bg, th.text)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn type="button" variant="surface" disabled={uploading === 'wide'} onClick={() => wideRef.current?.click()}>
                  {uploading === 'wide' ? 'Envoi…' : club.logoWideUrl ? 'Changer' : 'Ajouter'}
                </Btn>
                {club.logoWideUrl && <Btn type="button" variant="ghost" onClick={() => onDelete('wide')} ariaLabel="Retirer le logotype">Retirer</Btn>}
              </div>
            </div>
          </div>
          {hiddenInput(wideRef, 'wide', 'Choisir le logotype horizontal')}
          {warn('wide')}
        </div>

        {/* Avancé — version fond sombre */}
        <div style={{ background: th.surface2, borderRadius: 14, padding: 14, boxShadow: th.shadow }}>
          <button type="button" onClick={() => setShowAdvanced((s) => !s)}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', fontSize: 13, fontWeight: 600, color: th.text }}>
            <span>Avancé — version pour fond sombre</span><span aria-hidden>{showAdvanced ? '▾' : '▸'}</span>
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12.5, color: th.textFaint, marginBottom: 8 }}>Si votre logotype est sombre, il disparaît en thème sombre. Uploadez une version claire pour le bandeau nocturne.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn type="button" variant="surface" disabled={uploading === 'wide-dark'} onClick={() => darkRef.current?.click()}>
                  {uploading === 'wide-dark' ? 'Envoi…' : club.logoWideDarkUrl ? 'Changer' : 'Ajouter'}
                </Btn>
                {club.logoWideDarkUrl && <Btn type="button" variant="ghost" onClick={() => onDelete('wide-dark')} ariaLabel="Retirer la version sombre">Retirer</Btn>}
              </div>
              {hiddenInput(darkRef, 'wide-dark', 'Choisir le logotype pour fond sombre')}
              {warn('wide-dark')}
            </div>
          )}
        </div>
      </div>

      {/* Colonne droite — aperçus en direct */}
      <div className="pl-create-recap" style={{ background: HERO_GRADIENT, borderRadius: 16, padding: 16, color: HERO_INK }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: HERO_INK_MUTED, marginBottom: 10 }}>Aperçu — où vos logos apparaissent</div>

        <Preview label="Bandeau du site (clair)" bg="#ffffff" ink="#23314a">
          {wideUrlLight ? <img src={wideUrlLight} alt="" style={{ height: 20, objectFit: 'contain' }} /> : <em style={{ fontSize: 11 }}>logo</em>}
        </Preview>
        <Preview label="Bandeau du site (sombre)" bg="#1c2430" ink="#cfd6e0">
          {wideUrlDark ? <img src={wideUrlDark} alt="" style={{ height: 20, objectFit: 'contain' }} /> : <em style={{ fontSize: 11 }}>logo</em>}
        </Preview>
        <Preview label="Écran d’accueil du téléphone" bg="#1c2430" ink="#cfd6e0">
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: club.accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {iconUrl ? <img src={iconUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} /> : <strong style={{ color: '#fff' }}>{(club.name[0] ?? 'P').toUpperCase()}</strong>}
            </span>
            <span style={{ fontSize: 9 }}>{club.name.slice(0, 12)}</span>
          </span>
        </Preview>
        <Preview label="Notification" bg="#ffffff" ink="#23314a">
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: club.accentColor, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {iconUrl ? <img src={iconUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} /> : null}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700 }}>Partie confirmée 🎾</span>
          </span>
        </Preview>
        <Preview label="En-tête des emails" bg="#ffffff" ink="#23314a" last>
          <span style={{ display: 'block', textAlign: 'center' }}>
            {wideUrlLight ? <img src={wideUrlLight} alt="" style={{ height: 18, objectFit: 'contain' }} /> : <strong style={{ fontSize: 11 }}>{club.name}</strong>}
          </span>
        </Preview>
      </div>
    </div>
  );
}

function Preview({ label, bg, ink, last, children }: { label: string; bg: string; ink: string; last?: boolean; children: ReactNode }) {
  return (
    <div style={{ background: bg, color: ink, borderRadius: 10, padding: '8px 10px', marginBottom: last ? 0 : 8 }}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.6, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}
