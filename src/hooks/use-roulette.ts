import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PARTICIPANTS } from "@/lib/retrospectivas/participants";
import {
  clearLastWinner,
  loadDrawn,
  loadLastWinner,
  loadSkipped,
  saveDrawn,
  saveLastWinner,
  saveSkipped,
} from "@/lib/retrospectivas/storage";

// 18 flashes de 80 ms ≈ 1,44 s — os mesmos números do legado.
const FLASH_MS = 80;
const TOTAL_FLASHES = 18;
// Nos 4 últimos flashes o pool encolhe para [vencedor, ...~40% dos elegíveis]:
// é isso que produz a sensação de desaceleração.
const SLOWDOWN_FROM = TOTAL_FLASHES - 4;
// Nome pela probabilidade real: Math.random() > 0.6 é verdade em ~40% das
// vezes, e é isso que DESCARTA um elegível do pool round a round. O nome
// anterior (KEEP_CHANCE) descrevia o efeito líquido, não a probabilidade em
// si — enganava quem fosse ajustar "quero a desaceleração mais longa".
const DISCARD_CHANCE = 0.6;

export type RouletteApi = {
  drawn: ReadonlySet<string>; // e-mails
  skipped: ReadonlySet<string>; // e-mails
  lastWinner: string | null; // e-mail
  highlight: string | null; // e-mail piscando durante a animação
  spinning: boolean;
  availableCount: number;
  spin(): void;
  reset(): void;
  unmark(email: string): void; // desfaz "sorteado"
  skip(email: string): void; // marca "ausente"
  unskip(email: string): void; // reinclui
};

const KNOWN_EMAILS: ReadonlySet<string> = new Set(PARTICIPANTS.map((p) => p.email));

// Descarta e-mails que saíram da lista: quem não está mais no time não pode
// continuar contando no "N / 20 sorteados". O legado ganhava isso de graça ao
// converter e-mail para índice na fronteira do localStorage.
function keepKnown(emails: readonly string[]): Set<string> {
  return new Set(emails.filter((email) => KNOWN_EMAILS.has(email)));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pickRandom(pool: readonly string[]): string | undefined {
  return pool[Math.floor(Math.random() * pool.length)];
}

export function useRoulette(): RouletteApi {
  // Initializer lazy (função, não valor): não roda no servidor nem a cada render.
  const [drawn, setDrawn] = useState<ReadonlySet<string>>(() => keepKnown(loadDrawn()));
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => keepKnown(loadSkipped()));
  // Só restaura o vencedor se ele ainda estiver entre os sorteados — mesmo guard
  // que o legado aplicava ao reabrir a aba.
  const [lastWinner, setLastWinner] = useState<string | null>(() => {
    const stored = loadLastWinner();
    return stored !== null && drawn.has(stored) ? stored : null;
  });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Equivalente ao _cleanup() que o legado chamava a cada renderRoulette.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Elegíveis = nem sorteados, nem ausentes.
  const available = useMemo(
    () =>
      PARTICIPANTS.filter((p) => !drawn.has(p.email) && !skipped.has(p.email)).map((p) => p.email),
    [drawn, skipped],
  );

  const commitWinner = useCallback(
    (email: string) => {
      const next = new Set(drawn);
      next.add(email);
      setDrawn(next);
      saveDrawn(next);
      saveLastWinner(email);
      setLastWinner(email);
      setHighlight(null);
      setSpinning(false);
    },
    [drawn],
  );

  const spin = useCallback(() => {
    if (spinning) return;
    const pool = available;
    const winner = pickRandom(pool);
    if (winner === undefined) return;

    setSpinning(true);
    setLastWinner(null);

    // Quem configurou o sistema para não receber animação não leva 1,4 s de
    // piscada: o vencedor aparece direto.
    if (prefersReducedMotion()) {
      commitWinner(winner);
      return;
    }

    // Defesa contra um segundo spin() alcançar aqui de algum jeito futuro (hoje
    // o botão desabilita e o guard de `spinning` no topo cobre): sem isto, o
    // timer novo sobrescreveria a ref do antigo, que ficaria órfão — nunca
    // limpo, disparando commitWinner() a cada 80ms para sempre, inclusive
    // depois do unmount.
    if (timerRef.current !== null) clearInterval(timerRef.current);

    let flashes = 0;
    timerRef.current = setInterval(() => {
      flashes += 1;
      const roundPool =
        flashes > SLOWDOWN_FROM
          ? pool.filter((email) => email === winner || Math.random() > DISCARD_CHANCE)
          : pool;
      // O vencedor está sempre no roundPool, então o ?? nunca dispara na prática
      // — existe só para satisfazer noUncheckedIndexedAccess.
      setHighlight(pickRandom(roundPool) ?? winner);

      if (flashes >= TOTAL_FLASHES) {
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        commitWinner(winner);
      }
    }, FLASH_MS);
  }, [available, commitWinner, spinning]);

  const reset = useCallback(() => {
    if (spinning) return;
    const noDrawn = new Set<string>();
    const noSkipped = new Set<string>();
    setDrawn(noDrawn);
    saveDrawn(noDrawn);
    setSkipped(noSkipped);
    saveSkipped(noSkipped);
    clearLastWinner();
    setLastWinner(null);
  }, [spinning]);

  const unmark = useCallback(
    (email: string) => {
      if (spinning) return;
      const next = new Set(drawn);
      next.delete(email);
      setDrawn(next);
      saveDrawn(next);
      // Se era o último vencedor, some também com o card do palco.
      if (lastWinner === email) {
        clearLastWinner();
        setLastWinner(null);
      }
    },
    [drawn, lastWinner, spinning],
  );

  const skip = useCallback(
    (email: string) => {
      // Um sorteado não pode ser marcado ausente — no card a ação nem aparece,
      // mas o hook não depende disso para estar correto.
      if (spinning || drawn.has(email)) return;
      const next = new Set(skipped);
      next.add(email);
      setSkipped(next);
      saveSkipped(next);
    },
    [drawn, skipped, spinning],
  );

  const unskip = useCallback(
    (email: string) => {
      if (spinning) return;
      const next = new Set(skipped);
      next.delete(email);
      setSkipped(next);
      saveSkipped(next);
    },
    [skipped, spinning],
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
