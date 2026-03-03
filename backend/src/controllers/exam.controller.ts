import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { selectQuestionsWithAI } from '../services/gemini.service';
import { generateExamDocx } from '../services/docx.service';

const prisma = new PrismaClient();

export const generateExam = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subjectId, examTitle, requirements } = req.body as {
      subjectId: number;
      examTitle: string;
      requirements: {
        total: number;
        multipleChoice: number;
        essay: number;
        trueFalse: number;
      };
    };

    if (!subjectId || !requirements) {
      res.status(400).json({ error: 'subjectId and requirements are required' });
      return;
    }

    const { total, multipleChoice, essay, trueFalse } = requirements;
    if (multipleChoice + essay + trueFalse !== total) {
      res.status(400).json({ error: 'Sum of question types must equal total' });
      return;
    }

    // Verify subject ownership
    const subject = await prisma.subject.findUnique({ where: { id: Number(subjectId) } });
    if (!subject || subject.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    // Fetch all questions for this subject
    const allQuestions = await prisma.question.findMany({
      where: { subjectId: Number(subjectId) },
    });

    if (allQuestions.length < total) {
      res.status(400).json({
        error: `Not enough questions in the bank. You need ${total} but only have ${allQuestions.length}.`,
      });
      return;
    }

    // Check availability per type
    const mcQuestions = allQuestions.filter((q) => q.type === 'MULTIPLE_CHOICE');
    const essayQuestions = allQuestions.filter((q) => q.type === 'ESSAY');
    const tfQuestions = allQuestions.filter((q) => q.type === 'TRUE_FALSE');

    if (mcQuestions.length < multipleChoice) {
      res.status(400).json({ error: `Not enough multiple choice questions (need ${multipleChoice}, have ${mcQuestions.length})` });
      return;
    }
    if (essayQuestions.length < essay) {
      res.status(400).json({ error: `Not enough essay questions (need ${essay}, have ${essayQuestions.length})` });
      return;
    }
    if (tfQuestions.length < trueFalse) {
      res.status(400).json({ error: `Not enough true/false questions (need ${trueFalse}, have ${tfQuestions.length})` });
      return;
    }

    // Use AI to select questions
    let selectedQuestions;
    try {
      const selectedIds = await selectQuestionsWithAI(allQuestions, requirements);
      selectedQuestions = allQuestions.filter((q) => selectedIds.includes(q.id));

      // Fallback if AI doesn't return enough
      if (selectedQuestions.length < total) {
        throw new Error('AI returned insufficient questions, using fallback');
      }
    } catch (aiError) {
      console.warn('AI selection failed, using random selection:', aiError);
      // Fallback: random selection
      const shufflePick = <T>(arr: T[], n: number): T[] => {
        return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
      };
      selectedQuestions = [
        ...shufflePick(mcQuestions, multipleChoice),
        ...shufflePick(essayQuestions, essay),
        ...shufflePick(tfQuestions, trueFalse),
      ];
    }

    // Generate Word document
    const docBuffer = await generateExamDocx(
      examTitle || `${subject.name} - Exam`,
      subject.name,
      req.user!.fullName,
      selectedQuestions
    );

    const filename = `exam_${subject.name.replace(/\s+/g, '_')}_${Date.now()}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(docBuffer);
  } catch (error) {
    console.error('Exam generation error:', error);
    res.status(500).json({ error: 'Failed to generate exam' });
  }
};
