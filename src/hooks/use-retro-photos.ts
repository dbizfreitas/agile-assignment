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
    // "" é o sentinel de "Graph confirmou que a pessoa não tem foto" (ver
    // NO_PHOTO_SENTINEL em photos.server.ts) — trata igual a null/undefined
    // aqui, já que pra UI as duas coisas significam "mostra as iniciais".
    const data = results[i]?.data;
    photos[email] = data ? data : undefined;
  });
  return photos;
}
