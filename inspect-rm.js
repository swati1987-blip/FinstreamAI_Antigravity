import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const dir = "e:\\Recordings IIT Roorkee\\Cohort A\\New folder";
const files = ["RM_1.pdf", "RM_2.pdf", "RM_3.pdf"];

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
        const buffer = fs.readFileSync(p);
        const hash = crypto.createHash("md5").update(buffer).digest("hex").toLowerCase();
        console.log(`\n=================== ${f} ===================`);
        console.log(`MD5 Hash: ${hash}`);
        const text = await extractText(p);
        console.log("Text Content:");
        console.log(text.slice(0, 3000)); // Print first 3000 chars
      } catch (err) {
        console.error(`Error reading ${f}:`, err);
      }
    } else {
      console.log(`File not found: ${f}`);
    }
  }
}

main().catch(console.error);
