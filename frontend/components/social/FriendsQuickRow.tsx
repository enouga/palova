'use client';
import { useEffect, useState } from 'react';
import { api, Friend } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Avatar } from '@/components/ui/Avatar';
import { LevelChip } from '@/components/player/LevelChip';
import { colorForSeed } from '@/lib/playerColors';

// Rangée « Mes amis » : avatars en colonne (niveau accroché sous l'avatar, prénom dessous),
// ajout en un tap. Barre de défilement masquée (.sp-scroll-x) + fondu sur le bord droit.
// Filtre par `query` (optionnel) et masque `excludeIds` (déjà ajoutés). Rien si liste vide.
export function FriendsQuickRow({ slug, token, excludeIds, query, onPick, fadeColor }: {
  slug: string;
  token: string;
  excludeIds: string[];
  query?: string;
  onPick: (friend: Friend) => void;
  /** Couleur du fondu de débordement = fond du conteneur hôte (hex 6 chiffres uniquement — un suffixe alpha y est ajouté). Défaut th.surface. */
  fadeColor?: string;
}) {
  const { th } = useTheme();
  const [friends, setFriends] = useState<Friend[]>([]);

  useEffect(() => {
    let alive = true;
    api.listClubFriends(slug, token).then((fs) => { if (alive) setFriends(fs); }).catch(() => {});
    return () => { alive = false; };
  }, [slug, token]);

  const q = (query ?? '').trim().toLowerCase();
  const visible = friends.filter((f) =>
    !excludeIds.includes(f.id) &&
    (!q || `${f.firstName} ${f.lastName}`.toLowerCase().includes(q)));

  if (visible.length === 0) return null;

  const fade = fadeColor ?? th.surface;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, color: th.textMute, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Mes amis</div>
      <div style={{ position: 'relative' }}>
        <div className="sp-scroll-x" style={{ display: 'flex', gap: 8, paddingBottom: 6 }}>
          {visible.map((f) => (
            <button key={f.id} type="button"
              // preventDefault sur mousedown : garde le focus de l'input pour que le dropdown ne se
              // ferme pas avant le clic (même robustesse que la liste de résultats de PartnerSearch).
              onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(f)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: 56, flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Avatar firstName={f.firstName} lastName={f.lastName} avatarUrl={f.avatarUrl} size={40} color={colorForSeed(f.id)} />
                {f.level && (
                  <span style={{ position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%)' }}>
                    <LevelChip level={f.level} size="xs" />
                  </span>
                )}
              </span>
              <span style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 700, color: th.text, maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>{f.firstName}</span>
            </button>
          ))}
        </div>
        <div aria-hidden="true" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, background: `linear-gradient(90deg, ${fade}00, ${fade})`, pointerEvents: 'none' }} />
      </div>
    </div>
  );
}
