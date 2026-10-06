import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Allocation } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";

/**
 * Reordena cards dentro da célula, arrastando um sobre o outro (#91).
 * Espelha `useReorderDevs`: grava só `position`, nunca as semanas — o arraste
 * não muda a semana do card.
 */
export function useReorderAllocations(project: JiraProjectKey) {
  const qc = useQueryClient();
  // Mesma chave da query de BoardGrid: as linhas do cache são `Allocation`.
  const key = ["board", "allocations", project] as const;

  return useMutation({
    mutationFn: async ({ changes }: { changes: { id: string; position: number }[] }) => {
      // Em paralelo: cada update é independente e não há UNIQUE em position.
      const results = await Promise.all(
        changes.map((c) =>
          supabase.from("allocations").update({ position: c.position }).eq("id", c.id).select("id"),
        ),
      );
      for (const res of results) {
        if (res.error) throw res.error;
        // A RLS nega UPDATE sem erro (0 linhas afetadas); sem este teste a
        // tela mostraria sucesso e a ordem voltaria no refetch.
        if (!res.data || res.data.length === 0) {
          throw new Error("Sem permissão para reordenar ou demanda não encontrada.");
        }
      }
    },
    onMutate: async ({ changes }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Allocation[]>(key);
      const byId = new Map(changes.map((c) => [c.id, c.position]));
      // Otimista: o card muda de lugar no soltar, sem esperar a rede.
      qc.setQueryData<Allocation[]>(key, (old) =>
        old?.map((a) => (byId.has(a.id) ? { ...a, position: byId.get(a.id)! } : a)),
      );
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(boardErrorMessage(e, "allocation"));
    },
    // `return` de propósito: mantém isPending até o refetch, impedindo novo
    // arraste sobre posições obsoletas.
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", "allocations"] }),
  });
}
