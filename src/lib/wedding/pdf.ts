/** Pulls the words out of a contract PDF. They go in the same box as a paste, then the same read. */
import { extractText, getDocumentProxy } from "unpdf";
import { HttpError } from "@/lib/http";

export const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MIN_CHARS = 40;

export const NO_TEXT = "This PDF has no text to read, which usually means it's a scan or a photo. Paste the words in, or enter the terms yourself.";

export async function pdfText(bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_PDF_BYTES) throw new HttpError(413, "That PDF is over 5 MB. Paste the text in instead.", "pdf_too_big");
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new HttpError(422, "That file isn't a PDF.", "pdf_invalid");
  let text: string;
  try {
    const document = await getDocumentProxy(bytes);
    ({ text } = await extractText(document, { mergePages: true }));
  } catch (e) {
    if ((e as Error).name === "PasswordException") throw new HttpError(422, "This PDF has a password, so it can't be read. Paste the words in, or enter the terms yourself.", "pdf_password");
    throw new HttpError(422, "This PDF wouldn't open. Paste the words in, or enter the terms yourself.", "pdf_invalid");
  }
  const clean = text.trim();
  if (clean.length < MIN_CHARS) throw new HttpError(422, NO_TEXT, "pdf_no_text");
  return clean;
}
