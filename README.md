# Dev Demand Flow

preciso de uma ferramenta de alocação de demandas para devs. Hoje utilizamos o excel neste formato da imagem mas fica muito bagunçado gostaria de uma ferramenta mais pratica e didatica.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://agile-assignment.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7989a179-56a5-4a45-be0c-bb78a62c25c7).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

### Variáveis de ambiente

Um clone novo já funciona sem configuração: o `.env` da raiz **é versionado
de propósito** e traz as credenciais públicas do Supabase.

Isso é deliberado, não um descuido. O build do Lovable clona este repositório
e o Vite só injeta `import.meta.env.VITE_*` a partir de arquivos `.env`
presentes no clone. Sem um `.env` rastreado, todo push derruba o preview com
*"Missing Supabase environment variable(s)"* — já aconteceu duas vezes
(`2e7eae8`, revertido por `b3bab03`; e de novo em `c906cc5`). Também não
adianta depender do `.env.production`: o Vite lê `.env` + `.env.<mode>`, então
um build em modo development ignora o `.env.production` por completo.

A regra que mantém isso seguro:

| Arquivo | Versionado? | O que pode conter |
|---|---|---|
| `.env` | **Sim** | Só valores públicos: publishable key, URL, project ID |
| `.env.production` | Sim | Idem, overrides do modo production |
| `.env.local` | **Não** (gitignored) | Todos os segredos |

Os valores do `.env` são públicos por design — o Vite já os embute no bundle
JavaScript servido a qualquer visitante do site. A proteção dos dados vem de
RLS no Supabase, não do sigilo desses valores.

**Nunca coloque em `.env`:** `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS por
completo), `MS_TENANT_ID`, `MS_CLIENT_ID`, tokens ou qualquer credencial.
Esses vão em `.env.local`, que é gitignored e tem precedência sobre o `.env`
no Vite.

## Migrations e setup pós-deploy pendentes

Mudanças de schema vivem em `supabase/migrations/*.sql` e não são aplicadas
automaticamente — depois de um `git pull`/merge que traga migrations novas,
aplique cada arquivo (em ordem de timestamp) colando o SQL no SQL Editor do
projeto Supabase, e rode o smoke test correspondente em `supabase/tests/`
para confirmar.

**Retrospectivas (participantes/sorteio no banco, issue #24):** além das
migrations, a foto de cada participante vem do Microsoft Graph e exige
configuração única:

1. Aplicar `supabase/migrations/20260902180000_retro_participants_foundation.sql`,
   `20260902181000_retro_ms_graph_token.sql` e `20260902182000_retro_roulette_rpcs.sql`
   (nessa ordem), depois rodar `supabase/tests/retro_participants_smoke.sql`.
2. Criar um `.env.local` (nunca commitar em `.env`) com `MS_TENANT_ID`,
   `MS_CLIENT_ID` (credenciais do app registration já usado pelo `jira-live`),
   `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings
   → API → service_role).
3. Rodar `npm run ms-graph:auth` uma vez, acessar o link mostrado e digitar
   o código — isso grava o token OAuth em `public.ms_graph_token`. Sem isso
   a guia funciona normalmente, só sem fotos (cai no fallback de iniciais).
