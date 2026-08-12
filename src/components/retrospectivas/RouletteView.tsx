import { RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useRoulette } from "@/hooks/use-roulette";
import { getPhoto } from "@/lib/retrospectivas/photos";
import {
  avatarColor,
  getInitials,
  shortName,
  PARTICIPANTS,
} from "@/lib/retrospectivas/participants";
import { ParticipantCard } from "./ParticipantCard";

export function RouletteView() {
  const roulette = useRoulette();

  const drawnCount = roulette.drawn.size;
  const skippedCount = roulette.skipped.size;
  const plural = skippedCount > 1 ? "s" : "";
  const counter =
    skippedCount > 0
      ? `${drawnCount} / ${PARTICIPANTS.length} sorteados · ${skippedCount} ausente${plural}`
      : `${drawnCount} / ${PARTICIPANTS.length} sorteados`;

  // O card do vencedor vive aqui: são ~15 linhas de JSX que não se repetem em
  // lugar nenhum — extrair componente só espalharia props.
  const winnerIndex = PARTICIPANTS.findIndex((p) => p.email === roulette.lastWinner);
  const winner = winnerIndex === -1 ? undefined : PARTICIPANTS[winnerIndex];

  return (
    // A roleta é a única das quatro sem rolagem interna própria, então ela
    // rola inteira: `flex-1` + `overflow-y-auto` no lugar do `min-h-screen`.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4">
        {/* Contador é texto real, já legível por leitor de tela. Estava no
            cabeçalho do painel; desce para cá, acima do Card. */}
        <p className="text-[11px] text-muted-foreground">{counter}</p>

        <Card className="flex flex-col items-center gap-4 p-6">
          {/* A região aria-live existe desde o primeiro render, mesmo vazia: é o
              que faz o leitor de tela anunciar o vencedor quando ele aparece. */}
          <div aria-live="polite" className="flex min-h-[7rem] items-center justify-center">
            {winner ? (
              <div
                key={winner.email}
                className="flex animate-in flex-col items-center gap-1 duration-300 zoom-in-95"
              >
                <Avatar className="size-16 ring-2 ring-primary">
                  <AvatarImage src={getPhoto(winner.email)} alt="" />
                  <AvatarFallback
                    style={{ backgroundColor: avatarColor(winner, winnerIndex) }}
                    className="text-lg font-semibold text-white"
                  >
                    {getInitials(winner.name)}
                  </AvatarFallback>
                </Avatar>
                <p className="text-base font-semibold">{shortName(winner.name)}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  sorteado!
                </p>
              </div>
            ) : null}
          </div>

          {/* Desabilita por availableCount, não por drawn.size: com todo mundo
              restante marcado ausente, o botão do legado ficava clicável e não
              fazia nada (desvio 3). */}
          <Button
            size="lg"
            onClick={roulette.spin}
            disabled={roulette.spinning || roulette.availableCount === 0}
          >
            <Shuffle className="size-5" /> Sortear
          </Button>

          {drawnCount > 0 || skippedCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={roulette.reset} disabled={roulette.spinning}>
              <RotateCcw className="size-4" /> Reiniciar
            </Button>
          ) : null}
        </Card>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
          {PARTICIPANTS.map((p, i) => (
            <ParticipantCard
              key={p.email}
              participant={p}
              index={i}
              drawn={roulette.drawn.has(p.email)}
              skipped={roulette.skipped.has(p.email)}
              highlighted={roulette.highlight === p.email}
              disabled={roulette.spinning}
              onUnmark={() => roulette.unmark(p.email)}
              onSkip={() => roulette.skip(p.email)}
              onUnskip={() => roulette.unskip(p.email)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
