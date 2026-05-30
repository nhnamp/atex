const XLSX = require('xlsx');
const fs = require('fs');

const wb = XLSX.utils.book_new();

const mcqData = [
  {
    'Question Type': 'MULTIPLE_CHOICE',
    'Question Content': 'What is the capital of France?',
    'Correct Answer': 'Paris',
    'Options (A|B|C|D)': 'London|Paris|Berlin|Rome',
    'Difficulty': 'EASY',
    'Learning Outcome Code': ''
  },
  {
    'Question Type': 'MULTIPLE_CHOICE',
    'Question Content': '2 + 2 = ?',
    'Correct Answer': '4',
    'Options (A|B|C|D)': '3|4|5|6',
    'Difficulty': 'EASY',
    'Learning Outcome Code': ''
  },
  {
    'Question Type': 'MULTIPLE_CHOICE',
    'Question Content': 'Which gas do plants primarily absorb?',
    'Correct Answer': 'Carbon Dioxide',
    'Options (A|B|C|D)': 'Oxygen|Nitrogen|Carbon Dioxide|Hydrogen',
    'Difficulty': 'MEDIUM',
    'Learning Outcome Code': ''
  },
  {
    'Question Type': 'MULTIPLE_CHOICE',
    'Question Content': 'HTML stands for?',
    'Correct Answer': 'HyperText Markup Language',
    'Options (A|B|C|D)': 'HyperText Markdown Lang|HyperText Markup Language|Home Tool Markup Lang|Hyperlink Text Markup',
    'Difficulty': 'MEDIUM',
    'Learning Outcome Code': ''
  },
  {
    'Question Type': 'MULTIPLE_CHOICE',
    'Question Content': 'Which planet is known as the Red Planet?',
    'Correct Answer': 'Mars',
    'Options (A|B|C|D)': 'Venus|Mars|Jupiter|Saturn',
    'Difficulty': 'EASY',
    'Learning Outcome Code': ''
  },
  {
    'Question Type': 'MULTIPLE_CHOICE',
    'Question Content': 'Select the largest ocean on Earth.',
    'Correct Answer': 'Pacific Ocean',
    'Options (A|B|C|D)': 'Atlantic Ocean|Indian Ocean|Arctic Ocean|Pacific Ocean',
    'Difficulty': 'MEDIUM',
    'Learning Outcome Code': ''
  }
];

const essayData = [
  {
    'Question Type': 'ESSAY',
    'Question Content': 'Describe the causes of World War II.',
    'Correct Answer': '[Model answer: Political tensions, alliances, economic conditions, invasion of Poland, etc.]',
    'Difficulty': 'HARD',
    'Learning Outcome Code': ''
  },
  {
    'Question Type': 'ESSAY',
    'Question Content': 'Explain how photosynthesis works in plants.',
    'Correct Answer': '[Model answer: Light-dependent reactions, Calvin cycle, role of chlorophyll, inputs and outputs]',
    'Difficulty': 'MEDIUM',
    'Learning Outcome Code': ''
  },
  {
    'Question Type': 'ESSAY',
    'Question Content': 'Discuss the principles of Object-Oriented Programming.',
    'Correct Answer': '[Model answer: Encapsulation, Inheritance, Polymorphism, Abstraction]',
    'Difficulty': 'MEDIUM',
    'Learning Outcome Code': ''
  },
  {
    'Question Type': 'ESSAY',
    'Question Content': 'Write an essay on the importance of data privacy.',
    'Correct Answer': '[Model answer: risks, regulations, best practices, user rights]',
    'Difficulty': 'MEDIUM',
    'Learning Outcome Code': ''
  }
];

const mcqSheet = XLSX.utils.json_to_sheet(mcqData);
mcqSheet['!cols'] = [{wch:25},{wch:60},{wch:30},{wch:50},{wch:15},{wch:25}];
const essaySheet = XLSX.utils.json_to_sheet(essayData);
essaySheet['!cols'] = [{wch:25},{wch:80},{wch:60},{wch:15},{wch:25}];

XLSX.utils.book_append_sheet(wb, mcqSheet, 'MCQ');
XLSX.utils.book_append_sheet(wb, essaySheet, 'Essay');

const outPath = './template/question-import-sample.xlsx';
XLSX.writeFile(wb, outPath);
console.log('Wrote', outPath);
