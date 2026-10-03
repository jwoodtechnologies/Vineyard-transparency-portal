import { describe, expect, it } from 'vitest';
import { serviceAnswer } from '../worker/ai/serviceAnswers';

describe('service answers', () => {
  it('answers library card questions', () => {
    for (const q of ['How do I get a library card?', 'where can i sign up for a library card', 'library card', 'Can I register for the library?', 'I need a card for the library']) {
      expect(serviceAnswer(q)?.text, q).toMatch(/library card online/i);
    }
  });

  it('answers bookmobile questions', () => {
    for (const q of ['Is there a bookmobile?', 'when does the book mobile come to vineyard', 'bookmobile schedule']) {
      expect(serviceAnswer(q)?.text, q).toMatch(/Utah State Library/);
    }
  });

  it('leaves everything else to the records', () => {
    for (const q of ['How much is the library card fee reimbursement?', 'What did the council vote on the library budget?', 'Who is on the library board?', 'What is the budget for 2027?']) {
      expect(serviceAnswer(q), q).toBeNull();
    }
  });
});
