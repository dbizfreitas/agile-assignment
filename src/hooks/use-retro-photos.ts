import { useQueries } from "@tanstack/react-query";
import { getParticipantPhoto } from "@/integrations/ms-graph/server-fns";

// Uma query por e-mail (cacheada individualmente pelo react-query,
// staleTime alto complementar ao cache em coluna do banco — Task 4) em vez
// de uma chamada em lote: assim cada foto aparece assim que chega, sem
// esperar a mais lenta do grupo, e falhas isoladas (pessoa sem foto no
// Graph) não derrubam as demais.
export function useRetroPhotos(emails: readonly string[]): Record<string, string | undefined> {
  const results = useQueries({
    queries: emails.map((email) => ({
      queryKey: ["retro-photo", email],
      staleTime: 12 * 60 * 60 * 1000,
      queryFn: () => getParticipantPhoto({ data: email }),
    })),
  });

  const photos: Record<string, string | undefined> = {};
  emails.forEach((email, i) => {
    photos[email] = results[i]?.data ?? undefined;
  });
  return photos;
}
