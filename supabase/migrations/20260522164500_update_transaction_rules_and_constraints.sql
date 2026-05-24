-- Create transaction_rules_memory table if it does not exist
CREATE TABLE IF NOT EXISTS public.transaction_rules_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  vendor_pattern text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Safely add missing columns to transaction_rules_memory to support smart learning and classification
ALTER TABLE public.transaction_rules_memory ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.transaction_rules_memory ADD COLUMN IF NOT EXISTS vendor_pattern text;
ALTER TABLE public.transaction_rules_memory ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.transaction_rules_memory ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.transaction_rules_memory ADD COLUMN IF NOT EXISTS description_order integer;
ALTER TABLE public.transaction_rules_memory ADD COLUMN IF NOT EXISTS main_category text;
ALTER TABLE public.transaction_rules_memory ADD COLUMN IF NOT EXISTS company_entity text;
ALTER TABLE public.transaction_rules_memory ADD COLUMN IF NOT EXISTS expense_category text;

-- Set default values for main_category, company_entity, and user_id if they are null
UPDATE public.transaction_rules_memory SET main_category = 'Personal' WHERE main_category IS NULL;
UPDATE public.transaction_rules_memory SET company_entity = 'None' WHERE company_entity IS NULL;
UPDATE public.transaction_rules_memory SET user_id = auth.uid() WHERE user_id IS NULL AND auth.uid() IS NOT NULL;

-- Apply check constraints on company_entity in transaction_rules_memory to include 'Swati' and 'Others'
ALTER TABLE public.transaction_rules_memory DROP CONSTRAINT IF EXISTS transaction_rules_memory_company_entity_check;
ALTER TABLE public.transaction_rules_memory ADD CONSTRAINT transaction_rules_memory_company_entity_check CHECK (company_entity IN ('KS', 'TI', 'CPM', 'AAS', 'Swati', 'Others', 'None'));

-- Apply check constraints on company_entity in expenses to include 'Swati' and 'Others'
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_company_entity_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_company_entity_check CHECK (company_entity IN ('KS', 'TI', 'CPM', 'AAS', 'Swati', 'Others', 'None'));

-- Enable RLS and setup policies for transaction_rules_memory
ALTER TABLE public.transaction_rules_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own transaction rules memory" ON public.transaction_rules_memory;
CREATE POLICY "Users can manage own transaction rules memory" ON public.transaction_rules_memory
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
