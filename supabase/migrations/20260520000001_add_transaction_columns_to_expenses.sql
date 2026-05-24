-- Add the requested Transaction columns to the active public.expenses table
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS main_category text NOT NULL CHECK (main_category IN ('Business', 'Personal')) DEFAULT 'Personal',
  ADD COLUMN IF NOT EXISTS company_entity text NOT NULL CHECK (company_entity IN ('KS', 'TI', 'CPM', 'AAS', 'None')) DEFAULT 'None',
  ADD COLUMN IF NOT EXISTS expense_category text NOT NULL DEFAULT 'Other expenses';

-- Create indexes for the new columns to ensure optimal search performance
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_main_category ON public.expenses(main_category);
CREATE INDEX IF NOT EXISTS idx_expenses_company_entity ON public.expenses(company_entity);

-- Backfill existing rows using their historical fields to maintain complete consistency
UPDATE public.expenses e
SET
  date = e.created_at::date,
  main_category = CASE 
    WHEN e.category = 'Business' THEN 'Business' 
    ELSE 'Personal' 
  END,
  company_entity = COALESCE(
    (SELECT CASE 
              WHEN UPPER(b.name) IN ('KS', 'TI', 'CPM', 'AAS') THEN UPPER(b.name)
              ELSE 'None'
            END
     FROM public.businesses b 
     WHERE b.id = e.business_id),
    'None'
  ),
  expense_category = COALESCE(
    CASE 
      WHEN e.raw_text LIKE '% · %' THEN SPLIT_PART(e.raw_text, ' · ', 1)
      ELSE 'Other expenses'
    END,
    'Other expenses'
  );
