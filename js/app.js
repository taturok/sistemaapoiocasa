// Sistema de Controle de Medidas Socioeducativas v9.5 (Atualizado)
// Backend: Upstash Redis REST API
// ================================================================

// ================================================================
// CONFIGURAÇÃO
// ================================================================
const UPSTASH_URL = 'https://enhanced-lobster-167489.upstash.io';
const UPSTASH_TOKEN = 'gQAAAAAAAo5BAAIgcDI0NjUxNzdjMzdiYzg0YTBlOTFkZWZjY2Y0MGI5YjQ1YQ';

// ================================================================
// NÍVEIS DE ACESSO E PERMISSÕES
// ================================================================
const NIVEIS_ACESSO = {
  desenvolvedor: { nome: 'Desenvolvedor' },
  gestor: { nome: 'Gestor' },
  tecnico: { nome: 'Técnico' },
  oficineiro: { nome: 'Oficineiro' },
  jovem: { nome: 'Jovem' },
  autoridade: { nome: 'Autoridade Jurídica' },
  admin: { nome: 'Desenvolvedor' }
};

// ================================================================
// ESTADO GLOBAL
// ================================================================
let estado = {
  usuarios: [], jovens: [], profissionais: [], oficinas: [], planejamentos: [],
  online: false, usuarioAtual: null, graficos: {}, exclusaoPendente: null
};

// ================================================================
// CAMPOS DO FORMULÁRIO
// ================================================================
const CAMPOS = [
  ['REFERENCIA','REFERÊNCIA','text'],['NOME','NOME','text'],['NOME DO RESPONSÁVEL','RESPONSÁVEL','text'],
  ['REINCIDÊNCIA','REINCIDÊNCIA','text'],['MEDIDA','MEDIDA','select', [['','Selecione...'],['LA','LA - Liberdade Assistida'],['PSC','PSC - Prestação de Serviço'],['Internação','Internação'],['Liberação','Liberação']]],['MESES','MESES','text'],
  ['HORAS','HORAS','number'],['PROTETIVA','PROTETIVA','text'],['NASC.','NASCIMENTO','date'],
  ['IDADE','IDADE','number'],['GÊNERO','GÊNERO','select',[['','Selecione...'],['M','Masculino'],['F','Feminino'],['NB','Não-binário']]],
  ['CPF','CPF','text'],['TELEFONE','TELEFONE','text']
];

// ================================================================
// INJEÇÃO DE HTML DINÂMICO
// ================================================================
function injetarHTMLDinamico() {
  // Cronômetro Superior
  if (!document.getElementById('cronometroSaida')) {
    const cronometro = document.createElement('div');
    cronometro.id = 'cronometroSaida';
    cronometro.style.cssText = 'display:none; position:fixed; top:0; left:50%; transform:translateX(-50%); background:#ef4444; color:white; padding:10px 20px; border-radius:0 0 12px 12px; z-index:10000; font-weight:600; box-shadow:0 4px 6px rgba(0,0,0,0.1);';
    cronometro.innerHTML = `⚠️ Seu turno encerra em: <span id="cronometroTempo">30:00</span>`;
    document.body.appendChild(cronometro);
  }

  // Modais Básicos (Senha, Logo, etc) já existentes mantidos resumidos
  if (!document.getElementById('modalAlterarSenha')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalAlterarSenha"><div class="modal-box"><h2>🔑 Alterar Senha</h2><div class="campo"><label>Nova Senha</label><input type="password" id="novaSenhaInput"></div><div class="campo"><label>Confirmar Nova Senha</label><input type="password" id="confirmarNovaSenhaInput"></div><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalAlterarSenha').style.display='none'">Cancelar</button><button class="btn btn-primary" onclick="salvarNovaSenha()">Salvar Senha</button></div></div></div>`);
  }

  // Modal Confirmação de Exclusão (2 Passos)
  if (!document.getElementById('modalConfirmExclusao')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalConfirmExclusao"><div class="modal-box" style="max-width:400px;"><h2>⚠️ Confirmar Exclusão</h2><p id="textoConfirmExclusao" style="color:#6b7280; margin-bottom:20px;"></p><p style="font-weight:600; color:#dc3545;">Tem certeza que deseja excluir?</p><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalConfirmExclusao').style.display='none'">Cancelar</button><button class="btn btn-danger" onclick="executarExclusao()">Excluir Permanentemente</button></div></div></div>`);
  }

  // Modal Suspensão
  if (!document.getElementById('modalSuspensao')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalSuspensao"><div class="modal-box"><h2>🔴 Suspender Jovem</h2><p id="nomeJovemSuspensao" style="font-weight:600; margin-bottom:15px;"></p><div class="campo"><label>Motivo da Suspensão *</label><textarea id="motivoSuspensaoInput" rows="3" placeholder="Descreva o motivo..."></textarea></div><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalSuspensao').style.display='none'">Cancelar</button><button class="btn btn-danger" onclick="salvarSuspensao()">Suspender</button></div></div></div>`);
  }

  // Modal Aviso Gestor (7 e 14 dias)
  if (!document.getElementById('modalAvisoGestor')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalAvisoGestor"><div class="modal-box" style="max-width:700px;"><h2>⚠️ Atenção: Jovens Ausentes</h2><div style="display:flex; gap:20px; margin-top:15px;"><div style="flex:1;">
    <h4 style="color:#f59e0b;">🕒 7+ Dias Sem Comparecer</h4><ul id="listaAviso7Dias" style="color:#6b7280; font-size:0.9rem; padding-left:20px;"></ul></div><div style="flex:1;"><h4 style="color:#ef4444;">🚨 14+ Dias Sem Comparecer</h4><ul id="listaAviso14Dias" style="color:#6b7280; font-size:0.9rem; padding-left:20px;"></ul></div></div><div class="modal-actions"><button class="btn btn-primary" onclick="document.getElementById('modalAvisoGestor').style.display='none'">Ciente</button></div></div></div>`);
  }

  // Modal Controle de Horários
  if (!document.getElementById('modalHorarios')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalHorarios"><div class="modal-box" style="max-width:600px;"><h2>⏰ Configurar Acesso: <span id="nomeUserHorario"></span></h2><div id="gridHorarios" style="display:grid; gap:10px; margin-top:15px;"></div><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalHorarios').style.display='none'">Cancelar</button><button class="btn btn-primary" onclick="salvarHorariosUsuario()">Salvar Horários</button></div></div></div>`);
  }

  // Modal Ficha Atualizado (Acomoda ações LA e Profissional)
  if (!document.getElementById('modalFicha')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalFicha"><div class="modal-box ficha-container" style="max-width:800px; max-height:90vh; overflow-y:auto;"><h2 id="fichaTitulo">Ficha do Jovem</h2><div id="fichaConteudo"></div><div class="modal-actions"><button class="btn btn-secondary" id="fecharFicha" onclick="document.getElementById('modalFicha').style.display='none'">Fechar</button></div></div></div>`);
  }

  // Injetar Filtros na Aba de Frequência se não existirem
  const tab2 = document.getElementById('tab2');
  if (tab2 && !document.getElementById('filtrosFrequencia')) {
    const filtrosHTML = `<div id="filtrosFrequencia" style="background:#f8fafc; padding:15px; border-radius:12px; margin-bottom:15px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
      <div class="campo" style="flex:1; min-width:150px;"><label>Buscar Nome</label><input type="text" id="filtroNome" oninput="carregarLista()"></div>
      <div class="campo" style="flex:1; min-width:150px;"><label>Medida</label><select id="filtroMedida" onchange="carregarLista()"><option value="">Todas</option><option value="LA">LA</option><option value="PSC">PSC</option></select></div>
      <div class="campo" style="flex:1; min-width:150px;"><label>Status</label><select id="filtroStatus" onchange="carregarLista()"><option value="">Todos</option><option value="ativo">Ativo</option><option value="suspenso">Suspenso</option><option value="concluído">Concluído</option></select></div>
      <div class="campo" style="flex:1; min-width:150px;"><label>Saldo</label><select id="filtroSaldo" onchange="carregarLista()"><option value="">Todos</option><option value="critico">Crítico (>0h)</option></select></div>
    </div>`;
    tab2.insertAdjacentHTML('afterbegin', filtrosHTML);
  }
}

// ================================================================
// UPSTASH REST API BASE
// ================================================================
async function upstash(cmd, ...args) {
  const encodedArgs = args.map(a => encodeURIComponent(String(a)));
  const url = `${UPSTASH_URL}/${cmd}/${encodedArgs.join('/')}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Upstash error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) { lastErr = err; if (i < retries - 1) await new Promise(r => setTimeout(r, 1500)); }
  }
  throw lastErr;
}

// ================================================================
// LOGIN, CONTROLE DE ACESSO E CRONÔMETRO
// ================================================================
let intervaloCronometro;

async function fazerLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value.trim();
  if (!email || !senha) return alert('Preencha e-mail e senha.');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Conectando...';

  try {
    await withRetry(() => upstash('PING'));
    
    // Admin Master creation
    const adminExists = await upstash('EXISTS', 'user:admin001');
    if (adminExists === 0) {
      await upstash('SET', 'user:admin001', JSON.stringify({ id: 'admin001', nome: 'Admin', email: 'admin@teste.com', senha: '123', nivel: 'desenvolvedor', status: 'ativo' }));
      await upstash('SADD', 'users:all', 'admin001');
    }

    const allUsers = await upstash('SMEMBERS', 'users:all');
    let user = null;
    for (const id of allUsers) {
      const raw = await upstash('GET', `user:${id}`);
      if (raw) {
        const u = JSON.parse(raw);
        if (u.email === email && u.senha === senha) { user = u; break; }
      }
    }
    
    if (!user) { document.getElementById('loginErro').textContent = 'E-mail ou senha incorretos.'; return; }
    if (user.status !== 'ativo') { document.getElementById('loginErro').textContent = 'Cadastro pendente.'; return; }

    // VALIDAÇÃO DE HORÁRIO DE ACESSO
    if (!validarHorarioAcesso(user)) {
      document.getElementById('loginErro').textContent = '❌ Acesso bloqueado: Fora do horário permitido.';
      return;
    }

    estado.usuarioAtual = user;
    estado.online = true;
    document.getElementById('telaLogin').style.display = 'none';
    document.querySelector('.app-container').style.display = 'block';
    document.getElementById('nomeUsuario').textContent = user.nome || user.email;
    document.getElementById('nivelUsuario').textContent = NIVEIS_ACESSO[user.nivel]?.nome || user.nivel;

    mostrarAbasPorNivel(user.nivel);
    await carregarTodosDados();

    // Lógicas Pós-Login
    iniciarMonitoramentoHorario(user);
    if (user.nivel === 'jovem') {
      carregarJovemPeloCPF(user.cpf);
    } else if (['gestor', 'tecnico', 'desenvolvedor'].includes(user.nivel)) {
      exibirAvisoObservacoes();
    }
  } catch (err) {
    document.getElementById('loginErro').textContent = 'Erro de conexão: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

// LÓGICA DE HORÁRIOS LIMITADOS
function validarHorarioAcesso(user) {
  if (user.nivel === 'desenvolvedor' || !user.horariosConfigurados || !user.horarios) return true;
  const agora = new Date();
  const diasSemana = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
  const diaHoje = diasSemana[agora.getDay()];
  const configDia = user.horarios[diaHoje];
  if (!configDia || !configDia.ativo) return false;
  
  const horaAtualStr = agora.getHours().toString().padStart(2,'0') + ':' + agora.getMinutes().toString().padStart(2,'0');
  return horaAtualStr >= configDia.inicio && horaAtualStr <= configDia.fim;
}

function iniciarMonitoramentoHorario(user) {
  if (intervaloCronometro) clearInterval(intervaloCronometro);
  if (user.nivel === 'desenvolvedor' || !user.horariosConfigurados) return;

  intervaloCronometro = setInterval(() => {
    const agora = new Date();
    const diasSemana = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
    const diaHoje = diasSemana[agora.getDay()];
    const configDia = user.horarios[diaHoje];
    
    if (!configDia || !configDia.ativo) { deslogarSistema(); return; }

    const [horaFim, minFim] = configDia.fim.split(':').map(Number);
    const msFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), horaFim, minFim, 0).getTime();
    const diffMs = msFim - agora.getTime();
    const minutosRestantes = diffMs / 60000;

    const divCronometro = document.getElementById('cronometroSaida');
    if (minutosRestantes <= 0) {
      deslogarSistema();
    } else if (minutosRestantes <= 30) {
      divCronometro.style.display = 'block';
      const m = Math.floor(minutosRestantes);
      const s = Math.floor((minutosRestantes - m) * 60);
      document.getElementById('cronometroTempo').textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    } else {
      divCronometro.style.display = 'none';
    }
  }, 1000);
}

function deslogarSistema() {
  estado.usuarioAtual = null;
  document.querySelector('.app-container').style.display = 'none';
  document.getElementById('telaLogin').style.display = 'block';
  document.getElementById('cronometroSaida').style.display = 'none';
  if (intervaloCronometro) clearInterval(intervaloCronometro);
  alert('Seu turno de acesso encerrou. O sistema foi desconectado automaticamente.');
}

// ================================================================
// AVISO DE JOVENS AUSENTES (Gestores e Técnicos)
// ================================================================
function exibirAvisoObservacoes() {
  const agora = new Date();
  let html7 = '', html14 = '';
  
  estado.jovens.forEach(j => {
    if (j.status === 'concluído' || j.status === 'suspenso' || j['MEDIDA'] === 'Liberação') return;
    const hist = j.historicoFrequencia || [];
    if (hist.length > 0) {
      const ultimo = new Date(Math.max(...hist.map(h => new Date(h.data))));
      const diffDias = Math.floor((agora - ultimo) / (1000 * 60 * 60 * 24));
      const li = `<li><strong>${j['NOME']}</strong> - Último comparecimento: ${ultimo.toLocaleDateString('pt-BR')}</li>`;
      if (diffDias >= 14) html14 += li;
      else if (diffDias >= 7) html7 += li;
    }
  });

  if (html7 || html14) {
    document.getElementById('listaAviso7Dias').innerHTML = html7 || '<li>Nenhum jovem</li>';
    document.getElementById('listaAviso14Dias').innerHTML = html14 || '<li>Nenhum jovem</li>';
    document.getElementById('modalAvisoGestor').style.display = 'flex';
  }
}

// ================================================================
// CONFIRMAÇÃO DE EXCLUSÃO 2 PASSOS
// ================================================================
function abrirModalExclusao(tipo, id, nome) {
  estado.exclusaoPendente = { tipo, id };
  document.getElementById('textoConfirmExclusao').textContent = `Você está prestes a apagar permanentemente os registros de: ${nome}`;
  document.getElementById('modalConfirmExclusao').style.display = 'flex';
}

async function executarExclusao() {
  if (!estado.exclusaoPendente) return;
  const { tipo, id } = estado.exclusaoPendente;
  try {
    if (tipo === 'jovem') {
      await upstash('DEL', `jovem:${id}`); await upstash('SREM', 'jovens:all', id);
      estado.jovens = estado.jovens.filter(j => j.id !== id);
    } else if (tipo === 'usuario') {
      await upstash('DEL', `user:${id}`); await upstash('SREM', 'users:all', id);
      estado.usuarios = estado.usuarios.filter(u => u.id !== id);
    } else if (tipo === 'oficina') {
      await upstash('DEL', `oficina:${id}`); await upstash('SREM', 'oficinas:all', id);
      estado.oficinas = estado.oficinas.filter(o => o.id !== id);
    }
    document.getElementById('modalConfirmExclusao').style.display = 'none';
    atualizarInterfaceCompleta();
    alert('✅ Registro excluído com sucesso!');
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

// ================================================================
// STATUS SUSPENSO (COR ROSA)
// ================================================================
function abrirModalSuspensao(id, nome) {
  estado.suspensaoPendente = id;
  document.getElementById('nomeJovemSuspensao').textContent = nome;
  document.getElementById('motivoSuspensaoInput').value = '';
  document.getElementById('modalSuspensao').style.display = 'flex';
}

async function salvarSuspensao() {
  const motivo = document.getElementById('motivoSuspensaoInput').value.trim();
  if (!motivo) return alert('É obrigatório informar o motivo da suspensão.');
  
  const jovem = estado.jovens.find(j => j.id === estado.suspensaoPendente);
  if (!jovem) return;
  
  jovem.status = 'suspenso';
  jovem.motivoSuspensao = motivo;
  jovem.dataSuspensao = new Date().toISOString();
  
  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    document.getElementById('modalSuspensao').style.display = 'none';
    atualizarInterfaceCompleta();
  } catch (e) { alert('Erro ao suspender: ' + e.message); }
}

// ================================================================
// CARREGAR DADOS GERAIS
// ================================================================
async function carregarTodosDados() {
  try {
    estado.jovens = []; estado.usuarios = []; estado.profissionais = []; estado.oficinas = []; estado.planejamentos = [];
    const queries = [
      { key: 'jovens:all', prefix: 'jovem:', arr: 'jovens' },
      { key: 'users:all', prefix: 'user:', arr: 'usuarios' },
      { key: 'profissionais:all', prefix: 'profissional:', arr: 'profissionais' },
      { key: 'oficinas:all', prefix: 'oficina:', arr: 'oficinas' },
      { key: 'planejamentos:all', prefix: 'planejamento:', arr: 'planejamentos' }
    ];

    for (let q of queries) {
      const ids = await upstash('SMEMBERS', q.key) || [];
      for (const id of ids) {
        const raw = await upstash('GET', `${q.prefix}${id}`);
        if (raw) estado[q.arr].push(JSON.parse(raw));
      }
    }
    atualizarInterfaceCompleta();
  } catch (err) { console.error('Erro ao carregar dados:', err); }
}

function atualizarInterfaceCompleta() {
  renderizarCamposFormulario();
  carregarLista();
  renderizarDashboard();
  renderizarUsuarios();
  renderizarOficinas();
  renderizarPlanejamentos();
}

// ================================================================
// FORMULÁRIO E AÇÕES LA
// ================================================================
function renderizarCamposFormulario() {
  const grid = document.getElementById('camposGrid');
  if (!grid) return;
  grid.innerHTML = CAMPOS.map(([key, label, type, options]) => {
    if (type === 'select' && options) {
      return `<div class="campo"><label>${label}</label><select id="campo_${key}" onchange="if(this.id==='campo_MEDIDA') toggleAcoesLA()">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;
    }
    return `<div class="campo"><label>${label}</label><input type="${type}" id="campo_${key}"></div>`;
  }).join('');
  
  // Container dinâmico para Ações LA
  if (!document.getElementById('containerAcoesLA')) {
    grid.insertAdjacentHTML('afterend', `
      <div id="containerAcoesLA" style="display:none; background:#f8fafc; padding:15px; border-radius:12px; margin-bottom:15px; border:1px solid #e2e8f0;">
        <h4 style="color:#1e2a4a; margin-bottom:10px;">📋 Ações de Compromisso (LA)</h4>
        <div style="display:flex; gap:10px;"><input type="text" id="novaAcaoLAInput" placeholder="Descreva a ação a ser cumprida..." style="flex:1; padding:8px;"><button type="button" class="btn btn-secondary" onclick="adicionarAcaoLAForm()">Adicionar</button></div>
        <ul id="listaAcoesLAForm" style="margin-top:10px; padding-left:20px; font-size:0.9rem;"></ul>
      </div>
    `);
  }
}

let acoesLATemporarias = [];
function toggleAcoesLA() {
  const medida = document.getElementById('campo_MEDIDA')?.value;
  document.getElementById('containerAcoesLA').style.display = medida === 'LA' ? 'block' : 'none';
}
function adicionarAcaoLAForm() {
  const input = document.getElementById('novaAcaoLAInput');
  if (input.value.trim() !== '') {
    acoesLATemporarias.push({ id: Date.now(), texto: input.value.trim(), realizado: false });
    input.value = '';
    atualizarListaAcoesLAForm();
  }
}
function atualizarListaAcoesLAForm() {
  const ul = document.getElementById('listaAcoesLAForm');
  ul.innerHTML = acoesLATemporarias.map(a => `<li>${a.texto} <span style="color:red; cursor:pointer; font-weight:bold;" onclick="removerAcaoLAForm(${a.id})">x</span></li>`).join('');
}
function removerAcaoLAForm(id) {
  acoesLATemporarias = acoesLATemporarias.filter(a => a.id !== id);
  atualizarListaAcoesLAForm();
}

document.getElementById('salvarBtn')?.addEventListener('click', async () => {
  const nome = document.getElementById('campo_NOME')?.value.trim();
  if (!nome) return alert('Preencha o nome do jovem.');

  const jovem = { id: 'j_' + Date.now(), status: 'ativo' };
  CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) jovem[key] = el.value.trim(); });
  jovem['ID_DIGITAL'] = document.getElementById('campo_ID_DIGITAL')?.value.trim() || '';
  
  if (jovem['MEDIDA'] === 'LA') jovem.acoesLA = [...acoesLATemporarias];
  
  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    await upstash('SADD', 'jovens:all', jovem.id);
    estado.jovens.push(jovem);
    alert('Jovem salvo com sucesso!');
    acoesLATemporarias = []; atualizarListaAcoesLAForm(); toggleAcoesLA();
    atualizarInterfaceCompleta();
  } catch (err) { alert('Erro: ' + err.message); }
});

// ================================================================
// LISTA, FILTROS E STATUS (TABELA FREQUÊNCIA)
// ================================================================
function carregarLista() {
  const tbody = document.getElementById('listaCorpo');
  if (!tbody) return;

  const fNome = (document.getElementById('filtroNome')?.value || '').toLowerCase();
  const fMedida = document.getElementById('filtroMedida')?.value;
  const fStatus = document.getElementById('filtroStatus')?.value;
  const fSaldo = document.getElementById('filtroSaldo')?.value;

  let lista = estado.jovens.filter(j => {
    // Definir Status Real
    if (j.status === 'suspenso') j._statusRender = 'suspenso';
    else if (j['MEDIDA'] === 'Liberação') j._statusRender = 'liberado';
    else {
      const saldo = parseFloat(calcularSaldo(j));
      j._statusRender = saldo <= 0 ? 'concluído' : 'ativo';
    }

    if (fNome && !(j['NOME']||'').toLowerCase().includes(fNome)) return false;
    if (fMedida && j['MEDIDA'] !== fMedida) return false;
    if (fStatus && j._statusRender !== fStatus) return false;
    if (fSaldo === 'critico' && parseFloat(calcularSaldo(j)) <= 0) return false;
    return true;
  });

  tbody.innerHTML = lista.map(j => {
    const hist = j.historicoFrequencia || [];
    const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';
    let bgStatus = j._statusRender === 'suspenso' ? 'background:#fce7f3; color:#be185d;' : (j._statusRender === 'ativo' ? 'background:#d1fae5; color:#065f46;' : 'background:#e5e7eb; color:#374151;');

    const ehLA = j['MEDIDA'] === 'LA';
    const acoesRender = ehLA ? `Ações: ${j.acoesLA?.filter(a=>a.realizado).length || 0}/${j.acoesLA?.length || 0}` : `${calcularSaldo(j)}h`;

    return `<tr>
      <td>${j['NOME'] || '-'}</td>
      <td>${j['MEDIDA'] || '-'}</td>
      <td>${acoesRender}</td>
      <td><span style="font-weight:600; padding:4px 12px; border-radius:20px; ${bgStatus}">${j._statusRender.toUpperCase()}</span></td>
      <td>${ultimo}</td>
      <td>
        <button onclick="abrirFichaModal('${j.id}')" class="btn-acao btn-ficha">📋 Ficha</button>
        ${['gestor','tecnico'].includes(estado.usuarioAtual?.nivel) && j._statusRender !== 'suspenso' ? `<button onclick="abrirModalSuspensao('${j.id}', '${j['NOME']}')" class="btn-acao" style="background:#be185d; color:white;">🔴 Suspender</button>` : ''}
        <button onclick="abrirModalExclusao('jovem', '${j.id}', '${j['NOME']}')" class="btn-acao btn-danger">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

function calcularSaldo(jovem) {
  if(jovem['MEDIDA'] === 'LA') return 0; // LA não reduz horas
  const horasTotal = parseNum(jovem['HORAS']);
  const horasFeitas = (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0);
  return Math.max(0, horasTotal - horasFeitas).toFixed(1);
}
function parseNum(val) { const n = parseFloat(String(val).replace(',', '.')); return isNaN(n) ? 0 : n; }

// ================================================================
// DASHBOARD DO JOVEM (LA vs Outras Medidas)
// ================================================================
function carregarJovemPeloCPF(cpf) {
  const jovem = estado.jovens.find(j => (j['CPF']||'').replace(/\D/g,'') === cpf.replace(/\D/g,''));
  if (jovem) { estado.jovens = [jovem]; renderizarDashboardJovem(); }
}

function renderizarDashboardJovem() {
  const cards = document.getElementById('jovemInfoCards');
  const freqDiv = document.getElementById('jovemFrequencia');
  if (!cards || !freqDiv) return;
  const jovem = estado.jovens[0];
  if (!jovem) return;

  if (jovem['MEDIDA'] === 'LA') {
    // DASHBOARD LA (Ações)
    const acoes = jovem.acoesLA || [];
    const concluidas = acoes.filter(a => a.realizado).length;
    const progresso = acoes.length > 0 ? ((concluidas / acoes.length) * 100).toFixed(0) : 0;
    
    cards.innerHTML = `
      <div class="card"><h4>Nome</h4><p style="font-size:1.1rem;">${jovem['NOME'] || '-'}</p></div>
      <div class="card"><h4>Medida</h4><p>Liberdade Assistida</p></div>
      <div class="card"><h4>Ações Concluídas</h4><p style="font-size:1.5rem; color:#10b981;">${concluidas}/${acoes.length}</p></div>
      <div class="card"><h4>Progresso Geral</h4><p style="font-size:1.5rem; color:#3b82f6;">${progresso}%</p></div>
    `;

    freqDiv.innerHTML = `
      <div class="card" style="margin-top:16px;">
        <h3>📝 Minhas Ações/Compromissos</h3>
        <ul style="list-style:none; padding:0; margin-top:15px;">
          ${acoes.map(a => `<li style="padding:10px; background:${a.realizado ? '#d1fae5' : '#fffbeb'}; margin-bottom:8px; border-radius:8px; border-left:4px solid ${a.realizado ? '#10b981' : '#f59e0b'};"><strong>${a.texto}</strong> - <span style="color:${a.realizado ? '#065f46' : '#92400e'}">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span></li>`).join('')}
        </ul>
      </div>`;
  } else {
    // DASHBOARD NORMAL (Horas)
    const horasTotal = parseNum(jovem['HORAS']);
    const horasFeitas = (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0);
    cards.innerHTML = `
      <div class="card"><h4>Nome</h4><p style="font-size:1.1rem;">${jovem['NOME'] || '-'}</p></div>
      <div class="card"><h4>Horas a Cumprir</h4><p style="font-size:1.5rem; color:#2c3e66;">${horasTotal}h</p></div>
      <div class="card"><h4>Horas Cumpridas</h4><p style="font-size:1.5rem; color:#10b981;">${horasFeitas.toFixed(1)}h</p></div>
      <div class="card"><h4>Saldo Restante</h4><p style="font-size:1.5rem; color:#f59e0b;">${calcularSaldo(jovem)}h</p></div>
    `;
    freqDiv.innerHTML = `<div class="card" style="margin-top:16px;"><h3>📊 Frequências</h3><p style="color:#6b7280; margin-top:10px;">Consulte um técnico para registro de atividades.</p></div>`;
  }
}

// ================================================================
// FICHA DO JOVEM (Inclui Check de LA e Atribuição de Profissional)
// ================================================================
window.abrirFichaModal = function(id) {
  const jovem = estado.jovens.find(j => j.id === id);
  if (!jovem) return;
  document.getElementById('fichaTitulo').textContent = `Ficha: ${jovem['NOME']}`;
  
  let acoesLAHTML = '';
  if (jovem['MEDIDA'] === 'LA') {
    const acoes = jovem.acoesLA || [];
    const profs = estado.usuarios.filter(u => u.nivel === 'tecnico' || u.nivel === 'gestor');
    
    acoesLAHTML = `
      <h3 style="margin-top:20px; border-bottom:2px solid #e2e8f0; padding-bottom:5px;">Acompanhamento LA</h3>
      <div style="margin-bottom:15px;">
        <label style="font-weight:bold;">Profissional Responsável:</label>
        <select onchange="vincularProfissionalLA('${jovem.id}', this.value)" style="padding:5px; border-radius:5px;">
          <option value="">Não atribuído</option>
          ${profs.map(p => `<option value="${p.id}" ${jovem.profissionalLA === p.id ? 'selected' : ''}>${p.nome}</option>`).join('')}
        </select>
      </div>
      <ul style="list-style:none; padding:0;">
        ${acoes.map(a => `
          <li style="padding:10px; background:#f8fafc; border:1px solid #e2e8f0; margin-bottom:5px; display:flex; justify-content:space-between;">
            <span>${a.texto}</span>
            <button class="btn btn-${a.realizado ? 'success' : 'secondary'}" onclick="toggleAcaoLA('${jovem.id}', ${a.id})" style="padding:4px 8px; font-size:0.8rem;">${a.realizado ? '✅ Feito' : 'Marcar Feito'}</button>
          </li>
        `).join('')}
      </ul>
    `;
  }

  document.getElementById('fichaConteudo').innerHTML = `
    <div class="grid-campos">
      ${CAMPOS.map(([key, label]) => `<div class="campo-item"><strong>${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}
    </div>
    ${acoesLAHTML}
  `;
  document.getElementById('modalFicha').style.display = 'flex';
}

window.toggleAcaoLA = async function(jovemId, acaoId) {
  const jovem = estado.jovens.find(j => j.id === jovemId);
  const acao = jovem.acoesLA.find(a => a.id === acaoId);
  acao.realizado = !acao.realizado;
  await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
  abrirFichaModal(jovemId);
}
window.vincularProfissionalLA = async function(jovemId, profId) {
  const jovem = estado.jovens.find(j => j.id === jovemId);
  jovem.profissionalLA = profId;
  await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
  alert('Profissional vinculado com sucesso!');
}

// ================================================================
// OFICINAS (Cursos Obrigatórios e Planejamento)
// ================================================================
function renderizarPlanejamentos() {
  const tabPlanejamento = document.getElementById('tabPlanejamento');
  if (!tabPlanejamento) {
    document.getElementById('tabsContainer').insertAdjacentHTML('beforeend', `<button class="tab-btn" data-tab="tabPlanejamento" data-niveis="gestor,oficineiro,desenvolvedor">📅 Planejamento</button>`);
    document.querySelector('.app-container').insertAdjacentHTML('beforeend', `
      <div id="tabPlanejamento" class="tab-content">
        <h2>📅 Planejamento de Oficinas</h2>
        <div class="card" style="margin-bottom:20px; border-left-color:#3b82f6;">
          <input type="text" id="planTitulo" placeholder="Título da Oficina" style="width:100%; margin-bottom:10px; padding:10px;">
          <textarea id="planDesc" placeholder="Descrição" rows="3" style="width:100%; margin-bottom:10px; padding:10px;"></textarea>
          <input type="text" id="planMats" placeholder="Materiais necessários (separados por vírgula)" style="width:100%; margin-bottom:10px; padding:10px;">
          <button class="btn btn-primary" onclick="salvarPlanejamento()">Salvar Planejamento</button>
        </div>
        <div id="listaPlanejamentosHTML" style="display:grid; gap:15px;"></div>
      </div>
    `);
    
    // Injetar Relatório de Revertência na aba relatórios ou Oficinas
    const tabOficinas = document.getElementById('tab6');
    if (tabOficinas) {
      tabOficinas.insertAdjacentHTML('afterbegin', `
        <div style="background:#ecfdf5; padding:15px; border-radius:12px; margin-bottom:20px; border:1px solid #10b981;">
          <h3 style="color:#065f46;">🌱 Relatório de Revertência Social</h3>
          <p style="font-size:0.9rem; color:#065f46; margin-bottom:10px;">Oficinas que geraram benefício direto à sociedade.</p>
          <button class="btn btn-success" onclick="abrirRelatorioRevertencia()">Visualizar Relatório Completo</button>
        </div>
        <div style="margin-bottom:15px; background:#f8fafc; padding:10px; border-radius:8px;">
          <label><input type="checkbox" id="oficinaCursoObg" onchange="document.getElementById('oficinaGeraHorasContainer').style.display = this.checked ? 'block' : 'none'"> É Curso Obrigatório?</label>
          <div id="oficinaGeraHorasContainer" style="display:none; margin-top:5px; padding-left:20px;">
             <label><input type="checkbox" id="oficinaGeraHoras" checked> Este curso contabiliza horas para o jovem?</label>
          </div>
        </div>
      `);
    }
  }

  const listaHTML = document.getElementById('listaPlanejamentosHTML');
  if (listaHTML) {
    listaHTML.innerHTML = estado.planejamentos.map(p => `
      <div style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid #3b82f6; padding:15px; border-radius:8px;">
        <h4 style="margin-bottom:5px;">${p.titulo}</h4><p style="color:#6b7280; font-size:0.9rem; margin-bottom:10px;">${p.descricao}</p>
        <p style="font-size:0.85rem;"><strong>Materiais:</strong> ${p.materiais}</p>
        <button class="btn btn-danger" style="margin-top:10px;" onclick="abrirModalExclusao('planejamento', '${p.id}', '${p.titulo}')">Excluir</button>
      </div>
    `).join('');
  }
}

window.salvarPlanejamento = async function() {
  const titulo = document.getElementById('planTitulo').value;
  const descricao = document.getElementById('planDesc').value;
  const materiais = document.getElementById('planMats').value;
  if(!titulo) return;
  const plan = { id: 'plan_'+Date.now(), titulo, descricao, materiais };
  await upstash('SET', `planejamento:${plan.id}`, JSON.stringify(plan));
  await upstash('SADD', 'planejamentos:all', plan.id);
  estado.planejamentos.push(plan);
  renderizarPlanejamentos();
}

// Alterando função nativa de salvar oficina para acomodar Horas
document.getElementById('salvarOficinaBtn')?.addEventListener('click', async () => {
  const data = document.getElementById('oficinaData').value;
  const conteudo = document.getElementById('oficinaConteudo').value;
  const reverte = document.getElementById('oficinaReverte').checked;
  const isCurso = document.getElementById('oficinaCursoObg')?.checked;
  const abateHoras = isCurso ? document.getElementById('oficinaGeraHoras')?.checked : true;
  
  if (!data || !conteudo) return alert('Preencha data e conteúdo.');
  const jovensPresentes = [...document.querySelectorAll('#listaJovensOficina input:checked')].map(cb => cb.value);
  const oficina = { id: 'of_' + Date.now(), data, conteudo, reverte, jovensIds: jovensPresentes, isCurso, abateHoras };
  
  try {
    await upstash('SET', `oficina:${oficina.id}`, JSON.stringify(oficina));
    await upstash('SADD', 'oficinas:all', oficina.id);
    estado.oficinas.push(oficina);

    // Abater horas apenas se abateHoras for verdadeiro E jovem não for de LA
    if (abateHoras) {
      for (const jId of jovensPresentes) {
        const j = estado.jovens.find(x => x.id === jId);
        if (j && j['MEDIDA'] !== 'LA') {
          j.historicoFrequencia = j.historicoFrequencia || [];
          j.historicoFrequencia.push({ data: new Date().toISOString(), horas: 4, tipo: 'entrada', observacao: 'Oficina: ' + conteudo });
          await upstash('SET', `jovem:${j.id}`, JSON.stringify(j));
        }
      }
    }
    alert('Oficina salva!');
    carregarTodosDados();
  } catch (err) { alert('Erro: ' + err.message); }
});

window.abrirRelatorioRevertencia = function() {
  const ofs = estado.oficinas.filter(o => o.reverte);
  let html = `<html><head><title>Relatório de Revertência</title><style>body{font-family:sans-serif; padding:20px;}</style></head><body><h2>🌱 Relatório de Oficinas com Benefício Social</h2>`;
  html += ofs.map(o => {
    const jovens = o.jovensIds.map(id => estado.jovens.find(j=>j.id===id)?.NOME).join(', ');
    return `<div style="border-bottom:1px solid #ccc; padding:10px 0;"><strong>${new Date(o.data).toLocaleDateString('pt-BR')} - ${o.conteudo}</strong><br>Participantes: ${jovens || 'Nenhum'}</div>`;
  }).join('');
  html += `</body></html>`;
  const win = window.open('','_blank');
  win.document.write(html);
}

// ================================================================
// GESTÃO DE HORÁRIOS PARA USUÁRIOS
// ================================================================
function renderizarUsuarios() {
  const tbody = document.getElementById('listaUsuarios');
  if (!tbody) return;
  tbody.innerHTML = estado.usuarios.filter(u => u.status === 'ativo').map(u => `
    <tr>
      <td>${u.nome || '-'}</td><td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel}</td>
      <td>
        ${estado.usuarioAtual.nivel === 'gestor' || estado.usuarioAtual.nivel === 'desenvolvedor' ? `<button onclick="abrirModalHorarios('${u.id}')" class="btn-acao" style="background:#f59e0b; color:white;">⏱️ Horários</button>` : ''}
        <button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-acao btn-danger">🗑️</button>
      </td>
    </tr>
  `).join('');
}

window.abrirModalHorarios = function(id) {
  const u = estado.usuarios.find(x => x.id === id);
  estado.usuarioEdicaoHorario = u;
  document.getElementById('nomeUserHorario').textContent = u.nome;
  
  const dias = ['segunda','terca','quarta','quinta','sexta'];
  const cfg = u.horarios || {};
  document.getElementById('gridHorarios').innerHTML = `
    <label><input type="checkbox" id="horariosAtivosGlobais" ${u.horariosConfigurados ? 'checked' : ''}> Limitar Acesso por Horário</label>
    <div id="diasContainer" style="display:${u.horariosConfigurados ? 'block' : 'none'}; margin-top:10px;">
      ${dias.map(d => `
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
          <input type="checkbox" id="chk_${d}" ${cfg[d]?.ativo ? 'checked' : ''}>
          <span style="width:70px; text-transform:capitalize;">${d}</span>
          <input type="time" id="ini_${d}" value="${cfg[d]?.inicio || '08:00'}"> até
          <input type="time" id="fim_${d}" value="${cfg[d]?.fim || '17:00'}">
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('horariosAtivosGlobais').onchange = (e) => {
    document.getElementById('diasContainer').style.display = e.target.checked ? 'block' : 'none';
  };
  document.getElementById('modalHorarios').style.display = 'flex';
}

window.salvarHorariosUsuario = async function() {
  const u = estado.usuarioEdicaoHorario;
  u.horariosConfigurados = document.getElementById('horariosAtivosGlobais').checked;
  u.horarios = {};
  ['segunda','terca','quarta','quinta','sexta'].forEach(d => {
    u.horarios[d] = {
      ativo: document.getElementById(`chk_${d}`).checked,
      inicio: document.getElementById(`ini_${d}`).value,
      fim: document.getElementById(`fim_${d}`).value
    };
  });
  
  await upstash('SET', `user:${u.id}`, JSON.stringify(u));
  document.getElementById('modalHorarios').style.display = 'none';
  alert('Horários de acesso salvos com sucesso!');
}

// INICIALIZAÇÃO
document.getElementById('logoutBtn')?.addEventListener('click', deslogarSistema);
function renderizarDashboard() {} // Mock para não quebrar chamadas legadas
