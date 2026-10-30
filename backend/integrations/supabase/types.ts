export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ad_sessions: {
        Row: {
          created_at: string
          expires_at: string
          phase: string
          session_id: string
          status: string
          tg_id: number
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          phase?: string
          session_id: string
          status?: string
          tg_id: number
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          phase?: string
          session_id?: string
          status?: string
          tg_id?: number
          verified_at?: string | null
        }
        Relationships: []
      }
      locks: {
        Row: {
          id: string
          until: string
        }
        Insert: {
          id: string
          until: string
        }
        Update: {
          id?: string
          until?: string
        }
        Relationships: []
      }
      miners: {
        Row: {
          miner_id: number
          started_at: string
          tg_id: number
        }
        Insert: {
          miner_id: number
          started_at?: string
          tg_id: number
        }
        Update: {
          miner_id?: number
          started_at?: string
          tg_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "miners_tg_id_fkey"
            columns: ["tg_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["tg_id"]
          },
        ]
      }
      payout_batches: {
        Row: {
          id: string
          ids: string[]
          sent_at: string
          seqno: number
          status: string
        }
        Insert: {
          id: string
          ids: string[]
          sent_at?: string
          seqno: number
          status?: string
        }
        Update: {
          id?: string
          ids?: string[]
          sent_at?: string
          seqno?: number
          status?: string
        }
        Relationships: []
      }
      players: {
        Row: {
          balance_milli: number
          coins: number
          created_at: string
          donated_coins: number
          first_name: string
          last_ad_at: string | null
          last_ad_session_id: string | null
          last_bonus_date: string | null
          owns_miner2: boolean
          photo_url: string | null
          referral_claimed: boolean
          referred_by: number | null
          tg_id: number
          username: string | null
        }
        Insert: {
          balance_milli?: number
          coins?: number
          created_at?: string
          donated_coins?: number
          first_name?: string
          last_ad_at?: string | null
          last_ad_session_id?: string | null
          last_bonus_date?: string | null
          owns_miner2?: boolean
          photo_url?: string | null
          referral_claimed?: boolean
          referred_by?: number | null
          tg_id: number
          username?: string | null
        }
        Update: {
          balance_milli?: number
          coins?: number
          created_at?: string
          donated_coins?: number
          first_name?: string
          last_ad_at?: string | null
          last_ad_session_id?: string | null
          last_bonus_date?: string | null
          owns_miner2?: boolean
          photo_url?: string | null
          referral_claimed?: boolean
          referred_by?: number | null
          tg_id?: number
          username?: string | null
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          address: string
          amount_milli: number
          batch_id: string | null
          created_at: string
          id: string
          nano: string
          proof_posted: boolean
          sent_at: string | null
          status: string
          tg_id: number
        }
        Insert: {
          address: string
          amount_milli: number
          batch_id?: string | null
          created_at?: string
          id?: string
          nano: string
          proof_posted?: boolean
          sent_at?: string | null
          status?: string
          tg_id: number
        }
        Update: {
          address?: string
          amount_milli?: number
          batch_id?: string | null
          created_at?: string
          id?: string
          nano?: string
          proof_posted?: boolean
          sent_at?: string | null
          status?: string
          tg_id?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gm_ad_reward: { Args: { _tg: number }; Returns: string }
      gm_buy_miner: {
        Args: { _miner: number; _tg: number }
        Returns: undefined
      }
      gm_claim_bonus: { Args: { _tg: number }; Returns: undefined }
      gm_claim_miner: {
        Args: { _miner: number; _tg: number }
        Returns: undefined
      }
      gm_claim_referral: {
        Args: { _friend: number; _tg: number }
        Returns: undefined
      }
      gm_donate: { Args: { _tg: number }; Returns: undefined }
      gm_request_withdraw: {
        Args: { _address: string; _milli: number; _nano: string; _tg: number }
        Returns: string
      }
      miner_rule: { Args: { _id: number }; Returns: Record<string, unknown> }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
