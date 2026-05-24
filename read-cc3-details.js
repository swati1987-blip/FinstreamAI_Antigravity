import fs from "fs";
import path from "path";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";

const pdfPath = "e:\\Recordings IIT Roorkee\\Cohort A\\New folder\\CC Statement 3.pdf";
const outPath = "e:\\Recordings IIT Roorkee\\Cohort A\\New folder\\finstream-ai-swats-main\\cc3_text.txt";

async function extractText() {
  if (!fs.existsSync(pdfPath)) {
    fs.writeFileSync(outPath, `File not found: ${pdfPath}`);
    return;
  }
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map(item => ("str" in item ? item.str : ""))
      .join(" ");
    text += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  fs.writeFileSync(outPath, text);
  console.log("Text successfully extracted to cc3_text.txt");
}

extractText().catch(err => {
  fs.writeFileSync(outPath, `Error: ${err.message}\n${err.stack}`);
});
