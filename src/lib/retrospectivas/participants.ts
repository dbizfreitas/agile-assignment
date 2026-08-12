// Fonte da verdade da lista da retro, versionada. Nome + e-mail corporativo não
// são PII sensível — é exatamente o que já aparece no board. A foto, que é, mora
// em photos-cache.ts, fora do git.
//
// Não derivamos de `devs`: aquela tabela não tem coluna de e-mail (que é a chave
// do cache de fotos), e esta lista inclui gente da Shippit e papéis que não
// recebem alocação. Um JOIN por nome seria frágil por homônimo e acentuação.
export type Participant = { name: string; email: string; color?: string };

export const PARTICIPANTS: readonly Participant[] = [
  { name: "André Secco", email: "andre.secco@way2.com.br" },
  { name: "Bruno Shippit", email: "bruno@shippit.app", color: "#0ea5e9" },
  { name: "Christian Leonardo Chiavelli", email: "christian.chiavelli@way2.com.br" },
  { name: "Daniel Alves", email: "daniel.alves@way2.com.br" },
  { name: "Daniel Heler Pohlmann", email: "daniel.heler@way2.com.br" },
  { name: "Diego Freitas", email: "diego.freitas@way2.com.br" },
  { name: "Diego Martini Longhi", email: "diego.longhi@way2.com.br" },
  { name: "Fábio Meira de Almeida", email: "fabio.almeida@way2.com.br" },
  { name: "Fernando Gaio", email: "fernando.gaio@way2.com.br" },
  { name: "Francisco das Chagas", email: "francisco.chagas@way2.com.br" },
  { name: "Gilcelaine Portela da Luz", email: "gilcelaine.luz@way2.com.br" },
  { name: "Guilherme de Oliveira França", email: "guilherme.franca@way2.com.br" },
  { name: "Jaicon Algir Marmitt", email: "jaicon.marmitt@way2.com.br" },
  { name: "José Shippit", email: "jose@shippit.app", color: "#0ea5e9" },
  { name: "Lais Caroline Ortiz", email: "lais.ortiz@way2.com.br" },
  { name: "Luiz Berti", email: "luizberti@shippit.app", color: "#0ea5e9" },
  { name: "Rafaello Valladares Bertolini", email: "rafaello.bertolini@way2.com.br" },
  { name: "Rinaldo Ferreira Junior", email: "rinaldo.junior@way2.com.br" },
  { name: "Vitor Junior de Oliveira Souza", email: "vitor.souza@way2.com.br" },
  { name: "Warley Thales da Silva Lopes", email: "warley.lopes@way2.com.br" },
];

// As mesmas 21 cores do legado, na mesma ordem: a cor de cada pessoa é
// AVATAR_COLORS[i % 21]. Mudar a ordem da lista acima muda a cor de todo mundo
// abaixo da mudança — é feio, mas é o comportamento que o time já conhece.
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
// precedência sobre a paleta. Vale no grid E no card de vencedor — o legado
// ignorava `color` no palco, o que deixava o externo com duas cores diferentes
// na mesma tela (desvio 4).
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
