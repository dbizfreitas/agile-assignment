CREATE TYPE public.allocation_status AS ENUM ('planejado','em_andamento','bug','evolutiva','risco','concluido','ferias');

CREATE TABLE public.devs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  initials text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#94a3b8',
  position int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devs TO authenticated;
GRANT ALL ON public.devs TO service_role;
ALTER TABLE public.devs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devs_all_authenticated" ON public.devs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.sprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  quarter text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  days int NOT NULL DEFAULT 15,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sprints TO authenticated;
GRANT ALL ON public.sprints TO service_role;
ALTER TABLE public.sprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sprints_all_authenticated" ON public.sprints FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id uuid NOT NULL REFERENCES public.sprints(id) ON DELETE CASCADE,
  dev_id uuid NOT NULL REFERENCES public.devs(id) ON DELETE CASCADE,
  title text NOT NULL,
  ticket_key text,
  ticket_url text,
  status public.allocation_status NOT NULL DEFAULT 'planejado',
  notes text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocations TO authenticated;
GRANT ALL ON public.allocations TO service_role;
ALTER TABLE public.allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allocations_all_authenticated" ON public.allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX allocations_sprint_dev_idx ON public.allocations (sprint_id, dev_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER allocations_updated_at BEFORE UPDATE ON public.allocations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();