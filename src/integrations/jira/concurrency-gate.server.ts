// Server-only. Limita quantas requisições "caras" (fan-out de várias
// chamadas pro Jira, ex.: getJiraIssues) rodam ao mesmo tempo NO PROCESSO —
// evita que várias chamadas simultâneas multipliquem o fan-out sem limite.
const MAX_CONCURRENT = 4;
let active = 0;
const queue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

export async function withConcurrencyGate<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
