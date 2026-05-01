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
  const outcomeMap = new Map(outcomes.map((item) => [item.code, item.id]));

  const essayOutcomeCodes = ['G1.1', 'G1.2', 'G2.1', 'G2.2', 'G3.1'];

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
      learningOutcomeCode: 'G1.1',
      difficulty: 'EASY',
    },
    {
      type: 'ESSAY',
      content: 'Describe the three main phases of a penetration test.',
      answer:
        'The three main phases are: 1) Reconnaissance (information gathering), 2) Exploitation (finding and exploiting vulnerabilities), 3) Reporting (documenting findings and recommendations).',
      options: null,
      learningOutcomeCode: 'G2.1',
      difficulty: 'MEDIUM',
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
      learningOutcomeCode: 'G2.2',
      difficulty: 'HARD',
    },
    {
      type: 'ESSAY',
      content: 'Design an incident response plan for ransomware in a university network.',
      answer: 'A complete answer should include detection, isolation, communication, backup restoration, forensics, and lessons learned.',
      options: null,
      learningOutcomeCode: 'G3.1',
      difficulty: 'HARD',
    },
    {
      type: 'ESSAY',
      content: 'Explain why multi-factor authentication is more secure than password-only authentication in a networked environment.',
      answer: 'A complete answer should explain that MFA combines independent factors, reduces the impact of stolen passwords, and adds resistance to phishing and credential reuse attacks.',
      options: null,
      learningOutcomeCode: 'G1.2',
      difficulty: 'EASY',
    },
    {
      type: 'ESSAY',
      content: 'Discuss the role of network segmentation in reducing the impact of malware outbreaks.',
      answer: 'A complete answer should describe how segmentation limits lateral movement, isolates critical systems, supports least privilege, and makes containment and monitoring easier.',
      options: null,
      learningOutcomeCode: 'G2.2',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ESSAY',
      content: 'Describe the security risks of using public Wi-Fi and present practical ways to mitigate them.',
      answer: 'A complete answer should mention eavesdropping, rogue access points, session hijacking, and recommend VPN use, HTTPS, disabling auto-join, and avoiding sensitive transactions on untrusted networks.',
      options: null,
      learningOutcomeCode: 'G2.1',
      difficulty: 'EASY',
    },
    {
      type: 'ESSAY',
      content: 'Explain how access control lists and firewall rules work together to protect internal network resources.',
      answer: 'A complete answer should explain that ACLs restrict traffic at specific devices or interfaces while firewall rules enforce broader policy, and both help filter unauthorized access by source, destination, protocol, and port.',
      options: null,
      learningOutcomeCode: 'G1.2',
      difficulty: 'MEDIUM',
    },
    {
      type: 'ESSAY',
      content: 'Compare symmetric encryption and hashing, and explain when each should be used in network security.',
      answer: 'A complete answer should distinguish reversible encryption from one-way hashing, then note that encryption protects confidentiality while hashing supports integrity checks, password storage, and message verification.',
      options: null,
      learningOutcomeCode: 'G1.1',
      difficulty: 'EASY',
    },
    {
      type: 'ESSAY',
      content: 'Propose a secure policy for managing remote access for employees in a company network.',
      answer: 'A complete answer should include VPN or zero-trust access, strong authentication, device compliance checks, least privilege, logging, and periodic review of access rights.',
      options: null,
      learningOutcomeCode: 'G2.2',
      difficulty: 'HARD',
    },
  ];

  const additionalEssayQuestions: Array<{
    content: string;
    answer: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    learningOutcomeCode: string;
  }> = [
    {
      content: 'Explain the purpose of network security policies in an organization.',
      answer: 'A complete answer should explain that policies define acceptable use, roles, enforcement expectations, and provide a baseline for consistent protection of systems and data.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G1.1',
    },
    {
      content: 'Describe how strong password policies contribute to network security.',
      answer: 'A complete answer should mention password length, complexity, reuse prevention, periodic review, and how these reduce the chance of unauthorized access.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G1.2',
    },
    {
      content: 'Explain the difference between confidentiality, integrity, and availability.',
      answer: 'A complete answer should define confidentiality as preventing unauthorized disclosure, integrity as preventing unauthorized alteration, and availability as ensuring systems and data remain accessible when needed.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G1.1',
    },
    {
      content: 'Discuss why keeping network devices updated is important for security.',
      answer: 'A complete answer should explain that updates patch known vulnerabilities, improve stability, and reduce the attack surface available to adversaries.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G2.1',
    },
    {
      content: 'Explain the role of authentication in preventing unauthorized access.',
      answer: 'A complete answer should describe how authentication verifies identity before access is granted and helps stop attackers from impersonating legitimate users.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G1.2',
    },
    {
      content: 'Describe what a security incident is and give one example.',
      answer: 'A complete answer should define a security incident as an event that threatens confidentiality, integrity, or availability, and give an example such as malware infection or unauthorized login.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G3.1',
    },
    {
      content: 'Explain how least privilege improves network security.',
      answer: 'A complete answer should describe limiting each user or service to only the permissions required, reducing damage from mistakes and compromised accounts.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G1.2',
    },
    {
      content: 'Describe how logging helps administrators detect suspicious network activity.',
      answer: 'A complete answer should explain that logs provide evidence of access, errors, and unusual patterns, helping teams investigate incidents and identify threats faster.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G3.1',
    },
    {
      content: 'Explain why encryption is useful when transmitting sensitive information over a network.',
      answer: 'A complete answer should state that encryption prevents attackers from reading intercepted data and protects confidentiality during transmission.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G1.1',
    },
    {
      content: 'Describe one common way attackers exploit weak network authentication.',
      answer: 'A complete answer should explain attacks such as brute force, password spraying, or credential stuffing and why weak authentication makes them effective.',
      difficulty: 'EASY',
      learningOutcomeCode: 'G2.1',
    },
    {
      content: 'Analyze how a defense-in-depth strategy reduces the impact of a single security failure.',
      answer: 'A complete answer should explain that multiple layers of controls slow attackers, create backup barriers, and limit damage when one control fails.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G2.2',
    },
    {
      content: 'Discuss the benefits and limitations of using antivirus software in a networked environment.',
      answer: 'A complete answer should note that antivirus can detect known malware and reduce risk, but it cannot catch every attack and must be combined with other controls.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G2.1',
    },
    {
      content: 'Explain how a VPN protects remote communication between users and a company network.',
      answer: 'A complete answer should mention encrypted tunnels, protection on untrusted networks, and how VPNs help secure traffic while users are offsite.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G1.1',
    },
    {
      content: 'Describe how access reviews help maintain security in large organizations.',
      answer: 'A complete answer should explain that access reviews verify permissions remain appropriate, remove excessive rights, and reduce risk from outdated accounts.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G1.2',
    },
    {
      content: 'Explain how threat intelligence can support faster incident detection and response.',
      answer: 'A complete answer should describe using known indicators, attacker patterns, and external reporting to improve detection and guide containment decisions.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G3.1',
    },
    {
      content: 'Compare centralized authentication with local authentication in a network environment.',
      answer: 'A complete answer should describe how centralized authentication simplifies control, auditing, and account management, while local authentication is harder to manage at scale.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G1.2',
    },
    {
      content: 'Discuss the role of secure configuration baselines for servers and workstations.',
      answer: 'A complete answer should explain that baselines reduce unnecessary services, standardize protections, and make deviations easier to detect and correct.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G2.2',
    },
    {
      content: 'Explain why segmentation between user networks and server networks is important.',
      answer: 'A complete answer should describe how separation reduces lateral movement, protects critical assets, and allows different security controls for different zones.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G2.2',
    },
    {
      content: 'Describe how security awareness training can reduce the success of phishing attacks.',
      answer: 'A complete answer should explain that training helps users recognize suspicious messages, verify requests, and avoid unsafe clicks or credential submission.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G3.1',
    },
    {
      content: 'Analyze the security implications of allowing bring-your-own-device access to internal systems.',
      answer: 'A complete answer should discuss unmanaged devices, data leakage, inconsistent patching, and the need for device posture checks and access restrictions.',
      difficulty: 'MEDIUM',
      learningOutcomeCode: 'G2.1',
    },
    {
      content: 'Propose an effective incident containment strategy after detecting malware on one workstation.',
      answer: 'A complete answer should include isolating the infected host, preserving evidence, identifying spread, revoking suspicious access, and monitoring nearby systems.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G3.1',
    },
    {
      content: 'Evaluate how zero trust architecture changes the way access decisions are made.',
      answer: 'A complete answer should explain continuous verification, context-aware access, and minimizing implicit trust between users, devices, and resources.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G2.2',
    },
    {
      content: 'Design a secure response process for handling a suspected data breach in a networked system.',
      answer: 'A complete answer should include detection, escalation, isolation, evidence collection, communication, recovery, and post-incident review.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G3.1',
    },
    {
      content: 'Explain how attackers can bypass weak segmentation and why layered controls are still necessary.',
      answer: 'A complete answer should mention pivoting through allowed paths, exploiting misconfigurations, and the need for authentication, monitoring, and strict policy enforcement.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G2.1',
    },
    {
      content: 'Assess the risks of storing sensitive credentials in plain text within internal applications.',
      answer: 'A complete answer should explain that plain text storage exposes credentials to anyone who gains access, increases compromise impact, and should be replaced with hashing or secure secret storage.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G1.1',
    },
    {
      content: 'Propose a full recovery plan after a ransomware attack on a small enterprise network.',
      answer: 'A complete answer should cover system isolation, backup validation, restoration order, credential resets, communication, and lessons learned to prevent recurrence.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G3.1',
    },
    {
      content: 'Discuss how a security operations team can prioritize alerts during a large-scale incident.',
      answer: 'A complete answer should explain triage by severity, asset criticality, confidence, and blast radius, while coordinating investigation and containment efforts.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G3.1',
    },
    {
      content: 'Analyze why role-based access control is easier to govern than ad hoc permission assignment.',
      answer: 'A complete answer should describe how roles standardize permissions, simplify audits, reduce privilege sprawl, and make administrative review easier.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G1.2',
    },
    {
      content: 'Evaluate the security trade-offs of allowing external access to internal services over the internet.',
      answer: 'A complete answer should discuss convenience versus exposure, the need for strong authentication, network filtering, monitoring, and minimizing publicly reachable services.',
      difficulty: 'HARD',
      learningOutcomeCode: 'G2.2',
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
        data: {
          subjectId: subject.id,
          type: q.type,
          content: q.content,
          answer: q.answer,
          options: q.options,
          difficulty: q.difficulty ?? 'MEDIUM',
          learningOutcomeId: q.type === 'ESSAY' ? outcomeMap.get(q.learningOutcomeCode || '') ?? null : outcomes[0]?.id ?? null,
          rubric: q.type === 'ESSAY' ? null : undefined,
          status: 'ACTIVE',
        },
      });
    }
  }
  console.log(`✅ Created ${sampleQuestions.length} sample questions`);

  const essayQuestionsToCreate = additionalEssayQuestions;

  for (const [index, essay] of essayQuestionsToCreate.entries()) {
    const existing = await prisma.question.findFirst({
      where: {
        subjectId: subject.id,
        content: essay.content,
      },
    });

    if (existing) continue;

    await prisma.question.create({
      data: {
        subjectId: subject.id,
        type: 'ESSAY',
        content: essay.content,
        answer: essay.answer,
        options: null,
        status: 'ACTIVE',
        difficulty: essay.difficulty,
        learningOutcomeId: outcomeMap.get(essay.learningOutcomeCode) ?? null,
        rubric: `Assess against ${essay.learningOutcomeCode}.`,
      },
    });
  }

  console.log(`✅ Added ${essayQuestionsToCreate.length} additional essay questions`);

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
      difficulty: 'EASY' | 'MEDIUM' | 'HARD';
      learningOutcomeId: number | null;
      rubric: string | null;
      status: 'ACTIVE';
    }> = [];

    for (let i = 0; i < toCreate; i++) {
      const outcome = outcomes[i % outcomes.length];
      const difficulty = i % 10 < 5 ? 'EASY' : i % 10 < 9 ? 'MEDIUM' : 'HARD';

      if (i % 2 === 0) {
        generatedQuestions.push({
          subjectId: subject.id,
          type: 'MULTIPLE_CHOICE',
          content: `MCQ ${i + 1}: Which control is the best fit for scenario ${i + 1}?`,
          answer: 'B',
          options: JSON.stringify([
            `Distractor for scenario ${i + 1} - A`,
            `Recommended control for scenario ${i + 1}`,
            `Partially correct control for scenario ${i + 1}`,
            `Irrelevant control for scenario ${i + 1}`,
          ]),
          difficulty,
          learningOutcomeId: outcome?.id ?? null,
          rubric: null,
          status: 'ACTIVE',
        });
      } else {
        generatedQuestions.push({
          subjectId: subject.id,
          type: 'ESSAY',
          content: `Essay ${i + 1}: Analyze a security incident and propose mitigation strategy ${i + 1}.`,
          answer: 'A complete answer should explain root cause, impact, mitigation steps, and verification plan.',
          options: null,
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
