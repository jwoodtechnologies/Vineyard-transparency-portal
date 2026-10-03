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

  it('answers what is being built from the city construction updates', () => {
    for (const q of ['What construction is happening in Vineyard?', 'Are there any road closures right now?', 'when is the chip seal', 'Is Center Street closed?', 'what is the pavement preservation schedule', 'Any construction updates?']) {
      expect(serviceAnswer(q)?.text, q).toMatch(/August 21, 2026/);
    }
  });

  it('leaves everything else to the records', () => {
    for (const q of ['What are the construction permit fees?', 'What is the status of the 1200 North overpass construction?', 'Who is the contractor for the skate park?', 'construction standards for roads', 'How do I apply for a construction job?', 'What construction codes does Vineyard use?', 'How much is the library card fee reimbursement?', 'What did the council vote on the library budget?', 'Who is on the library board?', 'What is the budget for 2027?']) {
      expect(serviceAnswer(q), q).toBeNull();
    }
  });
});
