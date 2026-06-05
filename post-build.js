import fs from 'node:fs';
import path from 'node:path';

try {
  const filePath = path.resolve('dist/server/wrangler.json');
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // Remove empty triggers object to prevent Wrangler validation failures (Expected "triggers" to be of type object, containing only properties crons, but got {})
    if (data.triggers && typeof data.triggers === 'object' && Object.keys(data.triggers).length === 0) {
      delete data.triggers;
      console.log('[Post-Build] Successfully removed empty triggers block from wrangler.json');
    }

    // Resolve LOVABLE_API_KEY from environment or local .env
    let apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      const envPath = path.resolve('.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/^LOVABLE_API_KEY=["']?([^"'\r\n]+)["']?/m);
        if (match) {
          apiKey = match[1];
        }
      }
    }

    if (apiKey) {
      if (!data.vars) data.vars = {};
      data.vars.LOVABLE_API_KEY = apiKey;
      console.log('[Post-Build] Successfully injected LOVABLE_API_KEY into wrangler.json vars');
    } else {
      console.warn('[Post-Build] LOVABLE_API_KEY not found in environment or .env');
    }
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } else {
    console.warn('[Post-Build] wrangler.json not found at:', filePath);
  }
} catch (error) {
  console.error('[Post-Build] Failed to post-process wrangler.json:', error);
}
