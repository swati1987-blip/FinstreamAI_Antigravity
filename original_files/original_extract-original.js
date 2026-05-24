import fs from 'fs';
import readline from 'readline';

const logPath = 'C:\\Users\\swati\\.gemini\\antigravity\\brain\\689f2bd3-5790-4351-aaa8-d9462534bbba\\.system_generated\\logs\\transcript.jsonl';

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
      // Look for VIEW_FILE step types
      if (step.type === 'VIEW_FILE' && step.status === 'DONE') {
        const content = step.content;
        const toolCalls = step.tool_calls || [];
        
        // Find the absolute path from the previous model step or the message metadata
        let path = '';
        if (content.includes('File Path:')) {
          const match = content.match(/File Path:\s*`file:\/\/\/(.+?)`/);
          if (match) {
            path = match[1].replace(/%20/g, ' ');
          }
        }
        
        if (path) {
          console.log(`Found viewed file in logs: ${path}`);
          if (!viewedFiles[path]) {
            viewedFiles[path] = [];
          }
          viewedFiles[path].push({
            step_index: step.step_index,
            content: content
          });
        }
      }
    } catch (e) {
      // Ignore JSON parsing errors
    }
  }

  // Print summary of viewed files and write their earliest seen content to files
  console.log('\n--- EXTRACTED FILES SUMMARY ---');
  for (const [path, versions] of Object.entries(viewedFiles)) {
    // Sort by step index ascending to find the earliest version (original state)
    versions.sort((a, b) => a.step_index - b.step_index);
    const original = versions[0];
    console.log(`Path: ${path} (Available versions: ${versions.length})`);
    console.log(`Earliest version step_index: ${original.step_index}`);
    
    const lines = original.content.split('\n');
    let codeLines = [];
    let insideCode = false;
    
    for (const line of lines) {
        insideCode = true;
        continue;
      }