// Único módulo que sabe de onde vem a foto. Trocar o arquivo local por um bucket
// do Supabase Storage depois é mudança daqui, e de mais nenhum arquivo.

// O curinga é de propósito: se photos-cache.ts não existir, `modules` é {} e o
// build passa. Um import estático quebraria o build em qualquer clone limpo —
// e o cache é gitignorado, então todo clone é um clone limpo.
//
// Consequência: nenhum outro arquivo pode casar com "./photos-cache*.ts". Sem
// .example, sem .sample. Para documentar o formato, use um .md.
//
// eager: true coloca o cache no chunk da rota /retrospectivas, baixado só quando
// alguém abre a tela. Se 1,3 MB nesse chunk incomodar, trocar para eager: false
// + useQuery é mudança contida neste arquivo — por isso o resto do código só
// conhece getPhoto.
const modules = import.meta.glob<{ PHOTOS: Record<string, string> }>("./photos-cache*.ts", {
  eager: true,
});

const PHOTOS: Record<string, string> = Object.values(modules)[0]?.PHOTOS ?? {};

// Normaliza para minúsculas: evita "por que a foto do Fulano sumiu" por causa de
// uma maiúscula na chave do cache (desvio 8). noUncheckedIndexedAccess já torna o
// retorno `string | undefined` — o opcional é o tipo natural, não um `as`.
export function getPhoto(email: string): string | undefined {
  return PHOTOS[email.toLowerCase()];
}
