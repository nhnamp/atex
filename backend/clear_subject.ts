import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const subjects = await prisma.subject.findMany({ where: { name: "Kiến thức chung về mạng máy tính" } });
  for (const sub of subjects) {
    await prisma.subject.delete({ where: { id: sub.id } });
    console.log("Deleted subject with id:", sub.id);
  }
}
main().finally(() => prisma.$disconnect());
