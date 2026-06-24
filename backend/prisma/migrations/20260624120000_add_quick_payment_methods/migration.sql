-- Moyens d'encaissement rapides configurables par club (boutons 1 clic au comptoir).
-- Sous-ensemble ordonné de PaymentMethod parmi CASH/CARD/VOUCHER/TRANSFER/MEMBER. Défaut = CB, Ticket CE, Espèces.
ALTER TABLE "clubs" ADD COLUMN "quick_payment_methods" TEXT[] NOT NULL DEFAULT ARRAY['CARD', 'VOUCHER', 'CASH']::TEXT[];
