// Sistema de Controle de Medidas Socioeducativas v9.5
// Backend: Upstash Redis REST API (direto do frontend)
// ================================================================

// ================================================================
// CONFIGURAÇÃO UPSTASH
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
  online: false, usuarioAtual: null, graficos: {}, exclusaoPendente: null, suspensaoPendente: null
};

// ================================================================
// CAMPOS DO FORMULÁRIO (baseados na planilha real)
// ================================================================
const CAMPOS = [
  ['REFERENCIA','REFERÊNCIA','text'],['NOME','NOME','text'],['NOME DO RESPONSÁVEL','RESPONSÁVEL','text'],
  ['REINCIDÊNCIA','REINCIDÊNCIA','text'],
  ['MEDIDA','MEDIDA','select', [['','Selecione...'],['LA','LA - Liberdade Assistida'],['PSC','PSC - Prestação de Serviço'],['Internação','Internação'],['Liberação','Liberação']]],
  ['MESES','MESES','text'],
  ['HORAS','HORAS','number'],['PROTETIVA','PROTETIVA','text'],['NASC.','NASCIMENTO','date'],
  ['MÊS ANIVERSARIO','MÊS ANIVER.','text'],['NATURALIDADE','NATURALIDADE','text'],
  ['IDADE','IDADE','number'],['GÊNERO','GÊNERO','select',[['','Selecione...'],['M','Masculino'],['F','Feminino'],['NB','Não-binário']]],
  ['COR','COR','select',[['','Selecione...'],['Branca','Branca'],['Preta','Preta'],['Parda','Parda'],
    ['Amarela','Amarela'],['Indígena','Indígena']]],
  ['COMPOSIÇÃO FAMILIAR','COMPOSIÇÃO FAMILIAR','text'],['RENDA','RENDA','text'],
  ['BENEFICIO','BENEFÍCIO','text'],['PAA','PAA','text'],['ENDEREÇO','ENDEREÇO','text'],
  ['BAIRRO','BAIRRO','text'],['TELEFONE','TELEFONE','text'],['CRAS','CRAS','text'],
  ['UBS','UBS','text'],['CPF','CPF','text'],['ESTUDA?','ESTUDA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
  ['SÉRIE','SÉRIE','text'],['ESCOLA','ESCOLA','text'],['TRABALHA?','TRABALHA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
  ['FUNÇÃO','FUNÇÃO','text'],['VINCULO','VÍNCULO','text'],['REDE','REDE','text'],
  ['USO DE SPA?','USO DE SPA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
  ['QUAL?','QUAL?','text'],['PREFERE NOME SOCIAL?','NOME SOCIAL?','select',[['',''],['Sim','Sim'],['Não','Não']]],
  ['QUAL NOME SOCIAL?','NOME SOCIAL','text']
];

// ================================================================
// INJEÇÃO DE HTML (MODAIS, TELAS DE CADASTRO E APROVAÇÃO)
// ================================================================
function injetarHTMLDinamico() {
  // Tela de Cadastro
  if (!document.getElementById('telaCadastro')) {
    const telaCadastro = document.createElement('div');
    telaCadastro.id = 'telaCadastro';
    telaCadastro.style.display = 'none';
    telaCadastro.innerHTML = `
      <div class="login-box" style="margin: 20px auto;">
        <h2>📝 Solicitar Cadastro</h2>
        <p style="text-align:center; color:#6b7280; margin-bottom:20px;">Seu cadastro passará por aprovação.</p>
        <div class="campo"><label>Nome Completo</label><input type="text" id="cadastroNome" placeholder="Seu nome completo"></div>
        <div class="campo"><label>E-mail</label><input type="email" id="cadastroEmail" placeholder="seu@email.com"></div>
        <div class="campo"><label>Senha</label><input type="password" id="cadastroSenha" placeholder="••••••••"></div>
        <div class="campo"><label>Confirmar Senha</label><input type="password" id="cadastroSenhaConfirm" placeholder="••••••••"></div>
        <div class="campo"><label>Nível de Acesso</label><select id="cadastroNivel"><option value="oficineiro">Oficineiro</option><option value="tecnico">Técnico</option><option value="gestor">Gestor</option><option value="autoridade">Autoridade Jurídica</option><option value="jovem">Jovem</option></select></div>
        <button id="cadastrarBtn" class="btn btn-primary" style="margin-top:10px; width:100%;">Enviar Solicitação</button>
        <button id="voltarLoginBtn" class="btn btn-secondary" style="margin-top:10px; width:100%;">Voltar para Login</button>
        <div id="cadastroErro" class="login-erro"></div>
        <div id="cadastroSucesso" style="color: #10b981; text-align: center; margin-top: 10px; display: none;"></div>
      </div>
    `;
    document.body.appendChild(telaCadastro);
  }

  // Cronômetro Superior
  if (!document.getElementById('cronometroSaida')) {
    document.body.insertAdjacentHTML('beforeend', `<div id="cronometroSaida" style="display:none; position:fixed; top:0; left:50%; transform:translateX(-50%); background:#ef4444; color:white; padding:10px 20px; border-radius:0 0 12px 12px; z-index:10000; font-weight:600; box-shadow:0 4px 6px rgba(0,0,0,0.1);">⚠️ Seu turno encerra em: <span id="cronometroTempo">30:00</span></div>`);
  }

  // Modal Ficha Atualizado
  if (!document.getElementById('modalFicha')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalFicha"><div class="modal-box ficha-container" style="max-width:800px; max-height:90vh; overflow-y:auto;"><h2 id="fichaTitulo">Ficha do Jovem</h2><div id="fichaConteudo"></div><div class="modal-actions"><button class="btn btn-secondary" id="fecharFicha" onclick="document.getElementById('modalFicha').style.display='none'">Fechar</button></div></div></div>`);
  }

  // Modais Básicos
  if (!document.getElementById('modalAlterarSenha')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalAlterarSenha"><div class="modal-box"><h2>🔑 Alterar Senha</h2><div class="campo"><label>Nova Senha</label><input type="password" id="novaSenhaInput"></div><div class="campo"><label>Confirmar Nova Senha</label><input type="password" id="confirmarNovaSenhaInput"></div><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalAlterarSenha').style.display='none'">Cancelar</button><button class="btn btn-primary" onclick="salvarNovaSenha()">Salvar Senha</button></div></div></div>`);
  }
  if (!document.getElementById('modalAlterarLogo')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalAlterarLogo"><div class="modal-box"><h2>🖼️ Alterar Logo</h2><div class="campo"><label>Imagem do Logo</label><input type="file" id="novaLogoInput" accept="image/*"></div><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalAlterarLogo').style.display='none'">Cancelar</button><button class="btn btn-primary" onclick="salvarLogo()">Salvar Logo</button></div></div></div>`);
  }

  // Modal Exclusão 2 Passos
  if (!document.getElementById('modalConfirmExclusao')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalConfirmExclusao"><div class="modal-box" style="max-width:400px;"><h2>⚠️ Confirmar Exclusão</h2><p id="textoConfirmExclusao" style="color:#6b7280; margin-bottom:20px;"></p><p style="font-weight:600; color:#dc3545;">Tem certeza que deseja excluir?</p><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalConfirmExclusao').style.display='none'">Cancelar</button><button class="btn btn-danger" onclick="executarExclusao()">Excluir Permanentemente</button></div></div></div>`);
  }

  // Modal Suspensão
  if (!document.getElementById('modalSuspensao')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalSuspensao"><div class="modal-box"><h2>🔴 Suspender Jovem</h2><p id="nomeJovemSuspensao" style="font-weight:600; margin-bottom:15px;"></p><div class="campo"><label>Motivo da Suspensão *</label><textarea id="motivoSuspensaoInput" rows="3" placeholder="Descreva o motivo..."></textarea></div><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalSuspensao').style.display='none'">Cancelar</button><button class="btn btn-danger" onclick="salvarSuspensao()">Suspender</button></div></div></div>`);
  }

  // Modal Horários
  if (!document.getElementById('modalHorarios')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalHorarios"><div class="modal-box" style="max-width:600px;"><h2>⏰ Configurar Acesso: <span id="nomeUserHorario"></span></h2><div id="gridHorarios" style="display:grid; gap:10px; margin-top:15px;"></div><div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalHorarios').style.display='none'">Cancelar</button><button class="btn btn-primary" onclick="salvarHorariosUsuario()">Salvar Horários</button></div></div></div>`);
  }

  // Modal Aviso Observações Gestor
  if (!document.getElementById('modalAvisoGestor')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="modalAvisoGestor"><div class="modal-box" style="max-width:700px;"><h2>⚠️ Atenção: Jovens Ausentes</h2><div style="display:flex; gap:20px; margin-top:15px;"><div style="flex:1;"><h4 style="color:#f59e0b;">🕒 7+ Dias Sem Comparecer</h4><ul id="listaAviso7Dias" style="color:#6b7280; font-size:0.9rem; padding-left:20px;"></ul></div><div style="flex:1;"><h4 style="color:#ef4444;">🚨 14+ Dias Sem Comparecer</h4><ul id="listaAviso14Dias" style="color:#6b7280; font-size:0.9rem; padding-left:20px;"></ul></div></div><div class="modal-actions"><button class="btn btn-primary" onclick="document.getElementById('modalAvisoGestor').style.display='none'">Ciente</button></div></div></div>`);
  }

  // Modal Vincular Jovem
  if (!document.getElementById('modalVincularJovem')) {
    const modalVincular = document.createElement('div');
    modalVincular.className = 'modal-overlay';
    modalVincular.id = 'modalVincularJovem';
    modalVincular.innerHTML = `
      <div class="modal-box">
        <h2>🔗 Vincular Usuário a Jovem</h2>
        <p style="color:#6b7280; margin-bottom:15px;">Selecione o jovem correspondente a este usuário.</p>
        <div class="campo"><label>Jovem</label><select id="selectVincularJovem"></select></div>
        <div class="modal-actions"><button class="btn btn-secondary" onclick="document.getElementById('modalVincularJovem').style.display='none'">Cancelar</button><button class="btn btn-primary" onclick="salvarVinculoJovem()">Vincular e Aprovar</button></div>
      </div>
    `;
    document.body.appendChild(modalVincular);
  }

  // Adicionar Filtros na Aba de Frequência
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

  // Adicionar Relatório de Revertência na Aba Oficinas
  const tabOficinas = document.getElementById('tab6');
  if (tabOficinas && !document.getElementById('oficinaGeraHorasContainer')) {
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

  // Aba de Aprovação na tab de usuários
  const tabUsuarios = document.getElementById('tabUsuarios');
  if (tabUsuarios && !document.getElementById('listaPendentes')) {
    const aprovarSection = document.createElement('div');
    aprovarSection.innerHTML = `<h3 style="margin-top:30px; margin-bottom:15px;">⏳ Solicitações Pendentes</h3><div class="tabela-wrapper"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Nível</th><th>Status</th><th>Ações</th></tr></thead><tbody id="listaPendentes"></tbody></table></div>`;
    tabUsuarios.appendChild(aprovarSection);
  }

  // Aba Planejamento
  if (!document.getElementById('tabPlanejamento')) {
    document.getElementById('tabsContainer').insertAdjacentHTML('beforeend', `<button class="tab-btn" data-tab="tabPlanejamento" data-niveis="gestor,oficineiro,desenvolvedor">📅 Planejamento</button>`);
    document.querySelector('.app-container').insertAdjacentHTML('beforeend', `<div id="tabPlanejamento" class="tab-content"><h2>📅 Planejamento de Oficinas</h2><div class="card" style="margin-bottom:20px;"><input type="text" id="planTitulo" placeholder="Título da Oficina" style="width:100%; margin-bottom:10px; padding:10px;"><textarea id="planDesc" placeholder="Descrição" rows="3" style="width:100%; margin-bottom:10px; padding:10px;"></textarea><input type="text" id="planMats" placeholder="Materiais (separados por vírgula)" style="width:100%; margin-bottom:10px; padding:10px;"><button class="btn btn-primary" onclick="salvarPlanejamento()">Salvar Planejamento</button></div><div id="listaPlanejamentosHTML" style="display:grid; gap:15px;"></div></div>`);
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
async function upstashPipeline(commands) {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, { method: 'POST', headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) });
  if (!res.ok) throw new Error(`Upstash pipeline error: ${res.status}`);
  return res.json();
}
async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) { lastErr = err; if (i < retries - 1) await new Promise(r => setTimeout(r, 1500)); }
  }
  throw lastErr;
}

// ================================================================
// LOGIN, HORÁRIOS E AUTENTICAÇÃO
// ================================================================
async function fazerLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value.trim();
  if (!email || !senha) return alert('Preencha e-mail e senha.');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Conectando...';

  try {
    await withRetry(() => upstash('PING'));
    
    // Criar admin se não existir
    const adminExists = await upstash('EXISTS', 'user:admin001');
    if (adminExists === 0) {
      await upstash('SET', 'user:admin001', JSON.stringify({ id: 'admin001', nome: 'Administrador', email: 'admin@teste.com', senha: '123', nivel: 'desenvolvedor', status: 'ativo' }));
      await upstash('SADD', 'users:all', 'admin001');
    }

    const allUsers = await upstash('SMEMBERS', 'users:all') || [];
    let user = null;
    for (const id of allUsers) {
      const raw = await upstash('GET', `user:${id}`);
      if (raw) {
        const u = JSON.parse(raw);
        if (u.email === email && u.senha === senha) { user = u; break; }
      }
    }
    
    if (!user) { document.getElementById('loginErro').textContent = 'E-mail ou senha incorretos.'; return; }
    if (user.status !== 'ativo') { document.getElementById('loginErro').textContent = 'Seu cadastro está pendente de aprovação.'; return; }

    if (!validarHorarioAcesso(user)) {
      document.getElementById('loginErro').textContent = '❌ Acesso bloqueado: Fora do horário permitido.';
      return;
    }

    estado.usuarioAtual = user;
    estado.online = true;
    localStorage.setItem('usuarioLogado', user.email);
    localStorage.setItem('nivelUsuario', user.nivel);
    
    document.getElementById('telaLogin').style.display = 'none';
    document.querySelector('.app-container').style.display = 'block';
    document.getElementById('nomeUsuario').textContent = user.nome || user.email;
    document.getElementById('nivelUsuario').textContent = NIVEIS_ACESSO[user.nivel]?.nome || user.nivel;

    carregarLogo();
    mostrarAbasPorNivel(user.nivel);
    iniciarMonitoramentoHorario(user);
    
    if (user.nivel === 'jovem') {
      carregarJovemPeloCPF(user.cpf);
    } else {
      await carregarTodosDados();
      if (['gestor', 'tecnico', 'desenvolvedor'].includes(user.nivel)) exibirAvisoObservacoes();
    }
    iniciarPolling();
  } catch (err) {
    document.getElementById('loginErro').textContent = 'Erro de conexão: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function validarHorarioAcesso(user) {
  if (user.nivel === 'desenvolvedor' || !user.horariosConfigurados || !user.horarios) return true;
  const agora = new Date();
  const diaHoje = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'][agora.getDay()];
  const configDia = user.horarios[diaHoje];
  if (!configDia || !configDia.ativo) return false;
  
  const horaAtual = agora.getHours().toString().padStart(2,'0') + ':' + agora.getMinutes().toString().padStart(2,'0');
  return horaAtual >= configDia.inicio && horaAtual <= configDia.fim;
}

let intervaloCronometro;
function iniciarMonitoramentoHorario(user) {
  if (intervaloCronometro) clearInterval(intervaloCronometro);
  if (user.nivel === 'desenvolvedor' || !user.horariosConfigurados) return;

  intervaloCronometro = setInterval(() => {
    const agora = new Date();
    const diaHoje = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'][agora.getDay()];
    const configDia = user.horarios[diaHoje];
    
    if (!configDia || !configDia.ativo) { deslogarSistema(); return; }

    const [horaFim, minFim] = configDia.fim.split(':').map(Number);
    const msFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), horaFim, minFim, 0).getTime();
    const minutosRestantes = (msFim - agora.getTime()) / 60000;

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
  localStorage.removeItem('usuarioLogado');
  localStorage.removeItem('nivelUsuario');
  estado.usuarioAtual = null;
  document.querySelector('.app-container').style.display = 'none';
  document.getElementById('telaLogin').style.display = 'block';
  document.getElementById('cronometroSaida').style.display = 'none';
  if (intervaloCronometro) clearInterval(intervaloCronometro);
  if (pollingInterval) clearInterval(pollingInterval);
}

function mostrarAbasPorNivel(nivel) {
  const tabsContainer = document.getElementById('tabsContainer');
  if (!tabsContainer) return;
  
  let nivelNormalizado = (nivel || '').toLowerCase().trim();
  if (['admin', 'administrador', 'desenvolvedor'].includes(nivelNormalizado)) nivelNormalizado = 'desenvolvedor';
  if (['oficineira'].includes(nivelNormalizado)) nivelNormalizado = 'oficineiro';
  if (['técnico'].includes(nivelNormalizado)) nivelNormalizado = 'tecnico';
  if (['gestora'].includes(nivelNormalizado)) nivelNormalizado = 'gestor';
  if (['autoridade jurídica', 'autoridade juridica'].includes(nivelNormalizado)) nivelNormalizado = 'autoridade';
  
  const config = NIVEIS_ACESSO[nivelNormalizado];
  if (!config) return;
  
  tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
    const niveisDoBotao = btn.getAttribute('data-niveis');
    if (!niveisDoBotao) return;
    const temAcesso = niveisDoBotao.split(',').map(n => n.trim().toLowerCase()).includes(nivelNormalizado);
    btn.style.display = temAcesso ? '' : 'none';
    const tabContent = document.getElementById(btn.dataset.tab);
    if (tabContent) tabContent.style.display = temAcesso ? '' : 'none';
  });

  const primeiraVisivel = tabsContainer.querySelector('.tab-btn:not([style*="display: none"])');
  if (primeiraVisivel) {
    tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    primeiraVisivel.classList.add('active');
    const target = document.getElementById(primeiraVisivel.dataset.tab);
    if (target) target.classList.add('active');
  }

  // Ligar eventos nas abas
  tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      newBtn.classList.add('active');
      const target = document.getElementById(newBtn.dataset.tab);
      if (target) target.classList.add('active');
      
      if (newBtn.dataset.tab === 'tab3') renderizarRelatorios();
      if (newBtn.dataset.tab === 'tab5') renderizarAcompanhamento();
      if (newBtn.dataset.tab === 'tabAcompInd') popularSelectAcompInd();
      if (newBtn.dataset.tab === 'tab6') renderizarJovensOficina();
      if (newBtn.dataset.tab === 'tabDashboardJovem') renderizarDashboardJovem();
      if (newBtn.dataset.tab === 'tabMensagens') renderizarMensagens();
      if (newBtn.dataset.tab === 'tabUsuarios') { renderizarUsuarios(); renderizarPendentes(); }
    });
  });
}

// ================================================================
// AVISOS OBSERVACÕES GESTOR (7 e 14 dias)
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
      const li = `<li><strong>${j['NOME'] || j['REFERENCIA']}</strong> - Último comparecimento: ${ultimo.toLocaleDateString('pt-BR')}</li>`;
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
// CADASTRO E USUÁRIOS
// ================================================================
async function cadastrarUsuario() {
  const nome = document.getElementById('cadastroNome').value.trim();
  const email = document.getElementById('cadastroEmail').value.trim();
  const senha = document.getElementById('cadastroSenha').value.trim();
  const senha2 = document.getElementById('cadastroSenhaConfirm').value.trim();
  const nivel = document.getElementById('cadastroNivel').value;
  
  if (!nome || !email || !senha) return alert('Preencha todos os campos.');
  if (senha !== senha2) return alert('As senhas não coincidem.');

  try {
    const user = { id: 'usr_' + Date.now(), nome, email, senha, nivel, status: 'pendente', cpf: '' };
    await upstash('SET', `user:${user.id}`, JSON.stringify(user));
    await upstash('SADD', 'users:all', user.id);
    document.getElementById('cadastroSucesso').style.display = 'block';
    document.getElementById('cadastroSucesso').textContent = 'Cadastro enviado! Aguarde aprovação.';
    ['cadastroNome','cadastroEmail','cadastroSenha','cadastroSenhaConfirm'].forEach(id => document.getElementById(id).value = '');
  } catch (err) { document.getElementById('cadastroErro').textContent = 'Erro: ' + err.message; }
}

let userParaVincular = null;
function renderizarPendentes() {
  const tbody = document.getElementById('listaPendentes');
  if (!tbody) return;
  const pendentes = estado.usuarios.filter(u => u.status !== 'ativo');
  tbody.innerHTML = pendentes.map(u => `<tr><td>${u.nome || '-'}</td><td>${u.email || '-'}</td><td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel}</td><td style="color:#ef4444;">${u.status}</td><td><button onclick="aprovarUsuario('${u.id}', '${u.nivel}')" class="btn-acao" style="background:#10b981;">✅ Aprovar</button> <button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-acao btn-danger">🗑️</button></td></tr>`).join('');
}

window.aprovarUsuario = async function(id, nivel) {
  const user = estado.usuarios.find(u => u.id === id);
  if (!user) return;
  if (nivel === 'jovem') {
    userParaVincular = user;
    const select = document.getElementById('selectVincularJovem');
    select.innerHTML = '<option value="">Selecione o Jovem...</option>' + estado.jovens.map(j => `<option value="${j['CPF'] || j.id}">${j['NOME'] || j['REFERENCIA']} (CPF: ${j['CPF'] || 'Não informado'})</option>`).join('');
    document.getElementById('modalVincularJovem').style.display = 'flex';
  } else {
    user.status = 'ativo';
    await upstash('SET', `user:${user.id}`, JSON.stringify(user));
    await carregarTodosDados(); alert('Aprovado com sucesso!');
  }
}

window.salvarVinculoJovem = async function() {
  const cpfOuId = document.getElementById('selectVincularJovem').value;
  if (!cpfOuId) return alert('Selecione um jovem.');
  userParaVincular.cpf = cpfOuId; userParaVincular.status = 'ativo';
  await upstash('SET', `user:${userParaVincular.id}`, JSON.stringify(userParaVincular));
  document.getElementById('modalVincularJovem').style.display = 'none';
  await carregarTodosDados(); alert('Jovem vinculado e aprovado!');
}

function renderizarUsuarios() {
  const tbody = document.getElementById('listaUsuarios');
  if (!tbody) return;
  tbody.innerHTML = estado.usuarios.filter(u => u.status === 'ativo').map(u => `<tr><td>${u.nome || '-'}</td><td>${u.email || '-'}</td><td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel}</td><td style="color:#10b981;">${u.status}</td><td>${['gestor','desenvolvedor'].includes(estado.usuarioAtual.nivel) ? `<button onclick="abrirModalHorarios('${u.id}')" class="btn-acao" style="background:#f59e0b; color:white;">⏱️ Horários</button>` : ''} <button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-acao btn-danger">🗑️</button></td></tr>`).join('');
}

window.abrirModalHorarios = function(id) {
  const u = estado.usuarios.find(x => x.id === id);
  estado.usuarioEdicaoHorario = u;
  document.getElementById('nomeUserHorario').textContent = u.nome;
  const dias = ['segunda','terca','quarta','quinta','sexta'];
  const cfg = u.horarios || {};
  document.getElementById('gridHorarios').innerHTML = `<label><input type="checkbox" id="horariosAtivosGlobais" ${u.horariosConfigurados ? 'checked' : ''} onchange="document.getElementById('diasContainer').style.display = this.checked ? 'block' : 'none'"> Limitar Acesso por Horário</label><div id="diasContainer" style="display:${u.horariosConfigurados ? 'block' : 'none'}; margin-top:10px;">${dias.map(d => `<div style="display:flex; gap:10px; margin-bottom:8px;"><input type="checkbox" id="chk_${d}" ${cfg[d]?.ativo ? 'checked' : ''}><span style="width:70px; text-transform:capitalize;">${d}</span><input type="time" id="ini_${d}" value="${cfg[d]?.inicio || '08:00'}"> até <input type="time" id="fim_${d}" value="${cfg[d]?.fim || '17:00'}"></div>`).join('')}</div>`;
  document.getElementById('modalHorarios').style.display = 'flex';
}
window.salvarHorariosUsuario = async function() {
  const u = estado.usuarioEdicaoHorario;
  u.horariosConfigurados = document.getElementById('horariosAtivosGlobais').checked;
  u.horarios = {};
  ['segunda','terca','quarta','quinta','sexta'].forEach(d => { u.horarios[d] = { ativo: document.getElementById(`chk_${d}`).checked, inicio: document.getElementById(`ini_${d}`).value, fim: document.getElementById(`fim_${d}`).value }; });
  await upstash('SET', `user:${u.id}`, JSON.stringify(u)); document.getElementById('modalHorarios').style.display = 'none'; alert('Horários salvos!');
}

async function salvarNovoUsuario() {
  const nivel = document.getElementById('userNivel').value;
  const user = { id: 'usr_' + Date.now(), nome: document.getElementById('userNome').value.trim(), email: document.getElementById('userEmail').value.trim(), senha: document.getElementById('userSenha').value.trim(), nivel, status: 'ativo' };
  if (!user.nome || !user.email || !user.senha) return alert('Preencha todos os campos.');
  await upstash('SET', `user:${user.id}`, JSON.stringify(user)); await upstash('SADD', 'users:all', user.id); estado.usuarios.push(user); renderizarUsuarios();
}

// ================================================================
// EXCLUSÃO EM 2 PASSOS E SUSPENSÃO
// ================================================================
window.abrirModalExclusao = function(tipo, id, nome) {
  estado.exclusaoPendente = { tipo, id };
  document.getElementById('textoConfirmExclusao').textContent = `Apagar permanentemente: ${nome}?`;
  document.getElementById('modalConfirmExclusao').style.display = 'flex';
}
window.executarExclusao = async function() {
  const { tipo, id } = estado.exclusaoPendente;
  try {
    if (tipo === 'jovem') { await upstash('DEL', `jovem:${id}`); await upstash('SREM', 'jovens:all', id); estado.jovens = estado.jovens.filter(j => j.id !== id); } 
    else if (tipo === 'usuario') { await upstash('DEL', `user:${id}`); await upstash('SREM', 'users:all', id); estado.usuarios = estado.usuarios.filter(u => u.id !== id); } 
    else if (tipo === 'oficina') { await upstash('DEL', `oficina:${id}`); await upstash('SREM', 'oficinas:all', id); estado.oficinas = estado.oficinas.filter(o => o.id !== id); }
    else if (tipo === 'planejamento') { await upstash('DEL', `planejamento:${id}`); await upstash('SREM', 'planejamentos:all', id); estado.planejamentos = estado.planejamentos.filter(p => p.id !== id); }
    else if (tipo === 'profissional') { await upstash('DEL', `profissional:${id}`); await upstash('SREM', 'profissionais:all', id); estado.profissionais = estado.profissionais.filter(p => p.id !== id); }
    document.getElementById('modalConfirmExclusao').style.display = 'none'; atualizarInterfaceCompleta(); alert('✅ Excluído!');
  } catch (err) { alert('Erro: ' + err.message); }
}

window.abrirModalSuspensao = function(id, nome) {
  estado.suspensaoPendente = id; document.getElementById('nomeJovemSuspensao').textContent = nome; document.getElementById('motivoSuspensaoInput').value = ''; document.getElementById('modalSuspensao').style.display = 'flex';
}
window.salvarSuspensao = async function() {
  const motivo = document.getElementById('motivoSuspensaoInput').value.trim();
  if (!motivo) return alert('Motivo obrigatório.');
  const jovem = estado.jovens.find(j => j.id === estado.suspensaoPendente);
  jovem.status = 'suspenso'; jovem.motivoSuspensao = motivo;
  await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); document.getElementById('modalSuspensao').style.display = 'none'; carregarTodosDados();
}

// ================================================================
// CARREGAR DADOS GERAIS
// ================================================================
async function carregarTodosDados() {
  try {
    estado.jovens = []; estado.profissionais = []; estado.oficinas = []; estado.usuarios = []; estado.planejamentos = [];
    const queries = [ { key: 'jovens:all', prefix: 'jovem:', arr: 'jovens' }, { key: 'profissionais:all', prefix: 'profissional:', arr: 'profissionais' }, { key: 'oficinas:all', prefix: 'oficina:', arr: 'oficinas' }, { key: 'users:all', prefix: 'user:', arr: 'usuarios' }, { key: 'planejamentos:all', prefix: 'planejamento:', arr: 'planejamentos' } ];
    for (let q of queries) { const ids = await upstash('SMEMBERS', q.key) || []; for (const id of ids) { const raw = await upstash('GET', `${q.prefix}${id}`); if (raw) estado[q.arr].push(JSON.parse(raw)); } }
    atualizarInterfaceCompleta();
  } catch (err) { console.error('Erro ao carregar:', err); }
}
async function carregarJovemPeloCPF(cpfOuId) {
  try {
    const jovemIds = await upstash('SMEMBERS', 'jovens:all'); estado.jovens = [];
    for (const id of jovemIds) { const raw = await upstash('GET', `jovem:${id}`); if (raw) { const j = JSON.parse(raw); if (j['CPF'] === cpfOuId || j.id === cpfOuId) { estado.jovens = [j]; break; } } }
    renderizarDashboardJovem();
  } catch (err) { console.error('Erro ao carregar jovem:', err); }
}
function atualizarInterfaceCompleta() {
  renderizarCamposFormulario(); carregarLista(); renderizarDashboard(); renderizarProfissionais(); renderizarOficinas(); renderizarUsuarios(); renderizarPendentes(); renderizarRelatorios(); renderizarAcompanhamento(); popularSelectAcompInd(); renderizarPlanejamentos();
}

// ================================================================
// DASHBOARD (GERAL E JOVEM)
// ================================================================
function renderizarDashboard() {
  const cards = document.getElementById('cardsDashboard'); if (!cards) return;
  const total = estado.jovens.length;
  const ativos = estado.jovens.filter(j => j.status !== 'suspenso' && j['MEDIDA'] !== 'Liberação' && parseFloat(calcularSaldo(j)) > 0).length;
  const liberados = estado.jovens.filter(j => j['MEDIDA'] === 'Liberação' || parseFloat(calcularSaldo(j)) <= 0).length;
  const suspensos = estado.jovens.filter(j => j.status === 'suspenso').length;
  cards.innerHTML = `<div class="card"><h4>Total</h4><p>${total}</p></div><div class="card"><h4>Ativos</h4><p style="color:#10b981;">${ativos}</p></div><div class="card"><h4>Suspensos</h4><p style="color:#be185d;">${suspensos}</p></div><div class="card"><h4>Liberados/Concluídos</h4><p style="color:#6b7280;">${liberados}</p></div>`;
  renderizarGraficos();
}

function renderizarDashboardJovem() {
  const cards = document.getElementById('jovemInfoCards'); const freqDiv = document.getElementById('jovemFrequencia'); if (!cards || !freqDiv) return;
  const jovem = estado.jovens[0]; if (!jovem) return;
  if (jovem['MEDIDA'] === 'LA') {
    const acoes = jovem.acoesLA || []; const concluidas = acoes.filter(a => a.realizado).length; const progresso = acoes.length > 0 ? ((concluidas / acoes.length) * 100).toFixed(0) : 0;
    cards.innerHTML = `<div class="card"><h4>Medida</h4><p>Liberdade Assistida</p></div><div class="card"><h4>Ações Concluídas</h4><p style="color:#10b981;">${concluidas}/${acoes.length}</p></div><div class="card"><h4>Progresso</h4><p style="color:#3b82f6;">${progresso}%</p></div>`;
    freqDiv.innerHTML = `<div class="card" style="margin-top:16px;"><h3>📝 Compromissos (LA)</h3><ul style="list-style:none; padding:0; margin-top:15px;">${acoes.map(a => `<li style="padding:10px; background:${a.realizado ? '#d1fae5' : '#fffbeb'}; margin-bottom:8px; border-radius:8px; border-left:4px solid ${a.realizado ? '#10b981' : '#f59e0b'};"><strong>${a.texto}</strong> - ${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</li>`).join('')}</ul></div>`;
  } else {
    const horasTotal = parseNum(jovem['HORAS'] || 0); const hist = jovem.historicoFrequencia || []; const horasFeitas = hist.reduce((s, h) => s + (parseNum(h.horas)), 0); const saldo = Math.max(0, horasTotal - horasFeitas);
    cards.innerHTML = `<div class="card"><h4>Nome</h4><p>${jovem['NOME'] || '-'}</p></div><div class="card"><h4>Horas a Cumprir</h4><p style="color:#2c3e66;">${horasTotal}h</p></div><div class="card"><h4>Horas Cumpridas</h4><p style="color:#10b981;">${horasFeitas.toFixed(1)}h</p></div><div class="card"><h4>Saldo Restante</h4><p style="color:#f59e0b;">${saldo.toFixed(1)}h</p></div>`;
    freqDiv.innerHTML = `<div class="card" style="margin-top:16px;"><h3>📊 Minhas Frequências</h3>${hist.length > 0 ? `<table style="width:100%; margin-top:12px;"><thead><tr><th>Data</th><th>Horas</th><th>Observação</th></tr></thead><tbody>${hist.map(h => `<tr><td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td>${h.horas}h</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:#6b7280;">Nenhum registro encontrado.</p>'}</div>`;
  }
}

function renderizarGraficos() {
  Object.values(estado.graficos).forEach(c => c.destroy()); estado.graficos = {};
  const ativos = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação' && parseFloat(calcularSaldo(j)) > 0 && j.status !== 'suspenso');
  const medidas = {}; ativos.forEach(j => { const m = j['MEDIDA'] || 'Não informada'; medidas[m] = (medidas[m] || 0) + 1; });
  const ctx1 = document.getElementById('graficoMedidas')?.getContext('2d'); if (ctx1) estado.graficos.medidas = new Chart(ctx1, { type: 'bar', data: { labels: Object.keys(medidas), datasets: [{ label: 'Jovens', data: Object.values(medidas), backgroundColor: '#2c3e66' }] }});
}

// ================================================================
// FORMULÁRIO E AÇÕES LA
// ================================================================
function renderizarCamposFormulario() {
  const grid = document.getElementById('camposGrid'); if (!grid || grid.innerHTML !== "") return;
  grid.innerHTML = CAMPOS.map(([key, label, type, options]) => {
    if (type === 'select' && options) return `<div class="campo"><label>${label}</label><select id="campo_${key}" onchange="if(this.id==='campo_MEDIDA') toggleAcoesLA()">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;
    return `<div class="campo"><label>${label}</label><input type="${type}" id="campo_${key}"></div>`;
  }).join('');
  if (!document.getElementById('containerAcoesLA')) { grid.insertAdjacentHTML('afterend', `<div id="containerAcoesLA" style="display:none; background:#f8fafc; padding:15px; border-radius:12px; margin-bottom:15px; border:1px solid #e2e8f0;"><h4 style="color:#1e2a4a; margin-bottom:10px;">📋 Ações de Compromisso (LA)</h4><div style="display:flex; gap:10px;"><input type="text" id="novaAcaoLAInput" placeholder="Descreva a ação a ser cumprida..." style="flex:1; padding:8px;"><button type="button" class="btn btn-secondary" onclick="adicionarAcaoLAForm()">Adicionar</button></div><ul id="listaAcoesLAForm" style="margin-top:10px; padding-left:20px; font-size:0.9rem;"></ul></div>`); }
}
let acoesLATemporarias = [];
window.toggleAcoesLA = function() { document.getElementById('containerAcoesLA').style.display = document.getElementById('campo_MEDIDA')?.value === 'LA' ? 'block' : 'none'; }
window.adicionarAcaoLAForm = function() { const input = document.getElementById('novaAcaoLAInput'); if (input.value.trim() !== '') { acoesLATemporarias.push({ id: Date.now(), texto: input.value.trim(), realizado: false }); input.value = ''; atualizarListaAcoesLAForm(); } }
window.atualizarListaAcoesLAForm = function() { document.getElementById('listaAcoesLAForm').innerHTML = acoesLATemporarias.map(a => `<li>${a.texto} <span style="color:red; cursor:pointer; font-weight:bold;" onclick="removerAcaoLAForm(${a.id})">x</span></li>`).join(''); }
window.removerAcaoLAForm = function(id) { acoesLATemporarias = acoesLATemporarias.filter(a => a.id !== id); atualizarListaAcoesLAForm(); }

async function salvarJovem() {
  const nome = document.getElementById('campo_NOME')?.value.trim(); if (!nome) return alert('Preencha o nome.');
  const jovemExistente = estado.jovens.find(j => (j['NOME'] || '').toUpperCase() === nome.toUpperCase() && j.id !== window._editarId);
  const jovem = { id: window._editarId || (jovemExistente ? jovemExistente.id : 'j_' + Date.now()), status: window._editarId ? estado.jovens.find(j=>j.id===window._editarId)?.status : 'ativo' };
  CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) jovem[key] = el.value.trim(); });
  jovem['ID_DIGITAL'] = document.getElementById('campo_ID_DIGITAL')?.value.trim() || '';
  if (!jovem.historicoFrequencia) jovem.historicoFrequencia = []; if (!jovem.observacoes) jovem.observacoes = []; if (!jovem.documentos) jovem.documentos = [];
  if (jovem['MEDIDA'] === 'LA') jovem.acoesLA = [...acoesLATemporarias];
  try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); if(!window._editarId && !jovemExistente) await upstash('SADD', 'jovens:all', jovem.id); estado.jovens = estado.jovens.filter(j => j.id !== jovem.id); estado.jovens.push(jovem); alert('Jovem salvo!'); limparFormulario(); atualizarInterfaceCompleta(); } catch (err) { alert('Erro: ' + err.message); }
}
function limparFormulario() { CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) el.value = ''; }); if (document.getElementById('campo_ID_DIGITAL')) document.getElementById('campo_ID_DIGITAL').value = ''; acoesLATemporarias = []; atualizarListaAcoesLAForm(); toggleAcoesLA(); window._editarId = null; }
window.editarJovem = function(id) { const j = estado.jovens.find(x => x.id === id); if(!j) return; window._editarId = id; CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) el.value = j[key] || ''; }); document.getElementById('campo_ID_DIGITAL').value = j['ID_DIGITAL'] || ''; acoesLATemporarias = j.acoesLA || []; toggleAcoesLA(); atualizarListaAcoesLAForm(); document.querySelector('#tab1').scrollIntoView({ behavior: 'smooth' }); }

// ================================================================
// LISTA, FILTROS E PONTO
// ================================================================
window.carregarLista = function() {
  const tbody = document.getElementById('listaCorpo'); if (!tbody) return;
  const fNome = (document.getElementById('filtroNome')?.value || '').toLowerCase(); const fMedida = document.getElementById('filtroMedida')?.value; const fStatus = document.getElementById('filtroStatus')?.value; const fSaldo = document.getElementById('filtroSaldo')?.value;
  let lista = estado.jovens.filter(j => {
    if (j.status === 'suspenso') j._statusRender = 'suspenso'; else if (j['MEDIDA'] === 'Liberação') j._statusRender = 'liberado'; else { j._statusRender = parseFloat(calcularSaldo(j)) <= 0 && j['MEDIDA']!=='LA' ? 'concluído' : 'ativo'; }
    if (fNome && !(j['NOME']||'').toLowerCase().includes(fNome) && !(j['ID_DIGITAL']||'').includes(fNome)) return false;
    if (fMedida && j['MEDIDA'] !== fMedida) return false;
    if (fStatus && j._statusRender !== fStatus) return false;
    if (fSaldo === 'critico' && parseFloat(calcularSaldo(j)) <= 0) return false;
    return true;
  });
  tbody.innerHTML = lista.map(j => {
    const hist = j.historicoFrequencia || []; const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';
    let bgStatus = j._statusRender === 'suspenso' ? 'background:#fce7f3; color:#be185d;' : (j._statusRender === 'ativo' ? 'background:#d1fae5; color:#065f46;' : 'background:#e5e7eb; color:#374151;');
    const renderSaldo = j['MEDIDA'] === 'LA' ? `Ações: ${j.acoesLA?.filter(a=>a.realizado).length || 0}/${j.acoesLA?.length || 0}` : `${calcularSaldo(j)}h`;
    const hoje = new Date(); const hojeStr = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime(); let temEntradaAberta = false; let podeRegistrarPonto = j['MEDIDA'] !== 'Liberação' && parseFloat(calcularSaldo(j)) > 0 && j._statusRender !== 'suspenso';
    if (podeRegistrarPonto && j['MEDIDA'] !== 'LA') { for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].tipo === 'entrada') { const eDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime(); if (eDia === hojeStr) { temEntradaAberta = true; break; } } if (hist[i].tipo === 'saida') { const sDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime(); if (sDia === hojeStr) break; } } }
    return `<tr><td>${j['NOME'] || '-'}</td><td>${j['ID_DIGITAL'] || '-'}</td><td>${j['IDADE'] || '-'}</td><td>${j['MEDIDA'] || '-'}</td><td>${renderSaldo}</td><td><span style="font-weight:600; padding:4px 12px; border-radius:20px; ${bgStatus}">${j._statusRender.toUpperCase()}</span></td><td>${ultimo}</td><td>${podeRegistrarPonto && j['MEDIDA'] !== 'LA' ? `<button onclick="registrarPontoNaLinha('${j.id}')" class="btn-acao ${temEntradaAberta ? 'btn-ponto-saida' : 'btn-ponto-entrada'}">${temEntradaAberta ? '🚪 Saída' : '🚪 Entrada'}</button>` : ''}<button onclick="editarJovem('${j.id}')" class="btn-acao btn-edit">✏️</button><button onclick="abrirFichaModal('${j.id}')" class="btn-acao btn-ficha">📋</button>${['gestor','tecnico'].includes(estado.usuarioAtual?.nivel) && j._statusRender !== 'suspenso' ? `<button onclick="abrirModalSuspensao('${j.id}', '${j['NOME']}')" class="btn-acao" style="background:#be185d; color:white;">🔴</button>` : ''}<button onclick="abrirModalExclusao('jovem', '${j.id}', '${j['NOME']}')" class="btn-acao btn-danger">🗑️</button></td></tr>`;
  }).join('');
}
function parseNum(val) { const n = parseFloat(String(val).replace(',', '.')); return isNaN(n) ? 0 : n; }
function calcularSaldo(jovem) { if(jovem['MEDIDA'] === 'LA') return 0; const horasTotal = parseNum(jovem['HORAS']); const horasFeitas = (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0); return Math.max(0, horasTotal - horasFeitas).toFixed(1); }

window.registrarPontoNaLinha = async function(jovemId) {
  const jovem = estado.jovens.find(j => j.id === jovemId); if (!jovem) return; const now = new Date(); jovem.historicoFrequencia = jovem.historicoFrequencia || []; const hist = jovem.historicoFrequencia;
  const hojeStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); let entradaAberta = null;
  for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].tipo === 'entrada') { const eDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime(); if (eDia === hojeStr) { entradaAberta = hist[i]; break; } } if (hist[i].tipo === 'saida') { const sDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime(); if (sDia === hojeStr) break; } }
  if (entradaAberta) { const diffMs = now.getTime() - new Date(entradaAberta.data).getTime(); const hrs = Math.round((diffMs / (1000 * 60 * 60)) * 4) / 4; entradaAberta.horas = parseFloat(hrs.toFixed(2)); entradaAberta.horaSaida = now.toISOString(); hist.push({ data: now.toISOString(), horas: 0, tipo: 'saida', observacao: '', entradaReferencia: new Date(entradaAberta.data).getTime() }); alert(`✅ Saída registrada para ${jovem['NOME']} (${hrs.toFixed(2)}h)`); } else { hist.push({ data: now.toISOString(), horas: 0, tipo: 'entrada', observacao: '' }); alert(`✅ Entrada registrada para ${jovem['NOME']}`); }
  try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); carregarLista(); renderizarDashboard(); } catch (err) { alert('Erro: ' + err.message); }
}

async function registrarPontoDigital() {
  const id = document.getElementById('inputDigital').value.trim(); if (!id) return alert('Digite o código.');
  const jovem = estado.jovens.find(j => j['ID_DIGITAL'] === id); if (!jovem) return alert('Não encontrado.'); if (jovem['MEDIDA'] === 'LA') return alert('Medida LA não registra ponto digital.');
  await registrarPontoNaLinha(jovem.id); document.getElementById('inputDigital').value = '';
}
document.getElementById('btnPontoDigital')?.addEventListener('click', registrarPontoDigital);

// ================================================================
// FICHA INDIVIDUAL E MODAL
// ================================================================
function popularSelectAcompInd() {
  const select = document.getElementById('selectJovemAcomp'); if (!select) return;
  select.innerHTML = '<option value="">Selecione um jovem...</option>' + estado.jovens.sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR')).map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''}</option>`).join('');
}

window.abrirFichaModal = function(id) {
  const jovem = estado.jovens.find(j => j.id === id); if (!jovem) return;
  document.getElementById('fichaTitulo').textContent = `Ficha: ${jovem['NOME']}`;
  
  let acoesLAHTML = '';
  if (jovem['MEDIDA'] === 'LA') {
    const acoes = jovem.acoesLA || []; const profs = estado.usuarios.filter(u => u.nivel === 'tecnico' || u.nivel === 'gestor');
    acoesLAHTML = `<h3 style="margin-top:20px; border-bottom:2px solid #e2e8f0; padding-bottom:5px;">Acompanhamento LA</h3><div style="margin-bottom:15px;"><label style="font-weight:bold;">Técnico Responsável:</label><select onchange="vincularProfissionalLA('${jovem.id}', this.value)" style="padding:5px; border-radius:5px;"><option value="">Não atribuído</option>${profs.map(p => `<option value="${p.id}" ${jovem.profissionalLA === p.id ? 'selected' : ''}>${p.nome}</option>`).join('')}</select></div><ul style="list-style:none; padding:0;">${acoes.map(a => `<li style="padding:10px; background:#f8fafc; border:1px solid #e2e8f0; margin-bottom:5px; display:flex; justify-content:space-between;"><span>${a.texto}</span><button class="btn btn-${a.realizado ? 'success' : 'secondary'}" onclick="toggleAcaoLA('${jovem.id}', ${a.id})" style="padding:4px 8px; font-size:0.8rem;">${a.realizado ? '✅ Feito' : 'Marcar Feito'}</button></li>`).join('')}</ul>`;
  }
  const hist = jovem.historicoFrequencia || []; const ofs = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id)); const docs = jovem.documentos || []; const obs = jovem.observacoes || [];
  
  document.getElementById('fichaConteudo').innerHTML = `
    <div class="grid-campos">${CAMPOS.map(([key, label]) => `<div class="campo-item"><strong>${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}</div>${acoesLAHTML}
    <h3 style="margin-top:20px;">Frequências</h3><p>Total: ${hist.reduce((s, h) => s + parseNum(h.horas), 0).toFixed(1)}h | Saldo: ${calcularSaldo(jovem)}h</p>
    <h3 style="margin-top:20px;">Oficinas (${ofs.length})</h3>${ofs.length > 0 ? ofs.map(o => `<div style="border-bottom:1px solid #ccc; padding:5px 0;">${new Date(o.data).toLocaleDateString()} - ${o.conteudo}</div>`).join('') : '<p>Nenhuma</p>'}
    <h3 style="margin-top:20px;">Documentos</h3>${docs.map((d,i) => `<div>📄 ${d.nome} <button onclick="removerDocumento('${jovem.id}',${i})" class="btn-acao btn-danger">🗑️</button></div>`).join('') || '<p>Nenhum</p>'}
    <h3 style="margin-top:20px;">Observações</h3>${obs.map(o => `<div><strong>${o.profissional}</strong>: ${o.texto}</div>`).join('') || '<p>Nenhuma</p>'}
  `;
  document.getElementById('modalFicha').style.display = 'flex'; window._jovemDocAtual = jovem.id;
}
window.toggleAcaoLA = async function(jovemId, acaoId) { const jovem = estado.jovens.find(j => j.id === jovemId); const acao = jovem.acoesLA.find(a => a.id === acaoId); acao.realizado = !acao.realizado; await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); abrirFichaModal(jovemId); carregarLista(); }
window.vincularProfissionalLA = async function(jovemId, profId) { const jovem = estado.jovens.find(j => j.id === jovemId); jovem.profissionalLA = profId; await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); alert('Vinculado!'); }

function abrirRegistroManual() { document.getElementById('manualJovem').innerHTML = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação' && j['MEDIDA'] !== 'LA').map(j => `<option value="${j.id}">${j['NOME']}</option>`).join(''); document.getElementById('modalRegistroManual').style.display = 'flex'; }
document.getElementById('registroManualBtn')?.addEventListener('click', abrirRegistroManual);
document.getElementById('manualSalvar')?.addEventListener('click', async () => {
  const jovemId = document.getElementById('manualJovem').value; const hrs = parseFloat(document.getElementById('manualHoras').value); const obs = document.getElementById('manualObs').value.trim();
  const j = estado.jovens.find(x => x.id === jovemId); if(!j || !hrs) return; j.historicoFrequencia = j.historicoFrequencia || []; const data = new Date().toISOString(); j.historicoFrequencia.push({ data, horas: hrs, tipo: 'entrada', observacao: obs }); j.historicoFrequencia.push({ data, horas: 0, tipo: 'saida', observacao: '' });
  await upstash('SET', `jovem:${j.id}`, JSON.stringify(j)); document.getElementById('modalRegistroManual').style.display = 'none'; carregarLista(); alert('Salvo!');
});

// ================================================================
// OFICINAS E PLANEJAMENTOS
// ================================================================
async function salvarOficina() {
  const data = document.getElementById('oficinaData').value; const conteudo = document.getElementById('oficinaConteudo').value; const reverte = document.getElementById('oficinaReverte').checked; const isCurso = document.getElementById('oficinaCursoObg')?.checked; const abateHoras = isCurso ? document.getElementById('oficinaGeraHoras')?.checked : true;
  if (!data || !conteudo) return alert('Preencha data e conteúdo.');
  const jovensPresentes = [...document.querySelectorAll('#listaJovensOficina input:checked')].map(cb => cb.value);
  const oficina = { id: 'of_' + Date.now(), data, conteudo, reverte, jovensIds: jovensPresentes, isCurso, abateHoras };
  try {
    await upstash('SET', `oficina:${oficina.id}`, JSON.stringify(oficina)); await upstash('SADD', 'oficinas:all', oficina.id); estado.oficinas.push(oficina);
    if (abateHoras) { for (const jId of jovensPresentes) { const j = estado.jovens.find(x => x.id === jId); if (j && j['MEDIDA'] !== 'LA') { j.historicoFrequencia = j.historicoFrequencia || []; j.historicoFrequencia.push({ data: new Date().toISOString(), horas: 4, tipo: 'entrada', observacao: 'Oficina: ' + conteudo }); await upstash('SET', `jovem:${j.id}`, JSON.stringify(j)); } } }
    alert('Oficina salva!'); carregarTodosDados();
  } catch (err) { alert('Erro: ' + err.message); }
}
function renderizarJovensOficina() {
  const divJovens = document.getElementById('listaJovensOficina'); if(divJovens) divJovens.innerHTML = estado.jovens.filter(j=>j.status !== 'suspenso' && j['MEDIDA']!=='Liberação').map(j => `<label class="jovem-checkbox"><input type="checkbox" value="${j.id}"> <span class="jovem-nome">${j['NOME']}</span></label>`).join('');
}
function renderizarOficinas() {
  renderizarJovensOficina(); const lista = document.getElementById('listaOficinas');
  if(lista) lista.innerHTML = estado.oficinas.map(o => `<div class="oficina-card"><div class="oficina-header"><div><strong>📅 ${new Date(o.data).toLocaleDateString()}</strong> <span class="${o.reverte ? 'badge-reverte' : 'badge-nao-reverte'}">${o.reverte ? 'Benefício' : 'Normal'}</span></div><button class="btn btn-danger btn-acao" onclick="abrirModalExclusao('oficina','${o.id}','${o.conteudo}')">🗑️</button></div><div class="oficina-conteudo">${o.conteudo}</div><div class="oficina-jovens-lista">${o.jovensIds.map(id => `<span class="jovem-tag">${estado.jovens.find(j=>j.id===id)?.['NOME']}</span>`).join('')}</div></div>`).join('');
}
window.abrirRelatorioRevertencia = function() {
  const ofs = estado.oficinas.filter(o => o.reverte); let html = `<html><head><title>Relatório de Revertência</title><style>body{font-family:sans-serif; padding:20px;}</style></head><body><h2>🌱 Relatório de Oficinas com Benefício Social</h2>` + ofs.map(o => `<div style="border-bottom:1px solid #ccc; padding:10px 0;"><strong>${new Date(o.data).toLocaleDateString('pt-BR')} - ${o.conteudo}</strong><br>Participantes: ${o.jovensIds.map(id => estado.jovens.find(j=>j.id===id)?.['NOME']).join(', ') || 'Nenhum'}</div>`).join('') + `</body></html>`; window.open('','_blank').document.write(html);
}
window.salvarPlanejamento = async function() {
  const titulo = document.getElementById('planTitulo').value; const descricao = document.getElementById('planDesc').value; const materiais = document.getElementById('planMats').value; if(!titulo) return;
  const plan = { id: 'plan_'+Date.now(), titulo, descricao, materiais }; await upstash('SET', `planejamento:${plan.id}`, JSON.stringify(plan)); await upstash('SADD', 'planejamentos:all', plan.id); carregarTodosDados();
}
function renderizarPlanejamentos() {
  const div = document.getElementById('listaPlanejamentosHTML'); if(div) div.innerHTML = estado.planejamentos.map(p => `<div style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid #3b82f6; padding:15px; border-radius:8px; margin-bottom:10px;"><h4 style="margin-bottom:5px;">${p.titulo}</h4><p style="color:#6b7280; font-size:0.9rem; margin-bottom:10px;">${p.descricao}</p><p style="font-size:0.85rem;"><strong>Materiais:</strong> ${p.materiais}</p><button class="btn btn-danger" style="margin-top:10px; padding:4px 10px; border:none; border-radius:5px;" onclick="abrirModalExclusao('planejamento', '${p.id}', '${p.titulo}')">Excluir</button></div>`).join('');
}

// ================================================================
// DOCUMENTOS E OBSERVAÇÕES
// ================================================================
window.adicionarDocumento = function() { document.getElementById('modalDocumento').style.display = 'flex'; }
document.getElementById('modalSalvarObs')?.addEventListener('click', async () => {
  const prof = document.getElementById('modalProfissionalNome').value.trim(); const txt = document.getElementById('modalObservacaoTexto').value.trim();
  const j = estado.jovens.find(x => x.id === window._jovemDocAtual); if(!j || !txt) return; j.observacoes = j.observacoes || []; j.observacoes.push({ data: new Date().toISOString(), profissional: prof, texto: txt });
  await upstash('SET', `jovem:${j.id}`, JSON.stringify(j)); document.getElementById('modalObservacao').style.display = 'none'; carregarTodosDados(); alert('Salvo!');
});

// ================================================================
// EXCEL IMPORT / EXPORT (Original)
// ================================================================
document.getElementById('importarExcelBtn')?.addEventListener('click', () => {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv';
  input.onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = await file.arrayBuffer(); const wb = XLSX.read(data); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      for (const row of rows) {
        if (!row['NOME']) continue;
        const j = { id: 'j_' + Date.now() + Math.random(), status: 'ativo' };
        CAMPOS.forEach(([key]) => { j[key] = String(row[key] || '').trim(); });
        await upstash('SET', `jovem:${j.id}`, JSON.stringify(j)); await upstash('SADD', 'jovens:all', j.id);
      }
      alert('Importação concluída!'); carregarTodosDados();
    } catch(err) { alert('Erro na importação: ' + err.message); }
  };
  input.click();
});
document.getElementById('exportarExcelBtn')?.addEventListener('click', () => {
  const data = estado.jovens.map(j => ({ Nome: j['NOME'], Medida: j['MEDIDA'], Saldo: calcularSaldo(j), Status: j.status }));
  const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Jovens'); XLSX.writeFile(wb, 'relatorio.xlsx');
});

// ================================================================
// CONFIGURAÇÕES, SENHA E LOGO
// ================================================================
function carregarLogo() {
  upstash('GET', 'config:logo').then(b64 => { if(b64) { document.getElementById('logoImg').src = b64; if(document.getElementById('logoLogin')) document.getElementById('logoLogin').src = b64; } });
}
window.salvarLogo = async function() {
  const file = document.getElementById('novaLogoInput').files[0]; if (!file) return;
  const reader = new FileReader(); reader.onload = async () => { await upstash('SET', 'config:logo', reader.result); document.getElementById('logoImg').src = reader.result; document.getElementById('modalAlterarLogo').style.display = 'none'; }; reader.readAsDataURL(file);
}
window.salvarNovaSenha = async function() {
  const s1 = document.getElementById('novaSenhaInput').value; const s2 = document.getElementById('confirmarNovaSenhaInput').value;
  if(s1 !== s2) return alert('Senhas não coincidem.'); estado.usuarioAtual.senha = s1; await upstash('SET', `user:${estado.usuarioAtual.id}`, JSON.stringify(estado.usuarioAtual)); document.getElementById('modalAlterarSenha').style.display = 'none'; alert('Senha alterada!');
}

// ================================================================
// PROFISSIONAIS E RELATÓRIOS
// ================================================================
document.getElementById('salvarProfissionalBtn')?.addEventListener('click', async () => {
  const nome = document.getElementById('profNome').value; if(!nome) return; const prof = { id: 'p_'+Date.now(), nome }; await upstash('SET', `profissional:${prof.id}`, JSON.stringify(prof)); await upstash('SADD', 'profissionais:all', prof.id); carregarTodosDados();
});
function renderizarProfissionais() {
  const div = document.getElementById('listaProfissionais'); if(div) div.innerHTML = estado.profissionais.map(p => `<div class="profissional-item"><span>${p.nome}</span> <button class="btn btn-danger" onclick="abrirModalExclusao('profissional', '${p.id}', '${p.nome}')">🗑️</button></div>`).join('');
}
function renderizarRelatorios() {} function renderizarAcompanhamento() {} // Preservadas chamadas
