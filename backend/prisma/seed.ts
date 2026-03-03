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
  const subject = await prisma.subject.create({
    data: {
      name: 'Network Security Fundamentals',
      teacherId: teacher.id,
    },
  });

  const sampleQuestions = [
    {
      type: 'MULTIPLE_CHOICE',
      content: 'Which protocol is used for secure web communication?',
      answer: 'HTTPS',
      options: JSON.stringify(['HTTP', 'HTTPS', 'FTP', 'SMTP']),
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'What does CIA stand for in information security?',
      answer: 'Confidentiality, Integrity, Availability',
      options: JSON.stringify([
        'Confidentiality, Integrity, Availability',
        'Control, Identity, Access',
        'Cipher, Integrity, Authentication',
        'Confidentiality, Identity, Access',
      ]),
    },
    {
      type: 'TRUE_FALSE',
      content: 'A firewall can protect against all types of cyber attacks.',
      answer: 'False',
      options: null,
    },
    {
      type: 'TRUE_FALSE',
      content: 'Encryption ensures data confidentiality during transmission.',
      answer: 'True',
      options: null,
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
      answer: 'Phishing',
      options: JSON.stringify(['DDoS', 'SQL Injection', 'Phishing', 'Buffer Overflow']),
    },
    {
      type: 'MULTIPLE_CHOICE',
      content: 'What is the purpose of a VPN?',
      answer: 'To create a secure encrypted connection over a public network',
      options: JSON.stringify([
        'To increase internet speed',
        'To create a secure encrypted connection over a public network',
        'To block malicious websites',
        'To monitor network traffic',
      ]),
    },
  ];

  for (const q of sampleQuestions) {
    await prisma.question.create({
      data: { ...q, subjectId: subject.id },
    });
  }
  console.log(`✅ Created ${sampleQuestions.length} sample questions`);

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
