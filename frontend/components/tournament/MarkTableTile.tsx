'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { presenceGlyph, isReplaceableSlot } from '@/lib/markTable';
import type { MarkTableRegistration, MarkTableSide } from '@/lib/api';

/**
 * Une tuile binôme de la grille. Tap sur un nom = pointage (cycle). Si `replaceHighlight`
 * (userId du banc sélectionné) est posé, tout côté ABSENT devient un bouton « Mettre X ici »
 * qui déclenche le remplacement — indépendant d'un forfait préalable (cf. plan, décision 2).
 *
 * Purement présentationnelle : ni état ni réseau — le parent (Task 14) possède la vue et les
 * actions. `onOpenMenu` ne fait qu'annoncer un tap sur « ⋮ » ; le vrai menu contextuel
 * (forfait/appeler/promouvoir) et sa confirmation vivent dans l'orchestrateur.
 */
export function MarkTableTile({
  reg, replaceHighlight, replaceTargetName, onTapPlayer, onTapReplaceTarget, onOpenMenu,
}: {
  reg: MarkTableRegistration;
  /** userId du joueur du banc sélectionné en mode remplacement, sinon null. */
  replaceHighlight: string | null;
  /** Prénom du joueur du banc sélectionné, pour le libellé « Mettre {X} ici ». */
  replaceTargetName?: string;
  onTapPlayer: (regId: string, side: MarkTableSide) => void;
  onTapReplaceTarget: (regId: string, side: MarkTableSide) => void;
  onOpenMenu: (regId: string, side: MarkTableSide) => void;
}) {
  const { th } = useTheme();
  const bothPresent = reg.captain.presence === 'PRESENT' && reg.partner.presence === 'PRESENT';
  const anyAbsent = reg.captain.presence === 'ABSENT' || reg.partner.presence === 'ABSENT';
  const border = bothPresent ? ACCENTS.emerald : anyAbsent ? ACCENTS.coral : th.line;

  const row = (player: MarkTableRegistration['captain'], side: MarkTableSide) => {
    const isTarget = replaceHighlight != null && isReplaceableSlot(player.presence);
    if (isTarget) {
      return (
        <button key={side} onClick={() => onTapReplaceTarget(reg.id, side)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            border: `1.5px dashed ${ACCENTS.blue}`, borderRadius: 8, padding: '4px 6px',
            background: th.mode === 'floodlit' ? `${ACCENTS.blue}1f` : `${ACCENTS.blue}22`,
            cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.accent,
          }}>
          Mettre {replaceTargetName ?? '…'} ici
        </button>
      );
    }
    return (
      <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => onTapPlayer(reg.id, side)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent',
            cursor: 'pointer', padding: 0, fontFamily: th.fontUI, fontSize: 13, fontWeight: 700,
            color: player.presence === 'ABSENT' ? ACCENTS.coral : th.text,
          }}>
          <span aria-hidden="true">{presenceGlyph(player.presence)}</span>
          {player.firstName} {player.lastName}
        </button>
        <button aria-label={`Options pour ${player.firstName} ${player.lastName}`} onClick={() => onOpenMenu(reg.id, side)}
          style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: th.textFaint, fontSize: 14, padding: '2px 6px' }}>
          ⋮
        </button>
      </div>
    );
  };

  return (
    <div style={{ background: th.surface, borderRadius: 12, padding: '9px 10px', boxShadow: `inset 0 0 0 1.5px ${border}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {row(reg.captain, 'CAPTAIN')}
      {row(reg.partner, 'PARTNER')}
    </div>
  );
}
