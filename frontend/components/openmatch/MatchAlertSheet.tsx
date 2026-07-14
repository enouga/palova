'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ClubDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { DateField } from '@/components/ui/DateField';
import { TimePicker } from '@/components/ui/TimePicker';
import { LevelRangeSlider } from '@/components/player/LevelRangeSlider';
import { HERO_GRADIENT, HERO_INK, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';

interface Props {
  club: Pick<ClubDetail, 'slug' | 'timezone'>;
  token: string;
  initial: { date: string; from: string; to: string };
  onClose: () => void;
  onCreated: () => void;
}

const ALERT_ERRORS: Record<string, string> = {
  ALERT_LIMIT_REACHED: 'Vous avez déjà 5 alertes actives. Supprimez-en une pour en créer une nouvelle.',
  ALERT_WINDOW_INVALID: 'Choisissez une plage horaire valide, dans le futur.',
  MEMBERSHIP_BLOCKED: 'Votre accès à ce club est suspendu.',
  CLUB_NOT_FOUND: 'Club introuvable.',
};

// Plages type d'un joueur : un tap règle « De » et « À » d'un coup.
const TIME_PRESETS: Array<{ label: string; from: string; to: string }> = [
  { label: 'Matin', from: '09:00', to: '12:00' },
  { label: 'Après-midi', from: '14:00', to: '18:00' },
  { label: 'Soir', from: '18:00', to: '21:00' },
  { label: 'Tard', from: '20:00', to: '23:00' },
];

export function MatchAlertSheet({ club, token, initial, onClose, onCreated }: Props) {
  const { th } = useTheme();
  const [date, setDate] = useState(initial.date);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Jauge de niveau optionnelle : OFF = « à mon niveau » (niveau calculé côté serveur).
  const [limitLevel, setLimitLevel] = useState(false);
  const [lvlMin, setLvlMin] = useState(3);
  const [lvlMax, setLvlMax] = useState(6);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const level = limitLevel ? { targetLevelMin: lvlMin, targetLevelMax: lvlMax } : {};
      await api.createMatchAlert(club.slug, { date, from, to, ...level }, token);
      onCreated();
    } catch (e) {
      setError(ALERT_ERRORS[(e as Error).message] ?? 'Impossible de créer l’alerte pour le moment.');
    } finally { setBusy(false); }
  };

  const caption: React.CSSProperties = {
    display: 'block', fontFamily: th.fontUI, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3,
    textTransform: 'uppercase', color: th.textMute, marginBottom: 8,
  };
  const timeLabel: React.CSSProperties = {
    fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.textMute, minWidth: 24,
  };

  return (
    <div role="dialog" aria-label="Créer une alerte" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12,10,6,.5)', backdropFilter: 'blur(2px)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: th.bg, width: '100%', maxWidth: 460, borderRadius: '0 0 22px 22px', boxShadow: th.shadow, boxSizing: 'border-box' }}>

        {/* En-tête « brume bleue » : identité + promesse de l'alerte. */}
        <div style={{ background: HERO_GRADIENT, padding: '20px 22px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 13, background: 'rgba(255,255,255,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(24,21,14,0.12)' }}>
            <Icon name="bell" size={22} color={HERO_INK} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontFamily: th.fontDisplay, fontSize: 21, fontWeight: 700, color: HERO_INK, margin: 0, letterSpacing: -0.3 }}>Créer une alerte</h2>
            <p style={{ fontFamily: th.fontUI, fontSize: 13, color: HERO_INK_MUTED, margin: '5px 0 0', lineHeight: 1.45 }}>
              On vous prévient dès qu’une partie à votre niveau s’ouvre — ou libère une place — sur ce créneau.
            </p>
          </div>
        </div>

        {/* Corps : jour (calendrier maison) + plage horaire (steppers maison) + plages rapides. */}
        <div style={{ padding: '20px 22px 22px' }}>
          <label style={caption}>Jour</label>
          <DateField value={date} onChange={setDate} width="100%" ariaLabel="Jour" />

          <label style={{ ...caption, marginTop: 20 }}>Créneau horaire</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
            {TIME_PRESETS.map((p) => {
              const active = from === p.from && to === p.to;
              return (
                <button key={p.label} type="button" onClick={() => { setFrom(p.from); setTo(p.to); }}
                  style={{
                    border: `1px solid ${active ? th.accent : th.line}`, background: active ? th.accent : 'transparent',
                    color: active ? th.onAccent : th.textMute, borderRadius: 999, padding: '6px 13px', cursor: 'pointer',
                    fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
                  }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TimePicker value={from} onChange={setFrom} minuteChips={[]}
              leading={<span style={timeLabel}>De</span>} />
            <TimePicker value={to} onChange={setTo} minuteChips={[]}
              leading={<span style={timeLabel}>À</span>} />
          </div>

          {/* Jauge de niveau optionnelle : par défaut « à mon niveau ». */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 22, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text, userSelect: 'none' }}>
            <input type="checkbox" checked={limitLevel} onChange={(e) => setLimitLevel(e.target.checked)}
              style={{ width: 17, height: 17, accentColor: th.accent, cursor: 'pointer' }} />
            Cibler une fourchette de niveau
          </label>
          {limitLevel ? (
            <div style={{ marginTop: 14 }}>
              <LevelRangeSlider min={lvlMin} max={lvlMax} onChange={(mn, mx) => { setLvlMin(mn); setLvlMax(mx); }} />
            </div>
          ) : (
            <p style={{ fontFamily: th.fontUI, fontSize: 12.5, color: th.textMute, margin: '6px 0 0', lineHeight: 1.45 }}>
              Sinon, on cible les parties à votre niveau.
            </p>
          )}

          {error && (
            <div role="alert" style={{ marginTop: 14, background: `${th.accent}1f`, color: th.text, border: `1px solid ${th.accent}`, borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, lineHeight: 1.4 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button type="button" onClick={onClose} disabled={busy}
              style={{ flex: 1, padding: '12px 14px', borderRadius: 999, border: `1px solid ${th.line}`, background: 'transparent', color: th.text, fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
              Annuler
            </button>
            <button type="button" onClick={submit} disabled={busy}
              style={{ flex: 2, padding: '12px 14px', borderRadius: 999, border: 'none', background: th.accent, color: th.onAccent, fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, boxShadow: `0 4px 14px ${th.accent}55` }}>
              {busy ? 'Création…' : 'Créer l’alerte'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
