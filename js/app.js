// Sistema de Controle de Medidas Socioeducativas v11.0
// Backend: Upstash Redis REST API (direto do frontend)
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

const NIVEIS_COM_STATUS = ['desenvolvedor', 'admin', 'gestor', 'tecnico'];

// ================================================================
// ESTADO GLOBAL
// ================================================================
let estado = {
  usuarios: [], 
  jovens: [], 
  profissionais: [], 
  oficinas: [], 
  planejamentos: [],
  mensagens: [],
  online: false, 
  usuarioAtual: null, 
  graficos: {},
  exclusaoPendente: null,
  suspensaoPendente: null,
  usuarioEdicaoHorario: null
};

// ================================================================
// CAMPOS DO FORMULÁRIO (baseados na planilha real)
// ================================================================
const CAMPOS = [
  ['REFERENCIA','REFERÊNCIA','text'],['NOME','NOME','text'],['NOME DO RESPONSÁVEL','RESPONSÁVEL','text'],
  ['REINCIDÊNCIA','REINCIDÊNCIA','text'],
  ['MEDIDA','MEDIDA','select', [['','Selecione...'],['LA','LA - Liberdade Assistida'],['PSC','PSC - Prestação de Serviço'],['Internação','Internação'],['Liberação','Liberação']]],
  ['MESES','MESES','text'],['HORAS','HORAS','number'],['PROTETIVA','PROTETIVA','text'],['NASC.','NASCIMENTO','date'],
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
// UPSTASH REST API
// ================================================================
async function upstash(cmd, ...args) {
  const encodedArgs = args.map(a => encodeURIComponent(String(a)));
  const url = `${UPSTASH_URL}/${cmd}/${encodedArgs.join('/')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`Upstash error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) { lastErr = err; if (i < retries - 1) await new Promise(r => setTimeout(r, 1500)); }
  }
  throw lastErr;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
}

// ================================================================
// LOGIN, HORÁRIOS E SENHA
// ================================================================
let intervaloCronometro = null;
let pollingInterval = null;

function validarHorarioAcesso(user) {
    if (user.nivel === 'desenvolvedor' || user.nivel === 'admin') {
        return true;
    }
    if (!user.horariosConfigurados || !user.horarios) {
        return true;
    }
    const agora = new Date();
    const diasSemana = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
    const diaHoje = diasSemana[agora.getDay()];
    const configDia = user.horarios[diaHoje];
    if (!configDia || !configDia.ativo) {
        return false;
    }
    const horaAtualStr = agora.getHours().toString().padStart(2,'0') + ':' + agora.getMinutes().toString().padStart(2,'0');
    return horaAtualStr >= configDia.inicio && horaAtualStr <= configDia.fim;
}

async function fazerLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value.trim();
  if (!email || !senha) return alert('Preencha e-mail e senha.');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Conectando...';
  document.getElementById('loginErro').textContent = '';

  try {
    await withRetry(() => upstash('PING'));
    
    const adminExists = await upstash('EXISTS', 'user:admin001');
    if (adminExists === 0) {
      const adminData = JSON.stringify({
        id: 'admin001', nome: 'Administrador', email: 'admin@teste.com',
        senha: '123', nivel: 'desenvolvedor', status: 'ativo'
      });
      await upstash('SET', 'user:admin001', adminData);
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
    if (user.status !== 'ativo') { document.getElementById('loginErro').textContent = 'Seu cadastro está pendente de aprovação.'; return; }

    if (!validarHorarioAcesso(user)) {
      document.getElementById('loginErro').textContent = '❌ Acesso bloqueado: Fora do horário de trabalho permitido.';
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

    const btnLogo = document.getElementById('btnAlterarLogo');
    if (btnLogo) {
      btnLogo.style.display = (user.nivel === 'desenvolvedor' || user.nivel === 'admin' || user.nivel === 'gestor') ? '' : 'none';
    }

    const btnMeusHorarios = document.getElementById('btnMeusHorarios');
    if (btnMeusHorarios) {
      const podeVerHorarios = ['desenvolvedor', 'admin', 'gestor'].includes(user.nivel);
      btnMeusHorarios.style.display = podeVerHorarios ? '' : 'none';
    }
    
    mostrarHorarioAtual(user);
    carregarLogo();
    mostrarAbasPorNivel(user.nivel);
    iniciarMonitoramentoHorario(user);
    
    if (user.nivel === 'jovem') {
      carregarJovemPeloCPF(user.cpf);
    } else {
      await carregarTodosDados();
      verificarDescumprimentoAutomatico();
      if (['gestor', 'tecnico', 'desenvolvedor'].includes(user.nivel)) {
        setTimeout(() => exibirAvisoObservacoes(), 1500);
      }
    }
    iniciarPolling();
  } catch (err) {
    document.getElementById('loginErro').textContent = 'Erro de conexão: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function mostrarHorarioAtual(user) {
    const horarioSpan = document.getElementById('horarioAtual');
    if (!horarioSpan) return;
    
    if (user.nivel === 'desenvolvedor' || user.nivel === 'admin') {
        horarioSpan.style.display = 'inline';
        horarioSpan.textContent = '🟢 Acesso irrestrito';
        horarioSpan.style.color = '#10b981';
        horarioSpan.style.background = 'rgba(255,255,255,0.1)';
        horarioSpan.style.padding = '2px 10px';
        horarioSpan.style.borderRadius = '20px';
        return;
    }
    
    if (!user.horariosConfigurados || !user.horarios) {
        horarioSpan.style.display = 'none';
        return;
    }
    
    const agora = new Date();
    const diasSemana = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
    const diaHoje = diasSemana[agora.getDay()];
    const configDia = user.horarios[diaHoje];
    
    if (configDia && configDia.ativo) {
        const horaAtualStr = agora.getHours().toString().padStart(2,'0') + ':' + agora.getMinutes().toString().padStart(2,'0');
        const dentroHorario = horaAtualStr >= configDia.inicio && horaAtualStr <= configDia.fim;
        horarioSpan.style.display = 'inline';
        horarioSpan.textContent = `🕐 ${configDia.inicio} - ${configDia.fim}`;
        horarioSpan.style.color = dentroHorario ? '#10b981' : '#ef4444';
        horarioSpan.style.background = 'rgba(255,255,255,0.1)';
        horarioSpan.style.padding = '2px 10px';
        horarioSpan.style.borderRadius = '20px';
    } else {
        horarioSpan.style.display = 'inline';
        horarioSpan.textContent = '🔴 Sem expediente hoje';
        horarioSpan.style.color = '#ef4444';
        horarioSpan.style.background = 'rgba(255,255,255,0.1)';
        horarioSpan.style.padding = '2px 10px';
        horarioSpan.style.borderRadius = '20px';
    }
}

function atualizarIndicadorHorario(user) {
    const horarioSpan = document.getElementById('horarioAtual');
    if (!horarioSpan || !user) return;
    
    if (user.nivel === 'desenvolvedor' || user.nivel === 'admin') {
        horarioSpan.textContent = '🟢 Acesso irrestrito';
        horarioSpan.style.color = '#10b981';
        return;
    }
    
    if (!user.horariosConfigurados || !user.horarios) {
        horarioSpan.style.display = 'none';
        return;
    }
    
    const agora = new Date();
    const diasSemana = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
    const diaHoje = diasSemana[agora.getDay()];
    const configDia = user.horarios[diaHoje];
    
    if (!configDia || !configDia.ativo) {
        horarioSpan.textContent = '🔴 Sem expediente hoje';
        horarioSpan.style.color = '#ef4444';
        return;
    }
    
    const [horaFim, minFim] = configDia.fim.split(':').map(Number);
    const msFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), horaFim, minFim, 0).getTime();
    const diffMs = msFim - agora.getTime();
    const minutosRestantes = diffMs / 60000;
    
    const horaAtualStr = agora.getHours().toString().padStart(2,'0') + ':' + agora.getMinutes().toString().padStart(2,'0');
    const dentroHorario = horaAtualStr >= configDia.inicio && horaAtualStr <= configDia.fim;
    
    if (dentroHorario && minutosRestantes <= 30 && minutosRestantes > 0) {
        const m = Math.floor(minutosRestantes);
        const s = Math.floor((minutosRestantes - m) * 60);
        horarioSpan.textContent = `⏳ ${m}m ${s}s restantes`;
        horarioSpan.style.color = '#f59e0b';
    } else if (dentroHorario) {
        horarioSpan.textContent = `🕐 ${configDia.inicio} - ${configDia.fim} ✅`;
        horarioSpan.style.color = '#10b981';
    } else {
        horarioSpan.textContent = `🔴 Fora do horário`;
        horarioSpan.style.color = '#ef4444';
    }
}

function iniciarMonitoramentoHorario(user) {
    if (intervaloCronometro) clearInterval(intervaloCronometro);
    
    if (user.nivel === 'desenvolvedor' || user.nivel === 'admin') {
        return;
    }
    
    if (!user.horariosConfigurados) {
        return;
    }

    intervaloCronometro = setInterval(() => {
        const agora = new Date();
        const diasSemana = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
        const diaHoje = diasSemana[agora.getDay()];
        const configDia = user.horarios[diaHoje];
        
        if (!configDia || !configDia.ativo) { 
            deslogarSistema(); 
            return; 
        }

        const [horaFim, minFim] = configDia.fim.split(':').map(Number);
        const msFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), horaFim, minFim, 0).getTime();
        const diffMs = msFim - agora.getTime();
        const minutosRestantes = diffMs / 60000;

        atualizarIndicadorHorario(user);

        if (minutosRestantes <= 0) {
            deslogarSistema();
            return;
        }

        const divCronometro = document.getElementById('cronometroSaida');
        if (!divCronometro) {
            const cronometro = document.createElement('div');
            cronometro.id = 'cronometroSaida';
            cronometro.style.cssText = 'display:none; position:fixed; top:0; left:50%; transform:translateX(-50%); background:#ef4444; color:white; padding:10px 20px; border-radius:0 0 12px 12px; z-index:10000; font-weight:600; box-shadow:0 4px 6px rgba(0,0,0,0.1);';
            cronometro.innerHTML = `⚠️ Seu turno encerra em: <span id="cronometroTempo">30:00</span>`;
            document.body.appendChild(cronometro);
        }
        
        const divCronometroAtual = document.getElementById('cronometroSaida');
        if (minutosRestantes <= 30) {
            divCronometroAtual.style.display = 'block';
            const m = Math.floor(minutosRestantes);
            const s = Math.floor((minutosRestantes - m) * 60);
            document.getElementById('cronometroTempo').textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        } else {
            divCronometroAtual.style.display = 'none';
        }
    }, 1000);
}

function deslogarSistema() {
  estado.usuarioAtual = null;
  localStorage.removeItem('usuarioLogado');
  localStorage.removeItem('nivelUsuario');
  document.querySelector('.app-container').style.display = 'none';
  document.getElementById('telaLogin').style.display = 'flex';
  const cronometro = document.getElementById('cronometroSaida');
  if (cronometro) cronometro.style.display = 'none';
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginSenha').value = '';
  if (intervaloCronometro) clearInterval(intervaloCronometro);
  if (pollingInterval) clearInterval(pollingInterval);
}

function fecharModalSenha() { document.getElementById('modalAlterarSenha').style.display = 'none'; }

async function salvarNovaSenha() {
  const s1 = document.getElementById('novaSenhaInput').value;
  const s2 = document.getElementById('confirmarNovaSenhaInput').value;
  if (!s1 || s1.length < 6) return alert('Senha deve ter no mínimo 6 caracteres.');
  if (s1 !== s2) return alert('As senhas não coincidem.');

  try {
    estado.usuarioAtual.senha = s1;
    await upstash('SET', `user:${estado.usuarioAtual.id}`, JSON.stringify(estado.usuarioAtual));
    alert('Senha alterada com sucesso!');
    fecharModalSenha();
    document.getElementById('novaSenhaInput').value = '';
    document.getElementById('confirmarNovaSenhaInput').value = '';
  } catch (err) { alert('Erro ao alterar senha: ' + err.message); }
}

// ================================================================
// CARREGAR DADOS GERAIS
// ================================================================
async function carregarTodosDados() {
  try {
    estado.jovens = []; estado.profissionais = []; estado.oficinas = []; estado.usuarios = []; estado.planejamentos = []; estado.mensagens = [];
    const queries = [
      { key: 'jovens:all', prefix: 'jovem:', arr: 'jovens' },
      { key: 'profissionais:all', prefix: 'profissional:', arr: 'profissionais' },
      { key: 'oficinas:all', prefix: 'oficina:', arr: 'oficinas' },
      { key: 'users:all', prefix: 'user:', arr: 'usuarios' },
      { key: 'planejamentos:all', prefix: 'planejamento:', arr: 'planejamentos' },
      { key: 'mensagens:all', prefix: 'mensagem:', arr: 'mensagens' }
    ];

    for (let q of queries) {
      const ids = await upstash('SMEMBERS', q.key) || [];
      for (const id of ids) {
        const raw = await upstash('GET', `${q.prefix}${id}`);
        if (raw) {
          const obj = JSON.parse(raw);
          estado[q.arr].push(obj);
        }
      }
    }
    verificarDescumprimentoAutomatico();
    atualizarInterfaceCompleta();
  } catch (err) { console.error('Erro ao carregar dados:', err); }
}

async function carregarJovemPeloCPF(cpfOuId) {
  try {
    const jovemIds = await upstash('SMEMBERS', 'jovens:all');
    estado.jovens = [];
    for (const id of jovemIds) {
      const raw = await upstash('GET', `jovem:${id}`);
      if (raw) {
        const j = JSON.parse(raw);
        if (j['CPF'] === cpfOuId || j.id === cpfOuId) {
          estado.jovens = [j];
          break;
        }
      }
    }
    estado.online = true;
    renderizarDashboardJovem();
  } catch (err) { console.error('Erro ao carregar dados do jovem:', err); }
}

function atualizarInterfaceCompleta() {
  renderizarCamposFormulario();
  carregarLista();
  renderizarDashboard();
  if (typeof renderizarProfissionais === 'function') renderizarProfissionais();
  renderizarOficinas();
  renderizarUsuarios();
  renderizarPendentes();
  renderizarRelatorios();
  renderizarAcompanhamento();
  popularSelectAcompInd();
  renderizarPlanejamentos();
  renderizarMensagens();
  atualizarContadorLista(estado.jovens.length);
}

// ================================================================
// VERIFICAR DESCUMPRIMENTO AUTOMÁTICO
// ================================================================
async function verificarDescumprimentoAutomatico() {
  const agora = new Date();
  let alterado = false;
  
  for (const j of estado.jovens) {
    if (j.status === 'concluído' || j.status === 'suspenso' || j['MEDIDA'] === 'Liberação') continue;
    
    const hist = j.historicoFrequencia || [];
    let diffDias = 999;
    if (hist.length > 0) {
      const ultimo = new Date(Math.max(...hist.map(h => new Date(h.data))));
      diffDias = Math.floor((agora - ultimo) / (1000 * 60 * 60 * 24));
    }
    
    if (diffDias >= 14 && j.status !== 'descumprimento') {
      j.status = 'descumprimento';
      j.dataDescumprimento = new Date().toISOString();
      if (!j.observacoes) j.observacoes = [];
      j.observacoes.push({
        data: new Date().toISOString(),
        profissional: 'Sistema',
        texto: `🔴 Status alterado automaticamente para "Descumprimento" - ${diffDias} dias sem comparecimento.`
      });
      await upstash('SET', `jovem:${j.id}`, JSON.stringify(j));
      alterado = true;
    } else if (diffDias < 14 && j.status === 'descumprimento') {
      j.status = 'ativo';
      j.dataDescumprimento = '';
      await upstash('SET', `jovem:${j.id}`, JSON.stringify(j));
      alterado = true;
    }
  }
  
  if (alterado) {
    await carregarTodosDados();
  }
}

// ================================================================
// ABAS E NÍVEIS
// ================================================================
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

  tabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      newBtn.classList.add('active');
      const target = document.getElementById(newBtn.dataset.tab);
      if (target) target.classList.add('active');
      
      if (newBtn.dataset.tab === 'tab2') {
        carregarLista();
        setTimeout(() => atualizarContadorLista(estado.jovens.length), 100);
      }
      if (newBtn.dataset.tab === 'tab3') renderizarRelatorios();
      if (newBtn.dataset.tab === 'tab5') renderizarAcompanhamento();
      if (newBtn.dataset.tab === 'tabAcompInd') popularSelectAcompInd();
      if (newBtn.dataset.tab === 'tab6') renderizarJovensOficina();
      if (newBtn.dataset.tab === 'tabDashboardJovem') renderizarDashboardJovem();
      if (newBtn.dataset.tab === 'tabMensagens') renderizarMensagens();
      if (newBtn.dataset.tab === 'tabUsuarios') { renderizarUsuarios(); renderizarPendentes(); }
      if (newBtn.dataset.tab === 'tabPlanejamento') renderizarPlanejamentos();
    });
  });
}

// ================================================================
// DASHBOARD
// ================================================================
function renderizarDashboard() {
  const cards = document.getElementById('cardsDashboard');
  if (!cards) return;
  const total = estado.jovens.length;
  const ativos = estado.jovens.filter(j => {
    if (!j['MEDIDA'] || j['MEDIDA'] === 'Liberação' || j.status === 'suspenso' || j.status === 'descumprimento') return false;
    return parseFloat(calcularSaldo(j)) > 0 || j['MEDIDA'] === 'LA';
  }).length;
  const descumprimento = estado.jovens.filter(j => j.status === 'descumprimento').length;
  const suspensos = estado.jovens.filter(j => j.status === 'suspenso').length;
  const liberados = estado.jovens.filter(j => {
    if (j['MEDIDA'] === 'Liberação') return true;
    return parseFloat(calcularSaldo(j)) <= 0 && j['MEDIDA'] !== 'LA';
  }).length;
  
  cards.innerHTML = `
    <div class="card"><h4>Total</h4><p>${total}</p><div class="sub-info">Jovens cadastrados</div></div>
    <div class="card"><h4>Ativos</h4><p style="color:#10b981;">${ativos}</p><div class="sub-info">Em cumprimento</div></div>
    <div class="card"><h4>Descumprimento</h4><p style="color:#ef4444;">${descumprimento}</p><div class="sub-info">14+ dias sem comparecer</div></div>
    <div class="card"><h4>Suspensos</h4><p style="color:#be185d;">${suspensos}</p><div class="sub-info">Atividades pausadas</div></div>
    <div class="card"><h4>Concluídos</h4><p style="color:#6b7280;">${liberados}</p><div class="sub-info">Medida concluída</div></div>
  `;
  renderizarGraficos();
}

function renderizarDashboardJovem() {
  const cards = document.getElementById('jovemInfoCards');
  const freqDiv = document.getElementById('jovemFrequencia');
  if (!cards || !freqDiv) return;
  if (estado.jovens.length === 0) {
    cards.innerHTML = '<p style="color:#6b7280;">Nenhum dado encontrado.</p>'; freqDiv.innerHTML = ''; return;
  }
  
  const jovem = estado.jovens[0];
  
  if (jovem['MEDIDA'] === 'LA') {
    const acoes = jovem.acoesLA || [];
    const concluidas = acoes.filter(a => a.realizado).length;
    const progresso = acoes.length > 0 ? ((concluidas / acoes.length) * 100).toFixed(0) : 0;
    const profissional = estado.usuarios.find(u => u.id === jovem.profissionalLA);

    cards.innerHTML = `
      <div class="card"><h4>Nome</h4><p style="font-size:1.1rem;">${jovem['NOME'] || '-'}</p></div>
      <div class="card"><h4>Medida</h4><p>Liberdade Assistida</p></div>
      <div class="card"><h4>Ações Concluídas</h4><p style="font-size:1.5rem; color:#10b981;">${concluidas}/${acoes.length}</p></div>
      <div class="card"><h4>Progresso</h4><p style="font-size:1.5rem; color:#3b82f6;">${progresso}%</p></div>
      ${profissional ? `<div class="card"><h4>Técnico</h4><p style="font-size:0.9rem;">${profissional.nome}</p></div>` : ''}
    `;

    freqDiv.innerHTML = `
      <div class="card" style="margin-top:16px;">
        <h3>📝 Minhas Ações/Compromissos</h3>
        <ul style="list-style:none; padding:0; margin-top:15px;">
          ${acoes.map(a => `<li style="padding:10px; background:${a.realizado ? '#d1fae5' : '#fffbeb'}; margin-bottom:8px; border-radius:8px; border-left:4px solid ${a.realizado ? '#10b981' : '#f59e0b'}; display:flex; justify-content:space-between; align-items:center;">
            <span><strong>${a.texto}</strong> - <span style="color:${a.realizado ? '#065f46' : '#92400e'}">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span></span>
            <span style="font-size:0.75rem; color:#6b7280;">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
          </li>`).join('')}
        </ul>
      </div>`;
  } else {
    const horasTotal = parseFloat(jovem['HORAS'] || 0);
    const hist = jovem.historicoFrequencia || [];
    const horasFeitas = hist.reduce((s, h) => s + (parseFloat(h.horas) || 0), 0);
    const saldo = Math.max(0, horasTotal - horasFeitas);

    cards.innerHTML = `
      <div class="card"><h4>Nome</h4><p style="font-size:1.1rem;">${jovem['NOME'] || '-'}</p></div>
      <div class="card"><h4>Horas a Cumprir</h4><p style="font-size:1.5rem; color:#2c3e66;">${horasTotal}h</p></div>
      <div class="card"><h4>Horas Cumpridas</h4><p style="font-size:1.5rem; color:#10b981;">${horasFeitas.toFixed(1)}h</p></div>
      <div class="card"><h4>Saldo Restante</h4><p style="font-size:1.5rem; color:#f59e0b;">${saldo.toFixed(1)}h</p></div>
    `;

    freqDiv.innerHTML = `
      <div class="card" style="margin-top:16px;">
        <h3>📊 Minhas Frequências</h3>
        ${hist.length > 0 ? `
          <table style="width:100%; margin-top:12px;">
            <thead><tr><th>Data</th><th>Horas</th><th>Observação</th></tr></thead>
            <tbody>${hist.map(h => `<tr><td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td>${h.horas}h</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody>
          </table>
        ` : '<p style="color:#6b7280;">Nenhum registro de frequência encontrado.</p>'}
      </div>
    `;
  }
}

function renderizarGraficos() {
  Object.values(estado.graficos).forEach(c => c.destroy());
  estado.graficos = {};
  const ativos = estado.jovens.filter(j => {
    if (!j['MEDIDA'] || j['MEDIDA'] === 'Liberação' || j.status === 'suspenso' || j.status === 'descumprimento') return false;
    return parseFloat(calcularSaldo(j)) > 0 || j['MEDIDA'] === 'LA';
  });

  const medidas = {};
  ativos.forEach(j => { const m = j['MEDIDA'] || 'Não informada'; medidas[m] = (medidas[m] || 0) + 1; });
  const ctx1 = document.getElementById('graficoMedidas')?.getContext('2d');
  if (ctx1) estado.graficos.medidas = new Chart(ctx1, { type: 'bar', data: { labels: Object.keys(medidas), datasets: [{ label: 'Jovens', data: Object.values(medidas), backgroundColor: '#2c3e66' }] }});
}

// ================================================================
// FORMULÁRIO DE CADASTRO E AÇÕES LA
// ================================================================
function renderizarCamposFormulario() {
  const grid = document.getElementById('camposGrid');
  if (!grid || grid.innerHTML !== "") return; 
  
  grid.innerHTML = CAMPOS.map(([key, label, type, options]) => {
    if (type === 'select' && options) {
      return `<div class="campo"><label>${label}</label><select id="campo_${key}" onchange="if(this.id==='campo_MEDIDA') toggleAcoesLA()">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;
    }
    return `<div class="campo"><label>${label}</label><input type="${type}" id="campo_${key}"></div>`;
  }).join('');
  
  grid.insertAdjacentHTML('afterend', `
    <div id="containerAcoesLA" style="display:none; background:#f8fafc; padding:15px; border-radius:12px; margin-bottom:15px; border:1px solid #e2e8f0;">
      <h4 style="color:#1e2a4a; margin-bottom:10px;">📋 Ações de Compromisso (LA)</h4>
      <p style="font-size:0.85rem; color:#6b7280; margin-bottom:10px;">Adicione as ações que o jovem se comprometeu a realizar.</p>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <input type="text" id="novaAcaoLAInput" placeholder="Descreva a ação a ser cumprida..." style="flex:1; padding:8px; border:1px solid #d1d9e6; border-radius:8px; min-width:200px;">
        <button type="button" class="btn btn-secondary" onclick="adicionarAcaoLAForm()">➕ Adicionar</button>
      </div>
      <ul id="listaAcoesLAForm" style="margin-top:10px; padding-left:20px; font-size:0.9rem; max-height:200px; overflow-y:auto;"></ul>
    </div>
  `);
}

let acoesLATemporarias = [];

window.toggleAcoesLA = function() {
  const medida = document.getElementById('campo_MEDIDA')?.value;
  document.getElementById('containerAcoesLA').style.display = medida === 'LA' ? 'block' : 'none';
}

window.adicionarAcaoLAForm = function() {
  const input = document.getElementById('novaAcaoLAInput');
  if (input.value.trim() !== '') {
    acoesLATemporarias.push({ 
      id: Date.now(), 
      texto: input.value.trim(), 
      realizado: false,
      data: new Date().toISOString()
    });
    input.value = '';
    atualizarListaAcoesLAForm();
  }
}

window.atualizarListaAcoesLAForm = function() {
  const ul = document.getElementById('listaAcoesLAForm');
  ul.innerHTML = acoesLATemporarias.map(a => `<li style="margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding:4px 0;">
    <span>${a.texto}</span>
    <span style="color:red; cursor:pointer; font-weight:bold; margin-left:10px;" onclick="removerAcaoLAForm(${a.id})">✕</span>
  </li>`).join('');
}

window.removerAcaoLAForm = function(id) {
  acoesLATemporarias = acoesLATemporarias.filter(a => a.id !== id);
  atualizarListaAcoesLAForm();
}

async function salvarJovem() {
  const nome = document.getElementById('campo_NOME')?.value.trim();
  if (!nome) return alert('Preencha pelo menos o nome.');

  const jovemExistente = estado.jovens.find(j => (j['NOME'] || '').toUpperCase() === nome.toUpperCase() && j.id !== window._editarId);
  const jovem = { id: window._editarId || (jovemExistente ? jovemExistente.id : 'j_' + Date.now()), status: window._editarId ? estado.jovens.find(j=>j.id===window._editarId)?.status : 'ativo' };

  CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) jovem[key] = el.value.trim(); });
  jovem['ID_DIGITAL'] = document.getElementById('campo_ID_DIGITAL')?.value.trim() || '';
  
  if (!jovem.historicoFrequencia) jovem.historicoFrequencia = [];
  if (!jovem.observacoes) jovem.observacoes = [];
  if (!jovem.documentos) jovem.documentos = [];
  
  if (jovem['MEDIDA'] === 'LA') {
    jovem.acoesLA = [...acoesLATemporarias];
  }

  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    if (!window._editarId && !jovemExistente) await upstash('SADD', 'jovens:all', jovem.id);
    estado.jovens = estado.jovens.filter(j => j.id !== jovem.id);
    estado.jovens.push(jovem);
    
    atualizarInterfaceCompleta();
    limparFormulario();
    alert('Jovem salvo com sucesso!');
  } catch (err) { alert('Erro ao salvar: ' + err.message); }
}

function limparFormulario() {
  CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) el.value = ''; });
  if (document.getElementById('campo_ID_DIGITAL')) document.getElementById('campo_ID_DIGITAL').value = '';
  acoesLATemporarias = [];
  atualizarListaAcoesLAForm();
  toggleAcoesLA();
  window._editarId = null;
}

// ================================================================
// FUNÇÃO EDITAR JOVEM
// ================================================================
window.editarJovem = function(id) {
    if (!id) {
        alert('ID do jovem não fornecido.');
        return;
    }
    
    const j = estado.jovens.find(x => x.id === id);
    if (!j) {
        alert('Jovem não encontrado.');
        return;
    }
    
    window._editarId = id;
    
    CAMPOS.forEach(([key]) => { 
        const el = document.getElementById(`campo_${key}`); 
        if (el) el.value = j[key] || ''; 
    });
    
    const digitalEl = document.getElementById('campo_ID_DIGITAL');
    if (digitalEl) digitalEl.value = j['ID_DIGITAL'] || '';
    
    acoesLATemporarias = j.acoesLA || [];
    toggleAcoesLA();
    atualizarListaAcoesLAForm();
    
    const tabsContainer = document.getElementById('tabsContainer');
    if (tabsContainer) {
        tabsContainer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        const btnCadastro = tabsContainer.querySelector('.tab-btn[data-tab="tab1"]');
        if (btnCadastro) btnCadastro.classList.add('active');
    }
    
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabCadastro = document.getElementById('tab1');
    if (tabCadastro) {
        tabCadastro.classList.add('active');
        tabCadastro.scrollIntoView({ behavior: 'smooth' });
    }
    
    alert(`✏️ Editando jovem: ${j['NOME'] || 'Sem nome'}`);
};

// ================================================================
// LISTA E FILTROS DE ACOMPANHAMENTO GERAL (CORRIGIDO - BOTÃO DE PONTO)
// ================================================================
function carregarLista() {
    const tbody = document.getElementById('listaCorpo');
    if (!tbody) return;

    const fNome = (document.getElementById('filtroNome')?.value || '').toLowerCase();
    const fMedida = document.getElementById('filtroMedida')?.value;
    const fStatus = document.getElementById('filtroStatus')?.value;
    const fSaldo = document.getElementById('filtroSaldo')?.value;
    const fGenero = document.getElementById('filtroGenero')?.value;
    const fIdade = document.getElementById('filtroIdade')?.value;

    let lista = estado.jovens.filter(j => {
        // Definir Status Renderizado
        if (j.status === 'suspenso') j._statusRender = 'suspenso';
        else if (j.status === 'descumprimento') j._statusRender = 'descumprimento';
        else if (j['MEDIDA'] === 'Liberação') j._statusRender = 'liberado';
        else {
            const saldo = parseFloat(calcularSaldo(j));
            j._statusRender = saldo <= 0 && j['MEDIDA'] !== 'LA' ? 'concluído' : 'ativo';
        }

        // Aplicar Filtros
        if (fNome && !(j['NOME']||'').toLowerCase().includes(fNome) && !(j['ID_DIGITAL']||'').includes(fNome)) return false;
        if (fMedida && j['MEDIDA'] !== fMedida) return false;
        if (fStatus && j._statusRender !== fStatus) return false;
        if (fSaldo === 'critico' && parseFloat(calcularSaldo(j)) <= 0 && j['MEDIDA'] !== 'LA') return false;
        if (fSaldo === 'zerado' && parseFloat(calcularSaldo(j)) > 0 && j['MEDIDA'] !== 'LA') return false;
        if (fGenero && j['GÊNERO'] !== fGenero) return false;
        if (fIdade) {
            const idade = parseInt(j['IDADE']) || 0;
            if (fIdade === '12-15' && (idade < 12 || idade > 15)) return false;
            if (fIdade === '16-18' && (idade < 16 || idade > 18)) return false;
            if (fIdade === '19+' && idade < 19) return false;
        }
        
        return true;
    }).sort((a, b) => (a['NOME'] || '').localeCompare((b['NOME'] || ''), 'pt-BR'));

    atualizarContadorLista(lista.length);

    const podeAlterarStatus = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel);

    tbody.innerHTML = lista.map(j => {
        const hist = j.historicoFrequencia || [];
        const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';
        
        let bgStatus = j._statusRender === 'suspenso' ? 'background:#fce7f3; color:#be185d;' : 
                       j._statusRender === 'descumprimento' ? 'background:#fee2e2; color:#991b1b;' :
                       j._statusRender === 'ativo' ? 'background:#d1fae5; color:#065f46;' : 
                       'background:#e5e7eb; color:#374151;';
        
        const renderSaldo = j['MEDIDA'] === 'LA' ? `Ações: ${j.acoesLA?.filter(a=>a.realizado).length || 0}/${j.acoesLA?.length || 0}` : `${calcularSaldo(j)}h`;

        const hoje = new Date();
        const hojeStr = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
        let temEntradaAberta = false;
        
        // Verifica se pode registrar ponto (ativo, não suspenso, não descumprimento)
        const podeRegistrarPonto = j['MEDIDA'] !== 'Liberação' && 
                                   j._statusRender !== 'suspenso' && 
                                   j._statusRender !== 'descumprimento' && 
                                   j._statusRender !== 'concluído' &&
                                   (parseFloat(calcularSaldo(j)) > 0 || j['MEDIDA'] === 'LA');

        // Verifica se tem entrada aberta hoje (apenas para medidas que não são LA)
        if (podeRegistrarPonto && j['MEDIDA'] !== 'LA') {
            for (let i = hist.length - 1; i >= 0; i--) {
                if (hist[i].tipo === 'entrada') {
                    const eDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime();
                    if (eDia === hojeStr) { temEntradaAberta = true; break; }
                }
                if (hist[i].tipo === 'saida') {
                    const sDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime();
                    if (sDia === hojeStr) break;
                }
            }
        }

        // Botões de Status (Suspender/Reativar)
        let botoesStatus = '';
        if (podeAlterarStatus && j._statusRender !== 'concluído' && j['MEDIDA'] !== 'Liberação') {
            if (j._statusRender === 'suspenso') {
                botoesStatus = `<button onclick="reativarJovem('${j.id}')" class="btn-acao" style="background:#10b981; color:white;">✅ Reativar</button>`;
            } else if (j._statusRender === 'descumprimento') {
                botoesStatus = `
                    <button onclick="reativarJovem('${j.id}')" class="btn-acao" style="background:#10b981; color:white;">✅ Reativar</button>
                    <button onclick="abrirModalSuspensao('${j.id}', '${j['NOME']}')" class="btn-acao" style="background:#be185d; color:white;">🔴 Suspender</button>
                `;
            } else {
                botoesStatus = `<button onclick="abrirModalSuspensao('${j.id}', '${j['NOME']}')" class="btn-acao" style="background:#be185d; color:white;">🔴 Suspender</button>`;
            }
        }

        let motivoStatus = '';
        if (j._statusRender === 'suspenso' && j.motivoSuspensao) {
            motivoStatus = `<span title="${j.motivoSuspensao}" style="cursor:help; font-size:0.75rem; color:#be185d;">${j.motivoSuspensao.substring(0, 20)}${j.motivoSuspensao.length > 20 ? '...' : ''}</span>`;
        } else if (j._statusRender === 'descumprimento') {
            motivoStatus = `<span style="font-size:0.75rem; color:#991b1b;">14+ dias sem comparecer</span>`;
        }

        // Botão de ponto (entrada/saída)
        let botaoPonto = '';
        if (podeRegistrarPonto && j['MEDIDA'] !== 'LA') {
            botaoPonto = `<button onclick="registrarPontoNaLinha('${j.id}')" class="btn-acao ${temEntradaAberta ? 'btn-ponto-saida' : 'btn-ponto-entrada'}">${temEntradaAberta ? '🚪 Saída' : '🚪 Entrada'}</button>`;
        }

        return `<tr>
            <td>${j['NOME'] || j['REFERENCIA'] || '-'}</td>
            <td>${j['ID_DIGITAL'] || '-'}</td>
            <td>${j['IDADE'] || '-'}</td>
            <td>${j['MEDIDA'] || '-'}</td>
            <td>${renderSaldo}</td>
            <td><span style="font-weight:600; padding:4px 12px; border-radius:20px; ${bgStatus}">${j._statusRender.toUpperCase()}</span></td>
            <td>${motivoStatus}</td>
            <td>${ultimo}</td>
            <td>
                ${botaoPonto}
                <button onclick="editarJovem('${j.id}')" class="btn-acao btn-edit">✏️</button>
                <button onclick="abrirFichaModal('${j.id}')" class="btn-acao btn-ficha">📋 Ficha</button>
                ${botoesStatus}
                <button onclick="abrirModalExclusao('jovem', '${j.id}', '${j['NOME']}')" class="btn-acao btn-danger">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

// ================================================================
// CONTADOR DE JOVENS NA LISTA
// ================================================================
function atualizarContadorLista(total) {
    let contadorContainer = document.getElementById('contadorContainer');
    if (!contadorContainer) {
        const tabelaWrapper = document.querySelector('#tab2 .tabela-wrapper');
        if (tabelaWrapper) {
            contadorContainer = document.createElement('div');
            contadorContainer.id = 'contadorContainer';
            tabelaWrapper.appendChild(contadorContainer);
        }
    }
    
    if (contadorContainer) {
        const filtrosAtivos = [];
        const fNome = document.getElementById('filtroNome')?.value?.trim() || '';
        const fMedida = document.getElementById('filtroMedida')?.value || '';
        const fStatus = document.getElementById('filtroStatus')?.value || '';
        const fSaldo = document.getElementById('filtroSaldo')?.value || '';
        const fGenero = document.getElementById('filtroGenero')?.value || '';
        const fIdade = document.getElementById('filtroIdade')?.value || '';
        
        if (fNome) filtrosAtivos.push(`Nome: "${fNome}"`);
        if (fMedida) filtrosAtivos.push(`Medida: ${fMedida}`);
        if (fStatus) filtrosAtivos.push(`Status: ${fStatus}`);
        if (fSaldo === 'critico') filtrosAtivos.push('Saldo: Crítico');
        if (fSaldo === 'zerado') filtrosAtivos.push('Saldo: Zerado');
        if (fGenero) filtrosAtivos.push(`Gênero: ${fGenero}`);
        if (fIdade) filtrosAtivos.push(`Idade: ${fIdade}`);
        
        let textoFiltros = '';
        if (filtrosAtivos.length > 0) {
            textoFiltros = ` <span style="font-weight: 400; color: #6b7280; font-size: 0.85rem;">| Filtros: ${filtrosAtivos.join(', ')}</span>`;
        }
        
        contadorContainer.innerHTML = `
            <div id="contadorListaJovens" style="padding: 10px 15px; font-weight: 600; color: #1e2a4a; background: #f1f5f9; border-radius: 0 0 12px 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                <span>👥 Total de jovens: <strong style="color: #2c3e66; font-size: 1.1rem;">${total}</strong></span>
                <span style="font-size: 0.85rem; color: #6b7280;">
                    ${total === 1 ? '1 jovem exibido' : `${total} jovens exibidos`}
                    ${textoFiltros}
                </span>
            </div>
        `;
    }
}

function parseNum(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function calcularSaldo(jovem) {
  if(jovem['MEDIDA'] === 'LA') return 0;
  const horasTotal = parseNum(jovem['HORAS']);
  const horasFeitas = (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0);
  return Math.max(0, horasTotal - horasFeitas).toFixed(1);
}

// ================================================================
// STATUS - SUSPENSÃO, REATIVAÇÃO E DESCUMPRIMENTO
// ================================================================

window.abrirModalSuspensao = function(jovemId, jovemNome) {
  estado.suspensaoPendente = jovemId;
  document.getElementById('nomeJovemSuspensao').textContent = jovemNome;
  document.getElementById('motivoSuspensaoInput').value = '';
  document.getElementById('modalSuspensao').style.display = 'flex';
}

window.salvarSuspensao = async function() {
  const motivo = document.getElementById('motivoSuspensaoInput').value.trim();
  if (!motivo) return alert('É obrigatório informar o motivo da suspensão.');
  
  const jovem = estado.jovens.find(j => j.id === estado.suspensaoPendente);
  if (!jovem) return;
  
  jovem.status = 'suspenso';
  jovem.motivoSuspensao = motivo;
  jovem.dataSuspensao = new Date().toISOString();
  jovem.suspensoPor = estado.usuarioAtual?.nome || 'Sistema';
  
  if (!jovem.observacoes) jovem.observacoes = [];
  jovem.observacoes.push({
    data: new Date().toISOString(),
    profissional: jovem.suspensoPor,
    texto: `🔴 Jovem suspenso por: ${motivo}`
  });
  
  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    document.getElementById('modalSuspensao').style.display = 'none';
    await carregarTodosDados();
    alert('✅ Jovem suspenso com sucesso!');
  } catch (e) { alert('Erro ao suspender: ' + e.message); }
}

// ================================================================
// REATIVAR JOVEM (CORRIGIDO)
// ================================================================
window.reativarJovem = async function(id) {
  if (!confirm('Tem certeza que deseja reativar este jovem?')) return;
  const jovem = estado.jovens.find(j => j.id === id);
  if (!jovem) {
    alert('Jovem não encontrado.');
    return;
  }
  
  const statusAnterior = jovem.status;
  jovem.status = 'ativo';
  jovem.motivoSuspensao = '';
  jovem.dataSuspensao = '';
  jovem.dataDescumprimento = '';
  
  if (!jovem.observacoes) jovem.observacoes = [];
  jovem.observacoes.push({
    data: new Date().toISOString(),
    profissional: estado.usuarioAtual?.nome || 'Sistema',
    texto: `✅ Jovem reativado (estava em ${statusAnterior === 'suspenso' ? 'suspensão' : 'descumprimento'})`
  });
  
  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    // Recarregar todos os dados para atualizar a lista
    await carregarTodosDados();
    alert('✅ Jovem reativado com sucesso!');
  } catch (err) {
    alert('Erro ao reativar: ' + err.message);
  }
};

// ================================================================
// AVISO OBSERVAÇÕES GESTOR (7 e 14 dias)
// ================================================================
function exibirAvisoObservacoes() {
  const agora = new Date();
  let html7 = '', html14 = '';
  let tem7 = false, tem14 = false;
  
  estado.jovens.forEach(j => {
    if (j.status === 'concluído' || j.status === 'suspenso' || j['MEDIDA'] === 'Liberação') return;
    const hist = j.historicoFrequencia || [];
    let diffDias = 999;
    if (hist.length > 0) {
      const ultimo = new Date(Math.max(...hist.map(h => new Date(h.data))));
      diffDias = Math.floor((agora - ultimo) / (1000 * 60 * 60 * 24));
    }
    
    const li = `<li><strong>${j['NOME']}</strong> - Último: ${hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca'} (${diffDias} dias)</li>`;
    if (diffDias >= 14) { html14 += li; tem14 = true; }
    else if (diffDias >= 7) { html7 += li; tem7 = true; }
  });

  if (tem7 || tem14) {
    document.getElementById('listaAviso7Dias').innerHTML = html7 || '<li style="color:#10b981;">✅ Nenhum jovem ausente nesta faixa.</li>';
    document.getElementById('listaAviso14Dias').innerHTML = html14 || '<li style="color:#10b981;">✅ Nenhum jovem em descumprimento.</li>';
    document.getElementById('modalAvisoGestor').style.display = 'flex';
  }
}

// ================================================================
// OBSERVAÇÕES E ACOMPANHAMENTO INDIVIDUAL
// ================================================================
window.renderizarAcompanhamento = function() {
  const agora = new Date();
  const tabela7 = document.getElementById('tabela7dias');
  const tabela14 = document.getElementById('tabela14dias');
  if (!tabela7 || !tabela14) return;
  
  const semComparecimento = estado.jovens.filter(j => { 
    if (j['MEDIDA'] === 'Liberação' || j.status === 'suspenso') return false; 
    const hist = j.historicoFrequencia || []; 
    if (hist.length === 0) return true; 
    const ultimo = new Date(Math.max(...hist.map(h => new Date(h.data)))); 
    return Math.floor((agora - ultimo) / (1000 * 60 * 60 * 24)) >= 7; 
  });
  
  const sem7 = semComparecimento.filter(j => { 
    const hist = j.historicoFrequencia || []; 
    if (hist.length === 0) return true; 
    return Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) < 14; 
  });
  
  const sem14 = semComparecimento.filter(j => { 
    const hist = j.historicoFrequencia || []; 
    if (hist.length === 0) return true; 
    return Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) >= 14; 
  });
  
  tabela7.innerHTML = sem7.map(j => { 
    const hist = j.historicoFrequencia || []; 
    const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca'; 
    const dias = hist.length > 0 ? Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) : '?'; 
    return `<tr><td>${j['NOME'] || '-'}</td><td>${ultimo}</td><td>${dias}</td><td><button onclick="abrirFichaModal('${j.id}')" class="btn-acao btn-ficha">📋</button></td></tr>`; 
  }).join('') || '<tr><td colspan="4" style="text-align:center; color:#6b7280;">✅ Nenhum jovem com 7+ dias sem comparecer.</td></tr>';
  
  tabela14.innerHTML = sem14.map(j => { 
    const hist = j.historicoFrequencia || []; 
    const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca'; 
    const dias = hist.length > 0 ? Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) : '?'; 
    return `<tr><td>${j['NOME'] || '-'}</td><td>${ultimo}</td><td>${dias}</td><td><button onclick="abrirFichaModal('${j.id}')" class="btn-acao btn-ficha">📋</button></td></tr>`; 
  }).join('') || '<tr><td colspan="4" style="text-align:center; color:#10b981;">✅ Nenhum jovem em descumprimento.</td></tr>';
}

// ================================================================
// FICHA MODAL
// ================================================================
window.abrirFichaModal = function(id) {
    if (!id) { alert('ID do jovem não fornecido.'); return; }
    const jovem = estado.jovens.find(j => j.id === id);
    if (!jovem) { alert('Jovem não encontrado.'); return; }
    
    const modalFicha = document.getElementById('modalFicha');
    if (!modalFicha) { alert('Modal de ficha não encontrado.'); return; }
    
    document.getElementById('fichaTitulo').textContent = `📋 Ficha: ${jovem['NOME'] || 'Sem nome'}`;
    
    let acoesLAHTML = '';
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        const profs = estado.usuarios.filter(u => u.nivel === 'tecnico' || u.nivel === 'gestor');
        const profAtual = estado.usuarios.find(u => u.id === jovem.profissionalLA);
        const podeMarcar = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel);
        
        acoesLAHTML = `
            <h3 style="margin-top:20px; border-bottom:2px solid #e2e8f0; padding-bottom:5px;">⚖️ Acompanhamento LA</h3>
            <div style="margin-bottom:15px;">
                <label style="font-weight:bold;">Profissional Responsável:</label>
                <select onchange="vincularProfissionalLA('${jovem.id}', this.value)" style="padding:5px; border-radius:5px; margin-left:10px; border:1px solid #d1d9e6;">
                    <option value="">Não atribuído</option>
                    ${profs.map(p => `<option value="${p.id}" ${jovem.profissionalLA === p.id ? 'selected' : ''}>${p.nome}</option>`).join('')}
                </select>
                ${profAtual ? `<span style="margin-left:15px; color:#10b981;">✅ Atribuído a: ${profAtual.nome}</span>` : ''}
            </div>
            <ul style="list-style:none; padding:0;">
                ${acoes.map(a => `
                    <li style="padding:10px; background:#f8fafc; border:1px solid #e2e8f0; margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; border-radius:8px;">
                        <span style="${a.realizado ? 'text-decoration:line-through; color:#10b981;' : ''}">${a.texto}</span>
                        <div>
                            <span style="font-size:0.7rem; color:#6b7280; margin-right:10px;">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                            ${podeMarcar ? `<button class="btn btn-${a.realizado ? 'success' : 'secondary'}" onclick="toggleAcaoLA('${jovem.id}', ${a.id})" style="padding:4px 12px; font-size:0.8rem; border:none; border-radius:20px; cursor:pointer; background:${a.realizado ? '#10b981' : '#6c757d'}; color:white;">
                                ${a.realizado ? '✅ Feito' : 'Marcar Feito'}
                            </button>` : `<span style="color:${a.realizado ? '#10b981' : '#92400e'};">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span>`}
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    const hist = jovem.historicoFrequencia || [];
    const totalHoras = hist.reduce((s, h) => s + parseFloat(h.horas || 0), 0);
    const saldo = jovem['MEDIDA'] === 'LA' ? 'N/A' : calcularSaldo(jovem) + 'h';
    
    const frequenciaHTML = hist.length > 0 ? 
        `<ul style="list-style:none; padding:0; margin-top:10px;">
            ${hist.sort((a, b) => new Date(a.data) - new Date(b.data)).map(h => {
                const tipoLabel = h.tipo === 'saida' ? '🚪 Saída' : '🚪 Entrada';
                const horasLabel = h.tipo === 'saida' ? '' : `${parseFloat(h.horas || 0).toFixed(1)}h`;
                return `<li style="padding:6px 0; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
                    <span>${tipoLabel} - ${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</span>
                    <span>${horasLabel} ${h.observacao ? '- ' + h.observacao : ''}</span>
                </li>`;
            }).join('')}
        </ul>` : 
        '<p style="color:#6b7280;">Sem registros de frequência</p>';
    
    document.getElementById('fichaConteudo').innerHTML = `
        <div style="margin-bottom:20px;">
            <h3 style="border-bottom:2px solid #e2e8f0; padding-bottom:8px;">Dados Pessoais</h3>
            <div class="grid-campos" style="display:grid; grid-template-columns:1fr 1fr; gap:8px 20px; margin-top:12px;">
                ${CAMPOS.map(([key, label]) => `<div class="campo-item" style="padding:4px 0; border-bottom:1px solid #e9edf2;"><strong style="font-size:0.78rem; color:#1e2a4a;">${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}
                <div class="campo-item" style="padding:4px 0; border-bottom:1px solid #e9edf2;"><strong style="font-size:0.78rem; color:#1e2a4a;">ID Digital:</strong> ${jovem['ID_DIGITAL'] || '-'}</div>
                ${jovem.motivoSuspensao ? `<div class="campo-item" style="padding:4px 0; border-bottom:1px solid #e9edf2; grid-column:1/-1; background:#fce7f3; padding:8px; border-radius:4px;"><strong style="color:#be185d;">Motivo da Suspensão:</strong> ${jovem.motivoSuspensao}</div>` : ''}
                ${jovem.status === 'descumprimento' ? `<div class="campo-item" style="padding:4px 0; border-bottom:1px solid #e9edf2; grid-column:1/-1; background:#fee2e2; padding:8px; border-radius:4px;"><strong style="color:#991b1b;">⚠️ Status: Descumprimento</strong> - 14+ dias sem comparecer</div>` : ''}
            </div>
        </div>
        ${acoesLAHTML}
        <div class="secao-historico" style="margin-top:20px;">
            <h4 style="border-bottom:2px solid #e2e8f0; padding-bottom:8px;">📊 Frequência (${hist.length} registros) | Total: ${jovem['MEDIDA'] === 'LA' ? 'N/A' : totalHoras.toFixed(1) + 'h'} | Saldo: ${saldo}</h4>
            ${frequenciaHTML}
        </div>
    `;
    
    modalFicha.style.display = 'flex';
}

window.toggleAcaoLA = async function(jovemId, acaoId) {
  const jovem = estado.jovens.find(j => j.id === jovemId);
  const acao = jovem.acoesLA.find(a => a.id === acaoId);
  acao.realizado = !acao.realizado;
  await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
  abrirFichaModal(jovemId);
  carregarLista();
}

window.vincularProfissionalLA = async function(jovemId, profId) {
  const jovem = estado.jovens.find(j => j.id === jovemId);
  jovem.profissionalLA = profId;
  await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
  abrirFichaModal(jovemId);
  alert('Profissional vinculado com sucesso!');
}

function popularSelectAcompInd() {
  const select = document.getElementById('selectJovemAcomp');
  if (!select) return;
  select.innerHTML = '<option value="">Selecione um jovem...</option>' + 
    estado.jovens.sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'))
    .map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''} ${j.status === 'suspenso' ? '🔴' : j.status === 'descumprimento' ? '⚠️' : ''}</option>`).join('');
}

// ================================================================
// PONTO DIGITAL E NA LINHA
// ================================================================
window.registrarPontoNaLinha = async function(jovemId) {
  const jovem = estado.jovens.find(j => j.id === jovemId);
  if (!jovem) return;
  if (jovem.status === 'suspenso') return alert('❌ Jovem está suspenso.');
  if (jovem.status === 'descumprimento') return alert('❌ Jovem está em descumprimento.');
  if (jovem.status === 'concluído') return alert('❌ Jovem já concluiu a medida.');
  
  const now = new Date();
  jovem.historicoFrequencia = jovem.historicoFrequencia || [];
  const hist = jovem.historicoFrequencia;

  const hojeStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let entradaAberta = null;
  
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].tipo === 'entrada') {
      const eDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime();
      if (eDia === hojeStr) { entradaAberta = hist[i]; break; }
    }
    if (hist[i].tipo === 'saida') {
      const sDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime();
      if (sDia === hojeStr) break;
    }
  }

  if (entradaAberta) {
    const diffMs = now.getTime() - new Date(entradaAberta.data).getTime();
    const horasReais = diffMs / (1000 * 60 * 60);
    const horasArredondadas = Math.round(horasReais * 4) / 4;

    entradaAberta.horas = parseFloat(horasArredondadas.toFixed(2));
    entradaAberta.horaSaida = now.toISOString();
    hist.push({ data: now.toISOString(), horas: 0, tipo: 'saida', observacao: '', entradaReferencia: new Date(entradaAberta.data).getTime() });
    alert(`✅ Saída registrada para ${jovem['NOME']} às ${now.toLocaleTimeString('pt-BR')} (${horasArredondadas.toFixed(2)}h)`);
  } else {
    hist.push({ data: now.toISOString(), horas: 0, tipo: 'entrada', observacao: '' });
    alert(`✅ Entrada registrada para ${jovem['NOME']} em ${now.toLocaleString('pt-BR')}`);
  }

  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    await carregarTodosDados();
  } catch (err) { alert('Erro: ' + err.message); }
}

async function registrarPontoDigital() {
  const id = document.getElementById('inputDigital').value.trim();
  if (!id) return alert('Digite o código da digital.');
  const jovem = estado.jovens.find(j => j['ID_DIGITAL'] === id);
  if (!jovem) return alert('Código não encontrado.');
  if (jovem['MEDIDA'] === 'LA') return alert('Medida LA não registra ponto digital por horas.');
  if (jovem.status === 'suspenso') return alert('Jovem está suspenso.');
  if (jovem.status === 'descumprimento') return alert('Jovem está em descumprimento.');
  if (jovem.status === 'concluído') return alert('Jovem já concluiu a medida.');
  
  await registrarPontoNaLinha(jovem.id);
  document.getElementById('inputDigital').value = '';
}

// ================================================================
// REGISTRO MANUAL (CORRIGIDO)
// ================================================================
function abrirRegistroManual() {
  const select = document.getElementById('manualJovem');
  if (!select) return;
  
  // Filtrar jovens ativos (não suspensos, não descumprimento, não concluídos)
  const jovensDisponiveis = estado.jovens.filter(j => 
    j['MEDIDA'] !== 'Liberação' && 
    j.status !== 'suspenso' && 
    j.status !== 'descumprimento' &&
    j.status !== 'concluído'
  );
  
  if (jovensDisponiveis.length === 0) {
    alert('Não há jovens disponíveis para registro manual.');
    select.innerHTML = '<option value="">Nenhum jovem disponível</option>';
  } else {
    select.innerHTML = jovensDisponiveis
      .sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'))
      .map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''}</option>`)
      .join('');
  }
  
  document.getElementById('modalRegistroManual').style.display = 'flex';
  const now = new Date(); 
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('manualDataHora').value = now.toISOString().slice(0, 16);
}

async function salvarRegistroManual() {
  const jovemId = document.getElementById('manualJovem').value;
  const dataEntrada = document.getElementById('manualDataHora').value;
  const horas = parseFloat(document.getElementById('manualHoras').value);
  const obs = document.getElementById('manualObs').value.trim();
  if (!jovemId || !dataEntrada) return alert('Selecione o jovem e a data/hora.');

  const jovem = estado.jovens.find(j => j.id === jovemId);
  if (!jovem) return;
  
  if (jovem.status === 'suspenso') return alert('❌ Jovem está suspenso.');
  if (jovem.status === 'descumprimento') return alert('❌ Jovem está em descumprimento.');
  if (jovem.status === 'concluído') return alert('❌ Jovem já concluiu a medida.');
  
  jovem.historicoFrequencia = jovem.historicoFrequencia || [];
  
  const dataEntradaDate = new Date(dataEntrada);
  jovem.historicoFrequencia.push({ 
    data: dataEntradaDate.toISOString(), 
    horas: horas, 
    tipo: 'entrada', 
    observacao: obs || 'Registro manual'
  });

  if (horas > 0) {
    const dataSaida = new Date(dataEntradaDate.getTime() + horas * 60 * 60 * 1000);
    jovem.historicoFrequencia.push({ 
      data: dataSaida.toISOString(), 
      horas: 0, 
      tipo: 'saida', 
      observacao: '', 
      entradaReferencia: dataEntradaDate.getTime() 
    });
  }

  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    document.getElementById('modalRegistroManual').style.display = 'none';
    await carregarTodosDados();
    alert(`✅ Registro salvo: ${horas}h para ${jovem['NOME']}`);
  } catch (err) { alert('Erro: ' + err.message); }
}

// ================================================================
// IMPORTAR E EXPORTAR EXCEL
// ================================================================
async function importarPlanilha() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xlsx,.xls,.csv';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusDiv = document.getElementById('statusImportacao');
    statusDiv.style.display = 'block';
    statusDiv.style.background = '#fffbeb';
    statusDiv.style.color = '#92400e';
    statusDiv.textContent = '⏳ Processando planilha...';

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { raw: false });

      const colMap = {};
      const headers = Object.keys(rows[0] || {});
      headers.forEach(h => {
        const hNorm = h.toUpperCase().replace(/\s/g, '').replace(/[ÀÁÂÃÄÅ]/g,'A').replace(/[ÈÉÊË]/g,'E').replace(/[ÌÍÎÏ]/g,'I').replace(/[ÒÓÔÕÖ]/g,'O').replace(/[ÙÚÛÜ]/g,'U').replace(/Ç/g,'C');
        for (const [key] of CAMPOS) {
          const kNorm = key.toUpperCase().replace(/\s/g, '').replace(/[ÀÁÂÃÄÅ]/g,'A').replace(/[ÈÉÊË]/g,'E').replace(/[ÌÍÎÏ]/g,'I').replace(/[ÒÓÔÕÖ]/g,'O').replace(/[ÙÚÛÜ]/g,'U').replace(/Ç/g,'C');
          if (hNorm.includes(kNorm) || kNorm.includes(hNorm)) { colMap[key] = h; break; }
        }
        if (hNorm.includes('ID') && hNorm.includes('DIGITAL')) colMap['ID_DIGITAL'] = h;
      });

      let importados = 0; let duplicados = 0;

      for (const row of rows) {
        const nome = row[colMap['NOME']] || row['NOME'];
        if (!nome || nome === 'undefined') continue;

        const cpfPlanilha = String(row[colMap['CPF']] || row['CPF'] || '').replace(/\D/g, '');
        let existe = false;
        if (cpfPlanilha) { existe = estado.jovens.some(j => (j['CPF'] || '').replace(/\D/g, '') === cpfPlanilha); } 
        else { existe = estado.jovens.some(j => (j['NOME'] || '').toUpperCase() === nome.toUpperCase()); }

        if (existe) { duplicados++; continue; }

        const jovemId = 'j_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const jovem = { id: jovemId, status: 'ativo' };
        CAMPOS.forEach(([key]) => {
          const colName = colMap[key];
          if (colName && row[colName] !== undefined) {
            let val = String(row[colName] || '').trim();
            if (key === 'GÊNERO') { if (val.toUpperCase().includes('MASC')) val = 'M'; else if (val.toUpperCase().includes('FEM')) val = 'F'; else val = 'NB'; }
            if (key === 'HORAS' || key === 'MESES') val = parseFloat(val) || 0;
            jovem[key] = val;
          }
        });
        jovem['ID_DIGITAL'] = String(row[colMap['ID_DIGITAL']] || row['ID DIGITAL'] || '').trim();
        jovem.historicoFrequencia = []; jovem.observacoes = []; jovem.documentos = [];
        jovem.acoesLA = [];
        
        await upstash('SET', `jovem:${jovemId}`, JSON.stringify(jovem));
        await upstash('SADD', 'jovens:all', jovemId);
        importados++;
      }

      await carregarTodosDados();
      statusDiv.style.background = '#d1fae5'; statusDiv.style.color = '#065f46';
      statusDiv.textContent = `✅ Importação concluída! ${importados} adicionados (${duplicados} ignorados).`;
    } catch (err) {
      statusDiv.style.background = '#fee2e2'; statusDiv.style.color = '#991b1b';
      statusDiv.textContent = '❌ Erro: ' + err.message;
    }
  };
  input.click();
}

function exportarExcel() {
  const data = estado.jovens.map(j => ({
    Nome: j['NOME'] || j['REFERENCIA'], 
    Digital: j['ID_DIGITAL'], 
    Idade: j['IDADE'], 
    Medida: j['MEDIDA'],
    Saldo: calcularSaldo(j), 
    Status: j.status || 'ativo',
    Motivo: j.motivoSuspensao || '',
    Frequências: (j.historicoFrequencia || []).length,
    'Ações LA': (j.acoesLA || []).filter(a => a.realizado).length + '/' + (j.acoesLA || []).length
  }));
  const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jovens');
  XLSX.writeFile(wb, `relatorio_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ================================================================
// PROFISSIONAIS
// ================================================================

function renderizarProfissionais() {
    const div = document.getElementById('listaProfissionais');
    if (!div) return;
    
    div.innerHTML = estado.profissionais.map(p => `
        <div class="profissional-item" style="background:#f8fafc; border-radius:12px; padding:12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; border-left:4px solid #2c3e66;">
            <div>
                <strong>${p.nome || 'Sem nome'}</strong>
                ${p.funcao ? `<span style="color:#6b7280; margin-left:8px;">${p.funcao}</span>` : ''}
                ${p.registro ? `<span style="font-size:0.75rem; color:#6b7280; margin-left:8px;">Reg: ${p.registro}</span>` : ''}
                ${p.numero ? `<span style="font-size:0.75rem; color:#6b7280; margin-left:8px;">Nº ${p.numero}</span>` : ''}
            </div>
            <div>
                <button onclick="abrirModalExclusao('profissional', '${p.id}', '${p.nome}')" class="btn-acao btn-danger">🗑️</button>
            </div>
        </div>
    `).join('');
    
    if (estado.profissionais.length === 0) {
        div.innerHTML = '<p style="color:#6b7280; text-align:center; padding:20px;">Nenhum profissional cadastrado.</p>';
    }
}

async function salvarProfissional() {
    const nome = document.getElementById('profNome').value.trim();
    if (!nome) {
        alert('Preencha o nome do profissional.');
        return;
    }
    
    const profissional = {
        id: 'prof_' + Date.now(),
        nome: nome,
        funcao: document.getElementById('profFuncao').value.trim(),
        registro: document.getElementById('profRegistro').value.trim(),
        numero: document.getElementById('profNumero').value.trim()
    };
    
    try {
        await upstash('SET', `profissional:${profissional.id}`, JSON.stringify(profissional));
        await upstash('SADD', 'profissionais:all', profissional.id);
        estado.profissionais.push(profissional);
        
        document.getElementById('profNome').value = '';
        document.getElementById('profFuncao').value = '';
        document.getElementById('profRegistro').value = '';
        document.getElementById('profNumero').value = '';
        
        renderizarProfissionais();
        alert('✅ Profissional salvo com sucesso!');
    } catch (err) {
        alert('Erro ao salvar profissional: ' + err.message);
    }
}

// ================================================================
// OFICINAS
// ================================================================
function renderizarJovensOficina() {
  const div = document.getElementById('listaJovensOficina'); if (!div) return;
  const jovens = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação' && j.status !== 'suspenso' && j.status !== 'descumprimento' && j.status !== 'concluído')
    .sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'));
  div.innerHTML = jovens.map(j => `<label class="jovem-checkbox"><input type="checkbox" value="${j.id}"><span class="jovem-nome">${j['NOME'] || j['REFERENCIA']}</span></label>`).join('');
}

async function salvarOficina() {
  const data = document.getElementById('oficinaData').value;
  const periodo = document.getElementById('oficinaPeriodo').value;
  const conteudo = document.getElementById('oficinaConteudo').value.trim();
  const reverte = document.getElementById('oficinaReverte').checked;
  
  const isCurso = document.getElementById('oficinaCursoObg')?.checked;
  const abateHoras = isCurso ? document.getElementById('oficinaGeraHoras')?.checked : true;

  if (!data || !conteudo) return alert('Preencha data e conteúdo.');
  const jovensPresentes = [...document.querySelectorAll('#listaJovensOficina input:checked')].map(cb => cb.value);
  const oficina = { id: 'of_' + Date.now(), data, periodo, conteudo, reverte, jovensIds: jovensPresentes, isCurso, abateHoras };
  
  try { 
    await upstash('SET', `oficina:${oficina.id}`, JSON.stringify(oficina)); 
    await upstash('SADD', 'oficinas:all', oficina.id); 
    estado.oficinas.push(oficina); 
    
    if (abateHoras) {
      for (const jId of jovensPresentes) {
        const j = estado.jovens.find(x => x.id === jId);
        if (j && j['MEDIDA'] !== 'LA' && j.status !== 'concluído') {
          j.historicoFrequencia = j.historicoFrequencia || [];
          j.historicoFrequencia.push({ 
            data: new Date().toISOString(), 
            horas: 4, 
            tipo: 'entrada', 
            observacao: `Oficina: ${conteudo}${isCurso ? ' (Curso Obrigatório)' : ''}` 
          });
          await upstash('SET', `jovem:${j.id}`, JSON.stringify(j));
        }
      }
    }
    
    renderizarOficinas(); 
    document.getElementById('oficinaConteudo').value = ''; 
    document.querySelectorAll('#listaJovensOficina input').forEach(cb => cb.checked = false); 
    alert('✅ Oficina salva!');
    await carregarTodosDados();
  } catch (err) { alert('Erro: ' + err.message); }
}

function renderizarOficinas() {
  renderizarJovensOficina();
  const div = document.getElementById('listaOficinas'); if (!div) return;
  div.innerHTML = estado.oficinas.slice().reverse().map(o => {
    const dataFmt = new Date(o.data).toLocaleDateString('pt-BR');
    const jovensNomes = (o.jovensIds || []).map(id => { const j = estado.jovens.find(x => x.id === id); return j ? (j['NOME'] || j['REFERENCIA']) : 'Desconhecido'; });
    return `<div class="oficina-card" style="background:#f8fafc; border-radius:12px; padding:16px; margin-bottom:12px; border-left:4px solid ${o.reverte ? '#10b981' : '#2c3e66'}; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <div class="oficina-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:8px;">
        <div>
          <strong>📅 ${dataFmt}</strong>
          <span style="margin-left:8px; color:#6b7280;">${o.periodo}</span>
          <span class="${o.reverte ? 'badge-reverte' : 'badge-nao-reverte'}" style="margin-left:8px; padding:2px 10px; border-radius:20px; font-size:0.7rem; font-weight:600; ${o.reverte ? 'background:#10b981; color:white;' : 'background:#6b7280; color:white;'}">${o.reverte ? '✅ Benefício social' : 'Normal'}</span>
          ${o.isCurso ? '<span style="margin-left:8px; background:#f59e0b; color:white; padding:2px 10px; border-radius:20px; font-size:0.7rem; font-weight:600;">📚 Curso Obrigatório</span>' : ''}
        </div>
        <div>
          <span style="font-size:0.85rem; color:#3b82f6;">👥 ${jovensNomes.length} jovens</span>
          <button onclick="abrirModalExclusao('oficina','${o.id}', '${o.conteudo}')" class="btn-action btn-danger" style="margin-left:8px; border:none; padding:4px 10px; border-radius:20px; cursor:pointer; background:#dc3545; color:white;">🗑️</button>
        </div>
      </div>
      <div class="oficina-conteudo" style="margin:8px 0; color:#475569;">${o.conteudo}</div>
      <div class="oficina-jovens-lista" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">${jovensNomes.length > 0 ? jovensNomes.map(n => `<span class="jovem-tag" style="background:#eff6ff; color:#1e40af; padding:3px 10px; border-radius:20px; font-size:0.75rem; font-weight:500; border:1px solid #bfdbfe;">${n}</span>`).join('') : '<span style="color:#9ca3af;">Nenhum jovem presente</span>'}</div>
    </div>`;
  }).join('');
}

// ================================================================
// PLANEJAMENTO DE OFICINAS
// ================================================================
async function salvarPlanejamento() {
  const data = document.getElementById('planData').value;
  const periodo = document.getElementById('planPeriodo').value;
  const titulo = document.getElementById('planTitulo').value.trim();
  const descricao = document.getElementById('planDesc').value.trim();
  const materiais = document.getElementById('planMats').value.trim();
  const reverte = document.getElementById('planReverte').checked;
  
  if(!data || !titulo) return alert('Preencha a data e o título da oficina.');
  
  const plan = { 
    id: 'plan_'+Date.now(), 
    data, 
    periodo, 
    titulo, 
    descricao, 
    materiais, 
    reverte,
    realizada: false,
    dataCriacao: new Date().toISOString()
  };
  
  await upstash('SET', `planejamento:${plan.id}`, JSON.stringify(plan));
  await upstash('SADD', 'planejamentos:all', plan.id);
  estado.planejamentos.push(plan);
  
  document.getElementById('planData').value = '';
  document.getElementById('planTitulo').value = '';
  document.getElementById('planDesc').value = '';
  document.getElementById('planMats').value = '';
  document.getElementById('planReverte').checked = false;
  
  renderizarPlanejamentos();
  alert('✅ Planejamento salvo!');
}

window.converterPlanejamentoEmOficina = function(planId) {
  const plan = estado.planejamentos.find(p => p.id === planId);
  if (!plan) return alert('Planejamento não encontrado.');
  
  document.getElementById('oficinaData').value = plan.data;
  document.getElementById('oficinaPeriodo').value = plan.periodo;
  document.getElementById('oficinaConteudo').value = `${plan.titulo}\n${plan.descricao || ''}`;
  document.getElementById('oficinaReverte').checked = plan.reverte;
  
  const tabsContainer = document.getElementById('tabsContainer');
  if (tabsContainer) {
    tabsContainer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const btnOficinas = tabsContainer.querySelector('.tab-btn[data-tab="tab6"]');
    if (btnOficinas) btnOficinas.classList.add('active');
  }
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const tabOficinas = document.getElementById('tab6');
  if (tabOficinas) {
    tabOficinas.classList.add('active');
    tabOficinas.scrollIntoView({ behavior: 'smooth' });
  }
  
  plan.realizada = true;
  upstash('SET', `planejamento:${plan.id}`, JSON.stringify(plan));
  
  alert('✅ Planejamento convertido! Preencha os jovens presentes e salve a oficina.');
  renderizarPlanejamentos();
}

function renderizarPlanejamentos() {
  const listaHTML = document.getElementById('listaPlanejamentosHTML');
  if (!listaHTML) return;
  
  const podeConverter = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) || estado.usuarioAtual?.nivel === 'oficineiro';
  
  listaHTML.innerHTML = estado.planejamentos.filter(p => !p.realizada).map(p => `
    <div style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${p.reverte ? '#10b981' : '#3b82f6'}; padding:16px; border-radius:10px; box-shadow:0 2px 4px rgba(0,0,0,0.04);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
        <div style="flex:1;">
          <h4 style="color:#1e2a4a; margin-bottom:4px;">${p.titulo}</h4>
          <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.85rem; color:#6b7280; margin-bottom:6px;">
            <span>📅 ${new Date(p.data).toLocaleDateString('pt-BR')}</span>
            <span>🕐 ${p.periodo}</span>
            ${p.reverte ? '<span style="color:#10b981;">✅ Reverte em benefício social</span>' : ''}
          </div>
          ${p.descricao ? `<p style="color:#475569; font-size:0.9rem; margin-bottom:6px;">${p.descricao}</p>` : ''}
          ${p.materiais ? `<p style="font-size:0.8rem; color:#6b7280;"><strong>Materiais:</strong> ${p.materiais}</p>` : ''}
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${podeConverter ? `<button class="btn btn-success" onclick="converterPlanejamentoEmOficina('${p.id}')" style="padding:6px 16px; font-size:0.8rem;">🔄 Converter em Oficina</button>` : ''}
          <button class="btn btn-danger" onclick="abrirModalExclusao('planejamento', '${p.id}', '${p.titulo}')" style="padding:6px 16px; font-size:0.8rem;">🗑️</button>
        </div>
      </div>
    </div>
  `).join('') || '<p style="color:#6b7280; text-align:center; padding:20px;">Nenhum planejamento salvo.</p>';
}

// ================================================================
// RELATÓRIO DE REVERTÊNCIA
// ================================================================
window.abrirRelatorioRevertencia = function() {
  const ofs = estado.oficinas.filter(o => o.reverte);
  let html = `<html><head><title>Relatório de Revertência</title><style>
    body{font-family:'Segoe UI',Arial,sans-serif; padding:30px; background:#f0f4f8;}
    .container{max-width:900px; margin:0 auto; background:white; border-radius:12px; padding:30px; box-shadow:0 4px 20px rgba(0,0,0,0.08);}
    h1{color:#2c3e66; border-bottom:3px solid #10b981; padding-bottom:10px;}
    table{width:100%; border-collapse:collapse; margin-top:15px;}
    th{background:#f1f5f9; color:#1e293b; font-weight:600; padding:10px 12px; text-align:left; border-bottom:2px solid #e2e8f0;}
    td{padding:8px 12px; border-bottom:1px solid #f1f5f9;}
    .badge{display:inline-block; padding:2px 10px; border-radius:12px; font-size:11px; font-weight:600; background:#10b981; color:white;}
    .total{background:#ecfdf5; padding:15px; border-radius:8px; margin-top:20px; border:1px solid #10b981;}
  </style></head><body>
  <div class="container">
    <h1>🌱 Relatório de Oficinas Revertidas em Benefício Social</h1>
    <p style="color:#6b7280; margin:10px 0;">Oficinas que geraram benefício direto à sociedade.</p>
    <p style="color:#6b7280; font-size:0.9rem;">Total: <strong>${ofs.length}</strong> oficinas revertidas</p>`;
  
  if (ofs.length > 0) {
    html += `<table>
      <thead><tr><th>Data</th><th>Período</th><th>Conteúdo</th><th>Participantes</th></tr></thead>
      <tbody>`;
    ofs.forEach(o => {
      const jovens = o.jovensIds.map(id => estado.jovens.find(j=>j.id===id)?.['NOME']).filter(Boolean).join(', ');
      html += `<tr>
        <td>${new Date(o.data).toLocaleDateString('pt-BR')}</td>
        <td>${o.periodo || '-'}</td>
        <td>${o.conteudo}</td>
        <td>${jovens || 'Nenhum'}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    
    const todosJovens = new Set();
    ofs.forEach(o => o.jovensIds.forEach(id => todosJovens.add(id)));
    html += `<div class="total"><strong>📊 Jovens beneficiados:</strong> ${todosJovens.size} jovens únicos</div>`;
  } else {
    html += `<p style="color:#6b7280;">Nenhuma oficina revertida encontrada.</p>`;
  }
  
  html += `<div style="margin-top:20px; text-align:center; color:#94a3b8; font-size:0.8rem;">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
  </div></body></html>`;
  const win = window.open('','_blank');
  if (win) { win.document.write(html); win.document.close(); }
}

// ================================================================
// RELATÓRIOS
// ================================================================
window.renderizarRelatorios = function() {
  const tbody1 = document.querySelector('#tabelaProjecao tbody');
  if (tbody1) {
    const agora = new Date();
    const HORAS_POR_QUINZENA = 8; 
    let saldos = estado.jovens
      .filter(j => j['MEDIDA'] && j['MEDIDA'] !== 'Liberação' && j['MEDIDA'] !== 'LA' && j.status !== 'suspenso' && j.status !== 'descumprimento' && j.status !== 'concluído')
      .map(j => {
        const horasTotal = parseNum(j['HORAS']);
        const horasFeitas = (j.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0);
        return Math.max(0, horasTotal - horasFeitas);
      });
    
    tbody1.innerHTML = '';
    for (let mes = 0; mes < 3; mes++) {
      const dataMes = new Date(agora.getFullYear(), agora.getMonth() + mes, 1);
      const mesNome = dataMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const diasMes = new Date(dataMes.getFullYear(), dataMes.getMonth() + 1, 0).getDate();
      
      const ativosQ1 = saldos.filter(s => s > 0).length;
      const horasQ1 = saldos.reduce((sum, s) => sum + Math.min(s, HORAS_POR_QUINZENA), 0);
      saldos = saldos.map(s => Math.max(0, s - HORAS_POR_QUINZENA));
      const q1Inicio = new Date(dataMes.getFullYear(), dataMes.getMonth(), 1);
      const q1Fim = new Date(dataMes.getFullYear(), dataMes.getMonth(), 15);
      tbody1.innerHTML += `<tr><td>1ª Quin. ${mesNome}</td><td>${q1Inicio.toLocaleDateString('pt-BR')} - ${q1Fim.toLocaleDateString('pt-BR')}</td><td>${ativosQ1}</td><td>${horasQ1}h</td></tr>`;
      
      const ativosQ2 = saldos.filter(s => s > 0).length;
      const horasQ2 = saldos.reduce((sum, s) => sum + Math.min(s, HORAS_POR_QUINZENA), 0);
      saldos = saldos.map(s => Math.max(0, s - HORAS_POR_QUINZENA));
      const q2Inicio = new Date(dataMes.getFullYear(), dataMes.getMonth(), 16);
      const q2Fim = new Date(dataMes.getFullYear(), dataMes.getMonth(), diasMes);
      tbody1.innerHTML += `<tr><td>2ª Quin. ${mesNome}</td><td>${q2Inicio.toLocaleDateString('pt-BR')} - ${q2Fim.toLocaleDateString('pt-BR')}</td><td>${ativosQ2}</td><td>${horasQ2}h</td></tr>`;
    }
  }

  const tbody2 = document.querySelector('#tabelaAniversariantes tbody');
  if (tbody2) {
    const agora = new Date(); const anoAtual = agora.getFullYear(); const mesAtual = agora.getMonth();
    const aniversariantes = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação' && j.status !== 'concluído').map(j => {
      const nascStr = j['NASC.']; if (!nascStr) return null; const nasc = new Date(nascStr); if (isNaN(nasc.getTime())) return null;
      const mesNasc = nasc.getMonth(); const diaNasc = nasc.getDate() + 1;
      let mesTarget = mesNasc; let anoTarget = anoAtual; if (mesNasc < mesAtual || (mesNasc === mesAtual && diaNasc < agora.getDate())) anoTarget = anoAtual + 1;
      const diffMeses = (anoTarget - anoAtual) * 12 + (mesTarget - mesAtual); if (diffMeses < 0 || diffMeses >= 3) return null;
      return { nome: j['NOME'] || j['REFERENCIA'], nasc, mesNasc, diaNasc, anoTarget, mesTarget, idadeQueFara: anoTarget - nasc.getFullYear(), dataEvento: new Date(anoTarget, mesTarget, diaNasc) };
    }).filter(Boolean).sort((a, b) => a.dataEvento - b.dataEvento);
    tbody2.innerHTML = aniversariantes.length > 0 ? aniversariantes.map(a => `<tr><td>${a.nome}</td><td>${a.nasc.toLocaleDateString('pt-BR')}</td><td>${a.diaNasc}/${String(a.mesTarget + 1).padStart(2, '0')}/${a.anoTarget}</td><td>${a.idadeQueFara} anos</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center; color:#6b7280;">Nenhum aniversariante nos próximos 3 meses.</td></tr>';
  }
}

// ================================================================
// USUÁRIOS E APROVAÇÕES
// ================================================================
async function cadastrarUsuario() {
  const nome = document.getElementById('cadastroNome').value.trim();
  const email = document.getElementById('cadastroEmail').value.trim();
  const senha = document.getElementById('cadastroSenha').value.trim();
  const senha2 = document.getElementById('cadastroSenhaConfirm').value.trim();
  const nivel = document.getElementById('cadastroNivel').value;
  
  if (!nome || !email || !senha) return alert('Preencha todos os campos obrigatórios.');
  if (senha !== senha2) return alert('As senhas não coincidem.');
  if (senha.length < 6) return alert('Senha deve ter no mínimo 6 caracteres.');

  try {
    const user = { id: 'usr_' + Date.now(), nome, email, senha, nivel, status: 'pendente', cpf: '' };
    await upstash('SET', `user:${user.id}`, JSON.stringify(user));
    await upstash('SADD', 'users:all', user.id);
    document.getElementById('cadastroSucesso').style.display = 'block';
    document.getElementById('cadastroSucesso').textContent = 'Cadastro enviado! Aguarde aprovação.';
    ['cadastroNome','cadastroEmail','cadastroSenha','cadastroSenhaConfirm'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  } catch (err) { document.getElementById('cadastroErro').textContent = 'Erro: ' + err.message; }
}

let userParaVincular = null;

function renderizarPendentes() {
  const tbody = document.getElementById('listaPendentes');
  if (!tbody) return;
  const pendentes = estado.usuarios.filter(u => u.status !== 'ativo');
  tbody.innerHTML = pendentes.map(u => `
    <tr>
      <td>${u.nome || '-'}</td><td>${u.email || '-'}</td><td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel || '-'}</td>
      <td style="color:#ef4444;">${u.status || 'pendente'}</td>
      <td>
        ${NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) ? `
          <button onclick="aprovarUsuario('${u.id}', '${u.nivel}')" class="btn-acao" style="background:#10b981;">✅ Aprovar</button>
          <button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-acao btn-danger">🗑️ Rejeitar</button>
        ` : '<span style="color:#6b7280;">Aguardando aprovação</span>'}
      </td>
    </tr>
  `).join('');
}

window.aprovarUsuario = async function(id, nivel) {
  const user = estado.usuarios.find(u => u.id === id);
  if (!user) return;

  if (nivel === 'jovem') {
    userParaVincular = user;
    const select = document.getElementById('selectVincularJovem');
    select.innerHTML = '<option value="">Selecione o Jovem...</option>' + 
      estado.jovens.map(j => `<option value="${j['CPF'] || j.id}">${j['NOME'] || j['REFERENCIA']} (CPF: ${j['CPF'] || 'Não informado'})</option>`).join('');
    document.getElementById('modalVincularJovem').style.display = 'flex';
  } else {
    user.status = 'ativo';
    try {
      await upstash('SET', `user:${user.id}`, JSON.stringify(user));
      await carregarTodosDados();
      alert('✅ Usuário aprovado com sucesso!');
    } catch (err) { alert('Erro: ' + err.message); }
  }
}

function fecharModalVincular() {
  document.getElementById('modalVincularJovem').style.display = 'none';
  userParaVincular = null;
}

async function salvarVinculoJovem() {
  const cpfOuId = document.getElementById('selectVincularJovem').value;
  if (!cpfOuId) return alert('Selecione um jovem.');
  
  userParaVincular.cpf = cpfOuId; 
  userParaVincular.status = 'ativo';
  
  try {
    await upstash('SET', `user:${userParaVincular.id}`, JSON.stringify(userParaVincular));
    fecharModalVincular();
    await carregarTodosDados();
    alert('✅ Jovem vinculado e aprovado com sucesso!');
  } catch (err) { alert('Erro: ' + err.message); }
}

// ================================================================
// RENDERIZAR USUÁRIOS (COM BOTÃO DE HORÁRIOS)
// ================================================================
function renderizarUsuarios() {
  const tbody = document.getElementById('listaUsuarios');
  if (!tbody) {
    console.warn('Elemento listaUsuarios não encontrado');
    return;
  }
  
  const usuarioAtual = estado.usuarioAtual;
  if (!usuarioAtual) {
    console.warn('Usuário não logado');
    return;
  }
  
  const podeConfigurarHorarios = ['gestor', 'desenvolvedor', 'admin'].includes(usuarioAtual.nivel);
  
  const usuariosAtivos = estado.usuarios.filter(u => u.status === 'ativo');
  
  if (usuariosAtivos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#6b7280;">Nenhum usuário ativo encontrado.</td></tr>';
    return;
  }
  
  tbody.innerHTML = usuariosAtivos.map(u => {
    const horarioInfo = u.horariosConfigurados ? '✅ Com horário' : '❌ Sem horário';
    const isDesenvolvedor = u.nivel === 'desenvolvedor' || u.nivel === 'admin';
    const isProprioUsuario = u.id === usuarioAtual.id;
    
    let botoesHorarios = '';
    if (podeConfigurarHorarios) {
      if (isProprioUsuario) {
        botoesHorarios = `<button onclick="abrirModalHorarios('${u.id}')" class="btn-acao" style="background:#3b82f6; color:white; font-size:0.7rem;">👤 Meu Horário</button>`;
      } else if (isDesenvolvedor) {
        botoesHorarios = `<span style="font-size:0.65rem; color:#10b981;">🔓 Acesso irrestrito</span>`;
      } else {
        botoesHorarios = `<button onclick="abrirModalHorarios('${u.id}')" class="btn-acao" style="background:#f59e0b; color:white; font-size:0.7rem;">⏱️ Horários</button>`;
      }
    }
    
    const podeExcluir = NIVEIS_COM_STATUS.includes(usuarioAtual.nivel) && !isProprioUsuario && !isDesenvolvedor;
    const botaoExcluir = podeExcluir ? `<button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-acao btn-danger" style="font-size:0.7rem;">🗑️</button>` : '';
    
    return `
    <tr>
      <td>${u.nome || '-'}</td>
      <td>${u.email || '-'}</td>
      <td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel || '-'}</td>
      <td>
        <span style="color:#10b981;">${u.status}</span>
        ${u.horariosConfigurados ? `<span style="font-size:0.65rem; color:#6b7280; margin-left:5px; display:block;">${horarioInfo}</span>` : ''}
      </td>
      <td style="display:flex; gap:4px; flex-wrap:wrap;">
        ${botoesHorarios}
        ${botaoExcluir}
      </td>
    </tr>
  `}).join('');
}

// ================================================================
// HORÁRIOS DE ACESSO - CONFIGURAÇÃO
// ================================================================
window.abrirModalHorarios = function(id) {
  const u = estado.usuarios.find(x => x.id === id);
  if (!u) {
    alert('Usuário não encontrado.');
    return;
  }
  
  estado.usuarioEdicaoHorario = u;
  document.getElementById('nomeUserHorario').textContent = u.nome;
  
  const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];
  const cfg = u.horarios || {};
  
  document.getElementById('gridHorarios').innerHTML = `
    <div style="background:#f0fdf4; padding:10px; border-radius:8px; margin-bottom:12px; border:1px solid #86efac;">
      <strong>👤 Configurando: ${u.nome}</strong>
      <span style="margin-left:10px; font-size:0.8rem; color:#6b7280;">(${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel})</span>
    </div>
    <label style="font-weight:600; display:block; margin-bottom:8px;">
      <input type="checkbox" id="horariosAtivosGlobais" ${u.horariosConfigurados ? 'checked' : ''}> 
      Limitar Acesso por Horário
    </label>
    <div id="diasContainer" style="display:${u.horariosConfigurados ? 'block' : 'none'}; margin-top:10px;">
      ${dias.map(d => `
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px; flex-wrap:wrap; background:#f8fafc; padding:6px 10px; border-radius:6px;">
          <input type="checkbox" id="chk_${d}" ${cfg[d]?.ativo ? 'checked' : ''}>
          <span style="width:70px; text-transform:capitalize; font-weight:500;">${d}</span>
          <input type="time" id="ini_${d}" value="${cfg[d]?.inicio || '08:00'}" style="padding:4px 8px; border:1px solid #d1d9e6; border-radius:4px;">
          <span>até</span>
          <input type="time" id="fim_${d}" value="${cfg[d]?.fim || '17:00'}" style="padding:4px 8px; border:1px solid #d1d9e6; border-radius:4px;">
        </div>
      `).join('')}
    </div>
    <p style="font-size:0.75rem; color:#6b7280; margin-top:8px;">* O usuário só poderá acessar nos dias e horários configurados.</p>
    <p style="font-size:0.75rem; color:#10b981; margin-top:4px;">* Desenvolvedores têm acesso irrestrito independente da configuração.</p>
    ${u.nivel === 'desenvolvedor' || u.nivel === 'admin' ? `<p style="font-size:0.75rem; color:#f59e0b; margin-top:4px;">⚠️ Este usuário é desenvolvedor e tem acesso irrestrito.</p>` : ''}
  `;
  
  document.getElementById('horariosAtivosGlobais').onchange = (e) => {
    document.getElementById('diasContainer').style.display = e.target.checked ? 'block' : 'none';
  };
  
  document.getElementById('modalHorarios').style.display = 'flex';
}

window.salvarHorariosUsuario = async function() {
  const u = estado.usuarioEdicaoHorario;
  if (!u) return;
  
  u.horariosConfigurados = document.getElementById('horariosAtivosGlobais').checked;
  u.horarios = {};
  ['segunda','terca','quarta','quinta','sexta'].forEach(d => {
    u.horarios[d] = {
      ativo: document.getElementById(`chk_${d}`).checked,
      inicio: document.getElementById(`ini_${d}`).value,
      fim: document.getElementById(`fim_${d}`).value
    };
  });
  
  try {
    await upstash('SET', `user:${u.id}`, JSON.stringify(u));
    document.getElementById('modalHorarios').style.display = 'none';
    alert('✅ Horários de acesso salvos com sucesso!');
    await carregarTodosDados();
  } catch (err) {
    alert('Erro ao salvar horários: ' + err.message);
  }
}

async function salvarNovoUsuario() {
  const nivel = document.getElementById('userNivel').value;
  if (nivel === 'desenvolvedor') return alert('Não é possível cadastrar Desenvolvedor.');

  const user = {
    id: 'usr_' + Date.now(),
    nome: document.getElementById('userNome').value.trim(),
    email: document.getElementById('userEmail').value.trim(),
    senha: document.getElementById('userSenha').value.trim(),
    nivel,
    status: 'ativo'
  };
  if (!user.nome || !user.email || !user.senha) return alert('Preencha todos os campos.');
  try {
    await upstash('SET', `user:${user.id}`, JSON.stringify(user));
    await upstash('SADD', 'users:all', user.id);
    estado.usuarios.push(user);
    renderizarUsuarios();
    ['userNome','userEmail','userSenha'].forEach(id => document.getElementById(id).value = '');
  } catch (err) { alert('Erro: ' + err.message); }
}

// ================================================================
// MENSAGENS
// ================================================================
function renderizarMensagens() {
  const div = document.getElementById('listaMensagens');
  if (!div) return;
  
  const destinatario = document.getElementById('msgDestinatario');
  if (destinatario) {
    const usuariosAtivos = estado.usuarios.filter(u => u.status === 'ativo' && u.id !== estado.usuarioAtual?.id);
    const autoridades = usuariosAtivos.filter(u => u.nivel === 'autoridade' || u.nivel === 'gestor');
    destinatario.innerHTML = '<option value="">Selecione um destinatário...</option>' + 
      autoridades.map(u => `<option value="${u.id}">${u.nome} (${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel})</option>`).join('');
  }
  
  const mensagens = estado.mensagens
    .filter(m => m.para === estado.usuarioAtual?.id || m.de === estado.usuarioAtual?.id)
    .sort((a, b) => new Date(b.data) - new Date(a.data));
  
  div.innerHTML = mensagens.length > 0 ? mensagens.map(m => {
    const remetente = estado.usuarios.find(u => u.id === m.de);
    const isParaMim = m.para === estado.usuarioAtual?.id;
    return `
      <div style="background:${isParaMim ? '#eff6ff' : '#f8fafc'}; border-radius:8px; padding:12px; margin-bottom:8px; border-left:4px solid ${isParaMim ? '#3b82f6' : '#6c757d'};">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <strong>${remetente?.nome || 'Sistema'}</strong>
            <span style="font-size:0.7rem; color:#6b7280; margin-left:8px;">${new Date(m.data).toLocaleString('pt-BR')}</span>
          </div>
          <span style="font-size:0.7rem; color:#6b7280;">${isParaMim ? '📩 Recebida' : '📤 Enviada'}</span>
        </div>
        <div style="font-weight:500; margin-top:4px;">${m.assunto}</div>
        <div style="color:#475569; margin-top:4px;">${m.texto}</div>
        ${m.anexos ? `<div style="font-size:0.7rem; color:#6b7280; margin-top:4px;">📎 ${m.anexos.length} anexo(s)</div>` : ''}
      </div>
    `;
  }).join('') : '<p style="color:#6b7280; text-align:center; padding:20px;">Nenhuma mensagem encontrada.</p>';
}

async function enviarMensagem() {
  const para = document.getElementById('msgDestinatario').value;
  const assunto = document.getElementById('msgAssunto').value.trim();
  const texto = document.getElementById('msgTexto').value.trim();
  const anexos = document.getElementById('msgAnexos');
  
  if (!para) return alert('Selecione um destinatário.');
  if (!assunto) return alert('Digite um assunto.');
  if (!texto) return alert('Digite a mensagem.');
  
  const msg = {
    id: 'msg_' + Date.now(),
    de: estado.usuarioAtual.id,
    para: para,
    assunto: assunto,
    texto: texto,
    data: new Date().toISOString(),
    lida: false
  };
  
  try {
    await upstash('SET', `mensagem:${msg.id}`, JSON.stringify(msg));
    await upstash('SADD', 'mensagens:all', msg.id);
    estado.mensagens.push(msg);
    
    document.getElementById('msgAssunto').value = '';
    document.getElementById('msgTexto').value = '';
    if (anexos) anexos.value = '';
    
    renderizarMensagens();
    alert('✅ Mensagem enviada com sucesso!');
  } catch (err) {
    alert('Erro ao enviar mensagem: ' + err.message);
  }
}

// ================================================================
// EXCLUSÃO EM 2 PASSOS
// ================================================================
window.abrirModalExclusao = function(tipo, id, nome) {
  estado.exclusaoPendente = { tipo, id };
  document.getElementById('textoConfirmExclusao').textContent = `Você está prestes a apagar permanentemente os registros de: ${nome}`;
  document.getElementById('modalConfirmExclusao').style.display = 'flex';
}

window.executarExclusao = async function() {
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
    } else if (tipo === 'planejamento') {
      await upstash('DEL', `planejamento:${id}`); await upstash('SREM', 'planejamentos:all', id);
      estado.planejamentos = estado.planejamentos.filter(p => p.id !== id);
    } else if (tipo === 'profissional') {
      await upstash('DEL', `profissional:${id}`); await upstash('SREM', 'profissionais:all', id);
      estado.profissionais = estado.profissionais.filter(p => p.id !== id);
    }
    document.getElementById('modalConfirmExclusao').style.display = 'none';
    await carregarTodosDados();
    alert('✅ Registro excluído com sucesso!');
  } catch (err) { alert('Erro ao excluir: ' + err.message); }
}

// ================================================================
// LOGO PERSONALIZADO
// ================================================================
async function carregarLogo() {
  try {
    const logoBase64 = await upstash('GET', 'config:logo');
    if (logoBase64) {
      document.getElementById('logoImg').src = logoBase64;
      const logoLogin = document.getElementById('logoLogin');
      if (logoLogin) { logoLogin.src = logoBase64; logoLogin.style.display = 'block'; }
    }
  } catch (e) { console.error('Erro ao carregar logo', e); }
}
function fecharModalLogo() { document.getElementById('modalAlterarLogo').style.display = 'none'; }
async function salvarLogo() {
  const fileInput = document.getElementById('novaLogoInput');
  if (!fileInput.files[0]) return alert('Selecione uma imagem.');
  try {
    const base64 = await fileToBase64(fileInput.files[0]);
    await upstash('SET', 'config:logo', base64);
    document.getElementById('logoImg').src = base64;
    alert('Logo atualizado com sucesso!');
    fecharModalLogo();
  } catch (err) { alert('Erro ao salvar logo: ' + err.message); }
}

// ================================================================
// EVENT LISTENERS E INICIALIZAÇÃO
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnMeusHorarios')?.addEventListener('click', function() {
    if (estado.usuarioAtual) {
      abrirModalHorarios(estado.usuarioAtual.id);
    }
  });

  document.getElementById('loginBtn')?.addEventListener('click', fazerLogin);
  document.getElementById('loginSenha')?.addEventListener('keypress', e => { if (e.key === 'Enter') fazerLogin(); });
  
  document.getElementById('logoutBtn')?.addEventListener('click', deslogarSistema);

  const cadastroLink = document.getElementById('mostrarCadastroBtn');
  if (cadastroLink) {
    cadastroLink.addEventListener('click', (e) => {
      e.preventDefault(); document.getElementById('telaLogin').style.display = 'none'; document.getElementById('telaCadastro').style.display = 'block';
    });
  }
  
  document.getElementById('voltarLoginBtn')?.addEventListener('click', () => {
    document.getElementById('telaCadastro').style.display = 'none'; document.getElementById('telaLogin').style.display = 'block';
  });
  
  document.getElementById('cadastrarBtn')?.addEventListener('click', cadastrarUsuario);

  document.getElementById('salvarBtn')?.addEventListener('click', salvarJovem);
  document.getElementById('importarExcelBtn')?.addEventListener('click', importarPlanilha);
  document.getElementById('limparFormBtn')?.addEventListener('click', limparFormulario);

  document.getElementById('btnPontoDigital')?.addEventListener('click', registrarPontoDigital);
  document.getElementById('exportarExcelBtn')?.addEventListener('click', exportarExcel);
  document.getElementById('registroManualBtn')?.addEventListener('click', abrirRegistroManual);
  document.getElementById('manualSalvar')?.addEventListener('click', salvarRegistroManual);

  document.getElementById('salvarOficinaBtn')?.addEventListener('click', salvarOficina);
  
  document.getElementById('btnAlterarLogo')?.addEventListener('click', function() { document.getElementById('modalAlterarLogo').style.display = 'flex'; });
  document.getElementById('btnAlterarSenha')?.addEventListener('click', function() { document.getElementById('modalAlterarSenha').style.display = 'flex'; });
  
  document.getElementById('salvarProfissionalBtn')?.addEventListener('click', salvarProfissional);
  document.getElementById('userSalvarBtn')?.addEventListener('click', salvarNovoUsuario);

  document.querySelectorAll('#filtrosFrequencia select, #filtrosFrequencia input').forEach(el => {
    el?.addEventListener('change', carregarLista);
    el?.addEventListener('input', carregarLista);
  });

  document.getElementById('buscaFrequencia')?.addEventListener('input', function() {
    const filtroNome = document.getElementById('filtroNome');
    if (filtroNome) {
      filtroNome.value = this.value;
      carregarLista();
    }
  });

  verificarLoginLocal();
  renderizarCamposFormulario();
});

function verificarLoginLocal() {
  const emailLogado = localStorage.getItem('usuarioLogado');
  if (emailLogado) {
    document.getElementById('loginEmail').value = emailLogado;
  }
}

// ================================================================
// FUNÇÕES DE IMPRESSÃO, DOCUMENTOS E OBSERVAÇÕES
// ================================================================
window.carregarFichaIndividual = function() {
  const id = document.getElementById('selectJovemAcomp').value;
  const container = document.getElementById('fichaIndividual');
  const btnPrint = document.getElementById('btnImprimirFicha');
  
  if (!id) { container.style.display = 'none'; if(btnPrint) btnPrint.style.display = 'none'; return; }
  const jovem = estado.jovens.find(j => j.id === id); if (!jovem) return;
  
  container.style.display = 'block'; if(btnPrint) btnPrint.style.display = 'inline-block';
  
  let acoesLAHTML = '';
  if (jovem['MEDIDA'] === 'LA') {
    const acoes = jovem.acoesLA || []; const profs = estado.usuarios.filter(u => u.nivel === 'tecnico' || u.nivel === 'gestor');
    acoesLAHTML = `<h3 style="margin-top:20px; border-bottom:2px solid #e2e8f0; padding-bottom:5px;">Acompanhamento LA</h3><div style="margin-bottom:15px;"><label style="font-weight:bold;">Técnico Responsável:</label><select onchange="vincularProfissionalLA('${jovem.id}', this.value)" style="padding:5px; border-radius:5px;"><option value="">Não atribuído</option>${profs.map(p => `<option value="${p.id}" ${jovem.profissionalLA === p.id ? 'selected' : ''}>${p.nome}</option>`).join('')}</select></div><ul style="list-style:none; padding:0;">${acoes.map(a => `<li style="padding:10px; background:#f8fafc; border:1px solid #e2e8f0; margin-bottom:5px; display:flex; justify-content:space-between;"><span>${a.texto}</span><button class="btn btn-${a.realizado ? 'success' : 'secondary'}" onclick="toggleAcaoLATab('${jovem.id}', ${a.id})" style="padding:4px 8px; font-size:0.8rem;">${a.realizado ? '✅ Feito' : 'Marcar Feito'}</button></li>`).join('')}</ul>`;
  }

  const dadosDiv = document.getElementById('fichaDadosPessoais'); if (dadosDiv) dadosDiv.innerHTML = `<div class="ficha-grid">${CAMPOS.map(([key, label]) => `<div class="ficha-campo"><strong>${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}<div class="ficha-campo"><strong>ID Digital:</strong> ${jovem['ID_DIGITAL'] || '-'}</div></div>${acoesLAHTML}`;
  
  const freqDiv = document.getElementById('fichaFrequencia'); if (freqDiv) { const hist = jovem.historicoFrequencia || []; const totalHoras = hist.reduce((s, h) => s + parseNum(h.horas), 0); freqDiv.innerHTML = `<p><strong>Total de frequências:</strong> ${hist.length} registros</p><p><strong>Total de horas:</strong> ${totalHoras.toFixed(1)}h</p><p><strong>Saldo restante:</strong> ${calcularSaldo(jovem)}h</p>${hist.length > 0 ? `<table style="margin-top:12px; width:100%;"><thead><tr><th>Tipo</th><th>Data/Hora</th><th>Horas</th><th>Observação</th></tr></thead><tbody>${hist.map(h => `<tr><td>${h.tipo === 'saida' ? '🚪 Saída' : '🚪 Entrada'}</td><td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</td><td>${h.tipo === 'saida' ? '-' : (parseNum(h.horas) || 0) + 'h'}</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:#6b7280;">Nenhum registro de frequência.</p>'}`; }
  
  const ofDiv = document.getElementById('fichaOficinas'); if (ofDiv) { const oficinasParticipadas = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id)); ofDiv.innerHTML = oficinasParticipadas.length > 0 ? `<table style="margin-top:12px; width:100%;"><thead><tr><th>Data</th><th>Conteúdo</th><th>Benefício Social</th></tr></thead><tbody>${oficinasParticipadas.map(o => `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.conteudo}</td><td>${o.reverte ? '✅ Sim' : 'Não'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:#6b7280;">Nenhuma oficina registrada.</p>'; }
  
  const docDiv = document.getElementById('fichaDocumentos'); if (docDiv) { const docs = jovem.documentos || []; docDiv.innerHTML = docs.length > 0 ? docs.map((d, i) => `<div class="doc-item"><span>📄 ${d.nome} (${d.tipo})</span><div>${d.base64 ? `<a href="${d.base64}" download="${d.nome}" class="btn-acao btn-edit" style="text-decoration:none;">📥 Baixar</a>` : ''}<button onclick="removerDocumento('${id}', ${i})" class="btn-acao btn-danger">🗑️</button></div></div>`).join('') : '<p style="color:#6b7280;">Nenhum documento anexado.</p>'; }
  
  const obsDiv = document.getElementById('fichaObservacoes'); if (obsDiv) { const obs = jovem.observacoes || []; obsDiv.innerHTML = obs.length > 0 ? obs.map(o => `<div class="obs-item"><strong>${o.profissional || 'Sistema'}</strong> - <small>${new Date(o.data).toLocaleDateString('pt-BR')} ${new Date(o.data).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</small><p>${o.texto}</p></div>`).join('') : '<p style="color:#6b7280;">Nenhuma observação registrada.</p>'; }
  
  window._jovemDocAtual = jovem.id;
}

window.toggleAcaoLATab = async function(jovemId, acaoId) {
  const jovem = estado.jovens.find(j => j.id === jovemId); const acao = jovem.acoesLA.find(a => a.id === acaoId); acao.realizado = !acao.realizado;
  await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); carregarFichaIndividual(); carregarLista();
}

window.salvarObsAcomp = async function() {
  const jovemId = document.getElementById('selectJovemAcomp').value; const texto = document.getElementById('obsAcompTexto').value.trim();
  if (!texto) return alert('Digite a observação.'); const jovem = estado.jovens.find(j => j.id === jovemId); if (!jovem) return;
  jovem.observacoes = jovem.observacoes || []; jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto });
  try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); document.getElementById('obsAcompTexto').value = ''; carregarFichaIndividual(); alert('Observação salva!'); } catch (err) { alert('Erro: ' + err.message); }
}

window.imprimirFichaIndividual = function() {
    const id = document.getElementById('selectJovemAcomp').value;
    if (!id) { alert('Selecione um jovem primeiro.'); return; }
    const jovem = estado.jovens.find(j => j.id === id);
    if (!jovem) { alert('Jovem não encontrado.'); return; }
    
    const win = window.open('', '_blank');
    if (!win) { alert('Por favor, permita pop-ups para imprimir a ficha.'); return; }
    
    const logoImg = document.getElementById('logoImg');
    let logoBase64 = '';
    if (logoImg && logoImg.src && logoImg.src.startsWith('data:image')) {
        logoBase64 = logoImg.src;
    }
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head><title>Ficha Individual</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; padding: 40px; background: white; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #2c3e66; padding-bottom: 15px; display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; }
        .header-logo { max-height: 80px; max-width: 150px; object-fit: contain; }
        .header h1 { color: #2c3e66; font-size: 22px; }
        .section { margin-bottom: 20px; }
        .section h2 { color: #2c3e66; font-size: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; }
        .field { padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
        .field strong { font-size: 11px; text-transform: uppercase; color: #6b7280; display: block; }
        .field span { font-size: 13px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
        th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #e9edf2; }
        th { background: #f1f5f9; font-weight: 600; }
        @media print { body { padding: 20px; } }
    </style>
    </head>
    <body>
        <div class="header">
            ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" class="header-logo">` : ''}
            <div>
                <h1>📋 Ficha Individual</h1>
                <p style="color:#6b7280;">${jovem['NOME'] || 'Sem nome'}</p>
                <p style="color:#94a3b8; font-size:12px;">${new Date().toLocaleDateString('pt-BR')}</p>
            </div>
        </div>
        <div class="section">
            <h2>Dados Pessoais</h2>
            <div class="grid">
    `;
    CAMPOS.forEach(([key, label]) => {
        const valor = jovem[key] || '-';
        html += `<div class="field"><strong>${label}</strong><span>${valor}</span></div>`;
    });
    html += `<div class="field"><strong>ID Digital</strong><span>${jovem['ID_DIGITAL'] || '-'}</span></div>`;
    html += `</div></div>`;
    
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        html += `<div class="section"><h2>Ações LA</h2>`;
        acoes.forEach(a => {
            html += `<div style="padding:6px; background:${a.realizado ? '#d1fae5' : '#f8fafc'}; margin-bottom:4px; border-radius:4px;"><span>${a.texto}</span> - <span style="color:${a.realizado ? '#065f46' : '#92400e'};">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span></div>`;
        });
        html += `</div>`;
    }
    
    const hist = jovem.historicoFrequencia || [];
    const totalHoras = hist.reduce((s, h) => s + parseFloat(h.horas || 0), 0);
    html += `<div class="section"><h2>Frequência</h2><p>Total: ${totalHoras.toFixed(1)}h | Saldo: ${calcularSaldo(jovem)}h</p>`;
    if (hist.length > 0) {
        html += `<table><thead><tr><th>Tipo</th><th>Data</th><th>Horas</th></tr></thead><tbody>`;
        hist.forEach(h => {
            html += `<tr><td>${h.tipo === 'saida' ? 'Saída' : 'Entrada'}</td><td>${new Date(h.data).toLocaleDateString('pt-BR')}</td><td>${h.tipo === 'saida' ? '-' : (h.horas || 0) + 'h'}</td></tr>`;
        });
        html += `</tbody></table>`;
    }
    html += `</div></body></html>`;
    
    win.document.write(html);
    win.document.close();
};

window.removerDocumento = async function(jovemId, index) {
    if (!confirm('Tem certeza que deseja remover este documento?')) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    jovem.documentos = jovem.documentos || [];
    jovem.documentos.splice(index, 1);
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        carregarFichaIndividual();
        alert('Documento removido com sucesso!');
    } catch (err) {
        alert('Erro ao remover documento: ' + err.message);
    }
};

window.adicionarDocumento = function() {
    document.getElementById('modalDocumento').style.display = 'flex';
    document.getElementById('docNome').value = '';
    document.getElementById('docTipo').value = 'pdf';
    document.getElementById('docArquivo').value = '';
};

window.fecharModalDocumento = function() {
    document.getElementById('modalDocumento').style.display = 'none';
};

window.salvarDocumento = async function() {
    const jovemId = window._jovemDocAtual;
    if (!jovemId) { alert('Selecione um jovem primeiro.'); return; }
    const nome = document.getElementById('docNome').value.trim();
    const tipo = document.getElementById('docTipo').value;
    const arquivo = document.getElementById('docArquivo').files[0];
    if (!nome) { alert('Digite o nome do documento.'); return; }
    if (!arquivo) { alert('Selecione um arquivo.'); return; }
    try {
        const base64 = await fileToBase64(arquivo);
        const jovem = estado.jovens.find(j => j.id === jovemId);
        if (!jovem) { alert('Jovem não encontrado.'); return; }
        jovem.documentos = jovem.documentos || [];
        jovem.documentos.push({ nome, tipo, base64, data: new Date().toISOString() });
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        fecharModalDocumento();
        carregarFichaIndividual();
        alert('Documento adicionado com sucesso!');
    } catch (err) {
        alert('Erro ao salvar documento: ' + err.message);
    }
};

function injetarHTMLDinamico() {}

function iniciarPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        if (estado.usuarioAtual && estado.usuarioAtual.nivel !== 'jovem') {
            try {
                await carregarTodosDados();
            } catch (e) {
                console.error('Erro no polling:', e);
            }
        }
    }, 60000);
}
