'use client';
import { useState } from 'react';
import { api, AdminClubSport, AdminResource } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { inkOn } from '@/lib/theme';
import { resourceNames, pluralNoun } from '@/lib/onboarding';
import { WIZ, WizHeader, WizError, WizActions } from './wizardUi';

type Draft = { count: number; price: string; coverage: 'indoor' | 'outdoor' };

const DEFAULT_DRAFT: Draft = { count: 0, price: '', coverage: 'indoor' };

export function StepCourts({ clubName, clubSports, resources, clubId, token, onCreated, advance }: {
  clubName: string;
  clubSports: AdminClubSport[];
  resources: AdminResource[];
  clubId: string;
  token: string;
  onCreated: (r: AdminResource) => void;
  advance: () => void;
}) {
  const { th } = useTheme();
  const existingCount = (csId: string) => resources.filter((r) => r.clubSport.id === csId).length;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(
    clubSports.map((cs) => [cs.id, { count: existingCount(cs.id) > 0 ? 0 : 2, price: '', coverage: 'indoor' as const }]),
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDraft = (csId: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [csId]: { ...(d[csId] ?? DEFAULT_DRAFT), ...patch } }));

  const priceOf = (d: Draft) => Number(d.price.replace(',', '.'));

  const save = async () => {
    // Validation : un prix est requis dès qu'on crée des terrains pour un sport.
    for (const cs of clubSports) {
      const d = drafts[cs.id];
      if (d && d.count > 0 && (!Number.isFinite(priceOf(d)) || priceOf(d) <= 0)) {
        setError(`Indiquez un prix au créneau pour ${cs.sport.name}.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      for (const cs of clubSports) {
        const d = drafts[cs.id];
        if (!d || d.count <= 0) continue;
        let created = existingCount(cs.id);
        let doneHere = 0;
        try {
          for (let i = 0; i < d.count; i++) {
            const name = resourceNames(cs.sport.resourceNoun, created, 1)[0];
            const r = await api.adminCreateResource(clubId, {
              clubSportId: cs.id, name, price: priceOf(d), attributes: { coverage: d.coverage },
            }, token);
            onCreated(r);
            created += 1;
            doneHere += 1;
          }
        } finally {
          // consomme les créations réussies : 0 après succès complet (retry saute ce sport),
          // reste à créer après échec partiel (retry reprend au terrain qui a échoué)
          if (doneHere > 0) setDraft(cs.id, { count: d.count - doneHere });
        }
      }
      advance();
    } catch { setError('La création d’un terrain a échoué. Réessayez — rien n’est perdu.'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <WizHeader accent="#ffffff" surtitle={`Vos terrains · ${clubName}`}
        title={<>Vos terrains,<br />en 30 secondes.</>}
        sub="On les crée en série (« Piste 1, Piste 2… ») — noms, horaires et tarifs affinables ensuite dans Ressources." />

      {error && <WizError>{error}</WizError>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {clubSports.map((cs) => {
          const d = drafts[cs.id] ?? DEFAULT_DRAFT;
          const existing = existingCount(cs.id);
          return (
            <div key={cs.id} style={{ background: WIZ.card, border: `1px solid ${WIZ.line}`, borderRadius: 14, padding: 16 }}>
              <div style={{ color: WIZ.text, fontFamily: th.fontUI, fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{cs.sport.name}</div>
              {existing > 0 && (
                <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 12.5, marginBottom: 8 }}>
                  déjà {existing} {pluralNoun(cs.sport.resourceNoun, existing)} ✓ — ajoutez-en si besoin
                </div>
              )}
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    {existing > 0 ? 'À ajouter' : `Combien de ${pluralNoun(cs.sport.resourceNoun, 2)} ?`}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" aria-label={`Retirer un terrain — ${cs.sport.name}`} disabled={d.count <= 0}
                      onClick={() => setDraft(cs.id, { count: Math.max(0, d.count - 1) })}
                      style={{ width: 34, height: 34, borderRadius: 9, background: 'transparent', color: WIZ.text, border: `1px solid ${WIZ.line}`, cursor: 'pointer', fontSize: 17 }}>−</button>
                    <span style={{ color: WIZ.text, fontFamily: th.fontDisplay, fontSize: 24, fontWeight: 600, minWidth: 26, textAlign: 'center' }}>{d.count}</span>
                    <button type="button" aria-label={`Ajouter un terrain — ${cs.sport.name}`} disabled={d.count >= 20}
                      onClick={() => setDraft(cs.id, { count: Math.min(20, d.count + 1) })}
                      style={{ width: 34, height: 34, borderRadius: 9, background: 'transparent', color: WIZ.text, border: `1px solid ${WIZ.line}`, cursor: 'pointer', fontSize: 17 }}>+</button>
                  </div>
                </div>
                <div>
                  <div style={{ color: WIZ.mute, fontFamily: th.fontUI, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    Prix au créneau (€)
                  </div>
                  <input aria-label={`Prix au créneau (€) — ${cs.sport.name}`} inputMode="decimal" value={d.price} placeholder="25"
                    onChange={(e) => setDraft(cs.id, { price: e.target.value })}
                    style={{ display: 'block', width: 110, height: 40, padding: '0 12px', borderRadius: 10, background: 'rgba(255,255,255,.08)', color: WIZ.text, border: `1px solid ${WIZ.line}`, fontFamily: th.fontUI, fontSize: 15 }} />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([['indoor', 'Intérieur'], ['outdoor', 'Extérieur']] as const).map(([cov, label]) => (
                    <button key={cov} type="button" aria-pressed={d.coverage === cov} onClick={() => setDraft(cs.id, { coverage: cov })}
                      style={{
                        borderRadius: 18, padding: '8px 14px', fontFamily: th.fontUI, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                        background: d.coverage === cov ? '#ffffff' : 'transparent',
                        color: d.coverage === cov ? inkOn('#ffffff') : WIZ.mute,
                        border: `1px solid ${d.coverage === cov ? '#ffffff' : WIZ.line}`,
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <WizActions accent="#ffffff" busy={busy} onNext={save} onSkip={advance} />
    </div>
  );
}
