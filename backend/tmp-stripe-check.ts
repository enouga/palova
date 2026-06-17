import { prisma } from './src/db/prisma';
async function main() {
  const clubs = await prisma.club.findMany({
    select: {
      slug: true, name: true, stripeAccountId: true, stripeAccountStatus: true,
      requireOnlinePayment: true, requireCardFingerprint: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  for (const c of clubs) {
    console.log(JSON.stringify({
      slug: c.slug, name: c.name, status: c.stripeAccountStatus,
      acct: c.stripeAccountId, reqOnline: c.requireOnlinePayment, reqCard: c.requireCardFingerprint,
    }));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
