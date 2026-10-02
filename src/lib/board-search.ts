import { STATUS_LIST, TIPO_LIST, type AllocationStatus, type AllocationTipo } from "@/lib/board";

/**
 * Filtros do board na URL (issue #55). Todas as chaves são opcionais e os
 * padrões ficam FORA da URL: "todos" = chave ausente, busca vazia = ausente,
 * `ano` ausente = ano corrente do relógio (resolvido no `BoardGrid`). O
 * `| undefined` explícito permite que um patch remova a chave da URL
 * (`exactOptionalPropertyTypes`).
 */
export type BoardSearch = {
  ano?: number | undefined;
  q?: string | undefined;
  tipo?: AllocationTipo | undefined;
  status?: AllocationStatus | undefined;
};

const ANO_MIN = 2000;
const ANO_MAX = 2100;

/**
 * Valida os search params do board. Valor inválido vira `undefined` (cai no
 * padrão), nunca lança: um link velho ou editado à mão não pode quebrar a rota.
 */
export function parseBoardSearch(search: Record<string, unknown>): BoardSearch {
  const result: BoardSearch = {};

  // A URL pode entregar "2030" (string) ou 2030 (o router já faz JSON.parse).
  const rawAno = search["ano"];
  const ano =
    typeof rawAno === "number"
      ? rawAno
      : typeof rawAno === "string" && rawAno.trim() !== ""
        ? Number(rawAno)
        : NaN;
  if (Number.isInteger(ano) && ano >= ANO_MIN && ano <= ANO_MAX) result.ano = ano;

  // Guarda o texto como digitado (sem trim): só descarta se for vazio/espaços.
  // O router faz JSON.parse: `?q=123` chega como number.
  const rawQ = search["q"];
  const q =
    typeof rawQ === "string"
      ? rawQ
      : typeof rawQ === "number" && Number.isFinite(rawQ)
        ? String(rawQ)
        : "";
  if (q.trim() !== "") result.q = q;

  const rawTipo = search["tipo"];
  if (typeof rawTipo === "string") {
    const tipo = TIPO_LIST.find((t) => t.value === rawTipo);
    if (tipo) result.tipo = tipo.value;
  }

  const rawStatus = search["status"];
  if (typeof rawStatus === "string") {
    const status = STATUS_LIST.find((s) => s.value === rawStatus);
    if (status) result.status = status.value;
  }

  return result;
}
