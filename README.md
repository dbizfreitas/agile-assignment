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
completo), `JIRA_API_TOKEN`, ou qualquer
credencial. Esses vão em `.env.local`, que é gitignored e tem precedência
sobre o `.env` no Vite.

#### Segredos de runtime (servidor)

Estas variáveis são lidas no servidor via `process.env` e **não são supridas
pelo `.env` versionado** — ele só carrega valores públicos. Sem elas o app
sobe normalmente, mas o recurso correspondente fica indisponível:

| Variável | Recurso afetado sem ela | Onde configurar |
|---|---|---|
| `JIRA_EMAIL` + `JIRA_API_TOKEN` | Abas Compromisso e Cycle Time: *"Credenciais do Jira não configuradas no servidor"* | `.env.local` (local) e painel do Lovable (produção) |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotas administrativas | idem |

Para o **preview publicado**, configure-as no painel do Lovable em
Project Settings → Environment Variables. Elas não podem vir do git: o
`.env` versionado é público, e o Lovable só enxerga o que está no repositório.

O `JIRA_API_TOKEN` é gerado em
[id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
O `JIRA_BASE_URL` tem default `https://way2agile.atlassian.net` e só precisa
ser definido se for outro.

## Migrations e setup pós-deploy pendentes

Mudanças de schema vivem em `supabase/migrations/*.sql` e não são aplicadas
automaticamente — depois de um `git pull`/merge que traga migrations novas,
aplique cada arquivo (em ordem de timestamp) colando o SQL no SQL Editor do
projeto Supabase, e rode o smoke test correspondente em `supabase/tests/`
para confirmar.

**Retrospectivas (participantes/sorteio no banco, issue #24):** aplicar
`supabase/migrations/20260902180000_retro_participants_foundation.sql`,
`20260902181000_retro_ms_graph_token.sql` e `20260902182000_retro_roulette_rpcs.sql`
(nessa ordem), depois rodar `supabase/tests/retro_participants_smoke.sql`.
A tabela criada pela segunda é removida mais tarde por
`20261014180000_drop_ms_graph_token.sql` (#106); aplique essa depois do
deploy do front.

**Fotos da roleta:** são gravadas à mão em
`retro_participants.photo_data_url`, como data-URI JPEG 120×120. A foto de
cada pessoa sai do Outlook Web (outlook.office.com/people), e o `UPDATE` roda
no SQL Editor:

    UPDATE public.retro_participants
    SET photo_data_url = 'data:image/jpeg;base64,...', photo_fetched_at = now()
    WHERE email = 'pessoa@way2.com.br';

Quem não tem foto no diretório recebe `''`, o marcador de "sem foto".
Enquanto ninguém grava, a pessoa aparece com as iniciais. A busca automática
pelo Microsoft Graph foi removida na #106: o login entre tenants é
bloqueado (AADSTS500213).
