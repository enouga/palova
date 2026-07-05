import fs from 'fs';
import path from 'path';

// Racine des fichiers uploadés, servie statiquement sur /uploads (voir app.ts).
// UPLOADS_DIR surchargable pour les tests (tmpdir) et la prod (volume Docker).
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
export const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
export const ICONS_DIR = path.join(UPLOADS_DIR, 'icons'); // cache des icônes PWA de clubs
export const SPONSORS_DIR = path.join(UPLOADS_DIR, 'sponsors'); // logos de partenaires uploadés
export const LOGOS_DIR = path.join(UPLOADS_DIR, 'logos'); // logos de clubs uploadés
export const COVERS_DIR = path.join(UPLOADS_DIR, 'covers'); // couvertures de clubs uploadées
export const OGCARDS_DIR = path.join(UPLOADS_DIR, 'ogcards'); // cache des cartes OG de parties
export const ANNOUNCEMENTS_DIR = path.join(UPLOADS_DIR, 'announcements'); // affiches d'annonces
export const CLUB_PHOTOS_DIR = path.join(UPLOADS_DIR, 'club-photos'); // galerie de présentation des clubs

// Racine des fichiers PRIVÉS (photos de messagerie) — JAMAIS servie statiquement :
// streaming via une route authentifiée uniquement. Volume Docker dédié en prod.
export const PRIVATE_UPLOADS_DIR = process.env.PRIVATE_UPLOADS_DIR || path.join(process.cwd(), 'uploads-private');
export const DM_DIR = path.join(PRIVATE_UPLOADS_DIR, 'dm');

export function ensureUploadDirs(): void {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.mkdirSync(SPONSORS_DIR, { recursive: true });
  fs.mkdirSync(LOGOS_DIR, { recursive: true });
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.mkdirSync(OGCARDS_DIR, { recursive: true });
  fs.mkdirSync(ANNOUNCEMENTS_DIR, { recursive: true });
  fs.mkdirSync(CLUB_PHOTOS_DIR, { recursive: true });
  fs.mkdirSync(DM_DIR, { recursive: true });
}

// Types d'image acceptés pour les avatars → extension de fichier.
export const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
