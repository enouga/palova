'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';
import { AddPlayerPill } from '@/components/player/AddPlayerPill';
import { AddPlayerSheet, PickedMember } from '@/components/match/AddPlayerSheet';

// Champ « coéquipier » des fiches tournoi : le choix passe par la feuille de
// sélection de joueur partagée du site (AddPlayerSheet — amis + annuaire), à la
// place de l'ancien dropdown inline. Sans sélection → pill pointillée ; avec →
// ligne avatar + niveau + ✕ pour retirer (re-choisir = re-taper la pill).
export function PartnerField({ slug, token, selected, onSelect, onClear, disabled, excludeIds = [], triggerLabel = 'Choisir un coéquipier', sheetTitle }: {
  slug: string;
  token: string;
  selected: PickedMember | null;
  onSelect: (m: PickedMember) => void;
  onClear: () => void;
  disabled?: boolean;
  /** Ids à masquer de la feuille (soi-même, binôme actuel…). */
  excludeIds?: string[];
  triggerLabel?: string;
  /** Titre de la feuille (défaut = triggerLabel). */
  sheetTitle?: string;
}) {
  const { th } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: th.surface2, borderRadius: 12, padding: '9px 12px' }}>
          <Avatar firstName={selected.firstName} lastName={selected.lastName} avatarUrl={selected.avatarUrl ?? null} size={32} color={colorForSeed(selected.id)} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text }}>
            {selected.firstName} {selected.lastName}
          </span>
          <LevelChip level={selected.level} size="xs" />
          <button type="button" onClick={onClear} disabled={disabled} aria-label="Retirer le coéquipier choisi"
            style={{ marginLeft: 'auto', flexShrink: 0, border: 'none', background: 'transparent', color: th.textMute, cursor: disabled ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, padding: 4 }}>✕</button>
        </div>
      ) : (
        <AddPlayerPill onClick={() => setOpen(true)} disabled={disabled} label={triggerLabel} />
      )}
      {open && (
        <AddPlayerSheet slug={slug} token={token} title={sheetTitle ?? triggerLabel} excludeIds={excludeIds} busy={disabled}
          onPick={(m) => { onSelect(m); setOpen(false); }} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
