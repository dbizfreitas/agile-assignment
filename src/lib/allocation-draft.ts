import type { Allocation, AllocationStatus, AllocationTicket, AllocationTipo } from "@/lib/board";

// Fora do AllocationDialog para que aquele arquivo só exporte componente
// (Fast Refresh).
export type AllocationDraft = {
  id?: string;
  sprint_id: string;
  dev_id: string;
  title?: string;
  tickets?: AllocationTicket[];
  status?: AllocationStatus;
  tipo?: AllocationTipo;
  notes?: string | null;
  week_start?: number | null;
  week_end?: number | null;
};

export function toDraft(a: Allocation): AllocationDraft {
  return {
    id: a.id,
    sprint_id: a.sprint_id,
    dev_id: a.dev_id,
    title: a.title,
    tickets: a.tickets,
    status: a.status,
    tipo: a.tipo,
    notes: a.notes,
    week_start: a.week_start,
    week_end: a.week_end,
  };
}
