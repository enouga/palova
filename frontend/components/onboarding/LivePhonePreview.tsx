'use client';
import { ReactNode } from 'react';
import { assetUrl } from '@/lib/api';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { inkOn } from '@/lib/theme';
import { PreviewState } from '@/lib/onboarding';

function PreviewCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 9, padding: '8px 9px', boxShadow: '0 1px 5px rgba(20,40,80,.08)' }}>
      <div style={{ fontSize: 8.5, color: '#98a3b5', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  );
}

const hint = (text: string) => (
  <div style={{ fontSize: 9.5, color: '#b6bfcd', marginTop: 3, fontStyle: 'italic' }}>{text}</div>
);

/** Pluriel naïf suffisant pour les nouns du catalogue (piste→pistes, court→courts, terrain→terrains). */
const plural = (noun: string, n: number) => (n > 1 ? `${noun}s` : noun);

/**
 * Le « téléphone vivant » du wizard : un mini club-house qui se construit au fil des étapes.
 * Purement présentationnel — tout vient de PreviewState.
 */
export function LivePhonePreview({ preview }: { preview: PreviewState }) {
  const accent = preview.accentColor;
  const withCourts = preview.sports.filter((s) => s.courtCount > 0);
  return (
    // Attend un fond sombre (halo accent + ombre portée) ; le halo déborde de 30px — ne pas monter sous un parent overflow:hidden.
    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
      <div aria-hidden style={{ position: 'absolute', inset: -30, background: `radial-gradient(circle at 50% 45%, ${accent}26, transparent 65%)` }} />
      <div style={{ width: 230, background: '#f4f7fc', borderRadius: 28, border: '6px solid #232936', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,.55)', position: 'relative' }}>
        <div style={{ background: HERO_GRADIENT, padding: '18px 14px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {preview.logoUrl ? (
              <img src={assetUrl(preview.logoUrl) ?? ''} alt=""
                style={{ width: 34, height: 34, borderRadius: 10, objectFit: 'contain', background: '#fff', flexShrink: 0 }} />
            ) : (
              <span style={{ width: 34, height: 34, borderRadius: 10, background: accent, color: inkOn(accent), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
                {(preview.name[0] ?? '?').toUpperCase()}
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: HERO_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview.name}</div>
              <div style={{ fontSize: 9.5, color: HERO_INK_MUTED }}>{preview.slug}.palova.fr</div>
            </div>
          </div>
          <div style={{ marginTop: 11, background: 'rgba(255,255,255,.55)', borderRadius: 9, padding: '7px 9px', fontSize: 10, color: HERO_INK, fontWeight: 700 }}>
            Réserver un terrain →
          </div>
        </div>

        <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PreviewCard title="Vos sports">
            {preview.sports.length === 0 ? hint('apparaîtront à l’étape 2…') : (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                {preview.sports.map((s) => (
                  <span key={s.key} style={{ background: accent, color: inkOn(accent), borderRadius: 12, padding: '3px 9px', fontSize: 9.5, fontWeight: 700 }}>
                    {s.icon ? `${s.icon} ` : ''}{s.name}
                  </span>
                ))}
              </div>
            )}
          </PreviewCard>
          <PreviewCard title="Vos terrains">
            {withCourts.length === 0 ? hint('étape 3…') : (
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {withCourts.map((s) => (
                  <div key={s.key} style={{ fontSize: 9.5, color: '#333' }}>
                    {s.icon ? `${s.icon} ` : ''}{s.name} · {s.courtCount} {plural(s.noun, s.courtCount)}{s.minPrice != null ? ` · dès ${s.minPrice} €` : ''}
                  </div>
                ))}
              </div>
            )}
          </PreviewCard>
        </div>
        <div style={{ padding: '0 0 9px', textAlign: 'center', fontSize: 9, color: '#98a3b5' }}>Aperçu en direct ✨</div>
      </div>
    </div>
  );
}
