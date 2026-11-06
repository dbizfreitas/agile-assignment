/**
 * Visibilidade das colunas do quadro (#124): o usuário pode ocultar um time
 * inteiro ou pessoas avulsas. É preferência de visualização, só do navegador
 * (localStorage, por projeto) — não vai para o banco nem para a URL.
 *
 * Tudo aqui é função pura e imutável; o estado e a persistência ficam em
 * `useBoardVisibility`. IDs que não existem mais (time ou pessoa apagados)
 * simplesmente não casam com nada, então não é preciso limpá-los.
 */
import type { Dev } from "@/lib/board";

export type BoardVisibility = {
  /** IDs dos times ocultos (todas as pessoas do time somem). */
  teams: string[];
  /** IDs das pessoas ocultas individualmente. */
  devs: string[];
};

const EMPTY: BoardVisibility = { teams: [], devs: [] };

export const storageKey = (project: string) => `boardHidden:${project}`;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Lê o valor salvo de forma tolerante: JSON inválido ou em formato inesperado
 * vira "nada oculto", em vez de quebrar o quadro por causa de um dado velho.
 */
export function parseVisibility(raw: string | null): BoardVisibility {
  if (!raw) return { ...EMPTY };
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ...EMPTY };
    const obj = data as Record<string, unknown>;
    return { teams: strings(obj["teams"]), devs: strings(obj["devs"]) };
  } catch {
    return { ...EMPTY };
  }
}

/** A pessoa some se o time dela ou ela própria estiver oculta. */
export const isDevHidden = (dev: Pick<Dev, "id" | "team_id">, vis: BoardVisibility) =>
  vis.teams.includes(dev.team_id) || vis.devs.includes(dev.id);

/**
 * Clique no chip do time. Oculto → exibe o time inteiro (inclusive pessoas que
 * estavam ocultas individualmente dentro dele). Visível → oculta o time.
 */
export function toggleTeam(
  vis: BoardVisibility,
  teamId: string,
  teamDevs: Pick<Dev, "id">[],
): BoardVisibility {
  if (vis.teams.includes(teamId)) {
    const members = new Set(teamDevs.map((d) => d.id));
    return {
      teams: vis.teams.filter((t) => t !== teamId),
      devs: vis.devs.filter((id) => !members.has(id)),
    };
  }
  return { ...vis, teams: [...vis.teams, teamId] };
}

/** Oculta uma pessoa (olho no cabeçalho da coluna). */
export function hideDev(vis: BoardVisibility, devId: string): BoardVisibility {
  if (vis.devs.includes(devId)) return vis;
  return { ...vis, devs: [...vis.devs, devId] };
}

/**
 * Exibe uma pessoa (clique na faixa). Se o time inteiro está oculto, "só ela"
 * aparece: o time é desocultado e os OUTROS membros passam a ficar ocultos
 * individualmente. Senão, basta tirá-la da lista de ocultas.
 */
export function showDev(
  vis: BoardVisibility,
  dev: Pick<Dev, "id" | "team_id">,
  teamDevs: Pick<Dev, "id">[],
): BoardVisibility {
  if (vis.teams.includes(dev.team_id)) {
    const others = teamDevs.map((d) => d.id).filter((id) => id !== dev.id);
    const devs = new Set([...vis.devs.filter((id) => id !== dev.id), ...others]);
    return { teams: vis.teams.filter((t) => t !== dev.team_id), devs: [...devs] };
  }
  return { ...vis, devs: vis.devs.filter((id) => id !== dev.id) };
}

/** Quantas pessoas estão ocultas agora (por time ou individualmente). */
export const hiddenCount = (devs: Pick<Dev, "id" | "team_id">[], vis: BoardVisibility) =>
  devs.filter((d) => isDevHidden(d, vis)).length;

export const showAll = (): BoardVisibility => ({ teams: [], devs: [] });
