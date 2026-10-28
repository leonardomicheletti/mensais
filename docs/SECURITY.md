# Modelo de segurança — Controle dos Mensais

Este documento explica **por que os dados não vazam entre áreas** e quais são os limites do sistema. A ideia central: a decisão de "quem pode ver o quê" acontece **no servidor (Postgres/Supabase)**, nunca só no navegador.

## Princípio: a trava está no banco, não na tela

O frontend (HTML/JS) é público por natureza — qualquer pessoa pode ler o código, abrir o console e chamar a API. Por isso **ele não é a defesa**. A defesa é o **Row Level Security (RLS)** do PostgreSQL: cada consulta passa por políticas que decidem, linha a linha, o que aquele usuário pode ver.

Se um colaborador da área "Marketing" tentar ler a tabela `mensal` inteira (pela tela ou chamando a API direto com a chave pública), o banco devolve **apenas** as linhas de Marketing. As demais simplesmente não saem do servidor.

## Papéis

| Papel | Como é definido | O que vê |
|------|------------------|----------|
| **admin** (Controladoria) | `profiles.role = 'admin'`, via SQL | Tudo; gerencia acessos e importa dados |
| **diretoria** (vê todas) | `profiles.ver_todas = true`, pela tela Acessos | Todas as áreas, mas não gerencia acessos |
| **colaborador / área** | linhas em `user_areas`, pela tela Acessos | Só as áreas liberadas; registra justificativas se `can_write` |
| **aguardando** | cadastrou mas sem áreas | Nada além da tela "aguardando liberação" |

## As funções de permissão

Definidas em `supabase/schema.sql` (todas `security definer`, para avaliarem o perfil sem recursão de RLS):

- `is_admin()` — o usuário atual é admin?
- `ve_todas()` — admin ou diretoria (vê todas as áreas)?
- `pode_ver_area(area)` — vê aquela área específica? (`ve_todas()` ou tem a área em `user_areas`)
- `pode_escrever()` — pode registrar justificativas? (admin ou `can_write`)

## As políticas (resumo)

| Tabela | Ler (SELECT) | Escrever |
|--------|--------------|----------|
| `mensal`, `contas` | `pode_ver_area(area)` | só admin |
| `sem_orcamento` | `ve_todas()` | só admin |
| `justificativas` | o próprio autor **ou** admin | inserir: só o próprio autor, se `pode_escrever()` e `pode_ver_area(area)`; decidir/apagar: só admin |
| `profiles` | o próprio **ou** admin | só admin |
| `user_areas` | as próprias **ou** admin | só admin |
| `config` | qualquer logado (só e-mail da Controladoria e ano) | só admin |

Consequências:
- Uma área **não vê** os números nem as justificativas de outra área.
- Um colaborador **não pode** se auto-promover nem mudar as próprias áreas (só admin altera `profiles` e `user_areas`).
- Gastos "sem orçamento" (visão da empresa) ficam restritos a admin e diretoria.

## Autenticação e cadastro

- Login por e-mail/senha gerenciado pelo **Supabase Auth** (senhas com hash, nunca no nosso código).
- **Trava de domínio** em duas camadas: a tela recusa domínios fora da lista, e o gatilho `check_email_domain` no banco **bloqueia o cadastro** de qualquer e-mail fora dos domínios autorizados — mesmo que alguém tente burlar a tela.
- Recomendado deixar a **confirmação de e-mail** ligada no Supabase.

## A chave "anon" é pública — e tudo bem

A chave `anon` que fica em `assets/config.js` é pública por design. Ela só permite **tentar** operações; o que de fato é permitido é decidido pelo RLS. O que **nunca** deve aparecer no frontend é a chave `service_role` (ela ignora o RLS). Ela não é usada neste projeto.

## Limites e recomendações

- **RLS tem que estar ligado.** O `schema.sql` já faz `enable row level security` em todas as tabelas. Não desligue, e não crie políticas `using (true)` para escrita.
- **Confira os domínios** nos dois lugares (`config.js` e `check_email_domain`) ao mudar a lista.
- **Admins por SQL.** Promover admin só via banco reduz o risco de um clique errado dar acesso total.
- **HTTPS.** Publique o site sempre em HTTPS (Vercel/Cloudflare/Netlify já fornecem).
- **Backups.** O Supabase faz backups automáticos; confira a política de retenção do seu plano.
- **Revisão de acessos.** De tempos em tempos, revise na aba Acessos quem tem o quê e remova quem saiu da empresa (ou apague o usuário em Authentication → Users).

## O que este modelo NÃO cobre

- Não há trilha de auditoria detalhada de quem viu o quê (só o registro de decisões nas justificativas). Se precisar, dá para adicionar logs depois.
- Proteção contra um admin mal-intencionado: admin vê tudo por definição. Dê admin a poucas pessoas.
