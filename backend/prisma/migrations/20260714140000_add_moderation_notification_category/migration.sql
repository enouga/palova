DO $$ BEGIN
  ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'MODERATION';
EXCEPTION WHEN duplicate_object THEN null; END $$;
