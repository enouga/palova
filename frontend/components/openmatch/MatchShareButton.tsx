'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn } from '@/components/ui/atoms';

// Partage d'une partie ouverte : Web Share API, repli copie du lien.
// L'URL est explicite (les cartes de liste ne sont pas à l'URL de la partie).
// `compact` = bouton à icône seule (barre d'actions des cartes — le libellé
// passerait la barre à 2 lignes en mobile) ; l'état copié bascule l'icône en ✓.
export function MatchShareButton({ url, title, text, style, compact = false }: { url: string; title: string; text?: string; style?: React.CSSProperties; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const share = async () => {
    if (typeof navigator.share === 'function') {
      await navigator.share(text ? { title, text, url } : { title, url }).catch(() => {}); // AbortError (feuille refermée) : silencieux
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* presse-papier indisponible (contexte non sécurisé) : rien */ }
  };

  if (compact) {
    const side = (style?.height as number | undefined) ?? 46;
    return (
      <Btn variant="surface" icon={copied ? 'check' : 'share'}
        ariaLabel={copied ? 'Lien copié !' : 'Partager'}
        style={{ ...style, width: side, padding: 0, flexShrink: 0 }} onClick={share} />
    );
  }
  return (
    <Btn variant="surface" icon="share" style={style} onClick={share}>
      {copied ? 'Lien copié !' : 'Partager'}
    </Btn>
  );
}
