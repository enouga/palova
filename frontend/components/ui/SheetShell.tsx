'use client';
import { useEffect } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { useIsDesktop } from '@/lib/useIsDesktop';

// Chrome partagé des feuilles de match : bottom-sheet pleine largeur en mobile,
// dialogue centré (~420px) en desktop. Ferme sur clic overlay et Échap.
export function SheetShell({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  /** aria-label du dialogue. */
  label: string;
  children: React.ReactNode;
}) {
  const { th } = useTheme();
  const isDesktop = useIsDesktop();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: isDesktop ? 'center' : 'flex-end',
        alignItems: isDesktop ? 'center' : 'stretch',
      }}
    >
      <div
        data-overlay
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(2px)',
          animation: 'sp-fade .25s ease',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: 'relative',
          width: isDesktop ? 'min(420px, 92vw)' : '100%',
          boxSizing: 'border-box',
          maxHeight: '85dvh',
          overflowY: 'auto',
          background: th.bgElev,
          borderRadius: isDesktop ? 18 : '18px 18px 0 0',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.3)',
          animation: isDesktop ? 'sp-fade .2s ease' : 'sp-sheet-in .3s cubic-bezier(.2,.8,.2,1)',
          padding: '8px 14px 14px',
        }}
      >
        {!isDesktop && (
          <div
            aria-hidden="true"
            style={{
              width: 36,
              height: 4,
              borderRadius: 999,
              background: th.lineStrong,
              margin: '2px auto 10px',
            }}
          />
        )}
        {children}
      </div>
    </div>
  );
}
