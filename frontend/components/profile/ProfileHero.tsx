'use client';
import { RefObject } from 'react';
import type { MyProfile } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { Icon, IconName } from '@/components/ui/Icon';
import { memberSinceYear, ProfileTabKey } from '@/lib/meProfile';

interface Props {
  profile: MyProfile;
  avatarSrc: string | null;
  initials: string;
  uploading: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onPickAvatar: (file: File | undefined) => void;
  /** Nom du club sur un hôte club, « Palova » sur l'hôte plateforme. */
  kicker: string;
  /** Niveau padel pour le badge ; null = pas de badge. */
  level: number | null;
  isSubscriber: boolean;
  /** ISO de la date d'adhésion ; null = pas de chip. */
  memberSince: string | null;
  tabs: { key: ProfileTabKey; label: string }[];
  activeTab: ProfileTabKey;
  onTab: (k: ProfileTabKey) => void;
  /** Onglets ≠ Identité : identité réduite à une ligne (l'identité s'édite dans Identité). */
  compact: boolean;
}

// Icône par onglet (catalogue existant d'Icon.tsx, aucune icône nouvelle) et libellé court
// réservé au mobile (colonne étroite) — seuls les deux onglets au nom long en ont un.
const TAB_ICON: Record<ProfileTabKey, IconName> = {
  identite: 'user', niveau: 'chart', preferences: 'settings', portefeuille: 'wallet', securite: 'lock',
};
const TAB_SHORT: Partial<Record<ProfileTabKey, string>> = {
  preferences: 'Préfs', portefeuille: 'Solde',
};

// Hero « carte de joueur ». Le dégradé est CLAIR dans les deux thèmes → l'encre est
// FIXE (HERO_INK), jamais th.text (qui virerait au clair en sombre et deviendrait illisible).
export function ProfileHero({
  profile, avatarSrc, initials, uploading, fileRef, onPickAvatar,
  kicker, level, isSubscriber, memberSince, tabs, activeTab, onTab, compact,
}: Props) {
  const { th } = useTheme();
  const size = compact ? 40 : 80;
  const sinceYear = memberSinceYear(memberSince);
  const fullName = `${profile.firstName} ${profile.lastName}`;

  const chip = (bg: string, color: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '6px 11px',
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, background: bg, color,
  } as const);

  return (
    // Inset 20px de chaque côté (comme AgendaHero et les cartes en dessous — sinon le
    // panneau, plein-bleed, déborde visuellement des cartes plus étroites qui suivent).
    <div style={{ padding: '0 20px' }}>
    <div style={{ background: HERO_GRADIENT, borderRadius: 18, padding: compact ? '14px 20px' : '20px' }}>
      <div style={{
        fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, letterSpacing: 1.2,
        textTransform: 'uppercase', color: HERO_INK_MUTED,
      }}>{kicker}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 10 : 15, marginTop: compact ? 8 : 12 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {avatarSrc ? (
            <img src={avatarSrc} alt="Photo de profil" style={{
              width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block',
              boxShadow: `0 0 0 ${compact ? 2 : 3}px #fff, 0 10px 24px rgba(24,21,14,0.25)`,
              opacity: uploading ? 0.5 : 1,
            }} />
          ) : (
            <span aria-hidden style={{
              width: size, height: size, borderRadius: '50%', background: th.accent, color: th.onAccent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: th.fontUI, fontWeight: 700, fontSize: compact ? 15 : 27,
              boxShadow: `0 0 0 ${compact ? 2 : 3}px #fff, 0 10px 24px rgba(24,21,14,0.25)`,
              opacity: uploading ? 0.5 : 1,
            }}>{initials}</span>
          )}

          {level != null && (
            <span aria-label={`Niveau ${level}`} style={{
              position: 'absolute', right: -4, bottom: -2, background: '#181510', color: ACCENTS.lime,
              fontFamily: th.fontUI, fontSize: compact ? 8.5 : 10, fontWeight: 800, borderRadius: 999,
              padding: compact ? '2px 5px' : '3px 7px', boxShadow: '0 0 0 2px #e3edf9',
            }}>{level}</span>
          )}

          {!compact && (
            <>
              <input
                ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                aria-label="Choisir une photo de profil"
                onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.target.value = ''; }}
              />
              <button
                type="button" aria-label="Changer la photo" disabled={uploading}
                onClick={() => fileRef.current?.click()}
                style={{
                  position: 'absolute', left: -4, bottom: -2, width: 26, height: 26, borderRadius: '50%',
                  border: 'none', background: '#fff', cursor: uploading ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                  boxShadow: '0 2px 6px rgba(24,21,14,0.25)', opacity: uploading ? 0.6 : 1, padding: 0,
                }}
              >📷</button>
            </>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: th.fontDisplay, fontWeight: 600, fontSize: compact ? 16 : 26,
            letterSpacing: -0.5, lineHeight: 1.05, color: HERO_INK,
          }}>{fullName}</div>

          {!compact && (
            <>
              <div style={{ fontFamily: th.fontUI, fontSize: 14, color: HERO_INK_MUTED, marginTop: 3 }}>
                {profile.email}
              </div>
              {(isSubscriber || sinceYear != null) && (
                <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                  {isSubscriber && <span style={chip('rgba(255,255,255,0.78)', HERO_INK)}>⚡ Abonné</span>}
                  {sinceYear != null && (
                    <span style={chip('rgba(24,21,14,0.08)', HERO_INK_MUTED)}>Membre depuis {sinceYear}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Onglets « tuiles » : icône + libellé, pills horizontales en desktop → colonnes en
          mobile (≤600px, même bascule que ClubNav — .ph-lbl-full/.ph-lbl-short reprennent sa
          technique de libellé court). Le hero est refermé (coins arrondis partout) : plus
          d'onglet « soudé » au fond de page. */}
      <style>{`
        .ph-lbl-short { display: none; }
        .ph-tab:not(.is-active) { background: rgba(255,255,255,0.45); }
        @media (max-width: 600px) {
          .ph-tabs { gap: 4px !important; }
          .ph-tab { flex: 1 !important; flex-direction: column !important; gap: 3px !important; padding: 7px 2px !important; border-radius: 13px !important; }
          .ph-tab svg { width: 20px !important; height: 20px !important; }
          .ph-tab .ph-tab-label { font-size: 10px !important; letter-spacing: 0 !important; line-height: 1.1; }
          .ph-tab:not(.is-active) { background: transparent !important; }
          .ph-tab:has(.ph-lbl-short) .ph-lbl-full { display: none; }
          .ph-tab .ph-lbl-short { display: inline; }
        }
      `}</style>
      <div className="ph-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: compact ? 12 : 18 }}>
        {tabs.map((t) => {
          const active = t.key === activeTab;
          const short = TAB_SHORT[t.key];
          return (
            <button
              key={t.key} type="button" onClick={() => onTab(t.key)}
              aria-label={t.label} className={`ph-tab${active ? ' is-active' : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 999,
                padding: '9px 16px', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: active ? 700 : 600,
                background: active ? th.accent : undefined,
                color: active ? th.onAccent : HERO_INK,
                boxShadow: active ? `0 4px 12px ${th.accent}66` : 'none',
              }}
            >
              <Icon name={TAB_ICON[t.key]} size={16} color={active ? th.onAccent : HERO_INK} />
              <span className="ph-tab-label ph-lbl-full">{t.label}</span>
              {short && <span className="ph-tab-label ph-lbl-short">{short}</span>}
            </button>
          );
        })}
      </div>
    </div>
    </div>
  );
}
