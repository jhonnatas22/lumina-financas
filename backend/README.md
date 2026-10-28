# Lumina Finanças — Backend API

API REST do SaaS de Gestão Financeira. FastAPI + SQLite + JWT.

## Como rodar

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

- API: http://localhost:8000
- Documentação interativa (Swagger): http://localhost:8000/docs

## Rotas principais

| Método | Rota | Descrição |
|---|---|---|
| POST | /api/auth/register | Cadastro de usuário |
| POST | /api/auth/login | Login (JWT) — parâmetro opcional `role` |
| GET  | /api/auth/me | Dados do usuário logado |
| POST | /api/auth/recuperar | Recuperação de senha |
| GET/POST | /api/transacoes | Listar (com filtros) / criar movimentação |
| PUT/DELETE | /api/transacoes/{id} | Editar / excluir |
| POST | /api/importacao/csv | Importar linhas parseadas (JSON) |
| POST | /api/importacao/upload | Upload direto de arquivo .csv |
| GET  | /api/dashboard | KPIs, gráficos, alertas, evolução |
| GET/POST/PUT/DELETE | /api/metas | Metas financeiras |
| GET/POST/DELETE | /api/orcamentos | Orçamentos por categoria |
| GET  | /api/relatorios/mensal | Resumo mensal + ranking de categorias |
| GET  | /api/admin/stats | Estatísticas (apenas admin) |
| GET  | /api/funcionario/chamados | Fila de suporte (funcionário/admin) |

## Segurança

- Senhas com hash PBKDF2-SHA256 + salt aleatório
- Sessão via JWT (expiração configurável, padrão 7 dias)
- Cada usuário acessa exclusivamente os próprios dados (filtro por usuario_id em toda query)
- Controle de acesso por role: cliente, funcionario, admin

## Variáveis de ambiente

- `LUMINA_DB` — caminho do banco SQLite (padrão: lumina.db)
- `LUMINA_SECRET` — chave secreta do JWT (troque em produção)

## Exemplo de extrato aceito

Veja `extrato_exemplo.csv`. Formato: `data,descricao,valor,tipo` com data em dd/mm/aaaa.

## Deploy no Render

Esta pasta (`backend/`) já está pronta para ser publicada no Render como um único
Web Service — o FastAPI serve tanto a API quanto o frontend (arquivos em `static/`).

### Opção A — Blueprint (`render.yaml`), mais rápido

1. Suba o conteúdo desta pasta `backend/` para um repositório no GitHub/GitLab
   (ele já contém `static/` com o frontend, `main.py`, `requirements.txt` e `render.yaml`).
2. No Render, clique em **New > Blueprint**, aponte para o repositório.
3. O Render lê o `render.yaml` e cria o serviço automaticamente
   (`LUMINA_SECRET` é gerado sozinho).
4. Clique em **Apply** e aguarde o build.

### Opção B — Manual

1. Suba o repositório com o conteúdo desta pasta.
2. No Render: **New > Web Service**, conecte o repositório.
3. Configure:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Em **Environment**, adicione:
   - `LUMINA_SECRET` — uma string aleatória/segura (não use a chave padrão do código)
5. Deploy.

Depois do deploy, a aplicação inteira (telas + API) fica disponível na URL que o
Render gerar, ex.: `https://lumina-financas.onrender.com`.

### ⚠️ Sobre o banco de dados (SQLite)

Por padrão o app usa SQLite em arquivo local (`lumina.db`). No plano **free** do
Render o disco é **efêmero**: a cada novo deploy (ou quando a instância reinicia
por inatividade) o arquivo é apagado e os dados voltam ao estado inicial (seed demo).
Isso é ótimo para demonstração, mas não serve para dados reais de usuários.

Para persistir os dados de verdade, escolha uma das opções:

- **Render Disk** (planos pagos): anexe um disco persistente ao serviço, monte-o
  em `/var/data` e defina `LUMINA_DB=/var/data/lumina.db`.
- **Banco gerenciado**: trocar SQLite por Postgres (o Render oferece Postgres
  gerenciado) é a opção recomendada para produção — exige adaptar `main.py`
  (hoje usa `sqlite3` diretamente).

### Login de demonstração (seed automático)

Na primeira inicialização (banco vazio) o backend cria 3 contas de teste,
todas com senha `demo123`:

| E-mail | Perfil |
|---|---|
| cliente@lumina.com | Cliente |
| func@lumina.com | Funcionário |
| admin@lumina.com | Admin |
