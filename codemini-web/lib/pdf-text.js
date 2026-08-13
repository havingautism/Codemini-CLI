export async function extractPdfText(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return String(parsed?.text || '').trim();
  } finally {
    await parser.destroy();
  }
}
