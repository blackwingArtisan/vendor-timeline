/** What "Ask about this contract" returns. No server imports, so the page can use it too. */
export const MAX_QUESTION_CHARS = 300;
/** Shorter than this, a "quote" (one word, a name) proves nothing about the answer. */
export const MIN_QUOTE_CHARS = 20;
export const NOT_FOUND = "Couldn't find that in the contract";

export type QuestionResult =
  | { found: true; question: string; answer: string; quote: string; section: string; by: string; live: boolean }
  | { found: false; question: string; message: string; reason: "not_stated" | "quote_not_in_contract" | "quote_too_short" | "invented_term"; by: string; live: boolean };
