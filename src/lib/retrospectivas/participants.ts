// Funções puras de apresentação da retro — nome, cor, iniciais. Os dados
// (nome/e-mail/cor/ordem) vêm de public.retro_participants via
// use-retro-participants.ts (issue #24); este arquivo não conhece mais o
// Supabase, só sabe formatar o que chega.
export type Participant = { name: string; email: string; color?: string | null };

// As mesmas 21 cores do legado, na mesma ordem: a cor de cada pessoa é
// AVATAR_COLORS[i % 21]. Mudar a ordem da lista abaixo muda a cor de todo
// mundo — é feio, mas é o comportamento que o time já conhece.
export const AVATAR_COLORS: readonly string[] = [
  "#4f46e5",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#d97706",
  "#059669",
  "#0891b2",
  "#1d4ed8",
  "#be185d",
  "#9333ea",
  "#0d9488",
  "#b45309",
  "#16a34a",
  "#e11d48",
  "#6d28d9",
  "#0369a1",
  "#c2410c",
  "#15803d",
  "#7e22ce",
  "#0e7490",
  "#b91c1c",
];

// Cores de estado do avatar, iguais às do legado.
export const DRAWN_COLOR = "#9ca3af";
export const SKIPPED_COLOR = "#d97706";

// noUncheckedIndexedAccess torna o acesso indexado `string | undefined`; o `??`
// devolve um string de verdade sem precisar de `!`.
export function paletteColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#4f46e5";
}

// Cor base do avatar: o `color` explícito (marcador de pessoal externo) tem
// precedência sobre a paleta. Vale no grid E no card de vencedor.
export function avatarColor(p: Participant, index: number): string {
  return p.color ?? paletteColor(index);
}

// Primeira + última inicial; nome de uma palavra só usa os 2 primeiros caracteres.
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Nome exibido no card do grid.
export function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

// Nome exibido no card de vencedor: as duas primeiras palavras, como no legado.
export function shortName(fullName: string): string {
  return fullName.split(" ").slice(0, 2).join(" ");
}
