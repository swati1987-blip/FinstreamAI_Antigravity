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

async function run() {
  console.log("Checking active rules inside transaction_rules_memory...");
  const { data: rules, error } = await supabase
    .from('transaction_rules_memory')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching rules:', error);
  } else {
    console.log(`Fetched ${rules.length} rules:`);
    rules.forEach((r) => {
      console.log(`ID: ${r.id} | Vendor: ${r.vendor_pattern} | Amount: ${r.amount} | Desc: ${r.description} | Order: ${r.description_order} | Cat: ${r.main_category} | Entity: ${r.company_entity} | ExpCat: ${r.expense_category}`);
    });
  }
}

run();
