'use client';

import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Logotype, ThemeToggle, BackButton } from '@/components/ui/atoms';

/** Chrome commun des pages de contenu public (légales, FAQ, offres). Le footer est global. */
export function ContentShell({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.bg, color: th.text, fontFamily: th.fontUI }}>
      <header style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 18px 4px' }}>
        <Logotype size={22} />
        <ThemeToggle />
      </header>
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '6px 18px 56px' }}>
        <div style={{ margin: '6px 0 18px' }}><BackButton href="/" label="Accueil" /></div>
        {children}
      </main>
    </div>
  );
}

/** Date « Dernière mise à jour » discrète sous le titre d'une page. */
export function UpdatedAt({ iso }: { iso: string | null }) {
  const { th } = useTheme();
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <p style={{ color: th.textFaint, fontSize: 13, margin: '0 0 18px' }}>
      Dernière mise à jour le {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
    </p>
  );
}
