'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { LEVEL_SOURCE_PLAIN, LEVEL_SOURCE_HUMOR } from '@/lib/levelSource';
import { LevelGridSheet } from '@/components/player/LevelGridSheet';

export { LEVEL_SOURCE_PLAIN, LEVEL_SOURCE_HUMOR };

// Mention de source du référentiel de niveaux, CLIQUABLE : ouvre la grille interne
// (feuille top-sheet). Variante « humour » réservée aux écrans avec vannes.
export function LevelSourceNote({ humor = false, style }: { humor?: boolean; style?: React.CSSProperties }) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);

  const lead = humor ? 'Niveaux d’après la ' : 'Échelle de niveaux d’après la ';
  const link = 'grille Padel Magazine';
  const tail = humor ? " — l'humour est maison." : '.';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 11.5, color: th.textFaint, lineHeight: 1.4, ...style }}>
        {lead}<span style={{ color: th.accent, textDecoration: 'underline' }}>{link}</span>{tail}
      </button>
      {open && <LevelGridSheet onClose={() => setOpen(false)} />}
    </>
  );
}
