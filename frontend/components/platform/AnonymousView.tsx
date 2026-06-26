'use client';
import { useTheme } from '@/lib/ThemeProvider';
import { Screen } from '@/components/ui/Screen';
import { Logotype, ThemeToggle } from '@/components/ui/atoms';
import { ClubDirectory } from '@/components/ClubDirectory';

// Vitrine publique de palova.fr (visiteur non connecté). Joueur-d'abord, ambiance éditoriale claire.
// Les sections « Parties » et « Tournois » sont des emplacements (chantiers 3 et 2).
export default function AnonymousView() {
  const { th } = useTheme();
  return (
    <Screen>
      <div style={{ paddingBottom: 56 }}>
        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 24px 0' }}>
          <Logotype size={26} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle />
            <a href="/login" style={linkPill(th)}>Connexion</a>
          </div>
        </div>

        {/* Hero */}
        <div style={{ padding: '28px 24px 8px' }}>
          <h1 style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 40, lineHeight: 1.03, letterSpacing: -1, color: th.text, margin: 0 }}>
            Trouvez un terrain,<br />une partie, un tournoi.
          </h1>
          <p style={{ fontFamily: th.fontUI, fontSize: 16, color: th.textMute, marginTop: 14, lineHeight: 1.5, maxWidth: 520 }}>
            Le padel près de chez vous — réservez, rejoignez une partie ouverte, inscrivez-vous aux tournois.
          </p>
          <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textFaint, marginTop: 10, fontWeight: 600 }}>
            Des clubs partout en France
          </div>
        </div>

        {/* Recherche + annuaire (réutilise ClubDirectory : recherche + « Autour de moi ») */}
        <SectionTitle th={th}>Clubs près de chez vous</SectionTitle>
        <ClubDirectory />

        {/* Emplacements chantiers 3 & 2 */}
        <SectionTitle th={th}>Parties ouvertes près de moi</SectionTitle>
        <SoonCard th={th} label="Les parties ouvertes près de chez vous arrivent bientôt." />
        <SectionTitle th={th}>📅 Le calendrier des tournois</SectionTitle>
        <SoonCard th={th} label="Le calendrier des tournois de tous les clubs arrive bientôt." />

        {/* Bandeau B2B */}
        <div style={{ margin: '34px 20px 0', borderRadius: 22, background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee', padding: '26px 22px', textAlign: 'center' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 26, letterSpacing: -0.4 }}>Vous gérez un club ?</div>
          <p style={{ fontFamily: th.fontUI, fontSize: 14.5, opacity: 0.82, marginTop: 8, lineHeight: 1.5 }}>
            Réservations, caisse, tournois, membres — tout au même endroit.
          </p>
          <a href="/offres" style={{ display: 'inline-block', marginTop: 16, background: th.mode === 'floodlit' ? th.text : '#f7f5ee', color: th.ink, borderRadius: 30, padding: '11px 22px', fontFamily: th.fontUI, fontWeight: 800, fontSize: 14.5, textDecoration: 'none' }}>
            Découvrir Palova pour les clubs →
          </a>
        </div>

        {/* Fonctionnalités club */}
        <SectionTitle th={th}>Ce que Palova fait pour votre club</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, padding: '4px 20px 0' }}>
          {[
            { t: 'Réservation & planning', e: '📆' },
            { t: 'Caisse & carnets', e: '💳' },
            { t: 'Tournois & events', e: '🏆' },
          ].map((f) => (
            <div key={f.t} style={{ background: th.surface, borderRadius: 16, padding: '16px 14px', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
              <div style={{ fontSize: 22 }}>{f.e}</div>
              <div style={{ fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5, color: th.text, marginTop: 8 }}>{f.t}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '16px 20px 0', fontFamily: th.fontUI, fontWeight: 700, fontSize: 14.5 }}>
          <a href="/tarifs" style={{ color: th.text }}>Voir les tarifs →</a>
          <a href="/clubs/new" style={{ color: th.text }}>Créer mon club →</a>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', padding: '40px 20px 0', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600, color: th.textMute }}>
          {[['FAQ', '/faq'], ['Tarifs', '/tarifs'], ['CGV', '/cgv'], ['Mentions légales', '/mentions-legales'], ['Confidentialité', '/confidentialite']].map(([t, h]) => (
            <a key={h} href={h} style={{ color: th.textMute, textDecoration: 'none' }}>{t}</a>
          ))}
        </div>
      </div>
    </Screen>
  );
}

function SectionTitle({ children, th }: { children: React.ReactNode; th: ReturnType<typeof useTheme>['th'] }) {
  return (
    <div style={{ fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: th.textMute, padding: '30px 20px 0' }}>
      {children}
    </div>
  );
}

function SoonCard({ label, th }: { label: string; th: ReturnType<typeof useTheme>['th'] }) {
  return (
    <div style={{ margin: '12px 20px 0', borderRadius: 16, padding: '18px 16px', background: th.surface2, color: th.textMute, fontFamily: th.fontUI, fontSize: 14, textAlign: 'center', boxShadow: `inset 0 0 0 1px ${th.line}` }}>
      {label} <span style={{ fontWeight: 700, color: th.textFaint }}>· Bientôt</span>
    </div>
  );
}

function linkPill(th: ReturnType<typeof useTheme>['th']): React.CSSProperties {
  return { background: th.ink, color: th.mode === 'floodlit' ? th.text : '#f7f5ee', borderRadius: 30, padding: '8px 16px', fontFamily: th.fontUI, fontWeight: 700, fontSize: 13, textDecoration: 'none' };
}
