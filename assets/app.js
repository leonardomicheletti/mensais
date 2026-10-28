// =====================================================================
//  Controle dos Mensais — camada de dados, autenticacao e acessos
//  Substitui o runtime do Claude (window.claude) pelo Supabase.
//
//  Preserva intactos os dois motores inline do index.html:
//    - window.dash / window.__setDados  (motor de dados)
//    - os graficos D3, KPIs e tabelas    (motor de desenho)
//  Este arquivo so cuida de: login, carga dos dados (filtrada por RLS),
//  justificativas, liberacao de acessos e importacao de planilha.
// =====================================================================
(function () {
  'use strict';

  // ---------- helpers (iguais ao original)
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const pct = (v) => (v == null ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
  const money = (v) => (v == null ? '—' : brl0.format(v));
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const ATENCAO = 0.9, ESTOURO = 1.0;
  const status = (orc, real) => {
    if (real == null) return { t: 'Sem realizado', c: 'sem' };
    if (!(orc > 0)) return real > 0 ? { t: 'Sem orçamento', c: 'sem' } : { t: 'Sem movimento', c: 'sem' };
    const u = real / orc;
    return u > ESTOURO ? { t: 'Acima do orçado', c: 'bad' } : u >= ATENCAO ? { t: 'Em atenção', c: 'warn' } : { t: 'Dentro do orçado', c: 'ok' };
  };
  const parseValor = (s) => {
    const t = String(s || '').replace(/[^\d,.-]/g, '');
    if (!t) return null;
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  // numero generico para importacao (aceita 0, negativos e vazio -> null)
  const parseNum = (s) => {
    if (s == null) return null;
    const t = String(s).trim().replace(/[^\d,.-]/g, '');
    if (t === '' || t === '-') return null;
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const parseMes = (s) => {
    const t = semAcento(s);
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
    const i = MESES.map(semAcento).findIndex((m) => m.startsWith(t.slice(0, 3)) && t.length >= 3);
    return i >= 0 ? i + 1 : null;
  };

  const C = window.CONFIG || {};
  const configurado = !!(window.supabase && C.SUPABASE_URL && C.SUPABASE_ANON_KEY && !/SEU-PROJETO|SUA-CHAVE/.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY));
  const SB = configurado ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  const DOMINIOS = Array.isArray(C.ALLOWED_DOMAINS) ? C.ALLOWED_DOMAINS.map((d) => d.toLowerCase()) : [];

  // ---------- estado
  const S = {
    modo: 'carregando', me: null, myName: '', role: 'user',
    canWrite: false, canEdit: false, temTodas: false,
    ano: '', email: '', ultimoTexto: '',
    mensal: [], contas: [], sem: [], just: [],
    profiles: [], userAreas: {},
  };

  function aviso(text) { const a = $('aviso'); if (!a) return; a.textContent = text || ''; a.hidden = !text; }
  function setDash(id, rows, st) { if (window.__setDados) window.__setDados(id, rows, st); }
  const comMesNome = (rows) => rows.map((r) => Object.assign({ ano: S.ano, mes_nome: CURTO[Number(r.mes) - 1] }, r));
  const situacao = (j) => j.status || 'Aguardando análise';
  const sitClass = (s) => (s === 'Aprovada' ? 'ok' : s === 'Recusada' ? 'bad' : s === 'Em análise' ? 'warn' : 'sem');

  // =====================================================================
  //  AUTENTICACAO
  // =====================================================================
  let authModo = 'login';

  function mostrarApp() { $('auth-gate').classList.add('oculto'); $('cm-wrap').classList.add('ativo'); }
  function mostrarGate() { $('auth-gate').classList.remove('oculto'); $('cm-wrap').classList.remove('ativo'); }

  function authMsg(text, erro) { const m = $('auth-msg'); m.textContent = text || ''; m.className = 'auth-msg' + (erro ? ' err' : ''); }

  function pintarAuth() {
    const cad = authModo === 'cadastro';
    $('auth-h').textContent = cad ? 'Criar conta' : 'Entrar';
    $('auth-nome-wrap').hidden = !cad;
    $('auth-submit').textContent = cad ? 'Criar conta' : 'Entrar';
    $('auth-toggle').textContent = cad ? 'Já tenho conta — entrar' : 'Primeiro acesso — criar conta';
    authMsg('');
  }

  function dominioOk(email) {
    const d = (String(email).split('@')[1] || '').toLowerCase();
    return !DOMINIOS.length || DOMINIOS.includes(d);
  }

  async function submitAuth() {
    const email = $('auth-email').value.trim().toLowerCase();
    const senha = $('auth-senha').value;
    const nome = $('auth-nome').value.trim();
    if (!email || !senha) { authMsg('Preencha e-mail e senha.', true); return; }
    if (!dominioOk(email)) { authMsg('Use o e-mail da empresa. Domínios liberados: ' + DOMINIOS.join(', ') + '.', true); return; }
    if (authModo === 'cadastro' && senha.length < 8) { authMsg('A senha precisa de pelo menos 8 caracteres.', true); return; }
    const btn = $('auth-submit'); btn.disabled = true;
    authMsg(authModo === 'cadastro' ? 'Criando conta…' : 'Entrando…');
    try {
      if (authModo === 'cadastro') {
        const { data, error } = await SB.auth.signUp({ email, password: senha, options: { data: { name: nome || email.split('@')[0] } } });
        if (error) throw error;
        if (!data.session) { authMsg('Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre.'); authModo = 'login'; pintarAuth(); }
        // se ja veio sessao (confirmacao desligada), o onAuthStateChange cuida.
      } else {
        const { error } = await SB.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      }
    } catch (e) {
      authMsg(traduzErro(e), true);
    } finally {
      btn.disabled = false;
    }
  }

  function traduzErro(e) {
    const msg = (e && e.message) || '';
    if (/Invalid login/i.test(msg)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar (veja a caixa de entrada).';
    if (/already registered/i.test(msg)) return 'Esse e-mail já tem conta. Use "entrar".';
    if (/nao autorizado|not authorized|check_violation|Database error/i.test(msg)) return 'Esse domínio de e-mail não está autorizado a criar conta.';
    if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde um instante e tente de novo.';
    return msg || 'Não foi possível concluir. Tente de novo.';
  }

  async function sair() { try { await SB.auth.signOut(); } catch (e) {} location.reload(); }

  // =====================================================================
  //  CARGA DOS DADOS (o RLS no banco filtra o que cada um recebe)
  // =====================================================================
  let emCarga = false;
  async function carregar() {
    if (emCarga) return;
    emCarga = true;
    try { await _carregar(); } finally { emCarga = false; }
  }
  async function _carregar() {
    S.modo = 'carregando';
    const { data: sess } = await SB.auth.getSession();
    const u = sess && sess.session && sess.session.user;
    if (!u) { mostrarGate(); return; }
    S.me = u.id;

    // perfil proprio
    const { data: perfil } = await SB.from('profiles').select('*').eq('id', S.me).maybeSingle();
    S.myName = (perfil && perfil.name) || (u.user_metadata && u.user_metadata.name) || u.email;
    S.role = (perfil && perfil.role) || 'user';
    S.temTodas = !!(perfil && perfil.ver_todas) || S.role === 'admin';
    S.canEdit = S.role === 'admin';
    S.canWrite = S.role === 'admin' || !!(perfil && perfil.can_write);

    // config (e-mail da Controladoria + ano corrente)
    const { data: cfg } = await SB.from('config').select('*').eq('id', 1).maybeSingle();
    S.email = (cfg && cfg.email_controladoria) || '';
    S.ano = String((cfg && cfg.ano_corrente) || new Date().getFullYear());

    // minhas areas (so para quem nao ve todas)
    let minhasAreas = [];
    if (!S.temTodas) {
      const { data: ua } = await SB.from('user_areas').select('area').eq('user_id', S.me);
      minhasAreas = (ua || []).map((r) => r.area);
    }

    // dados — o SELECT so devolve as linhas que o RLS permite
    const ano = Number(S.ano);
    const [mensal, contas, sem, just] = await Promise.all([
      SB.from('mensal').select('area,mes,orcado,realizado').eq('ano', ano),
      SB.from('contas').select('area,conta,mes,orcado,realizado').eq('ano', ano),
      SB.from('sem_orcamento').select('mes,valor').eq('ano', ano),
      SB.from('justificativas').select('*').order('criado_em', { ascending: false }),
    ]);
    S.mensal = mensal.data || [];
    S.contas = contas.data || [];
    S.sem = sem.data || [];
    S.just = just.data || [];

    // admin tambem carrega pessoas e acessos
    if (S.canEdit) {
      const [profs, uareas] = await Promise.all([
        SB.from('profiles').select('*'),
        SB.from('user_areas').select('*'),
      ]);
      S.profiles = profs.data || [];
      S.userAreas = {};
      (uareas.data || []).forEach((r) => { (S.userAreas[r.user_id] = S.userAreas[r.user_id] || []).push(r.area); });
    }

    // define o modo
    if (S.canEdit) S.modo = 'admin';
    else if (S.temTodas || minhasAreas.length || S.mensal.length) S.modo = 'area';
    else S.modo = 'aguardando';

    mostrarApp();
    injetarBarraUsuario();
    if (S.canEdit) montarImport();
    aplicarModo();
    publicaDados();
    renderLista();
    renderAcessos();
    badge();
    updateButton();
  }

  async function recarregarJust() {
    const { data } = await SB.from('justificativas').select('*').order('criado_em', { ascending: false });
    S.just = data || [];
    renderLista(); badge();
  }
  async function recarregarAcessos() {
    if (!S.canEdit) return;
    const [profs, uareas] = await Promise.all([SB.from('profiles').select('*'), SB.from('user_areas').select('*')]);
    S.profiles = profs.data || [];
    S.userAreas = {};
    (uareas.data || []).forEach((r) => { (S.userAreas[r.user_id] = S.userAreas[r.user_id] || []).push(r.area); });
    renderAcessos(); badge();
  }

  // ---------- barra do usuario (nome + sair), injetada no cabecalho
  function injetarBarraUsuario() {
    let box = $('cm-usuario');
    if (box) { const n = box.querySelector('.cm-usuario-nome'); if (n) n.textContent = S.myName; return; }
    const picks = document.querySelector('.cm-picks');
    if (!picks) return;
    box = el('div', 'cm-usuario'); box.id = 'cm-usuario';
    const nome = el('span', 'cm-usuario-nome', S.myName);
    const btn = el('button', 'cm-sair', 'Sair'); btn.type = 'button'; btn.addEventListener('click', sair);
    box.append(nome, btn);
    picks.appendChild(box);
  }

  // =====================================================================
  //  MODO DA PAGINA (portado do original)
  // =====================================================================
  function aplicarModo() {
    const wrap = $('cm-wrap');
    const admin = S.modo === 'admin';
    const area = S.modo === 'area';
    const espera = S.modo === 'aguardando' || S.modo === 'sem';
    $('tab-acessos').hidden = !admin;
    const tabDados = $('tab-dados'); if (tabDados) tabDados.hidden = !admin;
    $('cm-tabs').hidden = espera;
    $('aguardando').hidden = !espera;
    const areas = [...new Set(S.mensal.map((r) => r.area))];
    wrap.classList.toggle('so-areas', area && !S.temTodas);
    wrap.classList.toggle('uma-area', area && areas.length === 1);
    window.__areaFixa = area && areas.length === 1 ? areas[0] : null;
    window.__escopo = area && !S.temTodas ? (areas.length === 1 ? areas[0] : 'suas áreas') : 'a empresa';
    window.__escopoTotal = area && !S.temTodas ? (areas.length === 1 ? 'Somente ' + areas[0] + '.' : 'Total das suas áreas.') : 'Total da empresa.';
    window.__rotTodas = area && !S.temTodas ? 'Todas as minhas áreas' : 'Todas as áreas';
    if (window.__areaFixa && window.dash && window.dash.params().area !== window.__areaFixa) window.dash.setParams({ area: window.__areaFixa });
    if (espera) {
      $('aba-painel').hidden = true; $('aba-justificativas').hidden = true; $('aba-acessos').hidden = true;
      const ad = $('aba-dados'); if (ad) ad.hidden = true;
      document.querySelectorAll('[data-so-painel]').forEach((e) => { e.hidden = true; });
      $('intro-justif').hidden = true;
      $('periodo').textContent = 'Acesso por área';
      $('aguardando-txt').textContent = S.modo === 'sem'
        ? 'Não foi possível conectar aos dados. Verifique a configuração do Supabase (assets/config.js) ou tente de novo.'
        : 'Seu acesso ainda não foi liberado. A Controladoria libera cada pessoa para a área dela. Assim que isso acontecer, os números da sua área aparecem aqui automaticamente.';
      $('aguardando-quem').textContent = S.myName ? 'Você entrou como ' + S.myName + '.' : '';
    } else {
      rota();
    }
    $('h-lista').textContent = admin
      ? 'Tudo o que as áreas registraram. Marque cada uma como em análise, aprovada ou recusada.'
      : 'As justificativas que você registrou e a situação da análise da Controladoria.';
  }

  // =====================================================================
  //  JUSTIFICATIVAS — passo 1: area e mes (portado)
  // =====================================================================
  function areas() { return [...new Set(S.mensal.map((r) => r.area))].sort((a, b) => a.localeCompare(b, 'pt-BR')); }
  function mesesFechados() { return [...new Set(S.mensal.filter((r) => r.realizado != null).map((r) => Number(r.mes)))].sort((a, b) => a - b); }

  function fillSelects() {
    const fa = $('f-area'), fm = $('f-mes'), fl = $('fl-area');
    const prevA = fa.value, prevM = fm.value, prevL = fl.value;
    const as = areas(), ms = mesesFechados();
    fa.replaceChildren(...(as.length === 1 ? [] : [new Option('Escolha a área', '')]), ...as.map((a) => new Option(a, a)));
    fm.replaceChildren(...ms.map((m) => new Option(cap(MESES[m - 1]) + (S.ano ? ' de ' + S.ano : ''), String(m))));
    fl.replaceChildren(new Option(as.length === 1 ? as[0] : 'Todas as áreas', ''), ...(as.length === 1 ? [] : as.map((a) => new Option(a, a))));
    fa.disabled = !as.length; fm.disabled = !ms.length;
    if (as.includes(prevA)) fa.value = prevA;
    fm.value = ms.includes(Number(prevM)) ? prevM : String(ms[ms.length - 1] || '');
    if (as.includes(prevL)) fl.value = prevL;
    renderSituacao();
  }

  function atual() {
    const area = $('f-area').value, mes = Number($('f-mes').value);
    if (!area || !mes) return null;
    const r = S.mensal.find((x) => x.area === area && Number(x.mes) === mes) || { orcado: 0, realizado: null };
    const ytd = S.mensal.filter((x) => x.area === area && Number(x.mes) <= mes);
    const orcY = ytd.reduce((s, x) => s + (Number(x.orcado) || 0), 0);
    const realY = ytd.reduce((s, x) => s + (Number(x.realizado) || 0), 0);
    const orc = Number(r.orcado) || 0, real = r.realizado == null ? null : Number(r.realizado);
    const contas = S.contas.filter((c) => c.area === area && Number(c.mes) === mes && c.realizado != null && Number(c.realizado) > Number(c.orcado || 0))
      .map((c) => ({ conta: c.conta, orcado: Number(c.orcado) || 0, realizado: Number(c.realizado) }))
      .sort((a, b) => (b.realizado - b.orcado) - (a.realizado - a.orcado)).slice(0, 6);
    return { area, mes, orc, real, dif: real == null ? null : real - orc, uso: real == null || !(orc > 0) ? null : real / orc, orcY, realY, contas, st: status(orc, real) };
  }

  function renderSituacao() {
    const a = atual();
    $('situacao').hidden = !a;
    $('contas').hidden = true;
    updateButton();
    if (!a) return;
    $('v-orc').textContent = money(a.orc);
    $('v-real').textContent = money(a.real);
    const acima = a.dif != null && a.dif > 0;
    $('l-dif').textContent = acima ? 'Acima do orçado' : 'Folga no mês';
    $('v-dif').textContent = a.dif == null ? '—' : money(Math.abs(a.dif));
    $('fig-dif').classList.toggle('is-bad', acima);
    $('v-uso').textContent = pct(a.uso);
    const p = $('v-status'); p.className = 'pill ' + a.st.c; p.textContent = a.st.t;
    $('v-ano').textContent = 'No ano até ' + cap(MESES[a.mes - 1]) + ': ' + money(a.realY) + ' realizados de ' + money(a.orcY) + ' orçados' + (a.orcY > 0 ? ' (' + pct(a.realY / a.orcY) + ')' : '') + '.';
    const lst = $('contas-lista'); lst.replaceChildren();
    a.contas.forEach((c) => {
      const row = el('div', 'conta');
      row.append(el('span', 'c', c.conta), el('span', 'v', '+' + money(c.realizado - c.orcado)), el('span', 'd', 'realizado ' + money(c.realizado) + (c.orcado > 0 ? ' de ' + money(c.orcado) + ' orçados' : ' sem orçamento')));
      lst.appendChild(row);
    });
    $('contas').hidden = !a.contas.length;
    if ($('tp-verba').checked && !$('f-valor').value && acima) $('f-valor').value = a.dif.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---------- registro
  function tipo() { return $('tp-verba').checked ? 'verba' : 'estouro'; }
  function updateButton() {
    const ok = !!atual() && $('f-motivo').value.trim().length >= 10 && (tipo() !== 'verba' || parseValor($('f-valor').value) != null);
    const b = $('b-registrar');
    b.disabled = !ok || !SB || S.canWrite === false;
    const m = $('m-registrar');
    m.className = 'msg';
    if (!SB) m.textContent = 'Conectando…';
    else if (S.canWrite === false) m.textContent = 'Seu acesso é só de leitura. Peça à Controladoria acesso de Colaborador para registrar.';
    else if (!atual()) m.textContent = 'Escolha a área e o mês.';
    else if ($('f-motivo').value.trim().length < 10) m.textContent = 'Escreva o motivo (pelo menos uma frase).';
    else if (tipo() === 'verba' && parseValor($('f-valor').value) == null) m.textContent = 'Informe o valor adicional.';
    else m.textContent = '';
  }

  function emailTexto(reg, nome) {
    const tipoTxt = reg.tipo === 'verba' ? 'um pedido de verba adicional' : 'uma justificativa de gasto acima do orçado';
    const linhas = [
      'Olá, Controladoria,', '',
      'Registrei no Controle dos Mensais ' + tipoTxt + ' da área ' + reg.area + ', referente a ' + MESES[reg.mes - 1] + ' de ' + reg.ano + '.', '',
      'Orçado no mês: ' + brl.format(reg.orcado),
      'Realizado no mês: ' + (reg.realizado == null ? '—' : brl.format(reg.realizado)),
      reg.diferenca == null ? '' : (reg.diferenca > 0 ? 'Acima do orçado: ' + brl.format(reg.diferenca) : 'Folga no mês: ' + brl.format(-reg.diferenca)) + (reg.uso == null ? '' : ' (uso de ' + pct(reg.uso) + ')'),
    ];
    if (reg.tipo === 'verba') linhas.push('Verba adicional solicitada: ' + brl.format(reg.valor_solicitado));
    linhas.push('', 'Motivo:', reg.motivo);
    if (reg.acao) linhas.push('', 'O que será feito nos próximos meses:', reg.acao);
    if (reg.contas && reg.contas.length) {
      linhas.push('', 'Contas acima do orçado no mês:');
      reg.contas.forEach((c) => linhas.push('- ' + c.conta + ': ' + brl0.format(c.realizado) + (c.orcado > 0 ? ' de ' + brl0.format(c.orcado) : ' (sem orçamento)')));
    }
    linhas.push('', 'Registro ' + reg.codigo + ' · ' + new Date(reg.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }));
    if (nome) linhas.push(nome);
    return linhas.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
  }

  function mostrarEmail(reg) {
    const para = S.email || '';
    const assunto = (reg.tipo === 'verba' ? 'Pedido de verba' : 'Justificativa de verba') + ' · ' + reg.area + ' · ' + cap(MESES[reg.mes - 1]) + '/' + reg.ano;
    const corpo = emailTexto(reg, S.myName || reg.autor_nome || '');
    $('m-para').textContent = para || 'endereço da Controladoria não configurado';
    $('m-assunto').textContent = assunto;
    $('m-corpo').textContent = corpo;
    const b = $('b-mail');
    b.href = 'mailto:' + encodeURIComponent(para).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(assunto) + '&body=' + encodeURIComponent(corpo);
    b.hidden = !para;
    S.ultimoTexto = 'Para: ' + para + '\nAssunto: ' + assunto + '\n\n' + corpo;
    $('enviado').hidden = false;
    $('m-copiar').textContent = '';
    $('enviado').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function registrar() {
    const a = atual();
    if (!a || !SB || !S.me) return;
    const b = $('b-registrar'), m = $('m-registrar');
    b.disabled = true; m.className = 'msg'; m.textContent = 'Registrando…';
    const agora = new Date();
    const codigo = 'JV-' + agora.getFullYear() + String(agora.getMonth() + 1).padStart(2, '0') + String(agora.getDate()).padStart(2, '0') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const reg = {
      codigo, area: a.area, mes: a.mes, ano: Number(S.ano) || agora.getFullYear(), tipo: tipo(),
      orcado: Math.round(a.orc * 100) / 100, realizado: a.real == null ? null : Math.round(a.real * 100) / 100,
      diferenca: a.dif == null ? null : Math.round(a.dif * 100) / 100, uso: a.uso == null ? null : Math.round(a.uso * 10000) / 10000,
      valor_solicitado: tipo() === 'verba' ? parseValor($('f-valor').value) : null,
      motivo: $('f-motivo').value.trim().slice(0, 4000), acao: $('f-acao').value.trim().slice(0, 2000),
      contas: a.contas, author_id: S.me, autor_nome: S.myName, criado_em: agora.toISOString(),
    };
    try {
      const { error } = await SB.from('justificativas').insert(reg);
      if (error) throw error;
      m.textContent = '';
      await recarregarJust();
      mostrarEmail(reg);
    } catch (e) {
      m.className = 'msg err';
      m.textContent = /row-level security|violates|permission/i.test((e && e.message) || '')
        ? 'Não foi possível registrar: seu acesso é só de leitura ou você não tem essa área. Peça à Controladoria.'
        : 'Não foi possível registrar agora. Tente de novo em instantes.';
      b.disabled = false;
    }
  }

  function limpar() {
    $('f-motivo').value = ''; $('f-acao').value = ''; $('f-valor').value = '';
    $('tp-estouro').checked = true; $('campo-valor').hidden = true;
    $('enviado').hidden = true;
    updateButton();
    $('passo-1').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ---------- lista de justificativas
  const lista = () => S.just.slice().sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));

  function renderLista() {
    const box = $('lista');
    const fa = $('fl-area').value, fs = $('fl-status').value;
    const todos = lista();
    const lst = todos.filter((j) => (!fa || j.area === fa) && (!fs || situacao(j) === fs));
    box.replaceChildren();
    if (!todos.length) { box.appendChild(el('div', 'empty', S.modo === 'admin' ? 'Nenhuma justificativa registrada ainda. As que as áreas registrarem aparecem aqui.' : 'Você ainda não registrou nenhuma justificativa.')); return; }
    if (!lst.length) { box.appendChild(el('div', 'empty', 'Nenhuma justificativa com esses filtros.')); return; }
    for (const j of lst) {
      const it = el('article', 'item');
      const top = el('div', 'item-top');
      const s = situacao(j);
      top.append(el('b', null, j.area + ' · ' + cap(MESES[j.mes - 1] || '') + '/' + j.ano), el('span', 'pill ' + (j.tipo === 'verba' ? 'warn' : 'bad'), j.tipo === 'verba' ? 'Pedido de verba' : 'Gasto acima do orçado'), el('span', 'pill ' + sitClass(s), s));
      it.appendChild(top);
      const quem = j.autor_nome || (j.author_id === S.me ? S.myName : '') || 'Alguém da área';
      it.appendChild(el('div', 'item-meta', j.codigo + ' · ' + quem + ' · ' + new Date(j.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })));
      const nums = el('div', 'item-nums');
      nums.append(el('span', null, 'Orçado ' + money(j.orcado)), el('span', null, 'Realizado ' + money(j.realizado)));
      if (j.diferenca != null) nums.append(el('span', null, (j.diferenca > 0 ? 'Acima ' : 'Folga ') + money(Math.abs(j.diferenca))));
      if (j.tipo === 'verba' && j.valor_solicitado) nums.append(el('span', null, 'Pede ' + money(j.valor_solicitado)));
      it.appendChild(nums);
      const mot = el('p'); mot.append(el('em', null, 'Motivo'), document.createTextNode(j.motivo || '')); it.appendChild(mot);
      if (j.acao) { const ac = el('p'); ac.append(el('em', null, 'Próximos meses'), document.createTextNode(j.acao)); it.appendChild(ac); }
      if (j.comentario) { const c = el('p'); c.append(el('em', null, 'Controladoria'), document.createTextNode(j.comentario)); it.appendChild(c); }
      if (S.modo === 'admin') it.appendChild(decisao(j));
      if (j.author_id && j.author_id === S.me) {
        const re = el('button', 'btn ghost', 'Ver e-mail de novo'); re.type = 'button'; re.style.cssText = 'align-self:flex-start;font-size:13px;padding:6px 10px';
        re.addEventListener('click', () => mostrarEmail(j)); it.appendChild(re);
      }
      box.appendChild(it);
    }
  }

  function decisao(j) {
    const w = el('div', 'decide');
    const inp = el('input'); inp.type = 'text'; inp.id = 'com-' + j.codigo; inp.placeholder = 'Comentário da Controladoria (opcional)'; inp.value = j.comentario || '';
    inp.setAttribute('aria-label', 'Comentário da Controladoria');
    const mk = (txt, st, cls) => { const b = el('button', 'btn ghost ' + (cls || ''), txt); b.type = 'button'; b.addEventListener('click', () => decidir(j, st, inp.value, b)); return b; };
    w.append(inp, mk('Em análise', 'Em análise'), mk('Aprovar', 'Aprovada', 'ok-b'), mk('Recusar', 'Recusada', 'bad-b'));
    return w;
  }

  async function decidir(j, st, comentario, btn) {
    if (!SB) return;
    btn.disabled = true;
    try {
      const { error } = await SB.from('justificativas').update({
        status: st, comentario: String(comentario || '').trim().slice(0, 1000),
        decidido_por: S.me || null, decidido_em: new Date().toISOString(),
      }).eq('codigo', j.codigo);
      if (error) throw error;
      await recarregarJust();
    } catch (e) { btn.textContent = 'Sem permissão'; }
    btn.disabled = false;
  }

  function badge() {
    const n = lista().filter((j) => situacao(j) === 'Aguardando análise').length;
    const b = $('badge-pend'); b.textContent = String(n); b.hidden = !(S.modo === 'admin' && n > 0);
    const pend = S.profiles.filter((p) => p.id !== S.me && p.role !== 'admin' && !p.ver_todas && !(S.userAreas[p.id] && S.userAreas[p.id].length)).length;
    const b2 = $('badge-acessos'); b2.textContent = String(pend); b2.hidden = !(S.modo === 'admin' && pend > 0);
  }

  // =====================================================================
  //  ACESSOS (so admin)
  // =====================================================================
  function renderAcessos() {
    if (S.modo !== 'admin') return;
    const box = $('ac-lista');
    const filtro = semAcento($('ac-busca') ? $('ac-busca').value : '');
    const todasAreas = [...new Set(S.mensal.map((r) => r.area))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    let pessoas = S.profiles.filter((p) => p.id !== S.me);
    if (filtro) pessoas = pessoas.filter((p) => semAcento(p.name).includes(filtro) || semAcento(p.email).includes(filtro));
    const liberado = (p) => p.ver_todas || (S.userAreas[p.id] && S.userAreas[p.id].length > 0);
    pessoas.sort((a, b) => (liberado(a) ? 1 : 0) - (liberado(b) ? 1 : 0) || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
    box.replaceChildren();
    if (!pessoas.length) { box.appendChild(el('div', 'empty', filtro ? 'Ninguém com esse nome ou e-mail.' : 'Ninguém se cadastrou ainda. Peça para a pessoa abrir o site e criar a conta com o e-mail da empresa; ela aparece aqui para você liberar.')); return; }
    for (const p of pessoas) {
      const id = p.id;
      const temTodas = !!p.ver_todas;
      const marcadas = new Set(temTodas ? ['*'] : (S.userAreas[id] || []));
      const card = el('article', 'ac-item');
      const head = el('div', 'ac-head');
      const nome = el('div', 'ac-nome');
      nome.append(el('b', null, p.name || 'Pessoa sem nome'), el('span', null, p.email || ''));
      const lib = liberado(p);
      const st = p.role === 'admin' ? el('span', 'pill ok', 'Administrador')
        : lib ? el('span', 'pill ok', temTodas ? 'Vê todas as áreas' : 'Liberado · ' + (S.userAreas[id] || []).length + ((S.userAreas[id] || []).length === 1 ? ' área' : ' áreas'))
        : el('span', 'pill warn', 'Aguardando liberação');
      head.append(nome, st);
      card.appendChild(head);
      if (p.role === 'admin') {
        card.appendChild(el('p', 'hint', 'Administrador vê tudo e gerencia os acessos. (Admins são definidos por SQL, não por aqui.)'));
        box.appendChild(card);
        continue;
      }
      const grid = el('div', 'ac-areas');
      const mkChk = (valor, rotulo, cls) => {
        const l = el('label', 'ac-chk' + (cls ? ' ' + cls : ''));
        const c = el('input'); c.type = 'checkbox'; c.value = valor; c.checked = marcadas.has(valor);
        l.append(c, document.createTextNode(rotulo));
        return l;
      };
      grid.appendChild(mkChk('*', 'Todas as áreas (diretoria)', 'ac-todas'));
      todasAreas.forEach((a) => grid.appendChild(mkChk(a, a)));
      card.appendChild(grid);
      const todasChk = grid.querySelector('input[value="*"]');
      const syncTodas = () => grid.querySelectorAll('input:not([value="*"])').forEach((c) => { c.disabled = todasChk.checked; });
      todasChk.addEventListener('change', syncTodas); syncTodas();
      // colaborador (pode registrar justificativas)
      const colabLabel = el('label', 'ac-chk'); const colab = el('input'); colab.type = 'checkbox'; colab.checked = !!p.can_write;
      colabLabel.append(colab, document.createTextNode('Pode registrar justificativas (colaborador)'));
      card.appendChild(colabLabel);

      const acts = el('div', 'actions');
      const salvar = el('button', 'btn primary', lib ? 'Salvar' : 'Liberar acesso'); salvar.type = 'button';
      const msg = el('span', 'msg');
      salvar.addEventListener('click', async () => {
        const sel = todasChk.checked ? ['*'] : [...grid.querySelectorAll('input:checked')].map((c) => c.value).filter((v) => v !== '*');
        if (!sel.length) { msg.className = 'msg err'; msg.textContent = 'Marque pelo menos uma área (ou "Todas as áreas").'; return; }
        salvar.disabled = true; msg.className = 'msg'; msg.textContent = 'Salvando…';
        try { await liberar(id, sel, colab.checked); msg.textContent = 'Acesso salvo.'; }
        catch (e) { msg.className = 'msg err'; msg.textContent = 'Não foi possível salvar. Tente de novo.'; }
        salvar.disabled = false;
      });
      acts.appendChild(salvar);
      if (lib) {
        const rem = el('button', 'btn ghost bad-b', 'Remover acesso'); rem.type = 'button';
        let confirmar = false;
        rem.addEventListener('click', async () => {
          if (!confirmar) { confirmar = true; rem.textContent = 'Confirmar remoção'; msg.textContent = 'A pessoa deixa de ver os dados.'; return; }
          rem.disabled = true;
          try { await remover(id); msg.textContent = 'Acesso removido.'; } catch (e) { msg.className = 'msg err'; msg.textContent = 'Não foi possível remover.'; rem.disabled = false; }
        });
        acts.appendChild(rem);
      }
      acts.appendChild(msg);
      card.appendChild(acts);
      box.appendChild(card);
    }
  }

  async function liberar(id, sel, canWrite) {
    const todas = sel.includes('*');
    // areas especificas
    await SB.from('user_areas').delete().eq('user_id', id);
    if (!todas && sel.length) {
      const rows = sel.map((area) => ({ user_id: id, area }));
      const { error } = await SB.from('user_areas').insert(rows);
      if (error) throw error;
    }
    const { error: e2 } = await SB.from('profiles').update({ ver_todas: todas, can_write: !!canWrite }).eq('id', id);
    if (e2) throw e2;
    await recarregarAcessos();
  }

  async function remover(id) {
    await SB.from('user_areas').delete().eq('user_id', id);
    const { error } = await SB.from('profiles').update({ ver_todas: false, can_write: false }).eq('id', id);
    if (error) throw error;
    await recarregarAcessos();
  }

  // =====================================================================
  //  IMPORTACAO DE PLANILHA (so admin) — aba "Dados"
  // =====================================================================
  function montarImport() {
    if ($('aba-dados')) return;
    // tab
    const tabs = $('cm-tabs');
    const tab = document.createElement('a');
    tab.className = 'cm-tab'; tab.id = 'tab-dados'; tab.href = '#dados'; tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'aba-dados'); tab.setAttribute('aria-selected', 'false'); tab.textContent = 'Dados';
    tabs.appendChild(tab);
    tab.addEventListener('click', (ev) => { ev.preventDefault(); try { history.replaceState(null, '', '#dados'); } catch (e) { location.hash = '#dados'; } rota(); });

    // painel
    const painel = el('div', 'cm-aba'); painel.id = 'aba-dados'; painel.setAttribute('role', 'tabpanel'); painel.hidden = true;
    const anoAtual = Number(S.ano) || new Date().getFullYear();
    painel.innerHTML = `
      <div class="jv">
        <section class="step">
          <h2>Importar planilha</h2>
          <p class="hint">Suba os arquivos em <b>CSV</b> (no Excel: Salvar como &rarr; CSV). Cada importação <b>substitui</b> os dados do ano escolhido. Aceita separador <b>,</b> ou <b>;</b> e valores no formato brasileiro (1.234,56).</p>
          <label class="f" style="max-width:220px">Ano de referência
            <input type="number" id="imp-ano" value="${anoAtual}" min="2000" max="2100">
          </label>
          <div class="imp-files">
            <label class="f">1. Orçado x realizado por área <span class="opt">colunas: area, mes, orcado, realizado</span>
              <input type="file" id="imp-mensal" accept=".csv,text/csv">
            </label>
            <label class="f">2. Por conta <span class="opt">colunas: area, conta, mes, orcado, realizado</span>
              <input type="file" id="imp-contas" accept=".csv,text/csv">
            </label>
            <label class="f">3. Sem orçamento <span class="opt">colunas: mes, valor</span>
              <input type="file" id="imp-sem" accept=".csv,text/csv">
            </label>
          </div>
          <div class="actions">
            <button class="btn primary" id="imp-aplicar" type="button">Importar e substituir o ano</button>
            <span class="msg" id="imp-msg"></span>
          </div>
          <div id="imp-preview" class="imp-preview"></div>
        </section>
        <section class="step">
          <h2>E-mail da Controladoria</h2>
          <p class="hint">Endereço que aparece no botão "Abrir e-mail" das justificativas.</p>
          <div class="actions">
            <input type="email" id="cfg-email" placeholder="controladoria@empresa.com" value="${(S.email || '').replace(/"/g, '&quot;')}" style="flex:1 1 260px">
            <button class="btn ghost" id="cfg-salvar" type="button">Salvar</button>
            <span class="msg" id="cfg-msg"></span>
          </div>
        </section>
      </div>`;
    $('aba-acessos').insertAdjacentElement('afterend', painel);
    $('imp-aplicar').addEventListener('click', importar);
    $('cfg-salvar').addEventListener('click', salvarConfig);
  }

  function parseCSV(texto) {
    const t = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
    if (!t) return [];
    const linha0 = t.split('\n', 1)[0];
    const delim = (linha0.split(';').length > linha0.split(',').length) ? ';' : ',';
    const linhas = [];
    let campo = '', atual = [], aspas = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (aspas) {
        if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
        else campo += ch;
      } else if (ch === '"') aspas = true;
      else if (ch === delim) { atual.push(campo); campo = ''; }
      else if (ch === '\n') { atual.push(campo); linhas.push(atual); atual = []; campo = ''; }
      else campo += ch;
    }
    atual.push(campo); linhas.push(atual);
    const head = linhas.shift().map((h) => semAcento(h));
    return linhas.filter((l) => l.some((c) => String(c).trim() !== '')).map((l) => {
      const o = {}; head.forEach((h, i) => { o[h] = (l[i] != null ? l[i] : '').trim(); }); return o;
    });
  }

  function lerArquivo(input) {
    return new Promise((resolve) => {
      const f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      const r = new FileReader();
      r.onload = () => resolve(parseCSV(String(r.result)));
      r.onerror = () => resolve(null);
      r.readAsText(f, 'utf-8');
    });
  }

  async function importar() {
    const ano = Number($('imp-ano').value);
    const msg = $('imp-msg'), prev = $('imp-preview');
    if (!(ano >= 2000 && ano <= 2100)) { msg.className = 'msg err'; msg.textContent = 'Informe um ano válido.'; return; }
    const btn = $('imp-aplicar'); btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Lendo arquivos…';
    prev.replaceChildren();
    try {
      const [rmensal, rcontas, rsem] = await Promise.all([lerArquivo($('imp-mensal')), lerArquivo($('imp-contas')), lerArquivo($('imp-sem'))]);
      if (!rmensal && !rcontas && !rsem) { msg.className = 'msg err'; msg.textContent = 'Selecione pelo menos um arquivo.'; btn.disabled = false; return; }
      const erros = [];
      let feito = [];

      if (rmensal) {
        const rows = rmensal.map((o, i) => {
          const mes = parseMes(o.mes), area = (o.area || '').trim();
          if (!area || !mes) { erros.push('Área por mês, linha ' + (i + 2) + ': área ou mês inválido.'); return null; }
          return { area, mes, ano, orcado: parseNum(o.orcado), realizado: parseNum(o.realizado) };
        }).filter(Boolean);
        await SB.from('mensal').delete().eq('ano', ano);
        if (rows.length) { const { error } = await SB.from('mensal').insert(rows); if (error) throw error; }
        feito.push(rows.length + ' linhas (área por mês)');
      }
      if (rcontas) {
        const rows = rcontas.map((o, i) => {
          const mes = parseMes(o.mes), area = (o.area || '').trim(), conta = (o.conta || '').trim();
          if (!area || !conta || !mes) { erros.push('Por conta, linha ' + (i + 2) + ': área, conta ou mês inválido.'); return null; }
          return { area, conta, mes, ano, orcado: parseNum(o.orcado), realizado: parseNum(o.realizado) };
        }).filter(Boolean);
        await SB.from('contas').delete().eq('ano', ano);
        if (rows.length) { const { error } = await SB.from('contas').insert(rows); if (error) throw error; }
        feito.push(rows.length + ' linhas (por conta)');
      }
      if (rsem) {
        const rows = rsem.map((o, i) => {
          const mes = parseMes(o.mes);
          if (!mes) { erros.push('Sem orçamento, linha ' + (i + 2) + ': mês inválido.'); return null; }
          return { mes, ano, valor: parseNum(o.valor) };
        }).filter(Boolean);
        await SB.from('sem_orcamento').delete().eq('ano', ano);
        if (rows.length) { const { error } = await SB.from('sem_orcamento').insert(rows); if (error) throw error; }
        feito.push(rows.length + ' linhas (sem orçamento)');
      }

      await SB.from('config').update({ ano_corrente: ano }).eq('id', 1);
      msg.className = 'msg'; msg.textContent = 'Importado: ' + feito.join(', ') + '.';
      if (erros.length) { const b = el('div', 'notice'); b.textContent = erros.length + ' linha(s) ignorada(s): ' + erros.slice(0, 5).join(' '); prev.appendChild(b); }
      // recarrega os dados e redesenha
      S.ano = String(ano);
      await carregar();
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = 'Erro ao importar: ' + ((e && e.message) || e);
    }
    btn.disabled = false;
  }

  async function salvarConfig() {
    const email = $('cfg-email').value.trim();
    const msg = $('cfg-msg'); msg.className = 'msg'; msg.textContent = 'Salvando…';
    try {
      const { error } = await SB.from('config').update({ email_controladoria: email }).eq('id', 1);
      if (error) throw error;
      S.email = email; msg.textContent = 'E-mail salvo.';
    } catch (e) { msg.className = 'msg err'; msg.textContent = 'Não foi possível salvar.'; }
  }

  // =====================================================================
  //  ABAS / ROTEAMENTO (portado, com a aba "dados")
  // =====================================================================
  function mostrarAba(nome) {
    if (S.modo === 'aguardando' || S.modo === 'sem') return;
    if ((nome === 'acessos' || nome === 'dados') && S.modo !== 'admin') nome = 'painel';
    $('aba-painel').hidden = nome !== 'painel';
    $('aba-justificativas').hidden = nome !== 'justificativas';
    $('aba-acessos').hidden = nome !== 'acessos';
    const ad = $('aba-dados'); if (ad) ad.hidden = nome !== 'dados';
    [['tab-painel', 'painel'], ['tab-justificativas', 'justificativas'], ['tab-acessos', 'acessos'], ['tab-dados', 'dados']].forEach(([t, n]) => { const e = $(t); if (e) e.setAttribute('aria-selected', String(nome === n)); });
    document.querySelectorAll('[data-so-painel]').forEach((e) => { e.hidden = nome !== 'painel'; });
    $('intro-justif').hidden = nome !== 'justificativas';
    $('intro-acessos').hidden = nome !== 'acessos';
    const per = $('periodo');
    if (nome !== 'painel') { if (!per.dataset.salvo) per.dataset.salvo = per.textContent; per.textContent = nome === 'justificativas' ? 'Justificativa de gasto e pedido de verba' : nome === 'dados' ? 'Importar dados do orçamento' : 'Quem vê o quê'; }
    else if (per.dataset.salvo) { per.textContent = per.dataset.salvo; delete per.dataset.salvo; }
    if (nome === 'painel' && window.__redesenha) window.__redesenha();
    if (nome === 'acessos') renderAcessos();
  }
  function rota() { const h = location.hash.replace('#', ''); mostrarAba(['justificativas', 'acessos', 'dados'].includes(h) ? h : 'painel'); }

  window.__abrirJustificativa = (area, mes) => {
    try { history.replaceState(null, '', '#justificativas'); } catch (e) { location.hash = '#justificativas'; }
    rota();
    if (area && areas().includes(area)) $('f-area').value = area;
    if (mes && mesesFechados().includes(mes)) $('f-mes').value = String(mes);
    renderSituacao();
    window.scrollTo({ top: 0 });
  };

  // ---------- dados para os graficos
  function publicaDados() {
    const ok = S.mensal.length > 0;
    setDash('mensal', comMesNome(S.mensal), ok ? 'ok' : 'loading');
    setDash('contas', S.contas, 'ok');
    setDash('sem_orcamento', S.sem, 'ok');
    fillSelects();
    if (!S.mensal.length && S.modo === 'admin') aviso('Nenhum dado importado para ' + S.ano + ' ainda. Vá em "Dados" e suba a planilha.');
    else aviso('');
  }

  // =====================================================================
  //  EVENTOS
  // =====================================================================
  function ligarEventos() {
    window.addEventListener('hashchange', rota);
    document.querySelectorAll('.cm-tab').forEach((t) => t.addEventListener('click', (ev) => {
      ev.preventDefault(); const alvo = t.getAttribute('href');
      if (location.hash !== alvo) { try { history.replaceState(null, '', alvo); } catch (e) { location.hash = alvo; } }
      rota();
    }));
    $('f-area').addEventListener('change', renderSituacao);
    $('f-mes').addEventListener('change', renderSituacao);
    ['f-motivo', 'f-acao', 'f-valor'].forEach((id) => $(id).addEventListener('input', updateButton));
    document.querySelectorAll('input[name="tipo"]').forEach((r) => r.addEventListener('change', () => {
      $('campo-valor').hidden = tipo() !== 'verba';
      const a = atual();
      if (tipo() === 'verba' && !$('f-valor').value && a && a.dif > 0) $('f-valor').value = a.dif.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      updateButton();
    }));
    $('b-registrar').addEventListener('click', registrar);
    $('b-nova').addEventListener('click', limpar);
    $('b-copiar').addEventListener('click', () => {
      const t = S.ultimoTexto || '';
      const ok = () => { $('m-copiar').textContent = 'Texto copiado.'; };
      const fallback = () => { const r = document.createRange(); r.selectNodeContents($('m-corpo')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $('m-copiar').textContent = 'Texto selecionado: use Ctrl+C para copiar.'; };
      try { navigator.clipboard.writeText(t).then(ok, fallback); } catch (e) { fallback(); }
    });
    $('fl-area').addEventListener('change', renderLista);
    $('fl-status').addEventListener('change', renderLista);
    // busca de pessoas vira filtro da lista de acessos
    const busca = $('ac-busca');
    if (busca) { busca.placeholder = 'Filtrar por nome ou e-mail'; busca.addEventListener('input', renderAcessos); const h = $('ac-hits'); if (h) h.hidden = true; }
    const atualizar = $('ac-atualizar');
    if (atualizar) { atualizar.textContent = 'Atualizar'; atualizar.addEventListener('click', recarregarAcessos); }
    // textos da aba acessos adaptados ao auto-cadastro
    const introAc = $('intro-acessos'); if (introAc) introAc.textContent = 'Libere cada pessoa para a área dela. Quem tem acesso a uma área vê só os números e as justificativas daquela área. As pessoas criam a própria conta com o e-mail da empresa e aparecem aqui para você liberar.';

    // tela de login
    $('auth-submit').addEventListener('click', submitAuth);
    $('auth-toggle').addEventListener('click', () => { authModo = authModo === 'login' ? 'cadastro' : 'login'; pintarAuth(); });
    document.querySelectorAll('#auth-form input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); }));
  }

  // =====================================================================
  //  INICIO
  // =====================================================================
  async function iniciar() {
    ligarEventos();
    pintarAuth();
    if (!SB) {
      // Supabase nao configurado: mostra a tela de login com aviso claro.
      authMsg('Configuração do Supabase ausente. Copie assets/config.example.js para assets/config.js e preencha a URL e a chave anon.', true);
      $('auth-form').style.opacity = '0.5';
      document.querySelectorAll('#auth-form input, #auth-form button').forEach((e) => { if (e.id !== 'auth-toggle') e.disabled = true; });
      return;
    }
    // reage a login/logout
    SB.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') carregar();
      if (event === 'SIGNED_OUT') mostrarGate();
    });
    // primeira carga
    const { data: sess } = await SB.auth.getSession();
    if (sess && sess.session) carregar(); else mostrarGate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
