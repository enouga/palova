-- CreateTable
CREATE TABLE "club_email_templates" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "cta_label" TEXT,
    "footer_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "club_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "club_email_templates_club_id_type_key" ON "club_email_templates"("club_id", "type");

-- AddForeignKey
ALTER TABLE "club_email_templates" ADD CONSTRAINT "club_email_templates_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
