'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { Avatar } from '@/components/ui/Avatar';
import { Btn } from '@/components/ui/atoms';
import { colorForSeed } from '@/lib/playerColors';
import type { MarkTableBenchEntry } from '@/lib/api';

/**
 * Barre du banc, ancrée en bas d'écran. Tap sur un joueur = sélection (jusqu'à 2, cf.
 * `benchSelectionNext`) ; 2 sélectionnés → bouton « Apparier ✓ ». Purement présentationnelle :
 * ni état ni réseau — le parent (Task 14) possède `selection` et gère `+`/l'appariement.
 */
export function BenchBar({ bench, selection, onTapPlayer, onAddWalkIn, onPair }: {
  bench: MarkTableBenchEntry[];
  selection: string[];
  onTapPlayer: (userId: string) => void;
  onAddWalkIn: () => void;
  onPair: () => void;
}) {
  const { th } = useTheme();
  return (
    <div style={{
      position: 'sticky', bottom: 0, background: th.surface, borderRadius: '18px 18px 0 0',
      boxShadow: '0 -5px 20px rgba(0,0,0,.13)', padding: '10px 14px 13px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: th.fontUI, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: th.textMute, textTransform: 'uppercase' }}>
          Banc
        </span>
        {selection.length === 1 && (
          <span style={{ fontFamily: th.fontUI, fontSize: 11.5, color: th.accent, fontWeight: 600 }}>
            — touchez une place ✕ pour remplacer, ou un autre joueur pour apparier
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflowX: 'auto' }}>
        {bench.length === 0 && (
          <span style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint }}>Banc vide.</span>
        )}
        {bench.map((b) => {
          const selected = selection.includes(b.userId);
          return (
            <button key={b.userId} onClick={() => onTapPlayer(b.userId)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}>
              <span style={{ borderRadius: '50%', boxShadow: selected ? `0 0 0 3px ${ACCENTS.blue}55` : 'none' }}>
                <Avatar firstName={b.firstName} lastName={b.lastName} avatarUrl={b.avatarUrl} size={30} color={colorForSeed(b.userId)} />
              </span>
              <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: selected ? th.accent : th.textMute, whiteSpace: 'nowrap' }}>
                {b.firstName} {b.lastName}
              </span>
            </button>
          );
        })}
        <button onClick={onAddWalkIn} aria-label="Ajouter un retardataire"
          style={{ width: 30, height: 30, borderRadius: '50%', border: `1.5px dashed ${th.textFaint}`, background: 'transparent', color: th.textFaint, fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>
          +
        </button>
        {selection.length === 2 && (
          <Btn variant="primary" onClick={onPair} style={{ marginLeft: 'auto', height: 34, fontSize: 12.5, padding: '0 14px', flexShrink: 0 }}>
            Apparier ✓
          </Btn>
        )}
      </div>
    </div>
  );
}
