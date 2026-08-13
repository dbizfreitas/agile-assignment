CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#94a3b8',
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_select_authenticated" ON public.teams
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "teams_insert_editors" ON public.teams
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_board(auth.uid()));
CREATE POLICY "teams_update_editors" ON public.teams
  FOR UPDATE TO authenticated
  USING (public.can_edit_board(auth.uid()))
  WITH CHECK (public.can_edit_board(auth.uid()));
CREATE POLICY "teams_delete_editors" ON public.teams
  FOR DELETE TO authenticated USING (public.can_edit_board(auth.uid()));

-- Backfill: existing devs get a default team so devs.team_id can become NOT NULL
INSERT INTO public.teams (name, color, position) VALUES ('Sem time', '#94a3b8', 0);

ALTER TABLE public.devs ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE RESTRICT;

UPDATE public.devs SET team_id = (SELECT id FROM public.teams WHERE name = 'Sem time' LIMIT 1);

ALTER TABLE public.devs ALTER COLUMN team_id SET NOT NULL;

CREATE INDEX devs_team_id_idx ON public.devs (team_id);

-- Team color replaces the old per-dev color for identifying a person's team
ALTER TABLE public.devs DROP COLUMN color;
