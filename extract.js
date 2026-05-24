import fs from 'fs';
import readline from 'readline';
import path from 'path';

const logPath = 'C:\\Users\\swati\\.gemini\\antigravity\\brain\\689f2bd3-5790-4351-aaa8-d9462534bbba\\.system_generated\\logs\\transcript.jsonl';
const outputDir = 'e:\\Recordings IIT Roorkee\\Cohort A\\New folder\\finstream-ai-swats-main\\original_files';

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function extractFiles() {
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const viewedFiles = {};

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const step = JSON.parse(line);
      if (step.type === 'VIEW_FILE' && step.status === 'DONE') {
        const content = step.content;
        
        let filePath = '';
        if (content.includes('File Path:')) {
          const match = content.match(/File Path:\s*`file:\/\/\/(.+?)`/);
          if (match) {
            filePath = match[1].replace(/%20/g, ' ');
          }
        }
        
        if (filePath) {
          console.log(`Found viewed file in logs: ${filePath}`);
          if (!viewedFiles[filePath]) {
            viewedFiles[filePath] = [];
          }
          viewedFiles[filePath].push({
            step_index: step.step_index,
            content: content
          });
        }
      }
    } catch (e) {
      // Ignore JSON parsing errors
    }
  }

  console.log('\n--- EXTRACTING FILES ---');
  for (const [filePath, versions] of Object.entries(viewedFiles)) {
    // Sort by step index ascending to find the earliest version (original state)
    versions.sort((a, b) => a.step_index - b.step_index);
    const original = versions[0];
    console.log(`Path: ${filePath} (Earliest version step_index: ${original.step_index})`);
    
    const lines = original.content.split('\n');
    let codeLines = [];
    let insideCode = false;
    
    for (const line of lines) {
      if (line.includes('The following code has been modified') || line.includes('Showing lines')) {
        insideCode = true;
        continue;
      }
      if (line.includes('The above content shows the entire')) {
        insideCode = false;
        continue;
      }
      if (insideCode) {
        // Strip line number prefix like "12: " or "123: "
        const cleanLine = line.replace(/^\d+:\s?/, '');
        codeLines.push(cleanLine);
      }
    }
    
    const finalCode = codeLines.join('\n');
    const cleanPath = filePath.replace(/e:\/Recordings IIT Roorkee\/Cohort A\/New folder\/finstream-ai-swats-main\//i, '').replace(/[\/:]/g, '_');
    const outPath = path.join(outputDir, `original_${cleanPath}`);
    fs.writeFileSync(outPath, finalCode);
    console.log(`Saved original to: ${outPath}\n`);
  }
}

extractFiles().catch(console.error);
