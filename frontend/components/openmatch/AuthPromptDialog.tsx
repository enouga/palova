'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Btn } from '@/components/ui/atoms';

interface AuthPromptDialogProps {
  /** Ligne de contexte (ex. « Terrain 1 »). */
  detail?: string;
  onRegister: () => void;
  onLogin: () => void;
  onClose: () => void;
}

/**
 * Invite un visiteur anonyme à s'inscrire / se connecter pour rejoindre une partie.
 * Top-sheet calqué sur ConfirmDialog (même langage visuel que les modales).
 */
export function AuthPromptDialog({ detail, onRegister, onLogin, onClose }: AuthPromptDialogProps) {
  const { th } = useTheme();
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', animation: 'sp-fade .25s ease' }} />
      <div role="dialog" aria-modal="true" style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto', background: th.bgElev, borderRadius: '0 0 28px 28px', padding: '12px 20px 36px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', animation: 'sp-sheet-in-top .34s cubic-bezier(.2,.8,.2,1)' }}>
        <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, color: th.text, letterSpacing: -0.3 }}>Rejoindre la partie</div>
        {detail && (
          <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text, marginTop: 14, background: th.surface2, borderRadius: 14, padding: '13px 16px' }}>{detail}</div>
        )}
        <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, marginTop: 14, lineHeight: 1.45 }}>
          Créez un compte (ou connectez-vous) pour vous ajouter à cette partie.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 24 }}>
          <Btn icon="arrowR" onClick={onRegister}>Créer un compte</Btn>
          <Btn variant="surface" onClick={onLogin}>J&apos;ai déjà un compte</Btn>
        </div>
        <div style={{ width: 38, height: 5, borderRadius: 3, background: th.lineStrong, margin: '18px auto 0' }} />
      </div>
    </div>
  );
}
