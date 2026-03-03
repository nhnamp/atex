import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

interface Question {
  id: number;
  type: string;
  content: string;
  answer: string;
  options: string | null;
}

interface Requirements {
  total: number;
  multipleChoice: number;
  essay: number;
  trueFalse: number;
}

export const selectQuestionsWithAI = async (
  questions: Question[],
  requirements: Requirements
): Promise<number[]> => {
  if (!config.geminiApiKey) {
    throw new Error('Gemini API key not configured');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

  const questionList = questions
    .map((q) => {
      const opts = q.options ? JSON.parse(q.options) : null;
      return `ID:${q.id} | Type:${q.type} | ${q.content}${opts ? ` | Options: ${opts.join(', ')}` : ''}`;
    })
    .join('\n');

  const prompt = `You are an intelligent exam generator. 
  
Given the following question bank, select exactly the specified number of questions for each type to create a balanced exam.

QUESTION BANK:
${questionList}

REQUIREMENTS:
- Total questions: ${requirements.total}
- Multiple choice (MULTIPLE_CHOICE): ${requirements.multipleChoice}
- Essay (ESSAY): ${requirements.essay}
- True/False (TRUE_FALSE): ${requirements.trueFalse}

INSTRUCTIONS:
1. Select exactly ${requirements.multipleChoice} MULTIPLE_CHOICE questions
2. Select exactly ${requirements.essay} ESSAY questions  
3. Select exactly ${requirements.trueFalse} TRUE_FALSE questions
4. Choose questions that cover diverse topics
5. Ensure good difficulty balance

Return ONLY a valid JSON object in this exact format (no markdown, no explanation):
{"selectedIds": [1, 5, 3, 7, 2]}

The array must contain exactly ${requirements.total} question IDs.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // Parse JSON response
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned) as { selectedIds: number[] };

  if (!parsed.selectedIds || !Array.isArray(parsed.selectedIds)) {
    throw new Error('Invalid AI response format');
  }

  return parsed.selectedIds;
};
