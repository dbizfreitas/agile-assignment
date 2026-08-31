import { SelectItem } from "@/components/ui/select";
import { TEAM_COLORS, type Team } from "@/lib/board";

/**
 * Faixa de bolinhas de cor clicáveis para escolher a cor de um time. Extraída
 * do TeamsDialog e do DevDialog (achado de duplicação no code review do PR
 * #33): as duas cópias só divergiam no par de estado (`draftColor` vs
 * `newTeamColor`) que cada diálogo usa para guardar a seleção.
 */
export function TeamColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TEAM_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          style={{ backgroundColor: c }}
          className={`size-7 rounded-full transition-transform ${
            value === c ? "scale-110 ring-2 ring-ring ring-offset-2" : ""
          }`}
          aria-label={`Cor ${c}`}
        />
      ))}
    </div>
  );
}

/**
 * `SelectItem` com a bolinha de cor do time — mesma extração acima, para a
 * opção que aparece no seletor de time do DevDialog e no seletor de destino
 * do TeamsDialog.
 */
export function TeamSelectOption({ team }: { team: Pick<Team, "id" | "name" | "color"> }) {
  return (
    <SelectItem value={team.id}>
      <span className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
        {team.name}
      </span>
    </SelectItem>
  );
}
