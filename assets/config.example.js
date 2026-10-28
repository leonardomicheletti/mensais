// =====================================================================
//  Configuracao do frontend — COPIE este arquivo para "config.js"
//  (cp assets/config.example.js assets/config.js) e preencha os valores
//  do SEU projeto Supabase. O config.js NAO vai para o Git (.gitignore).
//
//  Onde achar: painel do Supabase > Project Settings > API
//    - Project URL      -> SUPABASE_URL
//    - Project API keys > "anon public" -> SUPABASE_ANON_KEY
//
//  IMPORTANTE: a chave "anon" e PUBLICA de proposito. Ela pode aparecer
//  no navegador sem risco, porque quem protege os dados e o RLS no banco
//  (ver supabase/schema.sql). NUNCA coloque aqui a chave "service_role".
// =====================================================================

window.CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "SUA-CHAVE-ANON-PUBLICA",

  // Dominios de e-mail que podem criar conta. Usado so para a mensagem
  // amigavel na tela de cadastro; a trava de verdade esta no banco
  // (funcao check_email_domain em supabase/schema.sql). Mantenha os dois
  // em sincronia.
  ALLOWED_DOMAINS: [
    "cscdoesporte.com.br",
    "nortemkt.com",
    "eventsupply.com.br",
    "ativo.com",
    "ttkmarketing.com.br",
  ],
};
