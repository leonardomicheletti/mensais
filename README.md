# Mensais — Controle dos Mensais

Painel de **orçado x realizado por área** com justificativas de estouro / pedidos de verba e **controle de acesso por área**, feito para a Controladoria (Norte).

O site é um **frontend estático** (HTML + CSS + JavaScript, gráficos em D3) que conversa com o **Supabase** (banco de dados + autenticação). A segurança — quem vê o quê — é garantida por **Row Level Security (RLS)** no banco: o servidor só devolve a cada pessoa as linhas das áreas liberadas para ela. Mesmo editando o navegador, ninguém acessa dados de outra área.

## Como funciona o acesso

- Cada pessoa **cria a própria conta** com o e-mail da empresa (apenas domínios autorizados).
- Ao entrar pela primeira vez, fica em **"aguardando liberação"**.
- O **admin** (Controladoria) abre a aba **Acessos** e libera cada pessoa para as áreas dela (ou "todas as áreas" para diretoria), e marca quem pode registrar justificativas.
- O admin importa os números de orçado x realizado pela aba **Dados** (upload de planilha CSV).

## Estrutura do projeto

```
index.html              o site (abas Painel, Justificativas, Acessos, Dados)
assets/
  app.js                autenticação, carga de dados, acessos e importação
  config.example.js     modelo de configuração — copie para config.js
supabase/
  schema.sql            tabelas, funções, gatilhos e políticas de RLS
  seed.sql              define o primeiro administrador
docs/
  SETUP.md              passo a passo para colocar no ar
  SECURITY.md           como os dados são protegidos (modelo de segurança)
  exemplos/             planilhas CSV de exemplo para a importação
```

## Começar

Siga **[docs/SETUP.md](docs/SETUP.md)** — leva ~15 minutos:

1. Criar um projeto no Supabase.
2. Rodar `supabase/schema.sql` no SQL Editor.
3. Preencher `assets/config.js` com a URL e a chave anon.
4. Publicar o site (Vercel, Cloudflare Pages, Netlify ou similar).
5. Criar sua conta, rodar `supabase/seed.sql` para virar admin.
6. Importar a planilha e liberar as pessoas.

Para entender por que isso é seguro, veja **[docs/SECURITY.md](docs/SECURITY.md)**.
