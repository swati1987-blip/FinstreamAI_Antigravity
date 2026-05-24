-- Create Transactions table matching strict columns and rules
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  vendor text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  main_category text NOT NULL CHECK (main_category IN ('Business', 'Personal')),
  company_entity text NOT NULL CHECK (company_entity IN ('KS', 'TI', 'CPM', 'AAS', 'None')),
  expense_category text NOT NULL DEFAULT 'Other',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for speedy user-scoped queries
CREATE INDEX idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX idx_transactions_date ON public.transactions(date);

-- Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Row Level Security policies
CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON public.transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
