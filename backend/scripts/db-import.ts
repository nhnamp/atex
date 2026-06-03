// Import dữ liệu từ prisma/backup.json vào database hiện tại (đang generate -> Postgres/Supabase).
// Chiến lược: GIỮ user admin id=1 sẵn có trên Supabase; bỏ qua admin local (id=1);
// thêm 5 user còn lại + toàn bộ subject/learningOutcome/question/class/classStudent/exam/examQuestion.
// Giữ nguyên id gốc, sau đó reset sequence để id mới không trùng.
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const backup = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'prisma', 'backup.json'), 'utf8')
  );

  const SKIP_ADMIN_ID = 1; // giữ admin sẵn có trên Supabase
  const users = (backup.user as any[]).filter((u) => u.id !== SKIP_ADMIN_ID);

  // Theo thứ tự phụ thuộc khóa ngoại.
  const r = await prisma.$transaction(async (tx) => {
    const out: Record<string, number> = {};
    out.user = (await tx.user.createMany({ data: users, skipDuplicates: true })).count;
    out.subject = (await tx.subject.createMany({ data: backup.subject, skipDuplicates: true })).count;
    out.learningOutcome = (await tx.learningOutcome.createMany({ data: backup.learningOutcome, skipDuplicates: true })).count;
    out.question = (await tx.question.createMany({ data: backup.question, skipDuplicates: true })).count;
    out.class = (await tx.class.createMany({ data: backup.class, skipDuplicates: true })).count;
    out.classStudent = (await tx.classStudent.createMany({ data: backup.classStudent, skipDuplicates: true })).count;
    out.exam = (await tx.exam.createMany({ data: backup.exam, skipDuplicates: true })).count;
    out.examQuestion = (await tx.examQuestion.createMany({ data: backup.examQuestion, skipDuplicates: true })).count;
    return out;
  });

  console.log('Imported rows:');
  for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${v}`);

  // Reset sequence cho các bảng có id tự tăng đã chèn id tường minh.
  const seqTables = ['User', 'Subject', 'LearningOutcome', 'Question', 'Class', 'Exam'];
  for (const t of seqTables) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), (SELECT MAX(id) FROM "${t}"))`
    );
  }
  console.log('Sequences reset for:', seqTables.join(', '));
}

main()
  .catch((e) => {
    console.error('IMPORT FAILED:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
