# Painel de Prioridades — API + Autenticação (TiDB Cloud)

Backend em Node.js/Express com login por usuário (e-mail + senha) e as
tarefas de cada um isoladas no banco. Pensado pra rodar contra um cluster
**TiDB Cloud Serverless** (tem free tier).

## 1. Criar o banco no TiDB Cloud

1. Crie uma conta em https://tidbcloud.com e crie um cluster **Serverless** (grátis).
2. No painel do cluster, clique em **Connect** → escolha **Node.js**.
3. Copie os dados de conexão (host, porta, usuário, senha) — a senha só
   aparece uma vez na criação, guarde em local seguro.
4. Crie o banco (schema) chamado `painel` — pode ser pela aba **SQL Editor**
   do próprio TiDB Cloud, rodando:
   ```sql
   CREATE DATABASE painel;
   ```

## 2. Configurar o projeto

```bash
npm install
cp .env.example .env
```

Edite o `.env` com os dados que o TiDB Cloud te deu (`TIDB_HOST`,
`TIDB_USER`, `TIDB_PASSWORD`, etc). Gere um `JWT_SECRET` aleatório:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. Criar as tabelas

```bash
npm run migrate
```

Isso roda `src/schema.sql` e cria as tabelas `users` e `tasks`.

## 4. Rodar localmente

```bash
npm run dev
```

A API sobe em `http://localhost:3000`. Teste com:

```bash
curl http://localhost:3000/health
```

## Endpoints

### Autenticação

| Método | Rota | Body | Descrição |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password, name? }` | Cria conta, retorna `{ user, token }` |
| POST | `/api/auth/login` | `{ email, password }` | Retorna `{ user, token }` |
| GET | `/api/auth/me` | — (precisa de `Authorization: Bearer <token>`) | Dados do usuário logado |

A senha precisa ter no mínimo 8 caracteres. Senhas são armazenadas com
`bcrypt` (nunca em texto puro).

### Tarefas (todas exigem `Authorization: Bearer <token>`)

| Método | Rota | Body | Descrição |
|---|---|---|---|
| GET | `/api/tasks?date=YYYY-MM-DD` | — | Lista tarefas do usuário logado, naquele dia |
| POST | `/api/tasks` | `{ description, criticality, effort, status, date, dueDate? }` | Cria tarefa |
| PATCH | `/api/tasks/:id` | qualquer subconjunto dos campos acima | Atualiza (usado por editar, mudar status, transbordar — só mandar `date` novo) |
| DELETE | `/api/tasks/:id` | — | Exclui |
| POST | `/api/tasks/import` | `{ tasks: [ {...}, {...} ] }` | Importa várias de uma vez (máx. 500) |
| GET | `/api/tasks/deadlines?ref=YYYY-MM-DD&days=7` | — | Agenda de prazos: atrasadas, vencendo hoje e próximas |

Campos:
- `criticality`: 1 (Baixa) a 4 (Crítica)
- `effort`: 1 a 5
- `status`: `afazer` \| `andamento` \| `concluida`
- `date`: `YYYY-MM-DD` — o dia em que a tarefa aparece no painel
- `dueDate`: `YYYY-MM-DD` ou `null` — **prazo final**, opcional. Não pode ser
  anterior a `date`. Mandar `null` no PATCH remove o prazo.
- `completedAt` (só leitura): carimbo de quando a tarefa foi para `concluida` —
  serve para saber, depois, se o prazo foi cumprido. É preenchido/limpo
  automaticamente quando o `status` muda.

### Prazos

`GET /api/tasks/deadlines` recebe `ref` (a data considerada "hoje" — quem manda é
o cliente, para respeitar o fuso do usuário) e `days` (janela à frente, padrão 7,
máx. 90). Devolve:

```json
{
  "ref": "2026-08-18",
  "days": 7,
  "counts": { "overdue": 1, "dueToday": 2, "upcoming": 3 },
  "overdue":  [ { "id": "...", "dueDate": "2026-08-16", "daysLeft": -2, "...": "" } ],
  "dueToday": [],
  "upcoming": []
}
```

Tarefas concluídas não entram — prazo cumprido não é mais cobrança.

Cada tarefa só pode ser lida/editada/excluída pelo dono (`user_id` é
sempre conferido contra o token) — um usuário nunca vê tarefa de outro.

## 5. Deploy

Qualquer host de Node serve (Railway, Render, Fly.io). Passos gerais:

1. Suba este projeto pro GitHub.
2. Conecte o repositório na plataforma escolhida.
3. Configure as mesmas variáveis do `.env` nas "Environment Variables" do host.
4. Rode `npm run migrate` uma vez (via terminal da plataforma, ou local
   apontando pro banco de produção) antes do primeiro deploy da API.
5. Start command: `npm start`.

## Controle de prazos no painel web

O `index.html` tem controle de prazos independente da API (ainda em
`localStorage`, campo `due` em cada tarefa):

- Campo **Prazo** opcional no formulário e na edição.
- Etiqueta em cada linha: `Atrasada Nd`, `Vence hoje`, `Vence amanhã`,
  `Vence em Nd` ou a data curta (`31/08`) quando falta mais de uma semana.
- **A ordenação passou a considerar o prazo antes da criticidade**: atrasadas e
  vencendo hoje sobem ao topo mesmo sendo de criticidade baixa. Empatado o prazo,
  vale a regra antiga (criticidade > esforço > status).
- **Barra "Prazos"** no topo da lista: varre *todos* os dias, não só o aberto —
  é o que impede uma tarefa esquecida em outra data de sumir de vista. Clicar em
  um item leva ao dia daquela tarefa.
- Transbordar para um dia depois do prazo pede confirmação.
- O prazo não pode ser anterior ao dia da tarefa (validado no front e na API).

## Próximo passo

O painel web (HTML) ainda salva tudo em `localStorage`, sem login. O
próximo passo é trocar isso por: uma tela de login/cadastro, guardar o
`token` retornado, e trocar as chamadas de `localStorage` por `fetch`
nesses endpoints. Posso montar essa versão do frontend quando você
quiser seguir.
