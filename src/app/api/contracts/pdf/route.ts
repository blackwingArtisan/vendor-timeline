import { HttpError, route } from "@/lib/http";
import { MAX_PDF_BYTES, pdfText } from "@/lib/wedding/pdf";

/** Only turns a PDF into text. The read itself stays one step, one AI call, on /api/contracts. */
export const POST = route(async (req) => {
  if (Number(req.headers.get("content-length")) > MAX_PDF_BYTES + 1024) throw new HttpError(413, "That PDF is over 5 MB. Paste the text in instead.", "pdf_too_big");
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a PDF to upload.", "validation");
  return { text: await pdfText(new Uint8Array(await file.arrayBuffer())), fileName: file.name.slice(0, 200) };
});
