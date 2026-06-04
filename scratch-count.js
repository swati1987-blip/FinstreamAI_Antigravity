import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Read .env file manually
const envContent = fs.readFileSync('.env', 'utf8');
const envConfig = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    let value = parts.slice(1).join('=').trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    envConfig[key] = value;
  }
});

const SUPABASE_URL = envConfig.SUPABASE_URL || envConfig.VITE_SUPABASE_URL;
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY || envConfig.VITE_SUPABASE_SERVICE_ROLE_KEY || envConfig.SUPABASE_PUBLISHABLE_KEY || envConfig.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log("Analyzing expenses table...");
  const { data: expenses, error } = await supabase
    .from('expenses')
    .select('id, vendor, amount, date, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching expenses:', error);
    return;
  }

  console.log(`Total rows in database: ${expenses.length}`);
  
  // Group by vendor and amount and date to find exact duplicates
  const groups = {};
  expenses.forEach(e => {
    const key = `${e.vendor.toLowerCase().trim()}_${e.amount}_${e.date}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  let duplicateCount = 0;
  const duplicateKeys = [];
  Object.entries(groups).forEach(([key, items]) => {
    if (items.length > 1) {
      duplicateCount += (items.length - 1);
      duplicateKeys.push({ key, count: items.length });
    }
  });

  console.log(`Potential duplicate transactions (same vendor, amount, date): ${duplicateCount}`);
  console.log("Top duplicates:");
  duplicateKeys.slice(0, 10).forEach(dk => {
    console.log(`  Key: ${dk.key} | Count: ${dk.count}`);
  });
}

run();
