import fs from "fs";
import path from "path";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";

const dir = "e:\\Recordings IIT Roorkee\\Cohort A\\New folder";
const files = [
  "CN KUMARAM.pdf",
  "New Doc 04-16-2026 14.07.pdf",
  "CC statement.pdf",
  "CC One statement.pdf",
  "CC Statement 2.pdf",
  "CC Statement 3.pdf"
];

async function extractText(pdfPath) {
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
  return text;
}

async function main() {
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) {
      try {
        console.log(`\n=================== ${f} ===================`);
        const text = await extractText(p);
        console.log(text.slice(0, 1500)); // Print first 1500 chars
      } catch (err) {
        console.error(`Error reading ${f}:`, err);
      }
    } else {
      console.log(`File not found: ${f}`);
    }
  }
}

main().catch(console.error);
