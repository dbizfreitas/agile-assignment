import { Ban, CirclePause, Undo2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  avatarColor,
  firstName,
  getInitials,
  DRAWN_COLOR,
  SKIPPED_COLOR,
  type Participant,
} from "@/lib/retrospectivas/participants";
import { cn } from "@/lib/utils";

export type ParticipantCardProps = {
  participant: Participant;
  index: number;
  photoUrl: string | undefined;
  drawn: boolean;
  skipped: boolean;
  highlighted: boolean;
  disabled: boolean; // true enquanto a roleta gira
  onUnmark: () => void;
  onSkip: () => void;
  onUnskip: () => void;
};

// Botão que cobre o card inteiro. Só existe quando o card tem ação (sorteado ou
// ausente) — e nesses estados o botão de "marcar ausente" não é renderizado,
// então nunca há <button> dentro de <button>.
const OVERLAY_BUTTON =
  "absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none";

export function ParticipantCard({
  participant,
  index,
  photoUrl,
  drawn,
  skipped,
  highlighted,
  disabled,
  onUnmark,
  onSkip,
  onUnskip,
}: ParticipantCardProps) {
  // Mesma regra do legado, incluindo os estados: cinza para sorteado, âmbar para
  // ausente, senão a cor da pessoa. Vai em style porque vem de dado — Tailwind
  // não gera classe para valor dinâmico.
  const color = drawn ? DRAWN_COLOR : skipped ? SKIPPED_COLOR : avatarColor(participant, index);

  return (
    <div
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition",
        drawn && "opacity-40 [&_img]:grayscale",
        skipped && "border-amber-500/60 bg-amber-500/10",
        highlighted && "bg-primary/15 ring-2 ring-primary",
      )}
    >
      <Avatar className="size-12">
        <AvatarImage src={photoUrl} alt="" />
        <AvatarFallback
          style={{ backgroundColor: color }}
          className="text-sm font-semibold text-white"
        >
          {getInitials(participant.name)}
        </AvatarFallback>
      </Avatar>

      <span
        className={cn(
          "max-w-full truncate text-xs font-medium",
          skipped && "text-amber-600 dark:text-amber-400",
        )}
      >
        {firstName(participant.name)}
      </span>

      {drawn ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onUnmark}
          aria-label={`Desmarcar ${participant.name} como sorteado`}
          className={OVERLAY_BUTTON}
        >
          <Undo2 aria-hidden className="absolute right-1 top-1 size-3.5 text-muted-foreground" />
        </button>
      ) : null}

      {skipped ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onUnskip}
          aria-label={`Reincluir ${participant.name} no sorteio`}
          className={OVERLAY_BUTTON}
        >
          <CirclePause
            aria-hidden
            className="absolute right-1 top-1 size-3.5 text-amber-600 dark:text-amber-400"
          />
        </button>
      ) : null}

      {!drawn && !skipped ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onSkip}
          aria-label={`Marcar ${participant.name} como ausente`}
          className={cn(
            "absolute right-1 top-1 rounded-full p-0.5 text-muted-foreground opacity-0",
            "transition hover:text-amber-600 focus-visible:opacity-100 group-hover:opacity-100",
            "disabled:pointer-events-none dark:hover:text-amber-400",
          )}
        >
          <Ban aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
