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
const SUPABASE_KEY = envConfig.SUPABASE_PUBLISHABLE_KEY || envConfig.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkDatabase() {
  console.log("1. Fetching single row keys from 'expenses'...");
  const { data: expData, error: expError } = await supabase
    .from('expenses')
    .select('*')
    .limit(1);
    
  if (expError) {
    console.error("Expenses query failed:", expError);
  } else {
    console.log("Expenses query succeeded. Row keys present:", expData.length > 0 ? Object.keys(expData[0]) : "(empty table)");
  }

  console.log("\n2. Checking if 'transaction_rules_memory' table exists...");
  const { data: rulesData, error: rulesError } = await supabase
    .from('transaction_rules_memory')
    .select('*')
    .limit(1);
    
  if (rulesError) {
    console.error("Rules table check failed:", rulesError);
  } else {
    console.log("Rules table exists! Row keys:", rulesData.length > 0 ? Object.keys(rulesData[0]) : "(empty table)");
  }
}

checkDatabase();
