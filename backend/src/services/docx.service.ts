import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  NumberFormat,
} from 'docx';

interface Question {
  id: number;
  type: string;
  content: string;
  answer: string;
  options: string | null;
}

export const generateExamDocx = async (
  examTitle: string,
  subjectName: string,
  teacherName: string,
  questions: Question[]
): Promise<Buffer> => {
  const children: Paragraph[] = [];

  // Header
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'UNIVERSITY EXAMINATION',
          bold: true,
          size: 28,
          color: '1D4ED8',
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: examTitle,
          bold: true,
          size: 32,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Subject: ${subjectName}`,
          size: 24,
          italics: true,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Teacher: ${teacherName}  |  Date: ${new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}`,
          size: 22,
        }),
      ],
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: '─'.repeat(80),
          color: '1D4ED8',
        }),
      ],
      spacing: { after: 200 },
    })
  );

  // Student info section
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Full Name: ', bold: true, size: 22 }),
        new TextRun({ text: '_'.repeat(40), size: 22 }),
        new TextRun({ text: '     Student ID: ', bold: true, size: 22 }),
        new TextRun({ text: '_'.repeat(15), size: 22 }),
      ],
      spacing: { after: 300 },
    })
  );

  // Group questions by type
  const mcQuestions = questions.filter((q) => q.type === 'MULTIPLE_CHOICE');
  const tfQuestions = questions.filter((q) => q.type === 'TRUE_FALSE');
  const essayQuestions = questions.filter((q) => q.type === 'ESSAY');

  let questionNumber = 1;

  // Section I: Multiple Choice
  if (mcQuestions.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({
            text: `SECTION I: MULTIPLE CHOICE (${mcQuestions.length} questions)`,
            bold: true,
            size: 24,
            color: '1D4ED8',
          }),
        ],
        spacing: { before: 200, after: 200 },
      })
    );

    for (const q of mcQuestions) {
      const opts: string[] = q.options ? JSON.parse(q.options) : [];

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${questionNumber}. `, bold: true, size: 22 }),
            new TextRun({ text: q.content, size: 22 }),
          ],
          spacing: { before: 150, after: 80 },
        })
      );

      const labels = ['A', 'B', 'C', 'D', 'E'];
      opts.forEach((opt, i) => {
        children.push(
          new Paragraph({
            indent: { left: 360 },
            children: [
              new TextRun({ text: `${labels[i]}. ${opt}`, size: 22 }),
            ],
            spacing: { after: 40 },
          })
        );
      });

      children.push(new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 80 } }));
      questionNumber++;
    }
  }

  // Section II: True/False
  if (tfQuestions.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({
            text: `SECTION II: TRUE / FALSE (${tfQuestions.length} questions)`,
            bold: true,
            size: 24,
            color: '1D4ED8',
          }),
        ],
        spacing: { before: 300, after: 200 },
      })
    );

    for (const q of tfQuestions) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${questionNumber}. `, bold: true, size: 22 }),
            new TextRun({ text: q.content, size: 22 }),
            new TextRun({ text: '     [ True ]   [ False ]', size: 22, italics: true }),
          ],
          spacing: { before: 120, after: 120 },
        })
      );
      questionNumber++;
    }
  }

  // Section III: Essay
  if (essayQuestions.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({
            text: `SECTION III: ESSAY (${essayQuestions.length} questions)`,
            bold: true,
            size: 24,
            color: '1D4ED8',
          }),
        ],
        spacing: { before: 300, after: 200 },
      })
    );

    for (const q of essayQuestions) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${questionNumber}. `, bold: true, size: 22 }),
            new TextRun({ text: q.content, size: 22 }),
          ],
          spacing: { before: 150, after: 80 },
        })
      );

      // Answer lines
      for (let i = 0; i < 5; i++) {
        children.push(
          new Paragraph({
            indent: { left: 360 },
            children: [new TextRun({ text: '_'.repeat(90), size: 20, color: 'AAAAAA' })],
            spacing: { after: 60 },
          })
        );
      }
      questionNumber++;
    }
  }

  // Footer separator
  children.push(
    new Paragraph({
      children: [new TextRun({ text: '─'.repeat(80), color: '1D4ED8' })],
      spacing: { before: 400, after: 100 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Total Questions: ${questions.length}  |  Generated by NT208 Attendance System`,
          size: 18,
          italics: true,
          color: '888888',
        }),
      ],
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
};
