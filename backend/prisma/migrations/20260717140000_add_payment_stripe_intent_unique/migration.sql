-- Ferme la fenetre de double PaymentIntent (client + webhook, cf. audit pre-MEP §3.2) :
-- l'idempotence n'etait garantie qu'applicativement (findFirst + Serializable). Verifie
-- avant application qu'aucun doublon n'existe deja en base (dev + une eventuelle prod).
DROP INDEX IF EXISTS "payments_stripe_payment_intent_id_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");
