'use client';
import { RefObject } from 'react';
import type { MyProfile } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { ACCENTS } from '@/lib/theme';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
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
    // Coins arrondis en haut seulement : le bas reste carré pour souder l'onglet actif.
    <div style={{ padding: '0 20px' }}>
    <div style={{ background: HERO_GRADIENT, borderRadius: '18px 18px 0 0', padding: compact ? '14px 20px 0' : '20px 20px 0' }}>
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

      {/* Onglets « dossier » : l'actif prend le fond de page → il s'y soude visuellement. */}
      <div className="sp-scroll-x" style={{ marginTop: compact ? 12 : 18 }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {tabs.map((t) => {
            const active = t.key === activeTab;
            return (
              <button
                key={t.key} type="button" onClick={() => onTab(t.key)}
                style={{
                  border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 700,
                  padding: active ? '9px 15px' : '9px 12px',
                  borderRadius: active ? '11px 11px 0 0' : 0,
                  background: active ? th.bg : 'transparent',
                  color: active ? th.text : HERO_INK_MUTED,
                }}
              >{t.label}</button>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}
