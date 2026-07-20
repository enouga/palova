'use client';
import { useEffect, useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { AdminResource, CreatePromotionBody, Promotion } from '@/lib/api';
import { DateField } from '@/components/ui/DateField';
import { TimePicker } from '@/components/ui/TimePicker';

export interface PromotionFormProps {
  open: boolean;
  editing?: Promotion;
  courts: AdminResource[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: CreatePromotionBody) => void;
}

type Kind = 'PERCENT' | 'FIXED';

/** "18:00" → 1080 minutes depuis minuit. */
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
/** 1080 → "18:00". */
function fromMin(min: number): string {
  const hh = Math.floor(min / 60), mm = min % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function PromotionForm(props: PromotionFormProps) {
  const { th } = useTheme();
  const { open, editing, courts, busy, error, onClose, onSubmit } = props;

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [allCourts, setAllCourts] = useState(true);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [hasWindow, setHasWindow] = useState(false);
  const [windowStart, setWindowStart] = useState('18:00');
  const [windowEnd, setWindowEnd] = useState('20:00');
  const [kind, setKind] = useState<Kind>('PERCENT');
  const [percentOff, setPercentOff] = useState('20');
  const [fixedPrice, setFixedPrice] = useState('15');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setStartDate(editing.startDate);
      setEndDate(editing.endDate);
      setAllCourts(editing.resourceIds.length === 0);
      setCheckedIds(editing.resourceIds);
      setHasWindow(editing.windowStart != null && editing.windowEnd != null);
      setWindowStart(editing.windowStart != null ? fromMin(editing.windowStart) : '18:00');
      setWindowEnd(editing.windowEnd != null ? fromMin(editing.windowEnd) : '20:00');
      setKind(editing.kind);
      setPercentOff(editing.percentOff != null ? String(editing.percentOff) : '20');
      setFixedPrice(editing.fixedPrice != null ? String(Number(editing.fixedPrice)) : '15');
      setEnabled(editing.enabled);
    } else {
      setName(''); setStartDate(''); setEndDate('');
      setAllCourts(true); setCheckedIds([]);
      setHasWindow(false); setWindowStart('18:00'); setWindowEnd('20:00');
      setKind('PERCENT'); setPercentOff('20'); setFixedPrice('15');
      setEnabled(true);
    }
  }, [open, editing]);

  if (!open) return null;

  const toggleCourt = (id: string) => setCheckedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const handleSubmit = () => {
    const body: CreatePromotionBody = {
      name: name.trim(),
      startDate,
      endDate,
      kind,
      percentOff: kind === 'PERCENT' ? Number(percentOff) : undefined,
      fixedPrice: kind === 'FIXED' ? Number(fixedPrice) : undefined,
      windowStart: hasWindow ? toMin(windowStart) : null,
      windowEnd: hasWindow ? toMin(windowEnd) : null,
      enabled,
      resourceIds: allCourts ? [] : checkedIds,
    };
    onSubmit(body);
  };

  const label: CSSProperties = { fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 };
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 };
  const seg = (active: boolean): CSSProperties => ({
    border: 'none', background: active ? th.accent : 'transparent', color: active ? th.onAccent : th.text,
    borderRadius: 999, padding: '6px 14px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
  });
  const chip = (active: boolean): CSSProperties => ({
    border: `1.5px solid ${active ? th.accent : th.line}`, background: active ? th.surface2 : 'transparent',
    color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
  });
  const switchBtn = (checked: boolean, onClick: () => void, ariaLabel: string) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} onClick={onClick}
      style={{ width: 36, height: 21, borderRadius: 999, border: 'none', cursor: 'pointer', background: checked ? th.accent : th.lineStrong, position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2.5, left: checked ? 17 : 2.5, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  );

  const submitLabel = editing ? 'Enregistrer' : 'Créer la promotion';

  // Fix 1 — « Tous les terrains » OFF sans terrain coché : sinon resourceIds:[] créerait
  // silencieusement une promo « tous terrains » (interprétation backend/targetLabel).
  const courtsMissing = !allCourts && checkedIds.length === 0;

  // Fix 3 — garde client sur la validité (le backend valide déjà en défense ; ceci évite
  // à l'admin de voir un « VALIDATION_ERROR » brut). On expose le premier problème rencontré.
  const percentNum = Number(percentOff);
  const fixedNum = Number(fixedPrice);
  let invalidHint: string | null = null;
  if (startDate && endDate && startDate > endDate) invalidHint = 'La date de fin doit être après le début.';
  else if (kind === 'PERCENT' && !(Number.isInteger(percentNum) && percentNum >= 1 && percentNum <= 100)) invalidHint = 'Le pourcentage doit être un entier entre 1 et 100.';
  else if (kind === 'FIXED' && !(fixedPrice.trim() !== '' && fixedNum >= 0)) invalidHint = 'Le prix fixe doit être positif.';
  else if (hasWindow && toMin(windowStart) >= toMin(windowEnd)) invalidHint = 'La fin de plage doit être après le début.';

  const submitDisabled = busy || !name.trim() || !startDate || !endDate || courtsMissing || invalidHint !== null;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ width: '100%', maxWidth: 560, background: th.surface, borderRadius: 20, boxShadow: th.shadow, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 0' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, color: th.text }}>
            {editing ? 'Modifier la promotion' : 'Nouvelle promotion'}
          </div>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, color: th.textMute, fontSize: 16 }}>✕</button>
        </div>

        {error && (
          <div style={{ margin: '12px 20px 0', background: '#ff7a4d', color: '#fff', borderRadius: 12, padding: '10px 13px', fontFamily: th.fontUI, fontSize: 13, fontWeight: 600 }}>{error}</div>
        )}

        <div style={{ padding: 20, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 13 }}>
          <label style={label}>Nom
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Promo d'été" style={input} />
          </label>

          <div>
            <div style={{ ...label, marginBottom: 6 }}>Période</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <DateField value={startDate} onChange={setStartDate} size="sm" ariaLabel="Date de début" />
              <span style={{ color: th.textFaint }}>→</span>
              <DateField value={endDate} onChange={setEndDate} size="sm" ariaLabel="Date de fin" />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {switchBtn(allCourts, () => setAllCourts((v) => !v), 'Tous les terrains')}
              <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>Tous les terrains</span>
            </div>
            {!allCourts && (
              <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {courts.map((c) => (
                    <button key={c.id} type="button" onClick={() => toggleCourt(c.id)} style={chip(checkedIds.includes(c.id))}>
                      {c.name}
                    </button>
                  ))}
                </div>
                {courtsMissing && (
                  <div style={{ marginTop: 6, fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.accentWarm }}>
                    Cochez au moins un terrain.
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {switchBtn(hasWindow, () => setHasWindow((v) => !v), 'Limiter à une plage horaire')}
              <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>Limiter à une plage horaire</span>
            </div>
            {hasWindow && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <TimePicker value={windowStart} onChange={setWindowStart} minuteChips={[0, 30]} leading={<span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>De</span>} />
                <TimePicker value={windowEnd} onChange={setWindowEnd} minuteChips={[0, 30]} leading={<span style={{ fontFamily: th.fontUI, fontSize: 12, color: th.textMute }}>À</span>} />
              </div>
            )}
          </div>

          <div>
            <div style={{ ...label, marginBottom: 6 }}>Remise</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden' }}>
                <button type="button" onClick={() => setKind('PERCENT')} style={seg(kind === 'PERCENT')}>%</button>
                <button type="button" onClick={() => setKind('FIXED')} style={seg(kind === 'FIXED')}>Prix fixe</button>
              </div>
              {kind === 'PERCENT' ? (
                <label style={{ ...label, width: 110 }}>Remise %
                  <input type="number" min={1} max={100} step="1" value={percentOff} onChange={(e) => setPercentOff(e.target.value)} style={input} />
                </label>
              ) : (
                <label style={{ ...label, width: 110 }}>Prix fixe €
                  <input type="number" min={0} step="0.5" value={fixedPrice} onChange={(e) => setFixedPrice(e.target.value)} style={input} />
                </label>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {switchBtn(enabled, () => setEnabled((v) => !v), 'Activer la promotion')}
            <span style={{ fontFamily: th.fontUI, fontSize: 13, fontWeight: 700, color: th.text }}>Activer</span>
          </div>

          {invalidHint && (
            <div role="alert" style={{ fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, color: th.accentWarm }}>
              {invalidHint}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <button type="button" disabled={submitDisabled} onClick={handleSubmit}
              style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 20px', cursor: submitDisabled ? 'default' : 'pointer', opacity: submitDisabled ? 0.6 : 1, fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800 }}>
              {busy ? '…' : submitLabel}
            </button>
            <button type="button" disabled={busy} onClick={onClose} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>Annuler</button>
          </div>
        </div>
      </div>
    </div>
  );
}
