// Xuất toàn bộ dữ liệu từ database hiện tại (đang generate) ra prisma/backup.json.
// Chạy KHI Prisma Client đang trỏ SQLite để sao lưu dữ liệu local trước khi đồng bộ.
// Bảng nào lệch schema (cột thiếu) mà rỗng sẽ được bỏ qua an toàn -> [].
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function safe<T>(name: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`  ! bỏ qua ${name}: ${(e as Error).message.split('\n')[0]}`);
    return [];
  }
}

async function main() {
  const data: Record<string, unknown[]> = {};
  data.department = await safe('department', () => prisma.department.findMany());
  data.studentClass = await safe('studentClass', () => prisma.studentClass.findMany());
  data.user = await safe('user', () => prisma.user.findMany());
  data.class = await safe('class', () => prisma.class.findMany());
  data.classStudent = await safe('classStudent', () => prisma.classStudent.findMany());
  data.subject = await safe('subject', () => prisma.subject.findMany());
  data.learningOutcome = await safe('learningOutcome', () => prisma.learningOutcome.findMany());
  data.question = await safe('question', () => prisma.question.findMany());
  data.exam = await safe('exam', () => prisma.exam.findMany());
  data.examQuestion = await safe('examQuestion', () => prisma.examQuestion.findMany());
  data.examSession = await safe('examSession', () => prisma.examSession.findMany());
  data.examSubmission = await safe('examSubmission', () => prisma.examSubmission.findMany());
  data.examDraftScan = await safe('examDraftScan', () => prisma.examDraftScan.findMany());
  data.submissionGrade = await safe('submissionGrade', () => prisma.submissionGrade.findMany());
  data.gradingAuditLog = await safe('gradingAuditLog', () => prisma.gradingAuditLog.findMany());
  data.attendanceSession = await safe('attendanceSession', () => prisma.attendanceSession.findMany());
  data.attendanceRecord = await safe('attendanceRecord', () => prisma.attendanceRecord.findMany());
  data.faceDescriptor = await safe('faceDescriptor', () => prisma.faceDescriptor.findMany());

  const out = path.resolve(__dirname, '..', 'prisma', 'backup.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log('Saved backup to', out);
  for (const [k, v] of Object.entries(data)) {
    if ((v as unknown[]).length) console.log(`  ${k}: ${(v as unknown[]).length}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
