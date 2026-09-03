import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { RetroParticipant } from "./use-retro-participants";

// SQLSTATE customizados das RPCs do sorteio (mesmo padrão de src/lib/admin-errors.ts).
const ROULETTE_ERROR_MESSAGES: Record<string, string> = {
  W2001: "Você não tem permissão para esta ação.",
  W2402: "Todo mundo já foi sorteado ou está marcado como ausente.",
};

function rouletteErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code && ROULETTE_ERROR_MESSAGES[code]) return ROULETTE_ERROR_MESSAGES[code];
  console.error("[retrospectivas]", error);
  return "Não foi possível concluir a ação.";
}

// 18 flashes de 80 ms ≈ 1,44 s — os mesmos números do legado. Puramente
// estético: o vencedor real já foi decidido pelo servidor (spin_roulette)
// antes da animação começar — ver comentário na migration das RPCs.
const FLASH_MS = 80;
const TOTAL_FLASHES = 18;
const SLOWDOWN_FROM = TOTAL_FLASHES - 4;
const DISCARD_CHANCE = 0.6;

export type RouletteApi = {
  drawn: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
  lastWinner: string | null;
  highlight: string | null;
  spinning: boolean;
  availableCount: number;
  spin(): void;
  reset(): void;
  unmark(email: string): void;
  skip(email: string): void;
  unskip(email: string): void;
};

type RouletteState = {
  drawnEmails: string[];
  skippedEmails: string[];
  lastWinnerEmail: string | null;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pickRandom(pool: readonly string[]): string | undefined {
  return pool[Math.floor(Math.random() * pool.length)];
}

export function useRoulette(participants: readonly RetroParticipant[]): RouletteApi {
  const qc = useQueryClient();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Achado do code review do PR #38: sem isto, navegar para fora de
  // /retrospectivas (ou qualquer unmount) durante os ~1,4s da animação
  // deixa o setInterval de spin() rodando sozinho contra closures de um
  // componente já desmontado, até se auto-encerrar em TOTAL_FLASHES.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const stateQ = useQuery({
    queryKey: ["retro-roulette-state"],
    queryFn: async (): Promise<RouletteState> => {
      const { data, error } = await supabase
        .from("retro_roulette_state")
        .select("drawn_emails, skipped_emails, last_winner_email")
        .eq("id", true)
        .single();
      if (error) throw error;
      return {
        drawnEmails: data.drawn_emails,
        skippedEmails: data.skipped_emails,
        lastWinnerEmail: data.last_winner_email,
      };
    },
  });

  const drawn = useMemo(() => new Set(stateQ.data?.drawnEmails ?? []), [stateQ.data?.drawnEmails]);
  const skipped = useMemo(
    () => new Set(stateQ.data?.skippedEmails ?? []),
    [stateQ.data?.skippedEmails],
  );
  const lastWinner = stateQ.data?.lastWinnerEmail ?? null;

  const available = useMemo(
    () =>
      participants.filter((p) => !drawn.has(p.email) && !skipped.has(p.email)).map((p) => p.email),
    [participants, drawn, skipped],
  );

  const invalidateState = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["retro-roulette-state"] });
  }, [qc]);

  const spinMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("spin_roulette");
      if (error) throw error;
      return data;
    },
  });

  const skipMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.rpc("skip_participant", { _email: email });
      if (error) throw error;
    },
    onSuccess: invalidateState,
    onError: (error) => toast.error(rouletteErrorMessage(error)),
  });

  const unskipMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.rpc("unskip_participant", { _email: email });
      if (error) throw error;
    },
    onSuccess: invalidateState,
    onError: (error) => toast.error(rouletteErrorMessage(error)),
  });

  const unmarkMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.rpc("unmark_participant", { _email: email });
      if (error) throw error;
    },
    onSuccess: invalidateState,
    onError: (error) => toast.error(rouletteErrorMessage(error)),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reset_roulette");
      if (error) throw error;
    },
    onSuccess: invalidateState,
    onError: (error) => toast.error(rouletteErrorMessage(error)),
  });

  const spin = useCallback(() => {
    if (spinning || available.length === 0) return;
    setSpinning(true);

    spinMutation.mutate(undefined, {
      onSuccess: (winner) => {
        if (prefersReducedMotion()) {
          invalidateState();
          setSpinning(false);
          return;
        }

        if (timerRef.current !== null) clearInterval(timerRef.current);
        let flashes = 0;
        timerRef.current = setInterval(() => {
          flashes += 1;
          const roundPool =
            flashes > SLOWDOWN_FROM
              ? available.filter((email) => email === winner || Math.random() > DISCARD_CHANCE)
              : available;
          setHighlight(pickRandom(roundPool) ?? winner);

          if (flashes >= TOTAL_FLASHES) {
            if (timerRef.current !== null) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setHighlight(null);
            setSpinning(false);
            invalidateState();
          }
        }, FLASH_MS);
      },
      onError: (error) => {
        setSpinning(false);
        toast.error(rouletteErrorMessage(error));
      },
    });
  }, [available, invalidateState, spinMutation, spinning]);

  const reset = useCallback(() => {
    if (spinning) return;
    resetMutation.mutate();
  }, [resetMutation, spinning]);

  const unmark = useCallback(
    (email: string) => {
      if (spinning) return;
      unmarkMutation.mutate(email);
    },
    [spinning, unmarkMutation],
  );

  const skip = useCallback(
    (email: string) => {
      if (spinning || drawn.has(email)) return;
      skipMutation.mutate(email);
    },
    [drawn, skipMutation, spinning],
  );

  const unskip = useCallback(
    (email: string) => {
      if (spinning) return;
      unskipMutation.mutate(email);
    },
    [spinning, unskipMutation],
  );

  return {
    drawn,
    skipped,
    lastWinner,
    highlight,
    spinning,
    availableCount: available.length,
    spin,
    reset,
    unmark,
    skip,
    unskip,
  };
}
