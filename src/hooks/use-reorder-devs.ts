import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Dev } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";

/**
 * Reordena pessoas dentro do time (#83). Compartilhado por BoardGrid (arrastar
 * a coluna) e DevDialog (alternativa por teclado).
 */
export function useReorderDevs(project: JiraProjectKey) {
  const qc = useQueryClient();
  // Mesma chave de BoardGrid/DevDialog/TeamsDialog: as linhas do cache devem
  // continuar sendo `Dev` completos.
  const key = ["board", "devs", project] as const;

  return useMutation({
    mutationFn: async ({ changes }: { changes: { id: string; position: number }[] }) => {
      // Em paralelo: cada update é independente e não há UNIQUE em position.
      const results = await Promise.all(
        changes.map((c) =>
          supabase.from("devs").update({ position: c.position }).eq("id", c.id).select("id"),
        ),
      );
      for (const res of results) {
        if (res.error) throw res.error;
        // A RLS nega UPDATE sem erro (0 linhas afetadas); sem este teste a
        // tela mostraria sucesso e a ordem voltaria no refetch.
        if (!res.data || res.data.length === 0) {
          throw new Error("Sem permissão para reordenar ou pessoa não encontrada.");
        }
      }
    },
    onMutate: async ({ changes }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Dev[]>(key);
      const byId = new Map(changes.map((c) => [c.id, c.position]));
      // Otimista: a coluna muda de lugar no soltar, sem esperar a rede.
      qc.setQueryData<Dev[]>(key, (old) =>
        old?.map((d) => (byId.has(d.id) ? { ...d, position: byId.get(d.id)! } : d)),
      );
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(boardErrorMessage(e));
    },
    // `return` de propósito (como em TeamsDialog): mantém isPending até o
    // refetch, impedindo novo arraste sobre posições obsoletas.
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", "devs"] }),
  });
}
