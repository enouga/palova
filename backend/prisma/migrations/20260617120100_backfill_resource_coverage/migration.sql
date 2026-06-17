-- attributes.covered (booléen) -> attributes.coverage (indoor|outdoor). Le 3e état
-- "semi" est saisi à la main par l'admin. On retire l'ancienne clé covered.
UPDATE "resources"
SET "attributes" = ("attributes" - 'covered')
  || jsonb_build_object(
       'coverage',
       CASE WHEN ("attributes" ->> 'covered') = 'true' THEN 'indoor' ELSE 'outdoor' END
     )
WHERE "attributes" ? 'covered';
