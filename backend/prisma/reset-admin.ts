import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Resetting admin user...');
  await prisma.user.deleteMany({ where: { username: 'admin' } });
  console.log('✅ Admin user deleted (if existed).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
