-- =====================================================================
--  Controle dos Mensais — Esquema do banco de dados (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------
--  Rode este arquivo UMA vez no SQL Editor do Supabase (projeto novo).
--  Ele cria as tabelas, as funcoes de permissao, os gatilhos e, o mais
--  importante, as politicas de Row Level Security (RLS) que garantem que
--  cada pessoa so enxergue os dados das areas liberadas para ela.
--
--  Depois de rodar: veja supabase/seed.sql para virar admin, e
--  docs/SETUP.md para o passo a passo completo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Dominios de e-mail autorizados a criar conta
--    Para alterar depois, edite a lista dentro de check_email_domain().
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------

-- Perfil de cada usuario (1:1 com auth.users). Criado automaticamente
-- no cadastro pelo gatilho handle_new_user().
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  role        text    not null default 'user' check (role in ('user', 'admin')),
  can_write   boolean not null default false,  -- pode registrar justificativas (colaborador)
  ver_todas   boolean not null default false,  -- ve todas as areas sem ser admin (diretoria)
  criado_em   timestamptz not null default now()
);

-- Quais areas cada pessoa pode ver (so para quem NAO tem ver_todas/admin).
create table if not exists public.user_areas (
  user_id uuid not null references auth.users(id) on delete cascade,
  area    text not null,
  primary key (user_id, area)
);

-- Orcado x realizado por area e mes (um ano por vez).
create table if not exists public.mensal (
  id        bigint generated always as identity primary key,
  area      text not null,
  mes       int  not null check (mes between 1 and 12),
  ano       int  not null,
  orcado    numeric,
  realizado numeric,
  unique (area, mes, ano)
);

-- Orcado x realizado por conta, dentro de cada area e mes.
create table if not exists public.contas (
  id        bigint generated always as identity primary key,
  area      text not null,
  conta     text not null,
  mes       int  not null check (mes between 1 and 12),
  ano       int  not null,
  orcado    numeric,
  realizado numeric,
  unique (area, conta, mes, ano)
);

-- Gasto da empresa em contas sem orcamento aprovado (total mensal).
-- So e visivel para admin e para quem ve todas as areas.
create table if not exists public.sem_orcamento (
  id    bigint generated always as identity primary key,
  mes   int not null check (mes between 1 and 12),
  ano   int not null,
  valor numeric,
  unique (mes, ano)
);

-- Configuracao geral (linha unica, id = 1).
create table if not exists public.config (
  id                 int primary key default 1 check (id = 1),
  email_controladoria text,
  ano_corrente       int not null default extract(year from now())::int
);
insert into public.config (id) values (1) on conflict (id) do nothing;

-- Justificativas de estouro / pedidos de verba + a decisao da Controladoria.
create table if not exists public.justificativas (
  codigo           text primary key,
  area             text not null,
  mes              int  not null check (mes between 1 and 12),
  ano              int  not null,
  tipo             text not null check (tipo in ('estouro', 'verba')),
  orcado           numeric,
  realizado        numeric,
  diferenca        numeric,
  uso              numeric,
  valor_solicitado numeric,
  motivo           text not null,
  acao             text,
  contas           jsonb,
  author_id        uuid not null references auth.users(id) on delete cascade,
  autor_nome       text,
  criado_em        timestamptz not null default now(),
  -- decisao da Controladoria
  status           text not null default 'Aguardando análise'
                     check (status in ('Aguardando análise', 'Em análise', 'Aprovada', 'Recusada')),
  comentario       text,
  decidido_por     uuid references auth.users(id),
  decidido_em      timestamptz
);

create index if not exists justificativas_author_idx on public.justificativas (author_id);
create index if not exists justificativas_area_idx   on public.justificativas (area, ano);
create index if not exists mensal_ano_idx             on public.mensal (ano);
create index if not exists contas_ano_idx             on public.contas (ano);

-- ---------------------------------------------------------------------
-- 2. Funcoes de permissao (SECURITY DEFINER para poderem ler profiles
--    sem esbarrar nas proprias politicas de RLS e sem recursao).
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Admin OU diretoria (ve_todas): enxerga todas as areas.
create or replace function public.ve_todas()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role = 'admin' or ver_todas = true)
  );
$$;

-- Pode ver uma area especifica?
create or replace function public.pode_ver_area(a text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ve_todas()
      or exists (select 1 from public.user_areas where user_id = auth.uid() and area = a);
$$;

-- Pode registrar justificativas? (admin ou colaborador)
create or replace function public.pode_escrever()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role = 'admin' or can_write = true)
  );
$$;

grant execute on function public.is_admin(), public.ve_todas(),
  public.pode_ver_area(text), public.pode_escrever() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Gatilhos: criar perfil no cadastro e travar dominio de e-mail
-- ---------------------------------------------------------------------

-- Cria o perfil automaticamente quando alguem se cadastra.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trava de dominio: so e-mails dos dominios autorizados podem se cadastrar.
-- Defesa em profundidade (alem da validacao na tela de login).
-- >>> Para mudar os dominios, edite a lista abaixo. <<<
create or replace function public.check_email_domain()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  dominio text;
  permitidos text[] := array[
    'cscdoesporte.com.br',
    'nortemkt.com',
    'eventsupply.com.br',
    'ativo.com',
    'ttkmarketing.com.br'
  ];
begin
  dominio := lower(split_part(new.email, '@', 2));
  if not (dominio = any (permitidos)) then
    raise exception 'Dominio de e-mail nao autorizado: %', dominio
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists check_email_domain_trg on auth.users;
create trigger check_email_domain_trg
  before insert on auth.users
  for each row execute function public.check_email_domain();

-- ---------------------------------------------------------------------
-- 4. Row Level Security — a trava de verdade contra vazamento de dados
-- ---------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.user_areas     enable row level security;
alter table public.mensal         enable row level security;
alter table public.contas         enable row level security;
alter table public.sem_orcamento  enable row level security;
alter table public.config         enable row level security;
alter table public.justificativas enable row level security;

-- profiles: cada um ve o proprio; admin ve todos; so admin altera.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin());
-- (sem politica de INSERT: perfis sao criados pelo gatilho handle_new_user)

-- user_areas: cada um ve as proprias areas; admin ve e gerencia todas.
drop policy if exists user_areas_select on public.user_areas;
create policy user_areas_select on public.user_areas
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists user_areas_write on public.user_areas;
create policy user_areas_write on public.user_areas
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- mensal: SELECT so das areas liberadas; escrita so admin.
drop policy if exists mensal_select on public.mensal;
create policy mensal_select on public.mensal
  for select to authenticated
  using (public.pode_ver_area(area));

drop policy if exists mensal_write on public.mensal;
create policy mensal_write on public.mensal
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- contas: idem mensal.
drop policy if exists contas_select on public.contas;
create policy contas_select on public.contas
  for select to authenticated
  using (public.pode_ver_area(area));

drop policy if exists contas_write on public.contas;
create policy contas_write on public.contas
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- sem_orcamento: so admin e diretoria (ve_todas); escrita so admin.
drop policy if exists sem_orcamento_select on public.sem_orcamento;
create policy sem_orcamento_select on public.sem_orcamento
  for select to authenticated
  using (public.ve_todas());

drop policy if exists sem_orcamento_write on public.sem_orcamento;
create policy sem_orcamento_write on public.sem_orcamento
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- config: qualquer logado le (so o e-mail da Controladoria e o ano); so admin altera.
drop policy if exists config_select on public.config;
create policy config_select on public.config
  for select to authenticated using (true);

drop policy if exists config_write on public.config;
create policy config_write on public.config
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- justificativas:
--   ver   -> o proprio autor ve as suas; admin ve todas
--   criar -> so o proprio autor, se puder escrever e puder ver a area
--   decidir (update) e apagar -> so admin
drop policy if exists justificativas_select on public.justificativas;
create policy justificativas_select on public.justificativas
  for select to authenticated
  using (author_id = auth.uid() or public.is_admin());

drop policy if exists justificativas_insert on public.justificativas;
create policy justificativas_insert on public.justificativas
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.pode_escrever()
    and public.pode_ver_area(area)
  );

drop policy if exists justificativas_update on public.justificativas;
create policy justificativas_update on public.justificativas
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists justificativas_delete on public.justificativas;
create policy justificativas_delete on public.justificativas
  for delete to authenticated
  using (public.is_admin());

-- =====================================================================
--  Fim. Proximo passo: supabase/seed.sql (defina o primeiro admin).
-- =====================================================================
