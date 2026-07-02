'use client';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon, IconName } from '@/components/ui/Icon';
import { AgendaICSItem, buildAgendaICS, icsFilename } from '@/lib/tournament';

// Partager la fiche (Web Share API, repli copie de lien) + export agenda (.ics).
// Sert aux fiches tournoi (uidPrefix 'tournament'), event ('event') et partie ('match').
// L'URL est lue au clic (window absent au rendu serveur) — sauf shareUrl fourni
// (partie : URL versionnée par l'état ?s=) ; shareText enrichit les canaux sans aperçu.
export function ShareActions({ item, uidPrefix = 'tournament', shareUrl, shareText }: { item: AgendaICSItem; uidPrefix?: 'tournament' | 'event' | 'match'; shareUrl?: string; shareText?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const share = async () => {
    const url = shareUrl ?? window.location.href;
    if (typeof navigator.share === 'function') {
      // AbortError quand l'utilisateur referme la feuille de partage : silencieux.
      await navigator.share(shareText ? { title: item.name, text: shareText, url } : { title: item.name, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard indisponible (contexte non sécurisé) : on n'affiche rien */ }
  };

  const downloadICS = () => {
    const blob = new Blob([buildAgendaICS(item, window.location.href, new Date(), uidPrefix)], { type: 'text/calendar;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = icsFilename(item.name);
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div style={{ display: 'flex', gap: 8, padding: '14px 20px 0', flexWrap: 'wrap' }}>
      <Pill icon="share" label={copied ? 'Lien copié !' : 'Partager'} onClick={share} />
      <Pill icon="download" label="Ajouter au calendrier" onClick={downloadICS} />
    </div>
  );
}

function Pill({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  const { th } = useTheme();
  return (
    <button onClick={onClick} style={{
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7,
      border: `1px solid ${th.line}`, background: th.surface, color: th.textMute, borderRadius: 999,
      padding: '8px 14px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600,
    }}>
      <Icon name={icon} size={15} color={th.textMute} />{label}
    </button>
  );
}
