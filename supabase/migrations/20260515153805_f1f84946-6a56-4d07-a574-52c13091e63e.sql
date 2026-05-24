
-- Businesses table
CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own businesses" ON public.businesses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own businesses" ON public.businesses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own businesses" ON public.businesses
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own businesses" ON public.businesses
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Add business_id to expenses
ALTER TABLE public.expenses
  ADD COLUMN business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL;

CREATE INDEX idx_expenses_business_id ON public.expenses(business_id);

-- Audit records (historical FX info per expense)
CREATE TABLE public.audit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  bill_date date NOT NULL,
  original_currency text NOT NULL,
  original_amount numeric NOT NULL,
  exchange_rate_to_inr numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_records_expense_id ON public.audit_records(expense_id);

ALTER TABLE public.audit_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own audit records" ON public.audit_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own audit records" ON public.audit_records
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own audit records" ON public.audit_records
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own audit records" ON public.audit_records
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
