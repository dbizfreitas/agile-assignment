import { useCallback, useState } from "react";
import { ls, save } from "@/lib/local-storage";
import {
  hideDev,
  parseVisibility,
  showAll,
  showDev,
  storageKey,
  toggleTeam,
  type BoardVisibility,
} from "@/lib/board-visibility";
import type { Dev } from "@/lib/board";

type DevRef = Pick<Dev, "id" | "team_id">;

/**
 * Estado de visibilidade das colunas (#124), por projeto e salvo no
 * localStorage. Trocar de projeto recarrega o que foi salvo para ele; cada
 * mudança é gravada na hora.
 */
export function useBoardVisibility(project: string) {
  const [state, setState] = useState<{ project: string; vis: BoardVisibility }>(() => ({
    project,
    vis: parseVisibility(ls(storageKey(project))),
  }));

  // Troca de projeto: relê durante o render (padrão "ajustar estado ao mudar
  // prop"), para não exibir nem um frame com a visibilidade do projeto antigo.
  let current = state;
  if (state.project !== project) {
    current = { project, vis: parseVisibility(ls(storageKey(project))) };
    setState(current);
  }
  const vis = current.vis;

  // Grava só quando o usuário muda algo, não ao carregar/trocar de projeto.
  const update = useCallback((fn: (v: BoardVisibility) => BoardVisibility) => {
    setState((s) => {
      const next = fn(s.vis);
      if (next !== s.vis) save(storageKey(s.project), JSON.stringify(next));
      return { project: s.project, vis: next };
    });
  }, []);

  return {
    vis,
    toggleTeam: (teamId: string, teamDevs: DevRef[]) =>
      update((v) => toggleTeam(v, teamId, teamDevs)),
    hideDev: (devId: string) => update((v) => hideDev(v, devId)),
    showDev: (dev: DevRef, teamDevs: DevRef[]) => update((v) => showDev(v, dev, teamDevs)),
    showAll: () => update(() => showAll()),
  };
}
