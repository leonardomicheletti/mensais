-- =====================================================================
--  Definir o primeiro administrador (Controladoria)
-- ---------------------------------------------------------------------
--  Como ninguem comeca como admin, o primeiro admin e definido aqui,
--  manualmente, UMA vez. Depois, o admin libera as demais pessoas pela
--  propria tela de "Acessos" do site.
--
--  PASSOS:
--   1. Primeiro faca seu CADASTRO no site (com o e-mail da Controladoria),
--      confirmando o e-mail se o Supabase pedir.
--   2. So depois rode este comando, trocando o e-mail abaixo se precisar.
-- =====================================================================

update public.profiles
   set role = 'admin'
 where email = 'renan.cortes@cscdoesporte.com.br';

-- Confira o resultado:
--   select id, email, name, role from public.profiles order by criado_em;

-- Opcional: ja deixar registrado o e-mail de destino das justificativas
-- (aparece no botao "Abrir e-mail" da aba Justificativas). Tambem da para
-- configurar isso depois, direto pela tabela config.
update public.config
   set email_controladoria = 'renan.cortes@cscdoesporte.com.br'
 where id = 1;
