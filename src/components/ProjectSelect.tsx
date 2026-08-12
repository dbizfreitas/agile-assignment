import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ProjectOption = { key: string; name: string };

// As opções vêm por PROP, nunca de um import de JIRA_PROJECTS aqui dentro: a
// casca compartilhada da navegação unificada vai reaproveitar este componente
// com a lista dela (possivelmente a do Jira), e um import interno obrigaria a
// reescrevê-lo.
export function ProjectSelect({
  value,
  options,
  onChange,
  className,
}: {
  value: string | null;
  options: readonly ProjectOption[];
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    // O spread condicional é o mesmo de CycleTimeView: com
    // exactOptionalPropertyTypes ligado, passar `value={undefined}` não
    // compila, e o Radix precisa da prop ausente para ficar não-controlado
    // enquanto nada está selecionado.
    <Select {...(value ? { value } : {})} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-9 w-56"} aria-label="Projeto">
        <SelectValue placeholder="Selecione um projeto…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p.key} value={p.key}>
            {p.key === p.name ? p.key : `${p.key} — ${p.name}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
