// As mesmas três chaves do legado. O estado não migra de localhost:8000 para cá
// (origens diferentes = localStorage diferentes); a primeira retro no destino
// começa zerada, que é o que se faz no início de cada ciclo de qualquer forma.
const DRAWN_KEY = "retro-roulette-drawn";
const SKIPPED_KEY = "retro-roulette-skipped";
const WINNER_KEY = "retro-roulette-last-winner";

// Toda leitura e escrita degrada para vazio em caso de erro: modo privativo e
// quota estourada não podem derrubar a tela.
function readEmailArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // O filtro por typeof também descarta o formato antigo por índice do legado,
    // que aqui é inalcançável (outra origem) — desvio 2: sem código de migração.
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeEmailArray(key: string, emails: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...emails]));
  } catch {
    // Sem persistência a roleta continua funcionando dentro da sessão.
  }
}

export function loadDrawn(): string[] {
  return readEmailArray(DRAWN_KEY);
}

export function saveDrawn(emails: ReadonlySet<string>): void {
  writeEmailArray(DRAWN_KEY, emails);
}

export function loadSkipped(): string[] {
  return readEmailArray(SKIPPED_KEY);
}

export function saveSkipped(emails: ReadonlySet<string>): void {
  writeEmailArray(SKIPPED_KEY, emails);
}

export function loadLastWinner(): string | null {
  try {
    return localStorage.getItem(WINNER_KEY);
  } catch {
    return null;
  }
}

export function saveLastWinner(email: string): void {
  try {
    localStorage.setItem(WINNER_KEY, email);
  } catch {
    // idem writeEmailArray
  }
}

export function clearLastWinner(): void {
  try {
    localStorage.removeItem(WINNER_KEY);
  } catch {
    // idem writeEmailArray
  }
}
