// =====================================================================
//  Configuracao do frontend (usada pelo site publicado no GitHub Pages).
//
//  >>> PREENCHA os dois valores abaixo com os dados do SEU projeto Supabase. <<<
//  Painel do Supabase > Project Settings > API:
//    - Project URL                    -> SUPABASE_URL
//    - Project API keys > anon public -> SUPABASE_ANON_KEY
//
//  Pode editar este arquivo direto pelo GitHub (botao do lapis) e salvar:
//  o site se republica sozinho em ~1 minuto.
//
//  A chave "anon" e PUBLICA de proposito; quem protege os dados e o RLS no
//  banco (supabase/schema.sql). NUNCA use aqui a chave "service_role".
// =====================================================================

window.CONFIG = {
  SUPABASE_URL: "https://yurstexfxxazggthqzwd.supabase.co/rest/v1/",
  SUPABASE_ANON_KEY: "sb_publishable_etE_nYayQenROc9e6YFSVA_UpqzdM1e",

  // Dominios de e-mail que podem criar conta (so para a mensagem na tela;
  // a trava de verdade esta em supabase/schema.sql > check_email_domain).
  ALLOWED_DOMAINS: [
    "cscdoesporte.com.br",
    "nortemkt.com",
    "eventsupply.com.br",
    "ativo.com",
    "ttkmarketing.com.br",
  ],
};
