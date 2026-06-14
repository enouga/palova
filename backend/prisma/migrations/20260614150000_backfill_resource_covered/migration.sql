-- L'ancien attributes.surface valait indoor|outdoor (= couvert/découvert), pas un matériau.
-- On le convertit en attributes.covered (booléen) et on retire la clé surface
-- (le matériau sera re-choisi par l'admin parmi les surfaces du sport).
UPDATE "resources"
SET "attributes" = ("attributes" - 'surface')
  || jsonb_build_object('covered', ("attributes" ->> 'surface') = 'indoor')
WHERE "attributes" ? 'surface';
