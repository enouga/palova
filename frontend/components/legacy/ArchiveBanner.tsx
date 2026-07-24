'use client';
import { useTheme } from '@/lib/ThemeProvider';

// Bandeau d'archive : les pages de `/archive/*` sont des COPIES FIGÉES des trois surfaces
// d'avant la fusion de l'accueil, conservées pour comparaison. Elles ressemblent beaucoup à
// la page vivante — sans ce repère, impossible de savoir laquelle on regarde. Posé en
// `position: fixed` pour ne rien décaler dans la mise en page comparée.
export function ArchiveBanner({ label }: { label: string }) {
  const { th } = useTheme();
  return (
    <div
      style={{
        position: 'fixed', left: 12, bottom: 12, zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 8,
        background: th.ink, color: '#f7f5ee', borderRadius: 999, padding: '7px 14px',
        fontFamily: th.fontUI, fontSize: 12, fontWeight: 700,
        boxShadow: '0 10px 26px rgba(0,0,0,.3)',
      }}
    >
      <span aria-hidden="true">🗄️</span>
      Archive · {label}
      <a href="/" style={{ color: '#f7f5ee', opacity: 0.75, textDecoration: 'underline', fontWeight: 600 }}>
        page actuelle →
      </a>
    </div>
  );
}
