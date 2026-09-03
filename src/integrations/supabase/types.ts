export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  public: {
    Tables: {
      allocations: {
        Row: {
          created_at: string;
          dev_id: string;
          id: string;
          jira_project: string;
          notes: string | null;
          position: number;
          sprint_id: string;
          status: Database["public"]["Enums"]["allocation_status"];
          tickets: Json;
          tipo: Database["public"]["Enums"]["allocation_tipo"];
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          dev_id: string;
          id?: string;
          jira_project: string;
          notes?: string | null;
          position?: number;
          sprint_id: string;
          status?: Database["public"]["Enums"]["allocation_status"];
          tickets?: Json;
          tipo?: Database["public"]["Enums"]["allocation_tipo"];
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          dev_id?: string;
          id?: string;
          jira_project?: string;
          notes?: string | null;
          position?: number;
          sprint_id?: string;
          status?: Database["public"]["Enums"]["allocation_status"];
          tickets?: Json;
          tipo?: Database["public"]["Enums"]["allocation_tipo"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "allocations_dev_id_fkey";
            columns: ["dev_id"];
            isOneToOne: false;
            referencedRelation: "devs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "allocations_dev_project_fkey";
            columns: ["dev_id", "jira_project"];
            isOneToOne: false;
            referencedRelation: "devs";
            referencedColumns: ["id", "jira_project"];
          },
          {
            foreignKeyName: "allocations_sprint_id_fkey";
            columns: ["sprint_id"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "allocations_sprint_project_fkey";
            columns: ["sprint_id", "jira_project"];
            isOneToOne: false;
            referencedRelation: "sprints";
            referencedColumns: ["id", "jira_project"];
          },
        ];
      };
      devs: {
        Row: {
          active: boolean;
          available_from: string | null;
          available_to: string | null;
          created_at: string;
          id: string;
          initials: string;
          jira_project: string;
          name: string;
          position: number;
          team_id: string;
        };
        Insert: {
          active?: boolean;
          available_from?: string | null;
          available_to?: string | null;
          created_at?: string;
          id?: string;
          initials?: string;
          jira_project: string;
          name: string;
          position?: number;
          team_id: string;
        };
        Update: {
          active?: boolean;
          available_from?: string | null;
          available_to?: string | null;
          created_at?: string;
          id?: string;
          initials?: string;
          jira_project?: string;
          name?: string;
          position?: number;
          team_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "devs_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "devs_team_project_fkey";
            columns: ["team_id", "jira_project"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "jira_project"];
          },
        ];
      };
      invitations: {
        Row: {
          consumed_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          role: Database["public"]["Enums"]["app_role"];
          routes: Database["public"]["Enums"]["app_route"][];
        };
        Insert: {
          consumed_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          role: Database["public"]["Enums"]["app_role"];
          routes?: Database["public"]["Enums"]["app_route"][];
        };
        Update: {
          consumed_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          role?: Database["public"]["Enums"]["app_role"];
          routes?: Database["public"]["Enums"]["app_route"][];
        };
        Relationships: [];
      };
      ms_graph_token: {
        Row: {
          access_token: string | null;
          expires_at: string | null;
          id: boolean;
          refresh_token: string | null;
          updated_at: string;
        };
        Insert: {
          access_token?: string | null;
          expires_at?: string | null;
          id?: boolean;
          refresh_token?: string | null;
          updated_at?: string;
        };
        Update: {
          access_token?: string | null;
          expires_at?: string | null;
          id?: boolean;
          refresh_token?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      role_audit_log: {
        Row: {
          action: Database["public"]["Enums"]["role_audit_action"];
          actor_email: string | null;
          actor_user_id: string | null;
          created_at: string;
          id: string;
          new_role: Database["public"]["Enums"]["app_role"] | null;
          previous_role: Database["public"]["Enums"]["app_role"] | null;
          route: Database["public"]["Enums"]["app_route"] | null;
          target_email: string | null;
          target_user_id: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["role_audit_action"];
          actor_email?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          new_role?: Database["public"]["Enums"]["app_role"] | null;
          previous_role?: Database["public"]["Enums"]["app_role"] | null;
          route?: Database["public"]["Enums"]["app_route"] | null;
          target_email?: string | null;
          target_user_id?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["role_audit_action"];
          actor_email?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          new_role?: Database["public"]["Enums"]["app_role"] | null;
          previous_role?: Database["public"]["Enums"]["app_role"] | null;
          route?: Database["public"]["Enums"]["app_route"] | null;
          target_email?: string | null;
          target_user_id?: string | null;
        };
        Relationships: [];
      };
      retro_participants: {
        Row: {
          color: string | null;
          created_at: string;
          email: string;
          id: string;
          name: string;
          photo_data_url: string | null;
          photo_fetched_at: string | null;
          sort_order: number;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          name: string;
          photo_data_url?: string | null;
          photo_fetched_at?: string | null;
          sort_order: number;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          name?: string;
          photo_data_url?: string | null;
          photo_fetched_at?: string | null;
          sort_order?: number;
        };
        Relationships: [];
      };
      retro_roulette_state: {
        Row: {
          drawn_emails: string[];
          id: boolean;
          last_winner_email: string | null;
          skipped_emails: string[];
          updated_at: string;
        };
        Insert: {
          drawn_emails?: string[];
          id?: boolean;
          last_winner_email?: string | null;
          skipped_emails?: string[];
          updated_at?: string;
        };
        Update: {
          drawn_emails?: string[];
          id?: boolean;
          last_winner_email?: string | null;
          skipped_emails?: string[];
          updated_at?: string;
        };
        Relationships: [];
      };
      sprints: {
        Row: {
          code: string;
          created_at: string;
          days: number;
          end_date: string;
          id: string;
          jira_project: string;
          position: number;
          quarter: string;
          start_date: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          days?: number;
          end_date: string;
          id?: string;
          jira_project: string;
          position?: number;
          quarter?: string;
          start_date: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          days?: number;
          end_date?: string;
          id?: string;
          jira_project?: string;
          position?: number;
          quarter?: string;
          start_date?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          jira_project: string;
          name: string;
          position: number;
        };
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          jira_project: string;
          name: string;
          position?: number;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          jira_project?: string;
          name?: string;
          position?: number;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      user_route_access: {
        Row: {
          created_at: string;
          granted_by: string | null;
          route: Database["public"]["Enums"]["app_route"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          route: Database["public"]["Enums"]["app_route"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          route?: Database["public"]["Enums"]["app_route"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cancel_invitation: { Args: { _email: string }; Returns: undefined };
      create_invitation: {
        Args: {
          _email: string;
          _role: Database["public"]["Enums"]["app_role"];
          _routes?: Database["public"]["Enums"]["app_route"][];
        };
        Returns: string;
      };
      delete_platform_user: { Args: { _target: string }; Returns: undefined };
      delete_team: {
        Args: { _team: string; _target?: string | null };
        Returns: undefined;
      };
      set_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _target: string;
        };
        Returns: undefined;
      };
      set_user_routes: {
        Args: {
          _routes: Database["public"]["Enums"]["app_route"][];
          _target: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      allocation_status: "nao_especificada" | "especificada";
      allocation_tipo: "planejado" | "bug" | "evolutiva" | "ferias";
      app_role: "admin" | "editor" | "viewer";
      app_route: "compromisso" | "cycle-time" | "retrospectivas" | "alocacoes";
      role_audit_action:
        | "invite"
        | "grant"
        | "revoke"
        | "bootstrap"
        | "cancel"
        | "route_grant"
        | "route_revoke"
        | "delete";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      allocation_status: ["nao_especificada", "especificada"],
      allocation_tipo: ["planejado", "bug", "evolutiva", "ferias"],
      app_role: ["admin", "editor", "viewer"],
      app_route: ["compromisso", "cycle-time", "retrospectivas", "alocacoes"],
      role_audit_action: [
        "invite",
        "grant",
        "revoke",
        "bootstrap",
        "cancel",
        "route_grant",
        "route_revoke",
        "delete",
      ],
    },
  },
} as const;
