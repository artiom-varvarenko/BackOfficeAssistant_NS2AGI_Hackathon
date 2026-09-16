// PDF text extraction (PLAN.md section 8.2 step 2): one string per page, in
// page order. Anything unpdf/pdf.js cannot parse (corrupt file, a .txt renamed
// to .pdf, ...) surfaces as a thrown error; the ingest layer maps that to the
// Dutch "unreadable" failure.
import { extractText, getDocumentProxy } from 'unpdf';

export interface ExtractedPages {
  pageCount: number;
  pages: string[];
}

export async function extractPages(buffer: Buffer): Promise<ExtractedPages> {
  // pdf.js transfers the bytes to its worker, so it needs its own copy.
  // verbosity 0 = errors only: the seed PDFs trigger harmless font warnings.
  const doc = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
  try {
    const { totalPages, text } = await extractText(doc, { mergePages: false });
    return { pageCount: totalPages, pages: text };
  } finally {
    await doc.loadingTask.destroy();
  }
}
