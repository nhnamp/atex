import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Create Admin account
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: adminPassword,
      fullName: 'System Administrator',
      role: 'ADMIN',
      status: 'APPROVED',
    },
  });
  console.log(`✅ Admin created: ${admin.username}`);

  // Create a sample Teacher
  const teacherPassword = await bcrypt.hash('teacher123', 10);
  const teacher = await prisma.user.upsert({
    where: { username: 'Nguyen Van A' },
    update: {},
    create: {
      username: 'Nguyen Van A',
      password: teacherPassword,
      fullName: 'Nguyen Van A',
      role: 'TEACHER',
      status: 'APPROVED',
    },
  });
  console.log(`✅ Teacher created: ${teacher.username}`);

  // Create sample Students
  const studentIds = ['22521000', '22521001', '22521002', '22521003'];
  const studentPassword = await bcrypt.hash('student123', 10);
  
  for (const studentId of studentIds) {
    await prisma.user.upsert({
      where: { username: studentId },
      update: {},
      create: {
        username: studentId,
        password: studentPassword,
        fullName: `Student ${studentId}`,
        role: 'STUDENT',
        status: 'APPROVED',
      },
    });
  }
  console.log(`✅ ${studentIds.length} students created`);

  // Create a sample Class
  const sampleClass = await prisma.class.create({
    data: {
      name: 'NT208 - Network Security',
      description: 'Introduction to Network Security',
      teacherId: teacher.id,
    },
  });
  console.log(`✅ Class created: ${sampleClass.name}`);

  // Add students to class
  const students = await prisma.user.findMany({
    where: { username: { in: studentIds } },
  });
  
  for (const student of students) {
    await prisma.classStudent.upsert({
      where: { classId_studentId: { classId: sampleClass.id, studentId: student.id } },
      update: {},
      create: { classId: sampleClass.id, studentId: student.id },
    });
  }
  console.log(`✅ Added ${students.length} students to class`);

  // Create a sample Subject with questions
  let subject = await prisma.subject.findFirst({
    where: {
      teacherId: teacher.id,
      name: 'Network Security Fundamentals',
    },
  });

  if (!subject) {
    subject = await prisma.subject.create({
      data: {
        name: 'Network Security Fundamentals',
        teacherId: teacher.id,
      },
    });
  }

  const outcomeSeeds = [
    { code: 'G1.1', description: 'Understand core network security concepts' },
    { code: 'G1.2', description: 'Apply authentication and access-control methods' },
    { code: 'G2.1', description: 'Analyze network threats and vulnerabilities' },
    { code: 'G2.2', description: 'Design secure network architecture and policies' },
    { code: 'G3.1', description: 'Evaluate incident response and risk mitigation' },
  ];

  for (const outcome of outcomeSeeds) {
    const existing = await prisma.learningOutcome.findFirst({
      where: {
        subjectId: subject.id,
        code: outcome.code,
      },
    });
    if (!existing) {
      await prisma.learningOutcome.create({
        data: {
          subjectId: subject.id,
          code: outcome.code,
          description: outcome.description,
        },
      });
    }
  }

  const outcomes = await prisma.learningOutcome.findMany({
    where: { subjectId: subject.id },
    orderBy: { code: 'asc' },
  });

  const sampleQuestions = [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which protocol is used for secure web communication?',
      answer: 'B',
      options: JSON.stringify(['HTTP', 'HTTPS', 'FTP', 'SMTP']),
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'What does CIA stand for in information security?',
      answer: 'A',
      options: JSON.stringify([
        'Confidentiality, Integrity, Availability',
        'Control, Identity, Access',
        'Cipher, Integrity, Authentication',
        'Confidentiality, Identity, Access',
      ]),
    },
    {
      type: 'ESSAY',
      content: 'Explain the difference between symmetric and asymmetric encryption.',
      answer:
        'Symmetric encryption uses the same key for encryption and decryption, while asymmetric encryption uses a public key for encryption and a private key for decryption.',
      options: null,
    },
    {
      type: 'ESSAY',
      content: 'Describe the three main phases of a penetration test.',
      answer:
        'The three main phases are: 1) Reconnaissance (information gathering), 2) Exploitation (finding and exploiting vulnerabilities), 3) Reporting (documenting findings and recommendations).',
      options: null,
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which of the following is a type of social engineering attack?',
      answer: 'C',
      options: JSON.stringify(['DDoS', 'SQL Injection', 'Phishing', 'Buffer Overflow']),
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'What is the purpose of a VPN?',
      answer: 'B',
      options: JSON.stringify([
        'To increase internet speed',
        'To create a secure encrypted connection over a public network',
        'To block malicious websites',
        'To monitor network traffic',
      ]),
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which model layer is responsible for routing in TCP/IP?',
      answer: 'C',
      options: JSON.stringify(['Application', 'Transport', 'Internet', 'Data Link']),
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'What is the strongest mitigation for brute-force login attacks?',
      answer: 'D',
      options: JSON.stringify(['Allow longer passwords only', 'Use CAPTCHA only', 'Hide login endpoint', 'Rate limiting + MFA']),
    },
    {
      type: 'ESSAY',
      content: 'Analyze zero-trust network architecture and explain how it differs from perimeter-based security.',
      answer: 'A complete answer should cover identity-centric controls, continuous verification, micro-segmentation, and policy-driven access.',
      options: null,
    },
    {
      type: 'ESSAY',
      content: 'Design an incident response plan for ransomware in a university network.',
      answer: 'A complete answer should include detection, isolation, communication, backup restoration, forensics, and lessons learned.',
      options: null,
    },
  ];

  for (const q of sampleQuestions) {
    const existing = await prisma.question.findFirst({
      where: {
        subjectId: subject.id,
        content: q.content,
      },
    });

    if (!existing) {
      await prisma.question.create({
        data: { ...q, subjectId: subject.id, learningOutcomeId: outcomes[0]?.id ?? null, difficulty: 'MEDIUM' },
      });
    }
  }
  console.log(`✅ Created ${sampleQuestions.length} sample questions`);

  // Normalize existing MCQ answers to A/B/C/D if historical data stored answer text.
  const existingMcqs = await prisma.question.findMany({
    where: {
      subjectId: subject.id,
      type: 'MULTIPLE_CHOICE',
    },
    select: {
      id: true,
      answer: true,
      options: true,
    },
  });

  for (const question of existingMcqs) {
    if (!question.options) continue;
    try {
      const options = JSON.parse(question.options) as string[];
      if (!Array.isArray(options) || options.length < 2) continue;

      const normalized = String(question.answer || '').trim();
      if (/^[A-D]$/i.test(normalized)) continue;

      const idx = options.findIndex((option) => String(option).trim().toLowerCase() === normalized.toLowerCase());
      if (idx >= 0 && idx < 4) {
        const letter = ['A', 'B', 'C', 'D'][idx];
        await prisma.question.update({
          where: { id: question.id },
          data: { answer: letter },
        });
      }
    } catch {
      // keep legacy rows unchanged when options are malformed
    }
  }

  const existingCount = await prisma.question.count({ where: { subjectId: subject.id } });
  const targetCount = 220;
  const toCreate = Math.max(0, targetCount - existingCount);

  if (toCreate > 0) {
    const generatedQuestions: Array<{
      subjectId: number;
      type: 'MULTIPLE_CHOICE' | 'ESSAY';
      content: string;
      answer: string;
      options: string | null;
      topic: string;
      difficulty: 'EASY' | 'MEDIUM' | 'HARD';
      learningOutcomeId: number | null;
      rubric: string | null;
      status: 'ACTIVE';
    }> = [];

    const topics = [
      'Network Security',
      'Authentication',
      'Cryptography',
      'Threat Detection',
      'Incident Response',
      'Access Control',
    ];

    for (let i = 0; i < toCreate; i++) {
      const outcome = outcomes[i % outcomes.length];
      const topic = topics[i % topics.length];
      const difficulty = i % 10 < 5 ? 'EASY' : i % 10 < 9 ? 'MEDIUM' : 'HARD';

      if (i % 2 === 0) {
        generatedQuestions.push({
          subjectId: subject.id,
          type: 'MULTIPLE_CHOICE',
          content: `MCQ ${i + 1}: In ${topic}, which control is the best fit for scenario ${i + 1}?`,
          answer: 'B',
          options: JSON.stringify([
            `Distractor for ${topic} scenario ${i + 1} - A`,
            `Recommended control for ${topic} scenario ${i + 1}`,
            `Partially correct control for ${topic} scenario ${i + 1}`,
            `Irrelevant control for ${topic} scenario ${i + 1}`,
          ]),
          topic,
          difficulty,
          learningOutcomeId: outcome?.id ?? null,
          rubric: null,
          status: 'ACTIVE',
        });
      } else {
        generatedQuestions.push({
          subjectId: subject.id,
          type: 'ESSAY',
          content: `Essay ${i + 1}: Analyze an incident in ${topic} and propose mitigation strategy ${i + 1}.`,
          answer: 'A complete answer should explain root cause, impact, mitigation steps, and verification plan.',
          options: null,
          topic,
          difficulty,
          learningOutcomeId: outcome?.id ?? null,
          rubric: 'Score by: technical accuracy (0.4), mitigation quality (0.4), communication clarity (0.2).',
          status: 'ACTIVE',
        });
      }
    }

    for (const question of generatedQuestions) {
      await prisma.question.create({ data: question });
    }

    console.log(`✅ Added ${generatedQuestions.length} generated questions for testing`);
  } else {
    console.log(`✅ Question bank already has ${existingCount} questions (target ${targetCount})`);
  }

  console.log('\n🎉 Seed completed successfully!');
  console.log('\nDefault accounts:');
  console.log('  Admin   → username: admin       | password: admin123');
  console.log('  Teacher → username: Nguyen Van A | password: teacher123');
  console.log('  Student → username: 22521000     | password: student123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
