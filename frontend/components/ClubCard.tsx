'use client';
import { ClubSummary } from '@/lib/api';
import { clubUrl } from '@/lib/clubUrl';
import { useTheme } from '@/lib/ThemeProvider';
import { Chip, CardStripe } from '@/components/ui/atoms';
import { Icon } from '@/components/ui/Icon';
import { ClubCover } from '@/components/ClubCover';
import { cardStyle } from '@/components/clubhouse/SectionHeader';

// Carte de club (annuaire public + « mes clubs » de l'accueil). Lien vers le sous-domaine du club.
// `defaultCover` permet à l'annuaire d'imposer la photo de couverture par défaut (rotation
// de la banque pour éviter les répétitions entre cartes voisines).
// Hauteur : la carte s'étire sur toute la hauteur de sa rangée (`height:100%` en cascade) et
// son corps est une colonne flex dont le pied « N terrains » est poussé en bas (`marginTop:auto`).
// Toutes les cartes d'une même rangée finissent donc à la même hauteur, pied aligné, SANS rien
// tronquer (un nom sur 2 lignes ou 2 rangées de chips restent entiers, la carte la plus haute
// donne simplement la hauteur commune). Dans un parent sans hauteur définie, `height:100%`
// retombe sur `auto` — les usages hors rail ne changent pas.
export function ClubCard({ club, defaultCover }: { club: ClubSummary; defaultCover?: string }) {
  const { th } = useTheme();
  return (
    <a href={clubUrl(club.slug)} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
      <div style={{ ...cardStyle(th), borderRadius: 22, position: 'relative', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <CardStripe color={club.accentColor} />
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <ClubCover defaultPhoto={defaultCover} club={{
            name: club.name, slug: club.slug, accentColor: club.accentColor,
            coverImageUrl: club.coverImageUrl,
          }} />
        </div>
        <div style={{ padding: '15px 16px 17px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 24, color: th.text, lineHeight: 1.05, letterSpacing: -0.3 }}>{club.name}</div>
          {club.city && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: th.fontUI, fontSize: 13, color: th.textMute, marginTop: 5 }}>
              <Icon name="pin" size={13} color={th.textMute} />{club.city}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
            {club.sports.map((s) => <Chip key={s.key} tone="line">{s.icon ? `${s.icon} ` : ''}{s.name}</Chip>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${th.line}`, fontFamily: th.fontUI, fontSize: 13, color: th.textMute }}>
            {club.resourceCount} terrain{club.resourceCount > 1 ? 's' : ''}
            <Icon name="chevR" size={16} color={th.textFaint} style={{ marginLeft: 'auto' }} />
          </div>
        </div>
      </div>
    </a>
  );
}
