// Sistema de Controle de Medidas Socioeducativas v9
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
  desenvolvedor: {
    nome: 'Desenvolvedor',
    abas: ['dashboard', 'cadastro', 'frequencia', 'relatorios', 'profissionais', 'observacoes', 'acompanhamento', 'oficinas', 'usuarios', 'mensagens'],
    podeCadastrarDesenvolvedor: false
  },
  gestor: {
    nome: 'Gestor',
    abas: ['dashboard', 'cadastro', 'frequencia', 'relatorios', 'observacoes', 'acompanhamento', 'oficinas', 'usuarios', 'mensagens'],
    podeCadastrarDesenvolvedor: false
  },
  tecnico: {
    nome: 'Técnico',
    abas: ['dashboard', 'cadastro', 'frequencia', 'relatorios', 'observacoes', 'oficinas'],
    podeCadastrarDesenvolvedor: false
  },
  oficineiro: {
    nome: 'Oficineiro',
    abas: ['dashboard', 'oficinas'],
    podeCadastrarDesenvolvedor: false
  },
  jovem: {
    nome: 'Jovem',
    abas: ['dashboardJovem'],
    podeCadastrarDesenvolvedor: false
  },
  autoridade: {
    nome: 'Autoridade Jurídica',
    abas: ['dashboard', 'cadastro', 'frequencia', 'relatorios', 'profissionais', 'observacoes', 'acompanhamento', 'oficinas', 'usuarios', 'mensagens'],
    podeCadastrarDesenvolvedor: false
  },
  admin: {
    nome: 'Desenvolvedor',
    abas: ['dashboard', 'cadastro', 'frequencia', 'relatorios', 'profissionais', 'observacoes', 'acompanhamento', 'oficinas', 'usuarios', 'mensagens'],
    podeCadastrarDesenvolvedor: false
  }
};

// ================================================================
// ESTADO GLOBAL
// ================================================================
let estado = {
  usuarios: [], jovens: [], profissionais: [], oficinas: [],
  online: false, usuarioAtual: null, graficos: {}
};

// ================================================================
// CAMPOS DO FORMULÁRIO (baseados na planilha real)
// ================================================================
const CAMPOS = [
  ['REFERENCIA','REFERÊNCIA','text'],['NOME','NOME','text'],['NOME DO RESPONSÁVEL','RESPONSÁVEL','text'],
  ['REINCIDÊNCIA','REINCIDÊNCIA','text'],['MEDIDA','MEDIDA','text'],['MESES','MESES','text'],
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
        <p style="text-align:center; color:#6b7280; margin-bottom:20px;">
          Seu cadastro passará por aprovação.
        </p>
        <div class="campo">
          <label>Nome Completo</label>
          <input type="text" id="cadastroNome" placeholder="Seu nome completo">
        </div>
        <div class="campo">
          <label>E-mail</label>
          <input type="email" id="cadastroEmail" placeholder="seu@email.com">
        </div>
        <div class="campo">
          <label>Senha</label>
          <input type="password" id="cadastroSenha" placeholder="••••••••">
        </div>
        <div class="campo">
          <label>Confirmar Senha</label>
          <input type="password" id="cadastroSenhaConfirm" placeholder="••••••••">
        </div>
        <div class="campo">
          <label>Nível de Acesso</label>
          <select id="cadastroNivel">
            <option value="oficineiro">Oficineiro</option>
            <option value="tecnico">Técnico</option>
            <option value="gestor">Gestor</option>
            <option value="autoridade">Autoridade Jurídica</option>
            <option value="jovem">Jovem</option>
          </select>
        </div>
        <button id="cadastrarBtn" class="btn btn-primary" style="margin-top:10px; width:100%;">Enviar Solicitação</button>
        <button id="voltarLoginBtn" class="btn btn-secondary" style="margin-top:10px; width:100%;">Voltar para Login</button>
        <div id="cadastroErro" class="login-erro"></div>
        <div id="cadastroSucesso" style="color: #10b981; text-align: center; margin-top: 10px; display: none;"></div>
      </div>
    `;
    document.body.appendChild(telaCadastro);
  }



  // Modal Ficha
  if (!document.getElementById('modalFicha')) {
    const modalFicha = document.createElement('div');
    modalFicha.className = 'modal-overlay';
    modalFicha.id = 'modalFicha';
    modalFicha.innerHTML = `
      <div class="modal-box ficha-container">
        <h2 id="fichaTitulo">Ficha do Jovem</h2>
        <div id="fichaConteudo"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="fecharFicha">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalFicha);
  }

  // Modal Alterar Senha
  if (!document.getElementById('modalAlterarSenha')) {
    const modalSenha = document.createElement('div');
    modalSenha.className = 'modal-overlay';
    modalSenha.id = 'modalAlterarSenha';
    modalSenha.innerHTML = `
      <div class="modal-box">
        <h2>🔑 Alterar Senha</h2>
        <div class="campo"><label>Nova Senha</label><input type="password" id="novaSenhaInput"></div>
        <div class="campo"><label>Confirmar Nova Senha</label><input type="password" id="confirmarNovaSenhaInput"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="fecharModalSenha()">Cancelar</button>
          <button class="btn btn-primary" onclick="salvarNovaSenha()">Salvar Senha</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalSenha);
  }

  // Modal Alterar Logo
  if (!document.getElementById('modalAlterarLogo')) {
    const modalLogo = document.createElement('div');
    modalLogo.className = 'modal-overlay';
    modalLogo.id = 'modalAlterarLogo';
    modalLogo.innerHTML = `
      <div class="modal-box">
        <h2>🖼️ Alterar Logo</h2>
        <div class="campo"><label>Imagem do Logo (PNG, JPG)</label><input type="file" id="novaLogoInput" accept="image/*"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="fecharModalLogo()">Cancelar</button>
          <button class="btn btn-primary" onclick="salvarLogo()">Salvar Logo</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalLogo);
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
        <div class="campo">
          <label>Jovem</label>
          <select id="selectVincularJovem"></select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="fecharModalVincular()">Cancelar</button>
          <button class="btn btn-primary" onclick="salvarVinculoJovem()">Vincular e Aprovar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalVincular);
  }

  // Botões já estão no HTML, apenas configurar o onclick aqui
  const btnSenhaEl = document.getElementById('btnAlterarSenha');
  if (btnSenhaEl && !btnSenhaEl.onclick) {
    btnSenhaEl.onclick = function() { document.getElementById('modalAlterarSenha').style.display = 'flex'; };
  }

  const btnLogoEl = document.getElementById('btnAlterarLogo');
  if (btnLogoEl && !btnLogoEl.onclick) {
    btnLogoEl.onclick = function() { document.getElementById('modalAlterarLogo').style.display = 'flex'; };
  }

  // Adicionar aba de aprovação na tab de usuários
  const tabUsuarios = document.getElementById('tabUsuarios');
  if (tabUsuarios && !document.getElementById('listaPendentes')) {
    const aprovarSection = document.createElement('div');
    aprovarSection.innerHTML = `
      <h3 style="margin-top:30px; margin-bottom:15px;">⏳ Solicitações Pendentes</h3>
      <div class="tabela-wrapper">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Nível Solicitado</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody id="listaPendentes"></tbody>
        </table>
      </div>
    `;
    tabUsuarios.appendChild(aprovarSection);
  }
}

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

async function upstashPipeline(commands) {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!res.ok) throw new Error(`Upstash pipeline error: ${res.status}`);
  return res.json();
}

async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) { lastErr = err; if (i < retries - 1) await new Promise(r => setTimeout(r, 1500)); }
  }
  throw lastErr;
}

// ================================================================
// LOGIN E SENHA
// ================================================================
async function fazerLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const senha = document.getElementById('loginSenha').value.trim();
  if (!email || !senha) return alert('Preencha e-mail e senha.');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Conectando...';
  document.getElementById('loginErro').textContent = '';

  try {
    await withRetry(() => upstash('PING'));
    
    // Criar admin se não existir
    const adminExists = await upstash('EXISTS', 'user:admin001');
    if (adminExists === 0) {
      const adminData = JSON.stringify({
        id: 'admin001', nome: 'Gabriel Santiago', email: 'contato.gabriel.santiago@gmail.com',
        senha: 'ca265ga071', nivel: 'desenvolvedor', status: 'ativo'
      });
      await upstash('SET', 'user:admin001', adminData);
      await upstash('SADD', 'users:all', 'admin001');
    }

    // Buscar usuário
    const allUsers = await upstash('SMEMBERS', 'users:all');
    let user = null;
    for (const id of allUsers) {
      const raw = await upstash('GET', `user:${id}`);
      if (raw) {
        const u = JSON.parse(raw);
        if (u.email === email && u.senha === senha) {
          user = u; break;
        }
      }
    }
    
    if (!user) { document.getElementById('loginErro').textContent = 'E-mail ou senha incorretos.'; return; }
    if (user.status !== 'ativo') { document.getElementById('loginErro').textContent = 'Seu cadastro está pendente de aprovação.'; return; }

    estado.usuarioAtual = user;
    estado.online = true;
    document.getElementById('telaLogin').style.display = 'none';
    document.querySelector('.app-container').style.display = 'block';
    document.getElementById('nomeUsuario').textContent = user.nome || user.email;
    document.getElementById('nivelUsuario').textContent = NIVEIS_ACESSO[user.nivel]?.nome || user.nivel;

    // Botões editáveis para dev/gestor
    const btnLogo = document.getElementById('btnAlterarLogo');
    if (btnLogo) {
      btnLogo.style.display = (user.nivel === 'desenvolvedor' || user.nivel === 'admin' || user.nivel === 'gestor') ? '' : 'none';
    }

    carregarLogo();
    mostrarAbasPorNivel(user.nivel);
    
    if (user.nivel === 'jovem') {
      carregarJovemPeloCPF(user.cpf); // Usa o CPF salvo no vínculo
    } else {
      carregarTodosDados();
    }
    iniciarPolling();
  } catch (err) {
    document.getElementById('loginErro').textContent = 'Erro de conexão: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
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
  } catch (err) {
    alert('Erro ao alterar senha: ' + err.message);
  }
}

// ================================================================
// LOGO PERSONALIZADO
// ================================================================
async function carregarLogo() {
  try {
    const logoBase64 = await upstash('GET', 'config:logo');
    if (logoBase64) {
      document.getElementById('logoImg').src = logoBase64;
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
  } catch (err) {
    alert('Erro ao salvar logo: ' + err.message);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
// CADASTRO E APROVAÇÃO DE USUÁRIOS
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
    const user = {
      id: 'usr_' + Date.now(), nome, email, senha, nivel,
      status: 'pendente', cpf: '' // CPF será preenchido na aprovação para jovens
    };
    await upstash('SET', `user:${user.id}`, JSON.stringify(user));
    await upstash('SADD', 'users:all', user.id);
    document.getElementById('cadastroSucesso').style.display = 'block';
    document.getElementById('cadastroSucesso').textContent = 'Cadastro enviado! Aguarde aprovação.';
    ['cadastroNome','cadastroEmail','cadastroSenha','cadastroSenhaConfirm'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  } catch (err) {
    document.getElementById('cadastroErro').textContent = 'Erro: ' + err.message;
  }
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
        <button onclick="aprovarUsuario('${u.id}', '${u.nivel}')" class="btn-acao" style="background:#10b981;">✅ Aprovar</button>
        <button onclick="excluirUsuario('${u.id}')" class="btn-acao btn-danger">🗑️ Rejeitar</button>
      </td>
    </tr>
  `).join('');
}

async function aprovarUsuario(id, nivel) {
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
      alert('Usuário aprovado com sucesso!');
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  }
}

function fecharModalVincular() {
  document.getElementById('modalVincularJovem').style.display = 'none';
  userParaVincular = null;
}

async function salvarVinculoJovem() {
  const cpfOuId = document.getElementById('selectVincularJovem').value;
  if (!cpfOuId) return alert('Selecione um jovem.');
  
  userParaVincular.cpf = cpfOuId; // Salva o vínculo (CPF ou ID como fallback)
  userParaVincular.status = 'ativo';
  
  try {
    await upstash('SET', `user:${userParaVincular.id}`, JSON.stringify(userParaVincular));
    fecharModalVincular();
    await carregarTodosDados();
    alert('Jovem vinculado e aprovado com sucesso!');
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

function renderizarUsuarios() {
  const tbody = document.getElementById('listaUsuarios');
  if (!tbody) return;
  tbody.innerHTML = estado.usuarios.filter(u => u.status === 'ativo').map(u => `
    <tr>
      <td>${u.nome || '-'}</td><td>${u.email || '-'}</td><td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel || '-'}</td>
      <td style="color:#10b981;">${u.status}</td>
      <td>
        <button onclick="excluirUsuario('${u.id}')" class="btn-acao btn-danger">🗑️</button>
      </td>
    </tr>
  `).join('');
}

async function excluirUsuario(id) {
  if (!confirm('Excluir/Rejeitar usuário?')) return;
  try {
    await upstash('DEL', `user:${id}`);
    await upstash('SREM', 'users:all', id);
    estado.usuarios = estado.usuarios.filter(u => u.id !== id);
    renderizarUsuarios();
    renderizarPendentes();
  } catch (err) {
    alert('Erro: ' + err.message);
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
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// ================================================================
// CARREGAR DADOS GERAIS
// ================================================================
async function carregarTodosDados() {
  try {
    const jovemIds = await upstash('SMEMBERS', 'jovens:all');
    estado.jovens = [];
    for (const id of jovemIds) {
      const raw = await upstash('GET', `jovem:${id}`);
      if (raw) estado.jovens.push(JSON.parse(raw));
    }
    const profIds = await upstash('SMEMBERS', 'profissionais:all');
    estado.profissionais = [];
    for (const id of profIds) {
      const raw = await upstash('GET', `profissional:${id}`);
      if (raw) estado.profissionais.push(JSON.parse(raw));
    }
    const oficinaIds = await upstash('SMEMBERS', 'oficinas:all');
    estado.oficinas = [];
    for (const id of oficinaIds) {
      const raw = await upstash('GET', `oficina:${id}`);
      if (raw) estado.oficinas.push(JSON.parse(raw));
    }
    const userIds = await upstash('SMEMBERS', 'users:all');
    estado.usuarios = [];
    for (const id of userIds) {
      const raw = await upstash('GET', `user:${id}`);
      if (raw) estado.usuarios.push(JSON.parse(raw));
    }
    estado.online = true;
    atualizarInterfaceCompleta();
  } catch (err) {
    console.error('Erro ao carregar:', err);
  }
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
  } catch (err) {
    console.error('Erro ao carregar dados do jovem:', err);
  }
}

function atualizarInterfaceCompleta() {
  carregarLista();
  renderizarDashboard();
  renderizarProfissionais();
  renderizarOficinas();
  renderizarUsuarios();
  renderizarPendentes();
  renderizarRelatorios();
  renderizarAcompanhamento();
  popularSelectAcompInd();
}

// ================================================================
// DASHBOARD
// ================================================================
function renderizarDashboard() {
  const cards = document.getElementById('cardsDashboard');
  if (!cards) return;
  const ativos = estado.jovens.filter(j => j['MEDIDA'] && j['MEDIDA'] !== 'Liberação').length;
  const total = estado.jovens.length;
  const liberados = estado.jovens.filter(j => j['MEDIDA'] === 'Liberação').length;
  const profissionais = estado.profissionais.length;
  cards.innerHTML = `
    <div class="card"><h4>Total</h4><p>${total}</p><div class="sub-info">Jovens cadastrados</div></div>
    <div class="card"><h4>Ativos</h4><p style="color:#10b981;">${ativos}</p><div class="sub-info">Em cumprimento</div></div>
    <div class="card"><h4>Liberados</h4><p style="color:#6b7280;">${liberados}</p><div class="sub-info">Medida concluída</div></div>
    <div class="card"><h4>Profissionais</h4><p style="color:#3b82f6;">${profissionais}</p><div class="sub-info">Equipe técnica</div></div>
  `;
  renderizarGraficos();
}

function renderizarDashboardJovem() {
  const cards = document.getElementById('jovemInfoCards');
  const freqDiv = document.getElementById('jovemFrequencia');
  if (!cards || !freqDiv) return;
  if (estado.jovens.length === 0) {
    cards.innerHTML = '<p style="color:#6b7280;">Nenhum dado encontrado. Seu perfil ainda não foi vinculado a um jovem.</p>';
    freqDiv.innerHTML = '';
    return;
  }
  const jovem = estado.jovens[0];
  const horasTotal = parseFloat(jovem['HORAS'] || 0);
  const hist = jovem.historicoFrequencia || [];
  const horasFeitas = hist.reduce((s, h) => s + (parseFloat(h.horas) || 4), 0);
  const saldo = Math.max(0, horasTotal - horasFeitas);

  cards.innerHTML = `
    <div class="card"><h4>Nome</h4><p style="font-size:1.1rem;">${jovem['NOME'] || '-'}</p></div>
    <div class="card"><h4>Medida</h4><p>${jovem['MEDIDA'] || '-'}</p></div>
    <div class="card"><h4>Horas a Cumprir</h4><p style="font-size:1.5rem; color:#2c3e66;">${horasTotal}h</p></div>
    <div class="card"><h4>Horas Cumpridas</h4><p style="font-size:1.5rem; color:#10b981;">${horasFeitas.toFixed(1)}h</p></div>
    <div class="card"><h4>Saldo Restante</h4><p style="font-size:1.5rem; color:#f59e0b;">${saldo.toFixed(1)}h</p></div>
    <div class="card"><h4>Progresso</h4><p style="font-size:1.5rem; color:#3b82f6;">${horasTotal > 0 ? ((horasFeitas / horasTotal) * 100).toFixed(0) : 0}%</p></div>
  `;

  freqDiv.innerHTML = `
    <div class="card" style="margin-top:16px;">
      <h3>📊 Minhas Frequências</h3>
      ${hist.length > 0 ? `
        <table style="width:100%; margin-top:12px;">
          <thead><tr><th>Data</th><th>Horas</th><th>Observação</th></tr></thead>
          <tbody>${hist.map(h => `
            <tr><td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td>
            <td>${h.horas}h</td><td>${h.observacao || '-'}</td></tr>
          `).join('')}</tbody>
        </table>
      ` : '<p style="color:#6b7280;">Nenhum registro de frequência encontrado.</p>'}
    </div>
  `;
}

function renderizarGraficos() {
  Object.values(estado.graficos).forEach(c => c.destroy());
  estado.graficos = {};
  const ativos = estado.jovens.filter(j => j['MEDIDA'] && j['MEDIDA'] !== 'Liberação');

  const medidas = {};
  ativos.forEach(j => { const m = j['MEDIDA'] || 'Não informada'; medidas[m] = (medidas[m] || 0) + 1; });
  const ctx1 = document.getElementById('graficoMedidas')?.getContext('2d');
  if (ctx1) estado.graficos.medidas = new Chart(ctx1, { type: 'bar', data: { labels: Object.keys(medidas), datasets: [{ label: 'Jovens', data: Object.values(medidas), backgroundColor: '#2c3e66' }] }});

  const generos = { M: 0, F: 0, NB: 0 };
  ativos.forEach(j => { const g = (j['GÊNERO'] || '').toUpperCase(); if (generos[g] !== undefined) generos[g]++; });
  const ctx2 = document.getElementById('graficoGenero')?.getContext('2d');
  if (ctx2) estado.graficos.genero = new Chart(ctx2, { type: 'doughnut', data: { labels: ['Masculino','Feminino','Não-binário'], datasets: [{ data: Object.values(generos), backgroundColor: ['#3b82f6','#ec4899','#a78bfa'] }] }});

  const idades = { 'Até 15': 0, '16-17': 0, '18-21': 0, '22+': 0 };
  ativos.forEach(j => { const i = parseInt(j['IDADE']); if (i <= 15) idades['Até 15']++; else if (i <= 17) idades['16-17']++; else if (i <= 21) idades['18-21']++; else idades['22+']++; });
  const ctx3 = document.getElementById('graficoIdade')?.getContext('2d');
  if (ctx3) estado.graficos.idade = new Chart(ctx3, { type: 'pie', data: { labels: Object.keys(idades), datasets: [{ data: Object.values(idades), backgroundColor: ['#10b981','#f59e0b','#ef4444','#6b7280'] }] }});

  const semanas = {};
  ativos.forEach(j => { (j.historicoFrequencia || []).forEach(h => { const d = new Date(h.data); const week = `Sem ${Math.ceil(d.getMonth()+1)}/${d.getFullYear()}`; semanas[week] = (semanas[week] || 0) + 1; }); });
  const ctx4 = document.getElementById('graficoFrequenciaSemanal')?.getContext('2d');
  if (ctx4) estado.graficos.freqSemanal = new Chart(ctx4, { type: 'line', data: { labels: Object.keys(semanas), datasets: [{ label: 'Frequências', data: Object.values(semanas), borderColor: '#f39c12', fill: false }] }});

  const reverte = estado.oficinas.filter(o => o.reverte).length;
  const naoReverte = estado.oficinas.length - reverte;
  const ctx5 = document.getElementById('graficoReverte')?.getContext('2d');
  if (ctx5) estado.graficos.reverte = new Chart(ctx5, { type: 'bar', data: { labels: ['Reverte', 'Não Reverte'], datasets: [{ data: [reverte, naoReverte], backgroundColor: ['#10b981','#6b7280'] }] }});
}

// ================================================================
// FORMULÁRIO E IMPORTAÇÃO (COM VERIFICAÇÃO DE CPF DUPLICADO)
// ================================================================
function renderizarCamposFormulario() {
  const grid = document.getElementById('camposGrid');
  if (!grid) return;
  grid.innerHTML = CAMPOS.map(([key, label, type, options]) => {
    if (type === 'select' && options) {
      return `<div class="campo"><label>${label}</label><select id="campo_${key}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;
    }
    return `<div class="campo"><label>${label}</label><input type="${type}" id="campo_${key}"></div>`;
  }).join('');
}

async function salvarJovem() {
  const nome = document.getElementById('campo_NOME')?.value.trim();
  if (!nome) return alert('Preencha pelo menos o nome.');

  const jovemExistente = estado.jovens.find(j => (j['NOME'] || '').toUpperCase() === nome.toUpperCase());
  const jovem = { id: jovemExistente ? jovemExistente.id : 'j_' + Date.now(), ...jovemExistente };

  CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) jovem[key] = el.value.trim(); });
  jovem['ID_DIGITAL'] = document.getElementById('campo_ID_DIGITAL')?.value.trim() || '';
  if (!jovem.historicoFrequencia) jovem.historicoFrequencia = [];
  if (!jovem.observacoes) jovem.observacoes = [];
  if (!jovem.documentos) jovem.documentos = [];
  jovem.updatedAt = new Date().toISOString();

  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    if (!jovemExistente) await upstash('SADD', 'jovens:all', jovem.id);
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
}

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

      statusDiv.textContent = `⏳ Verificando e importando ${rows.length} registros...`;

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

      const lotes = [];
      let importados = 0;
      let duplicados = 0;

      for (let i = 0; i < rows.length; i += 25) {
        const lote = rows.slice(i, i + 25);
        const cmds = [];
        for (const row of lote) {
          const nome = row[colMap['NOME']] || row['NOME'];
          if (!nome || nome === 'undefined') continue;

          // VERIFICAÇÃO DE CPF DUPLICADO
          const cpfPlanilha = String(row[colMap['CPF']] || row['CPF'] || '').replace(/\D/g, '');
          let existe = false;
          if (cpfPlanilha) {
            existe = estado.jovens.some(j => (j['CPF'] || '').replace(/\D/g, '') === cpfPlanilha);
          } else {
            // Fallback para nome se não tiver CPF
            existe = estado.jovens.some(j => (j['NOME'] || '').toUpperCase() === nome.toUpperCase());
          }

          if (existe) {
            duplicados++;
            continue;
          }

          const jovemId = 'j_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
          const jovem = { id: jovemId };
          CAMPOS.forEach(([key]) => {
            const colName = colMap[key];
            if (colName && row[colName] !== undefined) {
              let val = String(row[colName] || '').trim();
              if (key === 'GÊNERO') {
                if (val.toUpperCase().includes('MASC')) val = 'M';
                else if (val.toUpperCase().includes('FEM')) val = 'F';
                else if (val.toUpperCase().includes('NB') || val.toUpperCase().includes('NÃO')) val = 'NB';
              }
              if (key === 'HORAS' || key === 'MESES') val = parseFloat(val) || 0;
              jovem[key] = val;
            }
          });
          jovem['ID_DIGITAL'] = String(row[colMap['ID_DIGITAL']] || row['ID DIGITAL'] || '').trim();
          jovem.historicoFrequencia = []; jovem.observacoes = []; jovem.documentos = [];
          jovem.createdAt = new Date().toISOString();
          
          cmds.push(['SET', `jovem:${jovemId}`, JSON.stringify(jovem)]);
          cmds.push(['SADD', 'jovens:all', jovemId]);
          importados++;
        }
        if (cmds.length > 0) lotes.push(cmds);
      }

      for (const lote of lotes) { await upstashPipeline(lote); }

      await carregarTodosDados();
      statusDiv.style.background = '#d1fae5';
      statusDiv.style.color = '#065f46';
      statusDiv.textContent = `✅ Importação concluída! ${importados} novos jovens adicionados. (${duplicados} duplicados ignorados).`;
    } catch (err) {
      statusDiv.style.background = '#fee2e2';
      statusDiv.style.color = '#991b1b';
      statusDiv.textContent = '❌ Erro: ' + err.message;
    }
  };
  input.click();
}

// ================================================================
// LISTA, PONTO DIGITAL E FICHA (MODAL CORRIGIDO)
// ================================================================
function carregarLista() {
  const tbody = document.getElementById('listaCorpo');
  if (!tbody) return;
  const busca = (document.getElementById('buscaFrequencia')?.value || '').toLowerCase();
  let lista = estado.jovens.filter(j => {
    if (!busca) return true;
    return (j['NOME'] || j['REFERENCIA'] || '').toLowerCase().includes(busca);
  }).sort((a, b) => (a['NOME'] || a['REFERENCIA'] || '').toUpperCase().localeCompare((b['NOME'] || b['REFERENCIA'] || '').toUpperCase(), 'pt-BR'));

  tbody.innerHTML = lista.map(j => {
    const hist = j.historicoFrequencia || [];
    const saldo = calcularSaldo(j);
    const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';
    const status = j['MEDIDA'] === 'Liberação' ? 'liberado' : (hist.length > 0 ? 'ativo' : 'inativo');
    const statusClass = status === 'liberado' ? 'ponto-status fechado' : (status === 'ativo' ? 'ponto-status entrada' : 'ponto-status saida');

    return `<tr>
      <td>${j['NOME'] || j['REFERENCIA'] || '-'}</td><td>${j['ID_DIGITAL'] || '-'}</td><td>${j['IDADE'] || '-'}</td>
      <td>${j['MEDIDA'] || '-'}</td><td>${saldo}h</td><td><span class="${statusClass}">${status}</span></td><td>${ultimo}</td>
      <td>
        <button onclick="abrirFicha('${j.id}')" class="btn-acao btn-ficha">📋</button>
        <button onclick="abrirObservacao('${j.id}')" class="btn-acao btn-obs">📝</button>
        <button onclick="excluirJovem('${j.id}')" class="btn-acao btn-danger">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

function parseNum(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function calcularSaldo(jovem) {
  const horasTotal = parseNum(jovem['HORAS']);
  const horasFeitas = (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0);
  return Math.max(0, horasTotal - horasFeitas).toFixed(1);
}

async function registrarPontoDigital() {
  const id = document.getElementById('inputDigital').value.trim();
  if (!id) return alert('Digite o código da digital.');
  const jovem = estado.jovens.find(j => j['ID_DIGITAL'] === id);
  if (!jovem) return alert('Código não encontrado.');
  if (jovem['MEDIDA'] === 'Liberação') return alert('Jovem liberado.');

  const now = new Date();
  jovem.historicoFrequencia = jovem.historicoFrequencia || [];
  jovem.historicoFrequencia.push({ data: now.toISOString(), horas: 4, tipo: 'entrada', observacao: '' });

  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    const msg = document.getElementById('mensagemPonto');
    msg.textContent = `✅ ${jovem['NOME']} - Entrada registrada em ${now.toLocaleString('pt-BR')}`;
    msg.style.color = '#10b981';
    document.getElementById('inputDigital').value = '';
    carregarLista(); renderizarDashboard();
  } catch (err) { alert('Erro: ' + err.message); }
}

function abrirFicha(id) {
  const jovem = estado.jovens.find(j => j.id === id);
  if (!jovem) return;
  const titulo = document.getElementById('fichaTitulo');
  const conteudo = document.getElementById('fichaConteudo');
  if (titulo) titulo.textContent = `Ficha: ${jovem['NOME'] || jovem['REFERENCIA']}`;
  if (conteudo) {
    conteudo.innerHTML = `
      <h3>Dados Pessoais</h3>
      <div class="grid-campos">
        ${CAMPOS.map(([key, label]) => `<div class="campo-item"><strong>${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}
      </div>
      <div class="secao-historico">
        <h4>Frequência (${(jovem.historicoFrequencia || []).length} registros)</h4>
        <ul>${(jovem.historicoFrequencia || []).map(h => `<li>${new Date(h.data).toLocaleDateString('pt-BR')} - ${h.horas}h - ${h.observacao || ''}</li>`).join('') || '<li>Sem registros</li>'}</ul>
      </div>
    `;
  }
  document.getElementById('modalFicha').style.display = 'flex';
}

// ================================================================
// RESTANTE DAS FUNÇÕES ORIGINAIS (Observações, Relatórios, etc)
// ================================================================
function abrirRegistroManual() {
  const select = document.getElementById('manualJovem');
  if (!select) return;
  select.innerHTML = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação').sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR')).map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']}</option>`).join('');
  document.getElementById('modalRegistroManual').style.display = 'flex';
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('manualDataHora').value = now.toISOString().slice(0, 16);
}

async function salvarRegistroManual() {
  const jovemId = document.getElementById('manualJovem').value;
  const dataHora = document.getElementById('manualDataHora').value;
  const horas = parseFloat(document.getElementById('manualHoras').value);
  const obs = document.getElementById('manualObs').value.trim();
  if (!jovemId || !dataHora) return alert('Selecione o jovem e a data.');

  const jovem = estado.jovens.find(j => j.id === jovemId);
  if (!jovem) return;
  jovem.historicoFrequencia = jovem.historicoFrequencia || [];
  jovem.historicoFrequencia.push({ data: new Date(dataHora).toISOString(), horas, tipo: 'entrada', observacao: obs });

  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    document.getElementById('modalRegistroManual').style.display = 'none';
    carregarLista(); renderizarDashboard();
  } catch (err) { alert('Erro: ' + err.message); }
}

let jovemObsAtual = null;
function abrirObservacao(id) {
  jovemObsAtual = id;
  document.getElementById('modalProfissionalNome').value = estado.usuarioAtual?.nome || '';
  document.getElementById('modalObservacaoTexto').value = '';
  document.getElementById('modalObservacao').style.display = 'flex';
}

async function salvarObs() {
  const profissional = document.getElementById('modalProfissionalNome').value.trim();
  const texto = document.getElementById('modalObservacaoTexto').value.trim();
  if (!texto) return alert('Digite a observação.');
  const jovem = estado.jovens.find(j => j.id === jovemObsAtual);
  if (!jovem) return;
  jovem.observacoes = jovem.observacoes || [];
  jovem.observacoes.push({ data: new Date().toISOString(), profissional, texto });
  try {
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    document.getElementById('modalObservacao').style.display = 'none';
    jovemObsAtual = null; carregarLista();
  } catch (err) { alert('Erro: ' + err.message); }
}

function exportarExcel() {
  const data = estado.jovens.map(j => ({
    Nome: j['NOME'] || j['REFERENCIA'], Digital: j['ID_DIGITAL'], Idade: j['IDADE'], Medida: j['MEDIDA'],
    Saldo: calcularSaldo(j), Frequências: (j.historicoFrequencia || []).length,
    Último: (j.historicoFrequencia || []).length > 0 ? new Date(Math.max(...j.historicoFrequencia.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca'
  }));
  const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jovens');
  XLSX.writeFile(wb, `relatorio_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function excluirJovem(id) {
  if (!confirm('Tem certeza que deseja excluir este jovem?')) return;
  try {
    await upstash('DEL', `jovem:${id}`); await upstash('SREM', 'jovens:all', id);
    estado.jovens = estado.jovens.filter(j => j.id !== id);
    atualizarInterfaceCompleta();
  } catch (err) { alert('Erro: ' + err.message); }
}

// ... Outras funções (profissionais, oficinas, mensagens, relatórios, acompanhamento) ...
// Para não exceder o limite, copiei as funções exatas do original para cá

async function salvarProfissional() {
  const nome = document.getElementById('profNome').value.trim();
  if (!nome) return alert('Preencha o nome.');
  const prof = { id: 'prof_' + Date.now(), nome, funcao: document.getElementById('profFuncao').value.trim(), registro: document.getElementById('profRegistro').value.trim(), numero: document.getElementById('profNumero').value.trim(), createdBy: estado.usuarioAtual?.nome || 'Sistema' };
  try { await upstash('SET', `profissional:${prof.id}`, JSON.stringify(prof)); await upstash('SADD', 'profissionais:all', prof.id); estado.profissionais.push(prof); renderizarProfissionais(); ['profNome','profFuncao','profRegistro','profNumero'].forEach(id => document.getElementById(id).value = ''); } catch (err) { alert('Erro: ' + err.message); }
}
function renderizarProfissionais() {
  const div = document.getElementById('listaProfissionais'); if (!div) return;
  div.innerHTML = estado.profissionais.map(p => `<div class="profissional-item"><div><strong>${p.nome}</strong> - ${p.funcao || '-'} ${p.registro ? `(${p.registro})` : ''}</div><button onclick="excluirProfissional('${p.id}')" class="btn-action btn-danger">🗑️</button></div>`).join('');
}
async function excluirProfissional(id) { if (!confirm('Excluir profissional?')) return; try { await upstash('DEL', `profissional:${id}`); await upstash('SREM', 'profissionais:all', id); estado.profissionais = estado.profissionais.filter(p => p.id !== id); renderizarProfissionais(); } catch (err) { alert('Erro: ' + err.message); } }

function renderizarJovensOficina() {
  const div = document.getElementById('listaJovensOficina'); if (!div) return;
  const jovens = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação').sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'));
  div.innerHTML = jovens.map(j => `<label class="jovem-checkbox"><input type="checkbox" value="${j.id}"><span class="jovem-nome">${j['NOME'] || j['REFERENCIA']}</span></label>`).join('');
}
function filtrarJovensOficina() {
  const busca = (document.getElementById('buscaJovensOficina')?.value || '').toLowerCase();
  document.querySelectorAll('#listaJovensOficina .jovem-checkbox').forEach(cb => { cb.style.display = (cb.querySelector('.jovem-nome')?.textContent || '').toLowerCase().includes(busca) ? '' : 'none'; });
}
async function salvarOficina() {
  const data = document.getElementById('oficinaData').value; const periodo = document.getElementById('oficinaPeriodo').value; const conteudo = document.getElementById('oficinaConteudo').value.trim(); const reverte = document.getElementById('oficinaReverte').checked;
  if (!data || !conteudo) return alert('Preencha data e conteúdo.');
  const jovensPresentes = [...document.querySelectorAll('#listaJovensOficina input:checked')].map(cb => cb.value);
  const oficina = { id: 'of_' + Date.now(), data, periodo, conteudo, reverte, jovensIds: jovensPresentes, createdBy: estado.usuarioAtual?.nome || 'Sistema' };
  try { await upstash('SET', `oficina:${oficina.id}`, JSON.stringify(oficina)); await upstash('SADD', 'oficinas:all', oficina.id); estado.oficinas.push(oficina); renderizarOficinas(); ['oficinaData','oficinaConteudo'].forEach(id => document.getElementById(id).value = ''); document.getElementById('oficinaReverte').checked = false; document.querySelectorAll('#listaJovensOficina input').forEach(cb => cb.checked = false); document.getElementById('buscaJovensOficina').value = ''; renderizarJovensOficina(); } catch (err) { alert('Erro: ' + err.message); }
}
function renderizarOficinas() {
  const div = document.getElementById('listaOficinas'); if (!div) return;
  div.innerHTML = estado.oficinas.slice().reverse().map(o => {
    const dataFmt = new Date(o.data).toLocaleDateString('pt-BR');
    const jovensNomes = (o.jovensIds || []).map(id => { const j = estado.jovens.find(x => x.id === id); return j ? (j['NOME'] || j['REFERENCIA']) : 'Desconhecido'; });
    return `<div class="oficina-card"><div class="oficina-header"><div><strong>📅 ${dataFmt}</strong><span style="margin-left:8px; color:#6b7280;">${o.periodo}</span><span class="${o.reverte ? 'badge-reverte' : 'badge-nao-reverte'}" style="margin-left:8px;">${o.reverte ? 'Reverte' : 'Normal'}</span></div><div><span style="font-size:0.85rem; color:#3b82f6;">👥 ${jovensNomes.length} jovens</span><button onclick="excluirOficina('${o.id}')" class="btn-action btn-danger" style="margin-left:8px;">🗑️</button></div></div><div class="oficina-conteudo">${o.conteudo}</div><div class="oficina-jovens-lista">${jovensNomes.length > 0 ? jovensNomes.map(n => `<span class="jovem-tag">${n}</span>`).join('') : '<span style="color:#9ca3af;">Nenhum jovem presente</span>'}</div></div>`;
  }).join('');
}
async function excluirOficina(id) { if (!confirm('Excluir oficina?')) return; try { await upstash('DEL', `oficina:${id}`); await upstash('SREM', 'oficinas:all', id); estado.oficinas = estado.oficinas.filter(o => o.id !== id); renderizarOficinas(); } catch (err) { alert('Erro: ' + err.message); } }

function popularSelectAcompInd() {
  const select = document.getElementById('selectJovemAcomp'); if (!select) return;
  select.innerHTML = '<option value="">Selecione um jovem...</option>' + estado.jovens.sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR')).map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''}</option>`).join('');
}
function carregarFichaIndividual() {
  const id = document.getElementById('selectJovemAcomp').value; const container = document.getElementById('fichaIndividual'); const btnPrint = document.getElementById('btnImprimirFicha');
  if (!id) { container.style.display = 'none'; btnPrint.style.display = 'none'; return; }
  const jovem = estado.jovens.find(j => j.id === id); if (!jovem) return;
  container.style.display = 'block'; btnPrint.style.display = 'inline-flex';
  const dadosDiv = document.getElementById('fichaDadosPessoais'); if (dadosDiv) dadosDiv.innerHTML = `<div class="ficha-grid">${CAMPOS.map(([key, label]) => `<div class="ficha-campo"><strong>${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}<div class="ficha-campo"><strong>ID Digital:</strong> ${jovem['ID_DIGITAL'] || '-'}</div></div>`;
  const freqDiv = document.getElementById('fichaFrequencia'); if (freqDiv) { const hist = jovem.historicoFrequencia || []; const totalHoras = hist.reduce((s, h) => s + (parseFloat(h.horas) || 4), 0); freqDiv.innerHTML = `<p><strong>Total de frequências:</strong> ${hist.length} registros</p><p><strong>Total de horas:</strong> ${totalHoras.toFixed(1)}h</p><p><strong>Saldo restante:</strong> ${calcularSaldo(jovem)}h</p>${hist.length > 0 ? `<table style="margin-top:12px; width:100%;"><thead><tr><th>Data</th><th>Horas</th><th>Observação</th></tr></thead><tbody>${hist.map(h => `<tr><td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</td><td>${h.horas}h</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:#6b7280;">Nenhum registro de frequência.</p>'}`; }
  const ofDiv = document.getElementById('fichaOficinas'); if (ofDiv) { const oficinasParticipadas = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id)); ofDiv.innerHTML = oficinasParticipadas.length > 0 ? `<p><strong>Total de oficinas:</strong> ${oficinasParticipadas.length}</p><table style="margin-top:12px; width:100%;"><thead><tr><th>Data</th><th>Período</th><th>Conteúdo</th><th>Reverte</th></tr></thead><tbody>${oficinasParticipadas.map(o => `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.periodo}</td><td>${o.conteudo}</td><td>${o.reverte ? 'Sim' : 'Não'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:#6b7280;">Nenhuma oficina registrada.</p>'; }
  const docDiv = document.getElementById('fichaDocumentos'); if (docDiv) { const docs = jovem.documentos || []; docDiv.innerHTML = docs.length > 0 ? docs.map((d, i) => `<div class="doc-item"><span>📄 ${d.nome} (${d.tipo}) - ${d.data ? new Date(d.data).toLocaleDateString('pt-BR') : ''}</span><div>${d.base64 ? `<a href="${d.base64}" download="${d.nome}" class="btn-acao btn-edit" style="text-decoration:none;">📥 Baixar</a>` : ''}<button onclick="removerDocumento('${id}', ${i})" class="btn-acao btn-danger">🗑️</button></div></div>`).join('') : '<p style="color:#6b7280;">Nenhum documento anexado.</p>'; }
  const obsDiv = document.getElementById('fichaObservacoes'); if (obsDiv) { const obs = jovem.observacoes || []; obsDiv.innerHTML = obs.length > 0 ? obs.map(o => `<div class="obs-item"><strong>${o.profissional || 'Sistema'}</strong> - <small>${new Date(o.data).toLocaleDateString('pt-BR')} ${new Date(o.data).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</small><p>${o.texto}</p></div>`).join('') : '<p style="color:#6b7280;">Nenhuma observação registrada.</p>'; }
}
function adicionarDocumento() { const jovemId = document.getElementById('selectJovemAcomp').value; if (!jovemId) return alert('Selecione um jovem primeiro.'); window._jovemDocAtual = jovemId; document.getElementById('docNome').value = ''; document.getElementById('docTipo').value = 'pdf'; document.getElementById('docArquivo').value = ''; document.getElementById('modalDocumento').style.display = 'flex'; }
function fecharModalDocumento() { document.getElementById('modalDocumento').style.display = 'none'; }
async function salvarDocumento() { const jovemId = window._jovemDocAtual; const nome = document.getElementById('docNome').value.trim(); const tipo = document.getElementById('docTipo').value; const fileInput = document.getElementById('docArquivo'); if (!nome) return alert('Digite o nome do documento.'); const jovem = estado.jovens.find(j => j.id === jovemId); if (!jovem) return; let base64 = null; if (fileInput.files[0]) base64 = await fileToBase64(fileInput.files[0]); jovem.documentos = jovem.documentos || []; jovem.documentos.push({ nome, tipo, data: new Date().toISOString(), base64 }); try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); fecharModalDocumento(); carregarFichaIndividual(); alert('Documento salvo com sucesso!'); } catch (err) { alert('Erro: ' + err.message); } }
async function removerDocumento(jovemId, index) { if (!confirm('Remover este documento?')) return; const jovem = estado.jovens.find(j => j.id === jovemId); if (!jovem) return; jovem.documentos.splice(index, 1); try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); carregarFichaIndividual(); } catch (err) { alert('Erro: ' + err.message); } }
async function salvarObsAcomp() { const jovemId = document.getElementById('selectJovemAcomp').value; const texto = document.getElementById('obsAcompTexto').value.trim(); if (!texto) return alert('Digite a observação.'); const jovem = estado.jovens.find(j => j.id === jovemId); if (!jovem) return; jovem.observacoes = jovem.observacoes || []; jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto }); try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); document.getElementById('obsAcompTexto').value = ''; carregarFichaIndividual(); } catch (err) { alert('Erro: ' + err.message); } }

function renderizarRelatorios() {
  const tbody1 = document.querySelector('#tabelaProjecao tbody');
  if (tbody1) {
    const agora = new Date();
    const HORAS_POR_QUINZENA = 8; // 4h/semana x 2 semanas = 8h por quinzena
    
    // Inicializar array com saldos individuais (saldo restante de cada jovem ativo)
    let saldos = estado.jovens
      .filter(j => j['MEDIDA'] && j['MEDIDA'] !== 'Liberação')
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
      
      // --- 1ª Quinzena ---
      // Contar jovens ativos ANTES de subtrair (estes ainda participam)
      const ativosQ1 = saldos.filter(s => s > 0).length;
      const horasQ1 = saldos.reduce((sum, s) => sum + Math.min(s, HORAS_POR_QUINZENA), 0);
      // Subtrair 8h de cada jovem que tem saldo
      saldos = saldos.map(s => Math.max(0, s - HORAS_POR_QUINZENA));
      
      const q1Inicio = new Date(dataMes.getFullYear(), dataMes.getMonth(), 1);
      const q1Fim = new Date(dataMes.getFullYear(), dataMes.getMonth(), 15);
      tbody1.innerHTML += `<tr><td>1ª Quin. ${mesNome}</td><td>${q1Inicio.toLocaleDateString('pt-BR')} - ${q1Fim.toLocaleDateString('pt-BR')}</td><td>${ativosQ1}</td><td>${horasQ1}h</td></tr>`;
      
      // --- 2ª Quinzena ---
      // Agora saldos já foram reduzidos pela Q1
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
    const aniversariantes = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação').map(j => {
      const nascStr = j['NASC.']; if (!nascStr) return null; const nasc = new Date(nascStr); if (isNaN(nasc.getTime())) return null;
      const mesNasc = nasc.getMonth(); const diaNasc = nasc.getDate();
      let mesTarget = mesNasc; let anoTarget = anoAtual; if (mesNasc < mesAtual || (mesNasc === mesAtual && diaNasc < agora.getDate())) anoTarget = anoAtual + 1;
      const diffMeses = (anoTarget - anoAtual) * 12 + (mesTarget - mesAtual); if (diffMeses < 0 || diffMeses >= 3) return null;
      return { nome: j['NOME'] || j['REFERENCIA'], nasc, mesNasc, diaNasc, anoTarget, mesTarget, idadeQueFara: anoTarget - nasc.getFullYear(), dataEvento: new Date(anoTarget, mesTarget, diaNasc) };
    }).filter(Boolean).sort((a, b) => a.dataEvento - b.dataEvento);
    tbody2.innerHTML = aniversariantes.length > 0 ? aniversariantes.map(a => `<tr><td>${a.nome}</td><td>${a.nasc.toLocaleDateString('pt-BR')}</td><td>${a.diaNasc}/${String(a.mesTarget + 1).padStart(2, '0')}/${a.anoTarget}</td><td>${a.idadeQueFara} anos</td></tr>`).join('') : '<tr><td colspan="4" style="text-align:center; color:#6b7280;">Nenhum aniversariante nos próximos 3 meses.</td></tr>';
  }
}

function renderizarAcompanhamento() {
  const agora = new Date(); const tabela7 = document.getElementById('tabela7dias'); const tabela14 = document.getElementById('tabela14dias');
  const semComparecimento = estado.jovens.filter(j => { if (j['MEDIDA'] === 'Liberação') return false; const hist = j.historicoFrequencia || []; if (hist.length === 0) return true; const ultimo = new Date(Math.max(...hist.map(h => new Date(h.data)))); return Math.floor((agora - ultimo) / (1000 * 60 * 60 * 24)) >= 7; });
  const sem7 = semComparecimento.filter(j => { const hist = j.historicoFrequencia || []; if (hist.length === 0) return true; return Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) < 14; });
  const sem14 = semComparecimento.filter(j => { const hist = j.historicoFrequencia || []; if (hist.length === 0) return true; return Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) >= 14; });
  if (tabela7) tabela7.innerHTML = sem7.map(j => { const hist = j.historicoFrequencia || []; const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca'; const dias = hist.length > 0 ? Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) : '?'; return `<tr><td>${j['NOME'] || '-'}</td><td>${ultimo}</td><td>${dias}</td><td><button onclick="abrirFicha('${j.id}')" class="btn-acao btn-ficha">📋</button></td></tr>`; }).join('');
  if (tabela14) tabela14.innerHTML = sem14.map(j => { const hist = j.historicoFrequencia || []; const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca'; const dias = hist.length > 0 ? Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) : '?'; return `<tr><td>${j['NOME'] || '-'}</td><td>${ultimo}</td><td>${dias}</td><td><button onclick="abrirFicha('${j.id}')" class="btn-acao btn-ficha">📋</button></td></tr>`; }).join('');
}

async function enviarMensagem() {
  const destinatario = document.getElementById('msgDestinatario').value; const assunto = document.getElementById('msgAssunto').value.trim(); const texto = document.getElementById('msgTexto').value.trim(); const fileInput = document.getElementById('msgAnexos');
  if (!destinatario) return alert('Selecione o destinatário.'); if (!assunto) return alert('Preencha o assunto.'); if (!texto) return alert('Escreva a mensagem.');
  const anexos = []; if (fileInput.files.length > 0) { for (const file of fileInput.files) { const base64 = await fileToBase64(file); anexos.push({ nome: file.name, tipo: file.type, base64 }); } }
  const msg = { id: 'msg_' + Date.now(), de: estado.usuarioAtual.id, deNome: estado.usuarioAtual.nome || estado.usuarioAtual.email, para: destinatario, assunto, texto, anexos, data: new Date().toISOString(), lida: false };
  try { await upstash('SET', `mensagem:${msg.id}`, JSON.stringify(msg)); await upstash('SADD', 'mensagens:all', msg.id); alert('Mensagem enviada com sucesso!'); document.getElementById('msgAssunto').value = ''; document.getElementById('msgTexto').value = ''; document.getElementById('msgAnexos').value = ''; renderizarMensagens(); } catch (err) { alert('Erro ao enviar: ' + err.message); }
}

async function renderizarMensagens() {
  const div = document.getElementById('listaMensagens'); const selectDest = document.getElementById('msgDestinatario'); if (!div) return;
  const meuId = estado.usuarioAtual?.id;
  if (selectDest) {
    const gestoresEAutoridades = estado.usuarios.filter(u => (u.nivel === 'gestor' || u.nivel === 'autoridade') && u.id !== meuId && u.status === 'ativo');
    selectDest.innerHTML = '<option value="">Selecione...</option>' + gestoresEAutoridades.map(u => `<option value="${u.id}">${u.nome || u.email} (${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel})</option>`).join('');
  }
  try {
    const msgIds = await upstash('SMEMBERS', 'mensagens:all'); const mensagens = [];
    for (const id of msgIds) { const raw = await upstash('GET', `mensagem:${id}`); if (raw) mensagens.push(JSON.parse(raw)); }
    const mensagensFiltradas = mensagens.filter(m => (m.de === meuId || m.para === meuId));
    const enviadas = mensagensFiltradas.filter(m => m.de === meuId); const recebidas = mensagensFiltradas.filter(m => m.para === meuId && !m.lida); const lidas = mensagensFiltradas.filter(m => m.para === meuId && m.lida);
    div.innerHTML = `<h4 style="margin-bottom:8px;">📥 Não lidas (${recebidas.length})</h4>${recebidas.length > 0 ? recebidas.map(m => criarCardMensagem(m)).join('') : '<p style="color:#6b7280;">Nenhuma mensagem não lida.</p>'}<h4 style="margin-top:16px; margin-bottom:8px;">📥 Lidas (${lidas.length})</h4>${lidas.length > 0 ? lidas.map(m => criarCardMensagem(m)).join('') : '<p style="color:#6b7280;">Nenhuma mensagem lida.</p>'}<h4 style="margin-top:16px; margin-bottom:8px;">📤 Enviadas (${enviadas.length})</h4>${enviadas.length > 0 ? enviadas.map(m => criarCardMensagem(m)).join('') : '<p style="color:#6b7280;">Nenhuma mensagem enviada.</p>'}`;
  } catch (err) { div.innerHTML = `<p style="color:#ef4444;">Erro ao carregar mensagens: ${err.message}</p>`; }
}
function criarCardMensagem(m) {
  const dataFmt = new Date(m.data).toLocaleDateString('pt-BR') + ' ' + new Date(m.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); const ehRecebida = m.para === estado.usuarioAtual?.id;
  const nomePara = estado.usuarios.find(u => u.id === m.para)?.nome || 'Desconhecido';
  return `<div class="msg-card" style="padding:12px; border-radius:8px; margin-bottom:8px; border:1px solid #e2e8f0; ${ehRecebida ? 'border-left:3px solid #3b82f6;' : 'border-left:3px solid #10b981;'}"><div style="display:flex; justify-content:space-between; align-items:start;"><div><strong>${ehRecebida ? m.deNome : 'Para: ' + nomePara}</strong><span style="font-size:0.8rem; color:#6b7280; margin-left:8px;">${dataFmt}</span></div><div>${ehRecebida && !m.lida ? `<button onclick="marcarComoLida('${m.id}')" style="background:#3b82f6; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.8rem;">Marcar lida</button>` : ''}</div></div><p style="font-weight:600; margin:6px 0;">📌 ${m.assunto}</p><p style="color:#475569; white-space:pre-wrap;">${m.texto}</p>${(m.anexos || []).length > 0 ? `<div style="margin-top:8px;"><strong>Anexos:</strong><br>${(m.anexos || []).map(a => `<a href="${a.base64}" download="${a.nome}" style="color:#3b82f6; text-decoration:none; margin-right:8px;">📎 ${a.nome}</a>`).join('')}</div>` : ''}</div>`;
}
async function marcarComoLida(id) { try { const raw = await upstash('GET', `mensagem:${id}`); if (raw) { const m = JSON.parse(raw); m.lida = true; await upstash('SET', `mensagem:${id}`, JSON.stringify(m)); renderizarMensagens(); } } catch (err) { alert('Erro: ' + err.message); } }

function imprimirFichaIndividual() {
    const jovemId = document.getElementById('selectJovemAcomp').value; if (!jovemId) return; const jovem = estado.jovens.find(j => j.id === jovemId); if (!jovem) return;
  const oficinasParticipadas = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id));
  const docs = jovem.documentos || [];
  const obs = jovem.observacoes || [];
  const hist = jovem.historicoFrequencia || [];
  const totalHoras = hist.reduce((s, h) => s + parseNum(h.horas), 0);

  // Buscar logo salva no banco
  const logoSrc = document.getElementById('logoImg')?.src || '';
  const hasLogo = logoSrc && logoSrc.length > 100;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`<!DOCTYPE html><html><head><title>Ficha - ${jovem['NOME'] || jovem['REFERENCIA']}</title><style>
    body { font-family: Arial, sans-serif; padding: 40px; color: #1e293b; font-size: 13px; }
    .print-header { display: flex; align-items: center; gap: 15px; border-bottom: 2px solid #2c3e66; padding-bottom: 12px; margin-bottom: 20px; }
    .print-header img { max-height: 60px; max-width: 120px; object-fit: contain; }
    .print-header h1 { margin: 0; font-size: 16px; color: #2c3e66; }
    .print-header .inst-name { font-size: 12px; color: #6b7280; }
    h2 { font-size: 14px; color: #2c3e66; margin-top: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; }
    .item { margin-bottom: 4px; } .item strong { color: #374151; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 6px 8px; border: 1px solid #d1d5db; text-align: left; font-size: 12px; }
    th { background: #f1f5f9; font-weight: 600; }
    .doc-list { margin-top: 8px; } .doc-item { padding: 4px 0; border-bottom: 1px solid #e5e7eb; }
    .obs-item { margin-bottom: 8px; padding: 6px; background: #f9fafb; border-left: 3px solid #2c3e66; }
    .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #6b7280; }
    @media print { body { padding: 20px; } }
  </style></head><body>
  <div class="print-header">
    ${hasLogo ? `<img src="${logoSrc}" alt="Logo">` : ''}
    <div><h1>FICHA INDIVIDUAL - ${jovem['NOME'] || jovem['REFERENCIA']}</h1>
    <span class="inst-name">Sistema de Controle de Medidas Socioeducativas</span></div>
  </div>
  <h2>Dados Pessoais</h2>
  <div class="grid">${CAMPOS.map(([key, label]) => `<div class="item"><strong>${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}<div class="item"><strong>ID Digital:</strong> ${jovem['ID_DIGITAL'] || '-'}</div></div>
  <h2>Frequência</h2>
  <p>Total de registros: ${hist.length} | Total de horas: ${totalHoras.toFixed(1)}h | Saldo: ${calcularSaldo(jovem)}h</p>
  ${hist.length > 0 ? `<table><thead><tr><th>Data/Hora</th><th>Horas</th><th>Observação</th></tr></thead><tbody>${hist.map(h => `<tr><td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</td><td>${h.horas}h</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody></table>` : '<p>Sem registros de frequência.</p>'}
  <h2>Oficinas Participadas (${oficinasParticipadas.length})</h2>
  ${oficinasParticipadas.length > 0 ? `<table><thead><tr><th>Data</th><th>Período</th><th>Conteúdo</th><th>Reverte</th></tr></thead><tbody>${oficinasParticipadas.map(o => `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.periodo}</td><td>${o.conteudo}</td><td>${o.reverte ? 'Sim' : 'Não'}</td></tr>`).join('')}</tbody></table>` : '<p>Nenhuma oficina registrada.</p>'}
  <h2>Documentos (${docs.length})</h2>
  ${docs.length > 0 ? '<div class="doc-list">' + docs.map(d => `<div class="doc-item">📄 ${d.nome} (${d.tipo}) - ${d.data ? new Date(d.data).toLocaleDateString('pt-BR') : ''}</div>`).join('') + '</div>' : '<p>Nenhum documento anexado.</p>'}
  <h2>Observações (${obs.length})</h2>
  ${obs.length > 0 ? obs.map(o => `<div class="obs-item"><strong>${o.profissional || 'Sistema'}</strong> - ${new Date(o.data).toLocaleDateString('pt-BR')}<br>${o.texto}</div>`).join('') : '<p>Nenhuma observação registrada.</p>'}
  <div class="footer"><p>Impresso em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</p><p>Sistema de Controle de Medidas Socioeducativas</p></div>
  </body></html>`);
  printWindow.document.close(); setTimeout(() => printWindow.print(), 500);
}

// ================================================================
// POLLING (sincronização automática a cada 60s)
// ================================================================
let pollingInterval = null;
function iniciarPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => { if (estado.online) carregarTodosDados(); }, 60000);
}

// ================================================================
// EVENT LISTENERS E INICIALIZAÇÃO
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Injetar HTML dinâmico que faltava
  injetarHTMLDinamico();

  // 2. Event Listeners
  // Login e Cadastro
  document.getElementById('loginBtn')?.addEventListener('click', fazerLogin);
  document.getElementById('loginSenha')?.addEventListener('keypress', e => { if (e.key === 'Enter') fazerLogin(); });

  // Botão Logo e Senha
  document.getElementById('btnAlterarLogo')?.addEventListener('click', function() {
    document.getElementById('modalAlterarLogo').style.display = 'flex';
  });
  document.getElementById('btnAlterarSenha')?.addEventListener('click', function() {
    document.getElementById('modalAlterarSenha').style.display = 'flex';
  });
  
  const cadastroLink = document.getElementById('mostrarCadastroBtn');
  if (cadastroLink) {
    cadastroLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('telaLogin').style.display = 'none';
      document.getElementById('telaCadastro').style.display = 'block';
    });
  }
  
  document.getElementById('voltarLoginBtn')?.addEventListener('click', () => {
    document.getElementById('telaCadastro').style.display = 'none';
    document.getElementById('telaLogin').style.display = 'block';
  });
  
  document.getElementById('cadastrarBtn')?.addEventListener('click', cadastrarUsuario);

  // Modais dinâmicos
  document.body.addEventListener('click', e => {
    if (e.target.id === 'fecharFicha') {
      document.getElementById('modalFicha').style.display = 'none';
    }
  });

  // Formulário Jovem
  document.getElementById('salvarBtn')?.addEventListener('click', salvarJovem);
  document.getElementById('importarExcelBtn')?.addEventListener('click', importarPlanilha);
  document.getElementById('limparFormBtn')?.addEventListener('click', limparFormulario);

  // Frequência
  document.getElementById('btnPontoDigital')?.addEventListener('click', registrarPontoDigital);
  document.getElementById('buscaFrequencia')?.addEventListener('input', carregarLista);
  document.getElementById('exportarExcelBtn')?.addEventListener('click', exportarExcel);
  document.getElementById('registroManualBtn')?.addEventListener('click', abrirRegistroManual);

  // Profissionais e Oficinas
  document.getElementById('salvarProfissionalBtn')?.addEventListener('click', salvarProfissional);
  document.getElementById('salvarOficinaBtn')?.addEventListener('click', salvarOficina);

  // Modal Observação
  document.getElementById('modalCancelar')?.addEventListener('click', () => { document.getElementById('modalObservacao').style.display = 'none'; });
  document.getElementById('modalSalvarObs')?.addEventListener('click', salvarObs);

  // Modal Registro Manual
  document.getElementById('manualCancelar')?.addEventListener('click', () => { document.getElementById('modalRegistroManual').style.display = 'none'; });
  document.getElementById('manualSalvar')?.addEventListener('click', salvarRegistroManual);

  // Usuários
  document.getElementById('userSalvarBtn')?.addEventListener('click', salvarNovoUsuario);

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    estado.usuarioAtual = null;
    document.querySelector('.app-container').style.display = 'none';
    document.getElementById('telaLogin').style.display = 'block';
    if (pollingInterval) clearInterval(pollingInterval);
  });

  // 3. Inicializar formulário base
  renderizarCamposFormulario();
});
