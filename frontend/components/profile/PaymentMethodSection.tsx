'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeProvider';
import { api, MyPaymentMethod } from '@/lib/api';
import { cardLabel } from '@/lib/payments';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Props { slug: string; token: string; }

/** Carte enregistrée du club courant : affichage + retrait (ConfirmDialog). */
export function PaymentMethodSection({ slug, token }: Props) {
  const { th } = useTheme();
  const [card, setCard] = useState<MyPaymentMethod | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getMyPaymentMethod(slug, token).then((c) => { setCard(c); setLoaded(true); }).catch(() => setLoaded(true));
  }, [slug, token]);

  const remove = async () => {
    setBusy(true);
    try {
      await api.removeMyPaymentMethod(slug, token);
      setCard(null);
      setConfirming(false);
    } finally { setBusy(false); }
  };

  const faint: React.CSSProperties = { fontFamily: th.fontUI, fontSize: 13, color: th.textFaint };

  if (!loaded) return <span style={faint}>Chargement…</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {card ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: th.surface2, borderRadius: 12, padding: '12px 14px' }}>
            <span style={{ fontFamily: th.fontUI, fontSize: 14, fontWeight: 600, color: th.text }}>{cardLabel(card)}</span>
            <button onClick={() => setConfirming(true)}
              style={{ cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline', fontFamily: th.fontUI, fontSize: 13, color: th.text }}>
              Retirer
            </button>
          </div>
          <span style={faint}>Cette carte sert d’empreinte (anti no-show) et aux débits liste d’attente. Le club pourra la redemander à votre prochaine réservation.</span>
        </>
      ) : (
        <span style={faint}>Aucune carte enregistrée.</span>
      )}

      {confirming && (
        <ConfirmDialog
          title="Retirer ma carte ?"
          message="Votre carte enregistrée sera supprimée. Vous pourrez en enregistrer une nouvelle lors d’une prochaine réservation."
          confirmLabel="Retirer ma carte"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
