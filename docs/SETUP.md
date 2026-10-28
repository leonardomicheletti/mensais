# Guia de instalação — Controle dos Mensais

Passo a passo para colocar o site no ar com Supabase. Não precisa saber programar; é seguir na ordem.

---

## 1. Criar o projeto no Supabase

1. Acesse https://supabase.com e crie uma conta (pode usar o login do GitHub).
2. Clique em **New project**. Dê um nome (ex.: `mensais`), escolha uma **senha do banco** (guarde-a) e a região **South America (São Paulo)**.
3. Espere ~2 minutos até o projeto ficar pronto.

## 2. Criar as tabelas e as regras de segurança

1. No menu lateral do Supabase, abra **SQL Editor**.
2. Clique em **New query**, abra o arquivo `supabase/schema.sql` deste repositório, copie **todo** o conteúdo e cole no editor.
3. Clique em **Run**. Deve aparecer "Success".

> Isso cria as tabelas (`mensal`, `contas`, `justificativas`, `profiles`, etc.), as funções de permissão, os gatilhos de cadastro e **todas as políticas de RLS**. Rode uma vez só.

### Confirmar o e-mail e a senha
Em **Authentication → Providers → Email**, deixe **Email** habilitado. Para a empresa:
- **Confirm email** ligado (recomendado): a pessoa confirma o e-mail antes de entrar.
- Em **Authentication → URL Configuration**, coloque em **Site URL** o endereço onde o site vai ficar (passo 4), para os links de confirmação apontarem certo.

## 3. Configurar o frontend

1. No Supabase, vá em **Project Settings → API** e copie:
   - **Project URL**
   - a chave **anon public**
2. No repositório, copie o modelo:
   ```bash
   cp assets/config.example.js assets/config.js
   ```
3. Abra `assets/config.js` e cole a URL e a chave anon nos campos indicados.

> A chave **anon** é pública de propósito — pode aparecer no navegador. Quem protege os dados é o RLS. **Nunca** use aqui a chave `service_role`.

Os domínios de e-mail autorizados já vêm preenchidos (`cscdoesporte.com.br`, `nortemkt.com`, `eventsupply.com.br`, `ativo.com`, `ttkmarketing.com.br`) em dois lugares, que devem ficar iguais:
- `assets/config.js` (campo `ALLOWED_DOMAINS`) — para a mensagem na tela;
- `supabase/schema.sql`, função `check_email_domain` — a trava de verdade no banco.

## 4. Publicar o site

É um site estático (uma pasta de arquivos). Qualquer hospedagem de site estático serve. Opções gratuitas e fáceis:

- **Cloudflare Pages** ou **Vercel** ou **Netlify**: conecte este repositório do GitHub; sem build; a pasta a publicar é a raiz do projeto. Lembre de subir o `assets/config.js` (ele não vai pelo Git; configure-o no painel da hospedagem ou crie o arquivo no deploy).
- **GitHub Pages**: também funciona (repositório privado exige plano pago para Pages privado; o site tem login de qualquer forma).

Depois de publicado, copie o endereço (ex.: `https://mensais.pages.dev`) e cole em **Supabase → Authentication → URL Configuration → Site URL**.

## 5. Virar administrador

1. Abra o site publicado, clique em **Primeiro acesso — criar conta** e cadastre-se com `controladoria@cscdoesporte.com.br`. Confirme o e-mail se o Supabase pedir.
2. Entre uma vez (para o perfil ser criado).
3. No Supabase, **SQL Editor**, rode o `supabase/seed.sql` (ele marca esse e-mail como `admin` e grava o e-mail da Controladoria na config).
4. Recarregue o site: você agora vê as abas **Acessos** e **Dados**.

## 6. Importar os dados e liberar as pessoas

1. Aba **Dados**: escolha o **ano**, suba os CSVs (modelos em `docs/exemplos/`) e clique em **Importar**.
   - `mensal.csv`: colunas `area, mes, orcado, realizado`
   - `contas.csv`: colunas `area, conta, mes, orcado, realizado`
   - `sem_orcamento.csv`: colunas `mes, valor`
   - Aceita separador `,` ou `;` e números no formato brasileiro (`1.234,56`). Cada importação **substitui** os dados daquele ano.
2. Aba **Acessos**: conforme as pessoas forem se cadastrando, elas aparecem como "Aguardando liberação". Marque as áreas de cada uma (ou "Todas as áreas" para diretoria), marque "colaborador" para quem pode registrar justificativas, e clique em **Liberar acesso**.

Pronto. Cada pessoa liberada vê só a(s) área(s) dela.

---

## Perguntas comuns

**Como adiciono outro domínio de e-mail depois?**
Edite a lista nos dois lugares (passo 3) e rode de novo, no SQL Editor, apenas a função `check_email_domain` do `schema.sql`.

**Como promovo outro administrador?**
Por segurança, admins são definidos por SQL (não pela tela). No SQL Editor:
```sql
update public.profiles set role = 'admin' where email = 'fulano@empresa.com';
```

**Esqueci/preciso trocar a senha de alguém.**
O usuário usa "esqueci a senha" na tela de login (requer o provedor de e-mail configurado no Supabase), ou você reseta em **Authentication → Users**.

**Atualizar os números do mês.**
Reimporte a planilha do ano na aba **Dados** — ela substitui os dados daquele ano.
