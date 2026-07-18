'use client';
import { useEffect, useRef, useState, CSSProperties } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { dangerBanner } from '@/lib/theme';
import { assetUrl, CreatePackageTemplateBody, CreateSubscriptionPlanBody, PackageKind, PackageTemplate, SubscriptionBenefit, SubscriptionPlan } from '@/lib/api';
import { offerTint, sportOfferTint } from '@/lib/adminOffers';
import { HERO_GRADIENT, HERO_INK_MUTED } from '@/components/agenda/AgendaHero';
import { OfferPreviewCard, OfferPreview } from '@/components/admin/offers/OfferPreviewCard';

type StudioKind = 'PLAN' | 'ENTRIES' | 'WALLET';

/** Brouillon émis au submit ; la page fait create OU update selon `editing`. */
export type OfferStudioResult =
  | { kind: 'plan'; body: CreateSubscriptionPlanBody; imageFile: File | null; removeImage: boolean }
  | { kind: 'package'; body: CreatePackageTemplateBody; imageFile: File | null; removeImage: boolean };

export interface OfferStudioProps {
  open: boolean;
  editing?: { kind: 'plan'; plan: SubscriptionPlan } | { kind: 'package'; tpl: PackageTemplate };
  sportOptions: string[];
  multiSport: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (result: OfferStudioResult) => void;
}

const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export function OfferStudio(props: OfferStudioProps) {
  const { th } = useTheme();
  const { open, editing, sportOptions, multiSport, busy, error, onClose, onSubmit } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);

  const initialKind: StudioKind = editing ? (editing.kind === 'plan' ? 'PLAN' : editing.tpl.kind) : 'PLAN';
  const [kind, setKind] = useState<StudioKind>(initialKind);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sports, setSports] = useState<string[]>(['padel']);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [price, setPrice] = useState('');
  const [months, setMonths] = useState('12');
  const [offPeak, setOffPeak] = useState(false);
  const [benefit, setBenefit] = useState<SubscriptionBenefit>('INCLUDED');
  const [discount, setDiscount] = useState('50');
  const [dailyCap, setDailyCap] = useState('');
  const [weeklyCap, setWeeklyCap] = useState('');
  const [entries, setEntries] = useState('10');
  const [walletAmount, setWalletAmount] = useState('');
  const [validity, setValidity] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing?.kind === 'plan') {
      const p = editing.plan;
      setKind('PLAN'); setName(p.name); setDescription(p.description ?? ''); setSports(p.sportKeys);
      setPrice(String(Number(p.monthlyPrice))); setMonths(String(p.commitmentMonths));
      setOffPeak(p.offPeakOnly); setBenefit(p.benefit); setDiscount(String(p.discountPercent ?? 50));
      setDailyCap(p.dailyCap != null ? String(p.dailyCap) : ''); setWeeklyCap(p.weeklyCap != null ? String(p.weeklyCap) : '');
    } else if (editing?.kind === 'package') {
      const t = editing.tpl;
      setKind(t.kind); setName(t.name); setDescription(t.description ?? ''); setSports(t.sportKeys);
      setPrice(String(Number(t.price))); setEntries(String(t.entriesCount ?? 10));
      setWalletAmount(t.walletAmount != null ? String(Number(t.walletAmount)) : '');
      setValidity(t.validityDays != null ? String(t.validityDays) : '');
    } else {
      setKind('PLAN'); setName(''); setDescription(''); setSports(['padel']);
      setPrice(''); setMonths('12'); setOffPeak(false); setBenefit('INCLUDED'); setDiscount('50');
      setDailyCap(''); setWeeklyCap(''); setEntries('10'); setWalletAmount(''); setValidity('');
    }
    setPendingFile(null); setRemoveImage(false); setShowAdvanced(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [open, editing]);

  useEffect(() => {
    if (!pendingFile || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setPreviewFileUrl(null); return; }
    const url = URL.createObjectURL(pendingFile);
    setPreviewFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  if (!open) return null;

  const existingImageUrl = editing?.kind === 'plan' ? editing.plan.imageUrl : editing?.kind === 'package' ? editing.tpl.imageUrl : null;
  const shownImageUrl = previewFileUrl ?? (!removeImage && existingImageUrl ? assetUrl(existingImageUrl) : null);
  const toggleSport = (k: string) => setSports((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const typeTint = offerTint(kind === 'PLAN' ? 'SUBSCRIPTION' : kind);
  const sportTint = multiSport ? sportOfferTint(sports) : typeTint;
  const priceNum = Number(price) || 0;
  const kindLabel = kind === 'PLAN' ? 'Abonnement' : kind === 'ENTRIES' ? 'Carnet' : 'Porte-monnaie';
  const sportsLine = sports.length > 0 ? sports.join(', ') : 'Tous sports';
  const lines = kind === 'PLAN'
    ? [sportsLine, offPeak ? 'Heures creuses' : 'Toutes heures', benefit === 'INCLUDED' ? 'Inclus' : `−${Number(discount) || 0} %`, `${Number(months) || 0} mois`]
    : kind === 'ENTRIES'
      ? [sportsLine, `${Number(entries) || 0} entrées`, validity ? `Valable ${validity} j` : 'Sans expiration']
      : [sportsLine, `${euro(Number(walletAmount) || 0)} crédités`, validity ? `Valable ${validity} j` : 'Sans expiration'];
  const preview: OfferPreview = {
    kindLabel, sportTint, typeTint, name, description,
    price: euro(priceNum), priceSuffix: kind === 'PLAN' ? '/mois' : null,
    lines, ctaLabel: `Souscrire · ${euro(priceNum)}`,
    imageUrl: shownImageUrl,
  };

  const handleSubmit = () => {
    if (kind === 'PLAN') {
      const body: CreateSubscriptionPlanBody = {
        name: name.trim(), description: description.trim() || null, sportKeys: sports,
        monthlyPrice: priceNum, commitmentMonths: Number(months) || 1, offPeakOnly: offPeak,
        benefit, discountPercent: benefit === 'DISCOUNT' ? Number(discount) || null : null,
        dailyCap: dailyCap ? Number(dailyCap) : null, weeklyCap: weeklyCap ? Number(weeklyCap) : null,
      };
      onSubmit({ kind: 'plan', body, imageFile: pendingFile, removeImage });
    } else {
      const body: CreatePackageTemplateBody = {
        kind: kind as PackageKind, name: name.trim(), description: description.trim() || null, price: priceNum,
        entriesCount: kind === 'ENTRIES' ? Number(entries) : undefined,
        walletAmount: kind === 'WALLET' ? Number(walletAmount) : undefined,
        validityDays: validity ? Number(validity) : null, sportKeys: sports,
      };
      onSubmit({ kind: 'package', body, imageFile: pendingFile, removeImage });
    }
  };

  const label: CSSProperties = { fontSize: 12, color: th.textMute, display: 'flex', flexDirection: 'column', gap: 4 };
  const input: CSSProperties = { border: `1px solid ${th.line}`, background: th.bg, color: th.text, borderRadius: 8, padding: '8px 10px', fontFamily: th.fontUI, fontSize: 14 };
  const chip = (active: boolean): CSSProperties => ({
    border: `1.5px solid ${active ? th.accent : th.line}`, background: active ? th.surface2 : 'transparent',
    color: th.text, borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 600,
  });
  const seg = (active: boolean): CSSProperties => ({
    border: 'none', background: active ? th.accent : 'transparent', color: active ? th.onAccent : th.text,
    borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700,
  });
  const submitLabel = editing ? 'Enregistrer' : 'Mettre en vente';

  const KIND_CHIPS: { k: StudioKind; label: string }[] = [
    { k: 'PLAN', label: '⚡ Abonnement' }, { k: 'ENTRIES', label: '🎟 Carnet' }, { k: 'WALLET', label: '💰 Porte-monnaie' },
  ];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ width: '100%', maxWidth: 860, background: th.surface, borderRadius: 20, boxShadow: th.shadow, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 0', flexWrap: 'wrap' }}>
          <div style={{ fontFamily: th.fontDisplay, fontWeight: 600, fontSize: 20, color: th.text }}>{editing ? 'Modifier l’offre' : 'Nouvelle offre'}</div>
          <span style={{ flex: 1 }} />
          {KIND_CHIPS.filter((c) => !editing || c.k === kind).map((c) => (
            <button key={c.k} type="button" disabled={!!editing} onClick={() => setKind(c.k)} style={chip(kind === c.k)}>{c.label}</button>
          ))}
          <button onClick={onClose} aria-label="Fermer" style={{ border: 'none', background: th.surface2, cursor: 'pointer', borderRadius: 9, width: 30, height: 30, color: th.textMute, fontSize: 16 }}>✕</button>
        </div>

        {error && (
          <div style={{ ...dangerBanner(th), margin: '12px 20px 0' }}>{error}</div>
        )}

        <div className="pl-create-grid" style={{ padding: 20, overflow: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <label style={label}>Nom
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Padel illimité" style={input} />
            </label>

            <div>
              <div style={{ ...label, marginBottom: 6 }}>Sports</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {sportOptions.map((k) => (
                  <button key={k} type="button" onClick={() => toggleSport(k)} style={chip(sports.includes(k))}>{k}</button>
                ))}
              </div>
            </div>

            {kind === 'PLAN' ? (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ ...label, flex: 1, minWidth: 110 }}>Prix / mois €
                    <input type="number" min={0} step="1" value={price} onChange={(e) => setPrice(e.target.value)} style={input} />
                  </label>
                  <label style={{ ...label, flex: 1, minWidth: 110 }}>Engagement (mois)
                    <input type="number" min={1} step="1" value={months} onChange={(e) => setMonths(e.target.value)} style={input} />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ ...label, marginBottom: 6 }}>Créneaux</div>
                    <div style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden' }}>
                      <button type="button" onClick={() => setOffPeak(false)} style={seg(!offPeak)}>Toutes heures</button>
                      <button type="button" onClick={() => setOffPeak(true)} style={seg(offPeak)}>Heures creuses</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ ...label, marginBottom: 6 }}>Avantage</div>
                    <div style={{ display: 'inline-flex', border: `1px solid ${th.line}`, borderRadius: 999, overflow: 'hidden' }}>
                      <button type="button" onClick={() => setBenefit('INCLUDED')} style={seg(benefit === 'INCLUDED')}>Inclus</button>
                      <button type="button" onClick={() => setBenefit('DISCOUNT')} style={seg(benefit === 'DISCOUNT')}>Remise %</button>
                    </div>
                  </div>
                  {benefit === 'DISCOUNT' && (
                    <label style={label}>Remise %
                      <input type="number" min={1} max={100} step="1" value={discount} onChange={(e) => setDiscount(e.target.value)} style={{ ...input, width: 90 }} />
                    </label>
                  )}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ ...label, flex: 1, minWidth: 110 }}>Prix de vente €
                  <input type="number" min={0} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} style={input} />
                </label>
                {kind === 'ENTRIES' ? (
                  <label style={{ ...label, flex: 1, minWidth: 110 }}>Entrées
                    <input type="number" min={1} step="1" value={entries} onChange={(e) => setEntries(e.target.value)} style={input} />
                  </label>
                ) : (
                  <label style={{ ...label, flex: 1, minWidth: 110 }}>Montant crédité €
                    <input type="number" min={0} step="0.5" value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)} style={input} />
                  </label>
                )}
              </div>
            )}

            <label style={label}>Description (affichée aux joueurs)
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="Ex. Réservez sans compter, toute l'année…" style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0] ?? null; setPendingFile(f); if (f) setRemoveImage(false); }} />
              <button type="button" onClick={() => fileRef.current?.click()} style={{ ...chip(false), display: 'inline-flex', gap: 6 }}>
                🖼 {shownImageUrl ? "Changer l'affiche" : 'Ajouter une affiche'}
              </button>
              {shownImageUrl && (
                <button type="button" onClick={() => { setPendingFile(null); setRemoveImage(true); if (fileRef.current) fileRef.current.value = ''; }} style={{ ...chip(false), color: '#ff7a4d' }}>
                  Retirer l'affiche
                </button>
              )}
            </div>

            <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={{ border: 'none', background: 'transparent', color: th.accent, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, alignSelf: 'flex-start', padding: 0 }}>
              Réglages avancés {showAdvanced ? '▴' : '▾'}
            </button>
            {showAdvanced && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {kind === 'PLAN' ? (
                  <>
                    <label style={label}>Plafond / jour
                      <input type="number" min={1} step="1" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} placeholder="∞" style={{ ...input, width: 100 }} />
                    </label>
                    <label style={label}>Plafond / sem.
                      <input type="number" min={1} step="1" value={weeklyCap} onChange={(e) => setWeeklyCap(e.target.value)} placeholder="∞" style={{ ...input, width: 100 }} />
                    </label>
                  </>
                ) : (
                  <label style={label}>Validité (jours, vide = sans)
                    <input type="number" min={1} step="1" value={validity} onChange={(e) => setValidity(e.target.value)} style={{ ...input, width: 150 }} />
                  </label>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <button type="button" disabled={busy} onClick={handleSubmit}
                style={{ border: 'none', background: th.accent, color: th.onAccent, borderRadius: 999, padding: '10px 20px', cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 800 }}>
                {busy ? '…' : submitLabel}
              </button>
              <button type="button" disabled={busy} onClick={onClose} style={{ border: 'none', background: 'transparent', color: th.textMute, cursor: 'pointer', fontFamily: th.fontUI, fontSize: 13, fontWeight: 700 }}>Annuler</button>
            </div>
          </div>

          <div className="pl-create-recap" style={{ background: HERO_GRADIENT, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div style={{ fontFamily: th.fontUI, fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: HERO_INK_MUTED }}>Ce que verront vos joueurs</div>
            <OfferPreviewCard preview={preview} />
            <div style={{ fontFamily: th.fontUI, fontSize: 11, color: HERO_INK_MUTED, textAlign: 'center' }}>Mise à jour en direct ✨</div>
          </div>
        </div>
      </div>
    </div>
  );
}
