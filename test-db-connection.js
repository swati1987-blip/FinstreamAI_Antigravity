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

console.log("Supabase URL:", SUPABASE_URL);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkSchema() {
  console.log("Querying public.expenses table...");
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .limit(1);

  if (error) {
    console.error("Query failed with error:", error);
  } else {
    console.log("Successfully fetched row!");
    if (data.length > 0) {
      console.log("Row keys:", Object.keys(data[0]));
      console.log("Row values:", data[0]);
    } else {
      console.log("Table is empty. Let's try selecting the new columns to see if they are defined.");
      const { data: colsData, error: colsError } = await supabase
        .from('expenses')
        .select('date, main_category, company_entity, expense_category')
        .limit(1);
      
      if (colsError) {
        console.error("Selecting new columns failed:", colsError);
      } else {
        console.log("Successfully verified new columns exist on remote database.");
      }
    }
  }
}

checkSchema();

