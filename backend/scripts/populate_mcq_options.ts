import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔎 Scanning MULTIPLE_CHOICE questions...');

  const mcqs = await prisma.question.findMany({
    where: { type: 'MULTIPLE_CHOICE' },
    select: { id: true, options: true, answer: true, content: true },
  });

  let updated = 0;
  const updatedIds: number[] = [];

  for (const q of mcqs) {
    let hasValidOptions = false;
    if (q.options) {
      try {
        const parsed = JSON.parse(q.options);
        if (Array.isArray(parsed) && parsed.length >= 2) {
          hasValidOptions = true;
        }
      } catch (e) {
        // malformed JSON -> treat as missing
      }
    }

    if (hasValidOptions) continue;

    // Heuristic to populate options
    const rawAnswer = String(q.answer || '').trim();

    let options: string[];
    let newAnswer = rawAnswer;

    if (/^[A-D]$/i.test(rawAnswer)) {
      // Only letter answer present -> fill with generic placeholders
      options = ['Option A', 'Option B', 'Option C', 'Option D'];
      newAnswer = rawAnswer.toUpperCase();
    } else if (rawAnswer.length > 3) {
      // Likely the answer text is stored; put it as option A and normalize answer to 'A'
      options = [rawAnswer, 'Option B', 'Option C', 'Option D'];
      newAnswer = 'A';
    } else {
      // Fallback: generic placeholders and default answer to 'A'
      options = ['Option A', 'Option B', 'Option C', 'Option D'];
      if (!/^[A-D]$/i.test(rawAnswer)) newAnswer = 'A'; else newAnswer = rawAnswer.toUpperCase();
    }

    try {
      await prisma.question.update({
        where: { id: q.id },
        data: {
          options: JSON.stringify(options),
          answer: newAnswer,
        },
      });
      updated++;
      updatedIds.push(q.id);
    } catch (e) {
      console.error(`Failed to update question ${q.id}:`, e);
    }
  }

  console.log(`✅ Updated ${updated} MULTIPLE_CHOICE questions`);
  if (updatedIds.length) console.log('Updated IDs:', updatedIds.join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
