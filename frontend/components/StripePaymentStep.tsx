'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useStripe, useElements } from '@stripe/react-stripe-js';
import { api } from '@/lib/api';
import { getStripe } from '@/lib/stripe';
import { Btn } from '@/components/ui/atoms';

const Elements = dynamic(
  () => import('@stripe/react-stripe-js').then((m) => m.Elements),
  { ssr: false },
);
const PaymentElement = dynamic(
  () => import('@stripe/react-stripe-js').then((m) => m.PaymentElement),
  { ssr: false },
);

interface Props {
  reservationId: string;
  slug: string;
  clubId: string;
  type: 'payment' | 'setup';
  amountLabel: string;
  token: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function StripeForm({ reservationId, type, amountLabel, token, onSuccess, onCancel }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    try {
      let result: { error?: { message?: string } | null; paymentIntent?: { id?: string }; setupIntent?: { id?: string } };
      if (type === 'payment') {
        result = await stripe.confirmPayment({ elements, redirect: 'if_required' } as any);
      } else {
        result = await stripe.confirmSetup({ elements, redirect: 'if_required' } as any);
      }

      if (result.error) {
        setError(result.error.message ?? 'Paiement échoué.');
        return;
      }

      await api.confirmReservation(reservationId, token, {
        stripePaymentIntentId: type === 'payment' ? result.paymentIntent?.id : undefined,
        stripeSetupIntentId: type === 'setup' ? result.setupIntent?.id : undefined,
      });
      onSuccess();
    } catch (e: any) {
      setError(e?.message ?? 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontWeight: 600 }}>
        {type === 'payment' ? `Montant : ${amountLabel}` : 'Enregistrement de votre carte'}
      </p>
      <PaymentElement />
      {error && <p style={{ color: 'red', fontSize: 14 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="ghost" onClick={onCancel}>Annuler</Btn>
        <Btn onClick={handleSubmit} disabled={loading || !stripe}>
          {loading ? 'Traitement…' : type === 'payment' ? `Payer ${amountLabel}` : 'Enregistrer ma carte'}
        </Btn>
      </div>
    </div>
  );
}

export default function StripePaymentStep(props: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    api.createStripeIntent(
      props.slug,
      { reservationId: props.reservationId, type: props.type },
      props.token,
    )
      .then((r) => setClientSecret(r.clientSecret))
      .catch(() => setFetchError('Impossible d\'initialiser le paiement.'));
  }, [props.slug, props.reservationId, props.type, props.token]);

  if (fetchError) {
    return (
      <div>
        <p style={{ color: 'red' }}>{fetchError}</p>
        <Btn variant="ghost" onClick={props.onCancel}>Annuler</Btn>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div>
        <p>Chargement…</p>
        <Btn variant="ghost" onClick={props.onCancel}>Annuler</Btn>
      </div>
    );
  }

  return (
    <Elements stripe={getStripe()} options={{ clientSecret }}>
      <StripeForm {...props} />
    </Elements>
  );
}
