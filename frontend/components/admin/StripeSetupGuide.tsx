'use client';
import { useState, CSSProperties } from 'react';
import { ClubAdminDetail } from '@/lib/api';
import { useTheme } from '@/lib/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { GUIDE_STEPS, stripeGuideStates, STRIPE_DOC_LINKS, StepState } from '@/lib/stripeGuide';

const DOT_META: Record<StepState, { bg: string; fg: string; symbol: string }> = {
  done: { bg: '#22c55e', fg: '#fff', symbol: '✓' },
  current: { bg: '', fg: '#fff', symbol: '' },
  todo: { bg: '', fg: '', symbol: '' },
};

export function StripeSetupGuide({ status }: { status: ClubAdminDetail['stripeAccountStatus'] }) {
  const { th } = useTheme();
  const [open, setOpen] = useState(status !== 'ACTIVE');
  const states = stripeGuideStates(status);

  const box: CSSProperties = {
    background: th.surface, border: `1px solid ${th.line}`, borderRadius: 18,
    marginBottom: 20, overflow: 'hidden',
  };

  return (
    <div style={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
          fontFamily: th.fontUI, fontSize: 16, fontWeight: 700, color: th.text,
        }}
      >
        <span style={{ flex: 1 }}>Comment activer le paiement en ligne ?</span>
        <span style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
          <Icon name="chevR" size={18} color={th.textMute} />
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {GUIDE_STEPS.map((step, i) => {
              const state = states[i];
              const meta = DOT_META[state];
              return (
                <li key={step.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span
                    style={{
                      flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: th.fontUI, fontSize: 12, fontWeight: 700, marginTop: 1,
                      background: state === 'done' ? meta.bg : state === 'current' ? th.accent : th.surface2,
                      color: state === 'todo' ? th.textMute : meta.fg,
                      border: state === 'todo' ? `1px solid ${th.line}` : 'none',
                    }}
                  >
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <div>
                    <div style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 600, color: th.text, marginBottom: 2 }}>
                      {step.title}
                    </div>
                    <div style={{ fontFamily: th.fontUI, fontSize: 13.5, color: th.textMute, lineHeight: 1.5 }}>
                      {step.body}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div>
            <h3 style={{ fontFamily: th.fontUI, fontSize: 14.5, fontWeight: 700, color: th.text, margin: '0 0 10px' }}>
              Tester votre paiement en ligne
            </h3>
            <div style={{ background: th.surface2, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontFamily: th.fontUI, fontSize: 13.5, fontWeight: 600, color: th.text, marginBottom: 4 }}>
                En conditions réelles (recommandé)
              </div>
              <div style={{ fontFamily: th.fontUI, fontSize: 13, color: th.textMute, lineHeight: 1.5 }}>
                Depuis un compte joueur, réservez un créneau et payez par CB (vraie carte, petit montant).
                Vérifiez l&rsquo;encaissement dans <strong>Paiements</strong> et sur votre tableau de bord Stripe,
                puis remboursez le paiement depuis Paiements → « Détails / options ».
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, paddingTop: 6, borderTop: `1px solid ${th.line}` }}>
            {STRIPE_DOC_LINKS.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: th.fontUI, fontSize: 13, color: th.accent }}
              >
                {link.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
