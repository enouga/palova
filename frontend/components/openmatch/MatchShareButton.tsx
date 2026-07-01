'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn } from '@/components/ui/atoms';

// Partage d'une partie ouverte : Web Share API, repli copie du lien.
// L'URL est explicite (les cartes de liste ne sont pas à l'URL de la partie).
export function MatchShareButton({ url, title, style }: { url: string; title: string; style?: React.CSSProperties }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const share = async () => {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, url }).catch(() => {}); // AbortError (feuille refermée) : silencieux
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* presse-papier indisponible (contexte non sécurisé) : rien */ }
  };

  return (
    <Btn variant="surface" icon="share" style={style} onClick={share}>
      {copied ? 'Lien copié !' : 'Partager'}
    </Btn>
  );
}
