import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { generateCode } from '../utils/code';
import { sendVerificationEmail, sendPasswordResetEmail, emailDevMode } from '../email/mailer';
import { rateLimit } from '../middleware/rateLimit';
import { LEGAL_VERSIONS } from '../content/legalVersions';

const router = Router();

// Limites anti-brute-force / anti-abus (fenêtre fixe, cf. assertRateLimit).
// Généreuses pour un humain, serrées pour un bot. Le contrôle par IP freine le spray
// (beaucoup de comptes depuis une IP), le contrôle par email le brute-force ciblé.
const MIN = 60;

const CODE_TTL_MS = 15 * 60 * 1000;        // validité du code : 15 min
const MAX_ATTEMPTS = 5;                     // essais max avant de devoir renvoyer un code
const RESEND_COOLDOWN_MS = 60 * 1000;       // délai mini entre deux envois

interface BasicUser { id: string; email: string; firstName: string; lastName: string; isSuperAdmin: boolean; }

function signToken(user: { id: string; email: string; tokenVersion: number }): string {
  return jwt.sign({ id: user.id, email: user.email, tokenVersion: user.tokenVersion }, process.env.JWT_SECRET!, { expiresIn: '7d' });
}

function publicUser(u: BasicUser) {
  return { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, isSuperAdmin: u.isSuperAdmin };
}

// Génère + stocke (hashé) + envoie un nouveau code pour un utilisateur. Renvoie le code en clair (pour le mode dev).
async function issueCode(userId: string, email: string): Promise<string> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await prisma.emailVerification.upsert({
    where: { userId },
    create: { userId, codeHash, expiresAt, attempts: 0, lastSentAt: new Date() },
    update: { codeHash, expiresAt, attempts: 0, lastSentAt: new Date() },
  });
  await sendVerificationEmail(email, code);
  return code;
}

// Idem pour la réinitialisation de mot de passe (table dédiée + email dédié).
async function issueResetCode(userId: string, email: string): Promise<string> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await prisma.passwordReset.upsert({
    where: { userId },
    create: { userId, codeHash, expiresAt, attempts: 0, lastSentAt: new Date() },
    update: { codeHash, expiresAt, attempts: 0, lastSentAt: new Date() },
  });
  await sendPasswordResetEmail(email, code);
  return code;
}

router.post('/login', rateLimit(
  { bucket: 'login', by: 'ip', max: 20, windowSec: MIN },
  { bucket: 'login', by: 'email', max: 8, windowSec: MIN },
), async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email et mot de passe requis' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json({ error: 'Identifiants invalides' });
    return;
  }
  if (user.deletedAt) {
    res.status(401).json({ error: 'Identifiants invalides' });
    return;
  }
  if (!user.emailVerified) {
    res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', email: user.email });
    return;
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

router.post('/register', rateLimit(
  { bucket: 'register', by: 'ip', max: 10, windowSec: MIN },
  { bucket: 'register', by: 'email', max: 5, windowSec: MIN },
), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, firstName, lastName, phone, preferredSportId, acceptTerms } = req.body;
    if (!email || !password || !firstName || !lastName) {
      res.status(400).json({ error: 'email, password, firstName, lastName requis' });
      return;
    }
    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });
      return;
    }
    // Preuve d'acceptation obligatoire (spec conformité légale) — la case du formulaire.
    if (acceptTerms !== true) {
      res.status(400).json({ error: 'CGU_NOT_ACCEPTED' });
      return;
    }

    // Validation optionnelle du sport préféré : un id invalide ou non publié est ignoré (non bloquant).
    let validPreferredSportId: string | null = null;
    if (typeof preferredSportId === 'string' && preferredSportId) {
      const sport = await prisma.sport.findUnique({ where: { id: preferredSportId }, select: { id: true, published: true } });
      if (sport && sport.published) validPreferredSportId = sport.id;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing?.emailVerified) {
      res.status(409).json({ error: 'Cet email est déjà utilisé' });
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    // Compte + preuve d'acceptation posés dans UNE transaction : si legalAcceptance.createMany
    // échoue après l'écriture du compte (coupure DB…), il ne doit jamais rester un compte
    // persisté sans trace de consentement — exactement ce que cette fonctionnalité garantit.
    const user = await prisma.$transaction(async (tx) => {
      // Compte non vérifié recréé/mis à jour : on autorise à reprendre l'inscription tant que l'email n'est pas validé.
      const u = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { password: hashed, firstName, lastName, phone: phone || null } })
        : await tx.user.create({ data: { email, password: hashed, firstName, lastName, phone: phone || null, preferredSportId: validPreferredSportId } });

      // Trace d'acceptation insert-only (CGU + politique de confidentialité). Une reprise
      // d'inscription (compte non vérifié) ré-écrit des lignes : historique, pas doublon.
      await tx.legalAcceptance.createMany({
        data: (['CGU', 'PRIVACY'] as const).map((document) => ({
          userId: u.id, document, version: LEGAL_VERSIONS[document], context: 'register',
        })),
      });

      return u;
    });

    const code = await issueCode(user.id, email);
    res.status(201).json({ pendingVerification: true, email, ...(emailDevMode ? { devCode: code } : {}) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Cet email est déjà utilisé' });
      return;
    }
    next(err);
  }
});

router.post('/verify-email', rateLimit(
  { bucket: 'verify', by: 'ip', max: 20, windowSec: MIN },
), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400).json({ error: 'email et code requis' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email }, include: { emailVerification: true } });
    if (!user) {
      res.status(400).json({ error: 'CODE_INVALID' });
      return;
    }
    if (user.emailVerified) {
      res.json({ token: signToken(user), user: publicUser(user) });
      return;
    }
    const v = user.emailVerification;
    if (!v || v.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ error: 'CODE_EXPIRED' });
      return;
    }
    if (v.attempts >= MAX_ATTEMPTS) {
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
      return;
    }
    const ok = await bcrypt.compare(String(code), v.codeHash);
    if (!ok) {
      await prisma.emailVerification.update({ where: { userId: user.id }, data: { attempts: { increment: 1 } } });
      res.status(400).json({ error: 'CODE_INVALID' });
      return;
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } }),
      prisma.emailVerification.delete({ where: { userId: user.id } }),
    ]);
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-code', rateLimit(
  { bucket: 'resend', by: 'ip', max: 8, windowSec: MIN },
), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'email requis' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email }, include: { emailVerification: true } });
    // Pas d'énumération : réponse neutre si l'email n'existe pas ou est déjà vérifié.
    if (!user || user.emailVerified) {
      res.json({ ok: true });
      return;
    }
    const last = user.emailVerification?.lastSentAt;
    if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_MS) {
      res.status(429).json({ error: 'RESEND_COOLDOWN' });
      return;
    }
    const code = await issueCode(user.id, email);
    res.json({ ok: true, ...(emailDevMode ? { devCode: code } : {}) });
  } catch (err) {
    next(err);
  }
});

// Mot de passe oublié : déclenche l'envoi d'un code de réinitialisation.
// Réponse TOUJOURS neutre (anti-énumération) : on ne révèle pas si l'email existe.
router.post('/forgot-password', rateLimit(
  { bucket: 'forgot', by: 'ip', max: 8, windowSec: MIN },
), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'email requis' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email }, include: { passwordReset: true } });
    // Compte inexistant ou non vérifié : réponse neutre, aucun envoi.
    if (!user || !user.emailVerified) {
      res.json({ ok: true });
      return;
    }
    const last = user.passwordReset?.lastSentAt;
    if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_MS) {
      // Code déjà envoyé récemment : on ne renvoie pas, mais réponse neutre.
      res.json({ ok: true });
      return;
    }
    const code = await issueResetCode(user.id, email);
    res.json({ ok: true, ...(emailDevMode ? { devCode: code } : {}) });
  } catch (err) {
    next(err);
  }
});

// Réinitialisation effective : valide le code et pose le nouveau mot de passe.
router.post('/reset-password', rateLimit(
  { bucket: 'reset', by: 'ip', max: 20, windowSec: MIN },
), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      res.status(400).json({ error: 'email, code et newPassword requis' });
      return;
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email }, include: { passwordReset: true } });
    const v = user?.passwordReset;
    if (!user || !v) {
      res.status(400).json({ error: 'CODE_INVALID' });
      return;
    }
    if (v.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ error: 'CODE_EXPIRED' });
      return;
    }
    if (v.attempts >= MAX_ATTEMPTS) {
      res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
      return;
    }
    const ok = await bcrypt.compare(String(code), v.codeHash);
    if (!ok) {
      await prisma.passwordReset.update({ where: { userId: user.id }, data: { attempts: { increment: 1 } } });
      res.status(400).json({ error: 'CODE_INVALID' });
      return;
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    // tokenVersion incrémenté : un mot de passe réinitialisé révoque tout JWT déjà émis
    // (ex. compte compromis) — cf. audit pré-MEP §2.2, vérifié par authMiddleware.
    const nextTokenVersion = (user.tokenVersion ?? 0) + 1;
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password: hashed, tokenVersion: nextTokenVersion } }),
      prisma.passwordReset.delete({ where: { userId: user.id } }),
    ]);
    res.json({ token: signToken({ ...user, tokenVersion: nextTokenVersion }), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

export default router;
