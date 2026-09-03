import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

type RetroParticipantRow = {
  id: string;
  name: string;
  email: string;
  color: string | null;
  sort_order: number;
  photo_data_url: string | null;
  photo_fetched_at: string | null;
  created_at: string;
};

type RetroRouletteStateRow = {
  id: boolean;
  drawn_emails: string[];
  skipped_emails: string[];
  last_winner_email: string | null;
  updated_at: string;
};

type MsGraphTokenRow = {
  id: boolean;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  updated_at: string;
};

type TableDefinition<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type RetroDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      retro_participants: TableDefinition<RetroParticipantRow>;
      retro_roulette_state: TableDefinition<RetroRouletteStateRow>;
      ms_graph_token: TableDefinition<MsGraphTokenRow>;
    };
    Functions: Database["public"]["Functions"] & {
      spin_roulette: { Args: Record<string, never>; Returns: string };
      skip_participant: { Args: { _email: string }; Returns: undefined };
      unskip_participant: { Args: { _email: string }; Returns: undefined };
      unmark_participant: { Args: { _email: string }; Returns: undefined };
      reset_roulette: { Args: Record<string, never>; Returns: undefined };
    };
  };
};

export function withRetroTypes(client: unknown): SupabaseClient<RetroDatabase> {
  return client as SupabaseClient<RetroDatabase>;
}