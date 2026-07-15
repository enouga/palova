'use client';
import { RefObject } from 'react';
import { assetUrl } from '@/lib/api';
import { ACCENTS } from '@/lib/theme';
import { Btn, Segmented } from '@/components/ui/atoms';
import { ClubCover } from '@/components/ClubCover';
import { SettingsTabProps, useSettingsStyles } from './shared';

interface Props extends SettingsTabProps {
  uploading: boolean;
  logoInputRef: RefObject<HTMLInputElement | null>;
  coverInputRef: RefObject<HTMLInputElement | null>;
  pickLogo: (f: File | undefined) => void;
  pickCover: (f: File | undefined) => void;
}

export function SettingsIdentity({ club, set, uploading, logoInputRef, coverInputRef, pickLogo, pickCover }: Props) {
  const { th, card, label, field, h2 } = useSettingsStyles();
  return (
    <>
      <div style={card}>
        <h2 style={{ ...h2, marginBottom: 16 }}>Profil</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><span style={label}>Nom du club</span><input value={club.name} onChange={(e) => set('name', e.target.value)} style={field} /></div>
          <div><span style={label}>Description</span><textarea value={club.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={2} style={{ ...field, height: 'auto', padding: '10px 14px', resize: 'vertical' }} /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}><span style={label}>Adresse</span><input value={club.address} onChange={(e) => set('address', e.target.value)} style={field} /></div>
            <div style={{ flex: 1 }}><span style={label}>Ville</span><input value={club.city ?? ''} onChange={(e) => set('city', e.target.value)} style={field} /></div>
          </div>
          <div><span style={label}>Fuseau horaire</span><input value={club.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Europe/Paris" style={field} /></div>
        </div>
      </div>

      <div style={card}>
        <h2 style={{ ...h2, marginBottom: 16 }}>Identité visuelle</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <span style={label}>Logo du club</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {club.logoUrl ? (
                <img src={assetUrl(club.logoUrl) ?? ''} alt="Logo du club"
                  style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'contain', background: th.bg, border: `1px solid ${th.line}`, flexShrink: 0, opacity: uploading ? 0.5 : 1 }} />
              ) : (
                <span style={{ width: 72, height: 72, borderRadius: 14, flexShrink: 0, background: th.accent, color: th.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: th.fontDisplay, fontWeight: 700, fontSize: 26 }}>
                  {(club.name?.[0] ?? '?').toUpperCase()}
                </span>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input ref={logoInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                  aria-label="Choisir un logo de club"
                  onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
                <Btn type="button" variant="surface" disabled={uploading} onClick={() => logoInputRef.current?.click()}>
                  {uploading ? 'Envoi…' : 'Changer le logo'}
                </Btn>
                <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint }}>JPEG, PNG ou WebP · 2 Mo max</span>
              </div>
            </div>
          </div>
          <div>
            <span style={label}>Image de couverture</span>
            <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '0 0 10px' }}>
              Illustre votre club dans l&apos;annuaire des clubs. Sans photo importée, une belle photo de court est utilisée automatiquement par défaut.
            </p>
            <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${th.line}`, marginBottom: 10, opacity: uploading ? 0.5 : 1 }}>
              <ClubCover club={{ name: club.name, slug: club.slug, accentColor: club.accentColor, coverImageUrl: club.coverImageUrl }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                aria-label="Choisir une image de couverture"
                onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = ''; }} />
              <Btn type="button" variant="surface" disabled={uploading} onClick={() => coverInputRef.current?.click()}>
                {uploading ? 'Envoi…' : 'Importer une photo'}
              </Btn>
              {club.coverImageUrl && (
                <Btn type="button" variant="ghost" disabled={uploading} onClick={() => set('coverImageUrl', null)}>
                  Utiliser l&apos;illustration automatique
                </Btn>
              )}
            </div>
            <span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textFaint, display: 'block', marginTop: 6 }}>JPEG, PNG ou WebP · 2 Mo max</span>
          </div>
          <div>
            <span style={label}>Couleur d&apos;accent</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {Object.values(ACCENTS).map((hex) => (
                <button key={hex} type="button" onClick={() => set('accentColor', hex)} aria-label={`Accent ${hex}`}
                  style={{ width: 34, height: 34, borderRadius: 10, background: hex, cursor: 'pointer', border: club.accentColor.toLowerCase() === hex.toLowerCase() ? `2px solid ${th.text}` : `2px solid transparent`, boxShadow: `inset 0 0 0 1px ${th.line}` }} />
              ))}
              <input value={club.accentColor} onChange={(e) => set('accentColor', e.target.value)} style={{ ...field, width: 120, height: 34 }} />
            </div>
          </div>
          <div>
            <span style={label}>Thème par défaut</span>
            <Segmented
              options={[{ value: 'daylight', label: 'Clair' }, { value: 'floodlit', label: 'Sombre' }]}
              value={club.defaultThemeMode}
              onChange={(v) => set('defaultThemeMode', v)}
            />
          </div>
        </div>
      </div>
    </>
  );
}
