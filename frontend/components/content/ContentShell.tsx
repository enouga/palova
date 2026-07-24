'use client';

import { ReactNode } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Logotype, ThemeToggle, BackButton } from '@/components/ui/atoms';

/** Chrome commun des pages de contenu public (légales, FAQ, offres). Le footer est global. */
export function ContentShell({ children }: { children: ReactNode }) {
  const { th } = useTheme();
  return (
    <div style={{ background: th.bg, color: th.text, fontFamily: th.fontUI }}>
      {/* En-tête sur UNE ligne : le retour « Accueil » vit à côté du logo (même en-tête que
          /decouvrir — avant, il occupait sa propre rangée et décalait tout le contenu). */}
      <header style={{ maxWidth: 800, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 18px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Logotype size={22} />
          <BackButton href="/" label="Accueil" />
        </div>
        <ThemeToggle />
      </header>
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '16px 18px 56px' }}>
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
