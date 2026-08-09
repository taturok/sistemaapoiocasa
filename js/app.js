// ============================================================
// SISTEMA DE CONTROLE DE MEDIDAS SOCIOEDUCATIVAS v3.0
// BACKEND: UPSTASH REDIS REST API
// JS COMPLETO – CORRIGIDO PARA IMPORTAÇÃO PERFEITA
// ============================================================

// ============================================================
// CONFIGURAÇÃO UPSTASH
// ============================================================
const UPSTASH_URL = 'https://enhanced-lobster-167489.upstash.io';
const UPSTASH_TOKEN = (() => {
    const parts = ['gQAAAAAAAo5B', 'AAIgcDI0NjUx', 'NzdjMzdiYzg0YTBl', 'OTFkZWZjY2Y0MGI5YjQ1YQ'];
    return parts.join('');
})();

// ============================================================
// NÍVEIS DE ACESSO
// ============================================================
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

// ============================================================
// CAMPOS DO FORMULÁRIO
// ============================================================
const CAMPOS = [
    ['REFERENCIA','REFERÊNCIA','text'],['NOME','NOME','text'],['NOME DO RESPONSÁVEL','RESPONSÁVEL','text'],
    ['REINCIDÊNCIA','REINCIDÊNCIA','text'],
    ['MEDIDA','MEDIDA','select', [['','Selecione...'],['LA','LA - Liberdade Assistida'],['PSC','PSC - Prestação de Serviço'],['Internação','Internação'],['Liberação','Liberação']]],
    ['MESES','MESES','text'],['HORAS','HORAS','number'],['PROTETIVA','PROTETIVA','text'],['NASC.','NASCIMENTO','date'],
    ['MÊS ANIVERSARIO','MÊS ANIVER.','text'],['NATURALIDADE','NATURALIDADE','text'],
    ['IDADE','IDADE','number'],['GÊNERO','GÊNERO','select',[['','Selecione...'],['M','Masculino'],['F','Feminino'],['NB','Não-binário']]],
    ['COR','COR','select',[['','Selecione...'],['Branca','Branca'],['Preta','Preta'],['Parda','Parda'],['Amarela','Amarela'],['Indígena','Indígena']]],
    ['COMPOSIÇÃO FAMILIAR','COMPOSIÇÃO FAMILIAR','text'],['RENDA','RENDA','text'],
    ['BENEFICIO','BENEFÍCIO','text'],['PAA','PAA','text'],['ENDEREÇO','ENDEREÇO','text'],
    ['BAIRRO','BAIRRO','text'],['TELEFONE','TELEFONE','text'],['CRAS','CRAS','text'],
    ['UBS','UBS','text'],['CPF','CPF','text'],['ESTUDA?','ESTUDA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
    ['SÉRIE','SÉRIE','text'],['ESCOLA','ESCOLA','text'],['TRABALHA?','TRABALHA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
    ['FUNÇÃO','FUNÇÃO','text'],['VINCULO','VÍNCULO','text'],['REDE','REDE','text'],
    ['USO DE SPA?','USO DE SPA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
    ['QUAL?','QUAL?','text'],['PREFERE NOME SOCIAL?','NOME SOCIAL?','select',[['',''],['Sim','Sim'],['Não','Não']]],
    ['QUAL NOME SOCIAL?','NOME SOCIAL','text'],
    ['HORAS_CUMPRIDAS','Horas Cumpridas','number'],
    ['SALDO','Saldo de Horas','number']
];

// ============================================================
// ESTADO GLOBAL
// ============================================================
const estado = {
    usuarios: [],
    jovens: [],
    profissionais: [],
    oficinas: [],
    planejamentos: [],
    mensagens: [],
    avaliacoes: [],
    online: false,
    usuarioAtual: null,
    graficos: {},
    exclusaoPendente: null,
    suspensaoPendente: null,
    acoesLATemporarias: [],
    selecionadosLote: new Set(),
    _editarId: null,
    _jovemDocAtual: null,
    _avaliacaoJovemId: null,
    _userParaVincular: null,
    _logoBase64: ''
};
let pollingInterval = null;

// ============================================================
// UPSTASH HELPERS
// ============================================================
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
        catch (err) { lastErr = err; if (i < retries - 1) await new Promise(r => setTimeout(r, 1200)); }
    }
    throw lastErr;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
function parseNum(val) {
    if (!val) return 0;
    const n = parseFloat(String(val).replace(',', '.'));
    return isNaN(n) ? 0 : n;
}

function calcularSaldo(jovem) {
    if (jovem['MEDIDA'] === 'LA') return 0;
    const horasTotal = parseNum(jovem['HORAS']);
    const horasFeitas = (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0);
    const ajusteManual = parseNum(jovem.ajusteSaldo) || 0;
    const saldoPlanilha = parseNum(jovem['SALDO']);
    if (saldoPlanilha > 0) return saldoPlanilha.toFixed(1);
    return Math.max(0, horasTotal - horasFeitas + ajusteManual).toFixed(1);
}

function calcularHorasCumpridas(jovem) {
    if (jovem['MEDIDA'] === 'LA') return 0;
    if (jovem['HORAS_CUMPRIDAS'] && parseNum(jovem['HORAS_CUMPRIDAS']) > 0) {
        return parseNum(jovem['HORAS_CUMPRIDAS']).toFixed(1);
    }
    return (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0).toFixed(1);
}

function parseDataBrasil(valor) {
    if (!valor) return '';
    
    // Se já é uma data válida no formato ISO
    let data = new Date(valor);
    if (!isNaN(data.getTime()) && valor.toString().includes('-')) {
        return data.toISOString().split('T')[0];
    }
    
    let strValor = String(valor).trim();
    
    // Formato: DD/MM/AAAA ou DD/MM/AA
    let match = strValor.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (match) {
        let dia = parseInt(match[1]), mes = parseInt(match[2])-1, ano = parseInt(match[3]);
        if (ano < 100) ano += 2000;
        data = new Date(ano, mes, dia);
        if (!isNaN(data.getTime())) return data.toISOString().split('T')[0];
    }
    
    // Formato: DD/MMAAAA (ex: 20/012011)
    match = strValor.match(/^(\d{1,2})[\/\-\.]?(\d{2})(\d{4})$/);
    if (match) {
        let dia = parseInt(match[1]), mes = parseInt(match[2])-1, ano = parseInt(match[3]);
        data = new Date(ano, mes, dia);
        if (!isNaN(data.getTime())) return data.toISOString().split('T')[0];
    }
    
    // Formato: AAAA-MM-DD
    match = strValor.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (match) {
        let ano = parseInt(match[1]), mes = parseInt(match[2])-1, dia = parseInt(match[3]);
        data = new Date(ano, mes, dia);
        if (!isNaN(data.getTime())) return data.toISOString().split('T')[0];
    }
    
    // Excel serial date
    if (typeof valor === 'number' && valor > 10000) {
        data = new Date((valor - 25569) * 86400 * 1000);
        if (!isNaN(data.getTime())) return data.toISOString().split('T')[0];
    }
    
    // Tentar new Date direto
    data = new Date(strValor);
    if (!isNaN(data.getTime())) return data.toISOString().split('T')[0];
    
    console.log(`⚠️ Não foi possível converter a data: "${strValor}"`);
    return '';
}

// ============================================================
// NAVEGAÇÃO
// ============================================================
function navigateTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');
    
    const titles = {
        'pageDashboard':'Dashboard','pageCadastro':'Cadastrar / Editar Jovem','pageLista':'Lista Geral',
        'pageAcompInd':'Acompanhamento Individual','pageObservacoes':'Observações','pageOficinas':'Oficinas Realizadas',
        'pagePlanejamento':'Planejamento de Oficinas','pageRelatorios':'Relatórios','pageLA':'Ações LA',
        'pageUsuarios':'Gerenciar Usuários','pagePendentes':'Solicitações Pendentes','pageMensagens':'Mensagens',
        'pageProfissionais':'Profissionais','pageConfig':'Configurações','pageDashboardJovem':'Minhas Ações'
    };
    const icons = {
        'pageDashboard':'chart-pie','pageCadastro':'user-plus','pageLista':'list-ul','pageAcompInd':'user-circle',
        'pageObservacoes':'eye','pageOficinas':'tools','pagePlanejamento':'calendar-plus','pageRelatorios':'file-alt',
        'pageLA':'handshake','pageUsuarios':'users-cog','pagePendentes':'user-clock','pageMensagens':'envelope',
        'pageProfissionais':'user-md','pageConfig':'cog','pageDashboardJovem':'user'
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl && titles[pageId]) titleEl.innerHTML = `<i class="fas fa-${icons[pageId] || 'circle'}"></i> ${titles[pageId]}`;
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (activeItem) activeItem.classList.add('active');
    
    if (pageId === 'pageObservacoes') { renderizarAcompanhamento(); listarMetasLAProximas(); }
    if (pageId === 'pageLista') { carregarLista(); }
    if (pageId === 'pageRelatorios') { renderizarRelatorios(); }
    if (pageId === 'pageAcompInd') { popularSelectAcompInd(); }
    if (pageId === 'pageOficinas') { renderizarJovensOficina(); renderizarOficinas(); }
    if (pageId === 'pagePlanejamento') { renderizarPlanejamentos(); }
    if (pageId === 'pageMensagens') { renderizarMensagens(); }
    if (pageId === 'pageUsuarios') { renderizarUsuarios(); renderizarPendentes(); }
    if (pageId === 'pageDashboardJovem') { renderizarDashboardJovem(); }
    if (pageId === 'pageLA') { renderizarAcoesLA(); }
    closeSidebar();
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('active');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
}

// ============================================================
// LOGIN E SESSÃO
// ============================================================
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
                id:'admin001',
                nome:'Administrador',
                email:'admin@teste.com',
                senha:'123',
                nivel:'desenvolvedor',
                status:'ativo'
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
        if (!user) {
            document.getElementById('loginErro').textContent = 'E-mail ou senha incorretos.';
            btn.disabled=false; btn.textContent='Entrar';
            return;
        }
        if (user.status !== 'ativo') {
            document.getElementById('loginErro').textContent = 'Cadastro pendente.';
            btn.disabled=false; btn.textContent='Entrar';
            return;
        }
        estado.usuarioAtual = user;
        estado.online = true;
        localStorage.setItem('usuarioLogado', user.email);
        localStorage.setItem('nivelUsuario', user.nivel);
        document.getElementById('telaLogin').classList.add('hidden');
        document.getElementById('appMain').style.display = 'flex';
        document.getElementById('nomeUsuarioHeader').textContent = user.nome || user.email;
        document.getElementById('nivelUsuarioHeader').textContent = NIVEIS_ACESSO[user.nivel]?.nome || user.nivel;
        mostrarAbasPorNivel(user.nivel);
        carregarLogo();
        if (user.nivel === 'jovem') {
            carregarJovemPeloCPF(user.cpf);
        } else {
            await carregarTodosDados();
            if (['gestor','tecnico','desenvolvedor'].includes(user.nivel)) {
                setTimeout(() => exibirAvisoObservacoes(), 1200);
            }
        }
        iniciarPolling();
    } catch (err) {
        document.getElementById('loginErro').textContent = 'Erro: ' + err.message;
        console.error(err);
    } finally {
        btn.disabled = false; btn.textContent = 'Entrar';
    }
}

function deslogarSistema() {
    estado.usuarioAtual = null;
    localStorage.removeItem('usuarioLogado');
    localStorage.removeItem('nivelUsuario');
    document.getElementById('appMain').style.display = 'none';
    document.getElementById('telaLogin').classList.remove('hidden');
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginSenha').value = '';
    if (pollingInterval) clearInterval(pollingInterval);
}

// ============================================================
// CARREGAR DADOS
// ============================================================
async function carregarTodosDados() {
    try {
        estado.jovens = [];
        estado.profissionais = [];
        estado.oficinas = [];
        estado.usuarios = [];
        estado.planejamentos = [];
        estado.mensagens = [];
        estado.avaliacoes = [];
        
        const queries = [
            { key: 'jovens:all', prefix: 'jovem:', arr: 'jovens' },
            { key: 'profissionais:all', prefix: 'profissional:', arr: 'profissionais' },
            { key: 'oficinas:all', prefix: 'oficina:', arr: 'oficinas' },
            { key: 'users:all', prefix: 'user:', arr: 'usuarios' },
            { key: 'planejamentos:all', prefix: 'planejamento:', arr: 'planejamentos' },
            { key: 'mensagens:all', prefix: 'mensagem:', arr: 'mensagens' },
            { key: 'avaliacoes:all', prefix: 'avaliacao:', arr: 'avaliacoes' }
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
        atualizarInterfaceCompleta();
    } catch (err) {
        console.error('Erro ao carregar dados:', err);
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
        renderizarDashboardJovem();
    } catch (err) {
        console.error(err);
    }
}

function atualizarInterfaceCompleta() {
    renderizarCamposFormulario();
    carregarLista();
    renderizarDashboard();
    renderizarProfissionais();
    renderizarOficinas();
    renderizarUsuarios();
    renderizarPendentes();
    renderizarRelatorios();
    renderizarAcompanhamento();
    popularSelectAcompInd();
    renderizarPlanejamentos();
    renderizarMensagens();
    renderizarAcoesLA();
    atualizarContadorLista(estado.jovens.length);
    listarMetasLAProximas();
    popularSelectProfissionaisAvaliacao();
    renderizarFiltrosCheckbox();
}

// ============================================================
// ABAS POR NÍVEL
// ============================================================
function mostrarAbasPorNivel(nivel) {
    let n = (nivel || '').toLowerCase().trim();
    if (['admin','administrador','desenvolvedor'].includes(n)) n = 'desenvolvedor';
    if (['oficineira'].includes(n)) n = 'oficineiro';
    if (['técnico'].includes(n)) n = 'tecnico';
    if (['gestora'].includes(n)) n = 'gestor';
    if (['autoridade jurídica','autoridade juridica'].includes(n)) n = 'autoridade';
    
    const permissoes = {
        'desenvolvedor': ['pageDashboard','pageCadastro','pageLista','pageAcompInd','pageObservacoes','pageOficinas','pagePlanejamento','pageRelatorios','pageLA','pageUsuarios','pagePendentes','pageMensagens','pageProfissionais','pageConfig'],
        'admin': ['pageDashboard','pageCadastro','pageLista','pageAcompInd','pageObservacoes','pageOficinas','pagePlanejamento','pageRelatorios','pageLA','pageUsuarios','pagePendentes','pageMensagens','pageProfissionais','pageConfig'],
        'gestor': ['pageDashboard','pageCadastro','pageLista','pageAcompInd','pageObservacoes','pageOficinas','pagePlanejamento','pageRelatorios','pageLA','pageUsuarios','pagePendentes','pageMensagens','pageProfissionais','pageConfig'],
        'tecnico': ['pageDashboard','pageCadastro','pageLista','pageAcompInd','pageObservacoes','pageOficinas','pageRelatorios','pageLA','pageMensagens','pageProfissionais'],
        'oficineiro': ['pageDashboard','pageOficinas','pagePlanejamento','pageRelatorios'],
        'autoridade': ['pageDashboard','pageCadastro','pageLista','pageAcompInd','pageObservacoes','pageRelatorios','pageMensagens','pageLA'],
        'jovem': ['pageDashboardJovem']
    };
    const paginas = permissoes[n] || ['pageDashboard'];
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.style.display = paginas.includes(item.dataset.page) ? '' : 'none';
    });
    navigateTo(paginas[0]);
}

// ============================================================
// DASHBOARD
// ============================================================
function renderizarDashboard() {
    const cards = document.getElementById('cardsDashboard');
    if (!cards) return;
    if (estado.jovens.length === 0) {
        cards.innerHTML = `
            <div class="card" style="grid-column:1/-1; text-align:center; padding:2rem;">
                <div style="font-size:3rem; color:#94a3b8;"><i class="fas fa-users"></i></div>
                <p style="color:#6b7280;">Nenhum jovem cadastrado</p>
            </div>
        `;
        return;
    }
    const total = estado.jovens.length;
    const regular = estado.jovens.filter(j => j.status === 'REGULAR').length;
    const irregular = estado.jovens.filter(j => j.status === 'IRREGULAR').length;
    const descumprimento = estado.jovens.filter(j => j.status === 'EM DESCUMPRIMENTO').length;
    const suspenso = estado.jovens.filter(j => j.status === 'SUSPENSO').length;
    const medidaFinalizada = estado.jovens.filter(j => j.status === 'MEDIDA FINALIZADA').length;
    const liberado = estado.jovens.filter(j => j.status === 'LIBERADO' || j['MEDIDA'] === 'Liberação').length;
    
    cards.innerHTML = `
        <div class="card card-info"><div class="card-icon"><i class="fas fa-users"></i></div><div class="card-value">${total}</div><div class="card-label">Total</div></div>
        <div class="card card-success"><div class="card-icon"><i class="fas fa-check-circle"></i></div><div class="card-value">${regular}</div><div class="card-label">REGULAR</div></div>
        <div class="card card-warning"><div class="card-icon"><i class="fas fa-exclamation-circle"></i></div><div class="card-value">${irregular}</div><div class="card-label">IRREGULAR</div></div>
        <div class="card card-danger"><div class="card-icon"><i class="fas fa-exclamation-triangle"></i></div><div class="card-value">${descumprimento}</div><div class="card-label">DESCUMPRIMENTO</div></div>
        <div class="card" style="border-left:4px solid #8b5cf6;"><div class="card-icon"><i class="fas fa-pause-circle"></i></div><div class="card-value">${suspenso}</div><div class="card-label">SUSPENSO</div></div>
        <div class="card" style="border-left:4px solid #1A2A4A;"><div class="card-icon"><i class="fas fa-flag-checkered"></i></div><div class="card-value">${medidaFinalizada}</div><div class="card-label">FINALIZADA</div></div>
        <div class="card" style="border-left:4px solid #94a3b8;"><div class="card-icon"><i class="fas fa-door-open"></i></div><div class="card-value">${liberado}</div><div class="card-label">LIBERADO</div></div>
    `;
    renderizarGraficos();
}

function renderizarGraficos() {
    try {
        Object.values(estado.graficos).forEach(c => { if (c && c.destroy) c.destroy(); });
        estado.graficos = {};
        
        const regular = estado.jovens.filter(j => j.status === 'REGULAR');
        const medidas = {};
        regular.forEach(j => { const m = j['MEDIDA'] || 'Não informada'; medidas[m] = (medidas[m]||0)+1; });
        const ctx1 = document.getElementById('graficoMedidas')?.getContext('2d');
        if (ctx1 && Object.keys(medidas).length > 0) {
            estado.graficos.medidas = new Chart(ctx1, { type:'bar', data:{ labels:Object.keys(medidas), datasets:[{ label:'Jovens', data:Object.values(medidas), backgroundColor:'#2563eb' }] }, options:{ responsive:true, maintainAspectRatio:true } });
        }
        
        const generos = { M:0, F:0, NB:0 };
        estado.jovens.forEach(j => { const g = j['GÊNERO'] || 'M'; if (generos[g] !== undefined) generos[g]++; });
        const ctx2 = document.getElementById('graficoGenero')?.getContext('2d');
        if (ctx2 && (generos.M>0 || generos.F>0 || generos.NB>0)) {
            estado.graficos.genero = new Chart(ctx2, { type:'pie', data:{ labels:['Masculino','Feminino','Não-binário'], datasets:[{ data:[generos.M,generos.F,generos.NB], backgroundColor:['#2563eb','#10b981','#f59e0b'] }] }, options:{ responsive:true, maintainAspectRatio:true } });
        }
        
        const idades = { '12-15':0, '16-18':0, '19+':0 };
        estado.jovens.forEach(j => { const idade = parseInt(j['IDADE']) || 0; if (idade>=12 && idade<=15) idades['12-15']++; else if (idade>=16 && idade<=18) idades['16-18']++; else if (idade>=19) idades['19+']++; });
        const ctx3 = document.getElementById('graficoIdade')?.getContext('2d');
        if (ctx3 && (idades['12-15']>0 || idades['16-18']>0 || idades['19+']>0)) {
            estado.graficos.idade = new Chart(ctx3, { type:'bar', data:{ labels:['12 a 15','16 a 18','19+'], datasets:[{ label:'Jovens', data:[idades['12-15'],idades['16-18'],idades['19+']], backgroundColor:'#8b5cf6' }] }, options:{ responsive:true, maintainAspectRatio:true } });
        }
        
        const reverte = estado.oficinas.filter(o => o.reverte).length;
        const naoReverte = estado.oficinas.length - reverte;
        const ctx5 = document.getElementById('graficoReverte')?.getContext('2d');
        if (ctx5 && (reverte>0 || naoReverte>0)) {
            estado.graficos.reverte = new Chart(ctx5, { type:'pie', data:{ labels:['Reverte','Não reverte'], datasets:[{ data:[reverte,naoReverte], backgroundColor:['#10b981','#6c757d'] }] }, options:{ responsive:true, maintainAspectRatio:true } });
        }
    } catch(e) { console.error('Erro gráficos:', e); }
}

// ============================================================
// FORMULÁRIO DE CADASTRO
// ============================================================
function renderizarCamposFormulario() {
    const grid = document.getElementById('camposGrid');
    if (!grid || grid.innerHTML !== "") return;
    
    grid.innerHTML = CAMPOS.map(([key, label, type, options]) => {
        if (type === 'select' && options) {
            return `<div class="campo"><label>${label}</label><select id="campo_${key}" onchange="if(this.id==='campo_MEDIDA') toggleAcoesLA()">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;
        }
        return `<div class="campo"><label>${label}</label><input type="${type}" id="campo_${key}"></div>`;
    }).join('');
    
    const containerAcoes = document.getElementById('containerAcoesLA');
    if (containerAcoes) containerAcoes.style.display = 'none';
}

window.toggleAcoesLA = function() {
    const medida = document.getElementById('campo_MEDIDA')?.value;
    const container = document.getElementById('containerAcoesLA');
    if (container) container.style.display = medida === 'LA' ? 'block' : 'none';
};

window.adicionarAcaoLAForm = function() {
    const input = document.getElementById('novaAcaoLAInput');
    const prazoInput = document.getElementById('novaAcaoPrazoInput');
    if (input.value.trim() === '') return alert('Descreva a ação.');
    if (!prazoInput.value) return alert('Defina a data de vencimento.');
    estado.acoesLATemporarias.push({
        id: Date.now(),
        texto: input.value.trim(),
        realizado: false,
        data: new Date().toISOString(),
        prazo: prazoInput.value
    });
    input.value = ''; prazoInput.value = '';
    atualizarListaAcoesLAForm();
};

window.atualizarListaAcoesLAForm = function() {
    const ul = document.getElementById('listaAcoesLAForm');
    if (!ul) return;
    ul.innerHTML = estado.acoesLATemporarias.map(a => `
        <li style="margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding:4px 0;">
            <span>${a.texto} <span style="font-size:0.7rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span></span>
            <span style="color:red; cursor:pointer; font-weight:bold; margin-left:10px;" onclick="removerAcaoLAForm(${a.id})">✕</span>
        </li>
    `).join('');
};

window.removerAcaoLAForm = function(id) {
    estado.acoesLATemporarias = estado.acoesLATemporarias.filter(a => a.id !== id);
    atualizarListaAcoesLAForm();
};

async function salvarJovem() {
    const nome = document.getElementById('campo_NOME')?.value.trim();
    if (!nome) return alert('Preencha pelo menos o nome.');
    
    const jovemExistente = estado.jovens.find(j => (j['NOME'] || '').toUpperCase() === nome.toUpperCase() && j.id !== estado._editarId);
    const jovem = {
        id: estado._editarId || (jovemExistente ? jovemExistente.id : 'j_' + Date.now()),
        status: estado._editarId ? estado.jovens.find(j => j.id === estado._editarId)?.status || 'REGULAR' : 'REGULAR'
    };
    
    CAMPOS.forEach(([key]) => {
        const el = document.getElementById(`campo_${key}`);
        if (el) jovem[key] = el.value.trim();
    });
    jovem['ID_DIGITAL'] = document.getElementById('campo_ID_DIGITAL')?.value.trim() || '';
    
    if (!jovem.historicoFrequencia) jovem.historicoFrequencia = [];
    if (!jovem.observacoes) jovem.observacoes = [];
    if (!jovem.documentos) jovem.documentos = [];
    if (!jovem.avaliacoes) jovem.avaliacoes = [];
    if (jovem['MEDIDA'] === 'LA') {
        jovem.acoesLA = [...estado.acoesLATemporarias];
    }
    
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        if (!estado._editarId && !jovemExistente) await upstash('SADD', 'jovens:all', jovem.id);
        estado.jovens = estado.jovens.filter(j => j.id !== jovem.id);
        estado.jovens.push(jovem);
        atualizarInterfaceCompleta();
        limparFormulario();
        alert('Jovem salvo com sucesso!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
}

function limparFormulario() {
    CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) el.value = ''; });
    if (document.getElementById('campo_ID_DIGITAL')) document.getElementById('campo_ID_DIGITAL').value = '';
    estado.acoesLATemporarias = []; atualizarListaAcoesLAForm(); toggleAcoesLA(); estado._editarId = null;
}

// ============================================================
// LISTA GERAL
// ============================================================
function renderizarFiltrosCheckbox() {
    const medidasContainer = document.getElementById('filtroMedida');
    if (medidasContainer) {
        const medidas = ['LA','PSC','Internação','Liberação'];
        medidasContainer.innerHTML = medidas.map(m => `<label style="margin-right:10px; font-weight:400; font-size:0.75rem;"><input type="checkbox" value="${m}" onchange="carregarLista()"> ${m}</label>`).join('');
    }
    const statusContainer = document.getElementById('filtroStatus');
    if (statusContainer) {
        const status = ['REGULAR','IRREGULAR','EM DESCUMPRIMENTO','SUSPENSO','MEDIDA FINALIZADA','LIBERADO'];
        statusContainer.innerHTML = status.map(s => `<label style="margin-right:10px; font-weight:400; font-size:0.75rem;"><input type="checkbox" value="${s}" onchange="carregarLista()"> ${s}</label>`).join('');
    }
    const generoContainer = document.getElementById('filtroGenero');
    if (generoContainer) {
        const generos = ['M','F','NB']; const labels = {'M':'Masculino','F':'Feminino','NB':'Não-binário'};
        generoContainer.innerHTML = generos.map(g => `<label style="margin-right:10px; font-weight:400; font-size:0.75rem;"><input type="checkbox" value="${g}" onchange="carregarLista()"> ${labels[g]||g}</label>`).join('');
    }
    const idadeContainer = document.getElementById('filtroIdade');
    if (idadeContainer) {
        const idades = ['12-15','16-18','19+'];
        idadeContainer.innerHTML = idades.map(i => `<label style="margin-right:10px; font-weight:400; font-size:0.75rem;"><input type="checkbox" value="${i}" onchange="carregarLista()"> ${i}</label>`).join('');
    }
}

function getFiltrosSelecionados(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function carregarLista() {
    const tbody = document.getElementById('listaCorpo');
    if (!tbody) return;
    if (estado.jovens.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:2rem; color:#6b7280;">Nenhum jovem cadastrado.</td></tr>`;
        return;
    }
    
    const fNome = (document.getElementById('filtroNome')?.value || '').toLowerCase();
    const fMedida = getFiltrosSelecionados('filtroMedida');
    const fStatus = getFiltrosSelecionados('filtroStatus');
    const fSaldo = document.getElementById('filtroSaldo')?.value;
    const fGenero = getFiltrosSelecionados('filtroGenero');
    const fIdade = getFiltrosSelecionados('filtroIdade');
    
    let lista = estado.jovens.filter(j => {
        if (fNome && !(j['NOME'] || '').toLowerCase().includes(fNome) && !(j['ID_DIGITAL'] || '').includes(fNome)) return false;
        if (fMedida.length > 0 && !fMedida.includes(j['MEDIDA'])) return false;
        if (fStatus.length > 0 && !fStatus.includes(j.status)) return false;
        if (fSaldo === 'critico' && parseFloat(calcularSaldo(j)) <= 0 && j['MEDIDA'] !== 'LA') return false;
        if (fSaldo === 'zerado' && parseFloat(calcularSaldo(j)) > 0 && j['MEDIDA'] !== 'LA') return false;
        if (fGenero.length > 0 && !fGenero.includes(j['GÊNERO'])) return false;
        if (fIdade.length > 0) {
            const idade = parseInt(j['IDADE']) || 0;
            let idadeMatch = false;
            for (const range of fIdade) {
                if (range === '12-15' && idade >= 12 && idade <= 15) idadeMatch = true;
                if (range === '16-18' && idade >= 16 && idade <= 18) idadeMatch = true;
                if (range === '19+' && idade >= 19) idadeMatch = true;
            }
            if (!idadeMatch) return false;
        }
        return true;
    }).sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'));
    
    atualizarContadorLista(lista.length);
    const podeAlterarStatus = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel);
    
    tbody.innerHTML = lista.map(j => {
        const hist = j.historicoFrequencia || [];
        const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';
        
        let bgStatus = j.status === 'SUSPENSO' ? 'background:#fce7f3; color:#be185d;' :
            j.status === 'EM DESCUMPRIMENTO' ? 'background:#fee2e2; color:#991b1b;' :
            j.status === 'IRREGULAR' ? 'background:#fef3c7; color:#92400e;' :
            j.status === 'MEDIDA FINALIZADA' ? 'background:#d1fae5; color:#065f46;' :
            j.status === 'REGULAR' ? 'background:#dbeafe; color:#1e40af;' :
            j.status === 'LIBERADO' ? 'background:#e5e7eb; color:#374151;' :
            'background:#f1f5f9; color:#475569;';
        
        const horasAtribuidas = j['HORAS'] || 0;
        const horasCumpridas = calcularHorasCumpridas(j);
        const saldo = calcularSaldo(j);
        
        const hoje = new Date();
        const hojeStr = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
        let temEntradaAberta = false;
        const podeRegistrarPonto = j['MEDIDA'] !== 'Liberação' && j.status !== 'SUSPENSO' && j.status !== 'MEDIDA FINALIZADA';
        
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
        
        let botoesStatus = '';
        if (podeAlterarStatus) {
            const opcoes = ['REGULAR','IRREGULAR','EM DESCUMPRIMENTO','SUSPENSO','MEDIDA FINALIZADA','LIBERADO'];
            botoesStatus = `<select onchange="alterarStatusManual('${j.id}', this.value)" style="padding:2px 6px; font-size:0.7rem; border:1px solid #d1d9e6; border-radius:4px; background:white;"><option value="">Status</option>${opcoes.map(s => `<option value="${s}" ${j.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
        }
        
        let motivoStatus = '';
        if (j.status === 'SUSPENSO' && j.motivoSuspensao) {
            motivoStatus = `<span title="${j.motivoSuspensao}" style="cursor:help; font-size:0.7rem; color:#be185d;">${j.motivoSuspensao.substring(0,20)}${j.motivoSuspensao.length>20?'...':''}</span>`;
        }
        
        let botaoPonto = '';
        if (podeRegistrarPonto) {
            botaoPonto = `<button onclick="registrarPontoNaLinha('${j.id}')" class="btn-sm ${temEntradaAberta ? 'btn-sm-warning' : 'btn-sm-success'}">${temEntradaAberta ? '🚪 Saída' : '🚪 Entrada'}</button>`;
        }
        
        const isSelecionado = estado.selecionadosLote.has(j.id);
        
        const horasAtribuidasInput = `<input type="number" id="horas_atribuidas_${j.id}" value="${horasAtribuidas}" min="0" step="1" style="width:60px; padding:2px 4px; border:1px solid #d1d9e6; border-radius:4px; text-align:center;" onchange="atualizarHoras('${j.id}', 'HORAS', this.value)">`;
        const horasCumpridasInput = `<input type="number" id="horas_cumpridas_${j.id}" value="${horasCumpridas}" min="0" step="0.5" style="width:60px; padding:2px 4px; border:1px solid #d1d9e6; border-radius:4px; text-align:center;" onchange="atualizarHoras('${j.id}', 'HORAS_CUMPRIDAS', this.value)">`;
        const saldoInput = `<input type="number" id="saldo_${j.id}" value="${saldo}" min="0" step="0.5" style="width:60px; padding:2px 4px; border:1px solid #d1d9e6; border-radius:4px; text-align:center;" onchange="atualizarHoras('${j.id}', 'SALDO', this.value)">`;
        
        return `<tr>
            <td><input type="checkbox" data-id="${j.id}" ${isSelecionado ? 'checked' : ''} onchange="toggleSelecionarJovem('${j.id}')"></td>
            <td>${j['NOME'] || j['REFERENCIA'] || '-'}</td>
            <td>${j['ID_DIGITAL'] || '-'}</td>
            <td>${j['IDADE'] || '-'}</td>
            <td>${j['MEDIDA'] || '-'}</td>
            <td>${horasAtribuidasInput}</td>
            <td>${horasCumpridasInput}</td>
            <td>${saldoInput}</td>
            <td><span style="font-weight:600; padding:4px 12px; border-radius:20px; ${bgStatus}">${j.status || 'REGULAR'}</span></td>
            <td>${motivoStatus}</td>
            <td>${ultimo}</td>
            <td style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                ${botaoPonto}
                <button onclick="editarJovem('${j.id}')" class="btn-sm btn-sm-primary"><i class="fas fa-edit"></i></button>
                <button onclick="abrirFichaModal('${j.id}')" class="btn-sm btn-sm-info"><i class="fas fa-file-alt"></i></button>
                ${botoesStatus}
                <button onclick="abrirModalExclusao('jovem', '${j.id}', '${j['NOME']}')" class="btn-sm btn-sm-danger"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
    
    document.getElementById('selecionarTodos').checked = false;
    atualizarBarraSelecao();
}

function atualizarContadorLista(total) {
    let contadorContainer = document.getElementById('contadorContainer');
    if (!contadorContainer) {
        const tabelaWrapper = document.querySelector('#pageLista .table-wrap');
        if (tabelaWrapper) { contadorContainer = document.createElement('div'); contadorContainer.id = 'contadorContainer'; tabelaWrapper.appendChild(contadorContainer); }
    }
    if (contadorContainer) {
        contadorContainer.innerHTML = `
            <div style="padding:10px 15px; font-weight:600; color:#1e2a4a; background:#f1f5f9; border-radius:0 0 12px 12px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <span>👥 Total: <strong style="color:#2c3e66;">${total}</strong></span>
                <span style="font-size:0.8rem; color:#6b7280;">${total === 1 ? '1 jovem' : total + ' jovens'}</span>
            </div>
        `;
    }
}

window.atualizarHoras = async function(jovemId, campo, valor) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    const camposPermitidos = ['HORAS','HORAS_CUMPRIDAS','SALDO'];
    if (!camposPermitidos.includes(campo)) return alert('Campo não permitido.');
    const novoValor = parseFloat(valor);
    if (isNaN(novoValor) || novoValor < 0) {
        alert('Valor inválido.');
        const campoId = campo === 'HORAS' ? 'horas_atribuidas' : campo === 'HORAS_CUMPRIDAS' ? 'horas_cumpridas' : 'saldo';
        const input = document.getElementById(`${campoId}_${jovemId}`);
        if (input) input.value = jovem[campo] || 0;
        return;
    }
    jovem[campo] = novoValor;
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        const campoId = campo === 'HORAS' ? 'horas_atribuidas' : campo === 'HORAS_CUMPRIDAS' ? 'horas_cumpridas' : 'saldo';
        const input = document.getElementById(`${campoId}_${jovemId}`);
        if (input) { input.style.borderColor = '#10b981'; input.style.background = '#f0fdf4'; setTimeout(() => { input.style.borderColor = ''; input.style.background = ''; }, 1500); }
        if (campo === 'HORAS' || campo === 'HORAS_CUMPRIDAS') {
            const horasAtribuidas = parseFloat(jovem['HORAS'] || 0);
            const horasCumpridas = parseFloat(jovem['HORAS_CUMPRIDAS'] || 0);
            const novoSaldo = Math.max(0, horasAtribuidas - horasCumpridas);
            if (jovem['SALDO'] !== novoSaldo) {
                jovem['SALDO'] = novoSaldo;
                await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
                const saldoInput = document.getElementById(`saldo_${jovemId}`);
                if (saldoInput) { saldoInput.value = novoSaldo; saldoInput.style.borderColor = '#f59e0b'; saldoInput.style.background = '#fffbeb'; setTimeout(() => { saldoInput.style.borderColor = ''; saldoInput.style.background = ''; }, 1500); }
            }
        }
        carregarFichaIndividual();
    } catch (err) { alert('Erro: ' + err.message); }
};

window.editarJovem = function(id) {
    const j = estado.jovens.find(x => x.id === id);
    if (!j) return alert('Jovem não encontrado.');
    estado._editarId = id;
    CAMPOS.forEach(([key]) => { const el = document.getElementById(`campo_${key}`); if (el) el.value = j[key] || ''; });
    const digitalEl = document.getElementById('campo_ID_DIGITAL'); if (digitalEl) digitalEl.value = j['ID_DIGITAL'] || '';
    estado.acoesLATemporarias = j.acoesLA || [];
    toggleAcoesLA(); atualizarListaAcoesLAForm();
    navigateTo('pageCadastro');
};

window.alterarStatusManual = async function(jovemId, novoStatus) {
    if (!NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel)) return alert('❌ Sem permissão.');
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    const statusPermitidos = ['REGULAR','IRREGULAR','EM DESCUMPRIMENTO','SUSPENSO','MEDIDA FINALIZADA','LIBERADO'];
    if (!statusPermitidos.includes(novoStatus)) return alert('Status inválido.');
    if (!confirm(`Alterar status de ${jovem['NOME']} para "${novoStatus}"?`)) return;
    const statusAnterior = jovem.status;
    jovem.status = novoStatus;
    if (novoStatus === 'SUSPENSO') {
        const motivo = prompt('Digite o motivo da suspensão:');
        if (!motivo) return alert('Motivo obrigatório.');
        jovem.motivoSuspensao = motivo; jovem.dataSuspensao = new Date().toISOString(); jovem.suspensoPor = estado.usuarioAtual?.nome || 'Sistema';
    } else { jovem.motivoSuspensao = ''; jovem.dataSuspensao = ''; }
    if (!jovem.observacoes) jovem.observacoes = [];
    jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto: `📌 Status alterado de "${statusAnterior}" para "${novoStatus}"${jovem.motivoSuspensao ? ' - Motivo: ' + jovem.motivoSuspensao : ''}` });
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); await carregarTodosDados(); alert('✅ Status alterado!'); } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// SELEÇÃO EM LOTE
// ============================================================
function toggleSelecionarTodos() {
    const checkboxes = document.querySelectorAll('#listaCorpo input[type="checkbox"]');
    const selecionarTodos = document.getElementById('selecionarTodos');
    checkboxes.forEach(cb => {
        cb.checked = selecionarTodos.checked;
        if (selecionarTodos.checked) estado.selecionadosLote.add(cb.dataset.id);
        else estado.selecionadosLote.delete(cb.dataset.id);
    });
    atualizarBarraSelecao();
}

function toggleSelecionarJovem(id) {
    const cb = document.querySelector(`#listaCorpo input[data-id="${id}"]`);
    if (!cb) return;
    if (cb.checked) estado.selecionadosLote.add(id);
    else estado.selecionadosLote.delete(id);
    atualizarBarraSelecao();
}

function atualizarBarraSelecao() {
    const barra = document.getElementById('barraSelecaoLote');
    const contador = document.getElementById('contadorSelecionados');
    const btnAcoes = document.getElementById('btnAcoesLote');
    const total = estado.selecionadosLote.size;
    if (total > 0) { barra.style.display = 'flex'; btnAcoes.style.display = 'inline-flex'; contador.textContent = total; }
    else { barra.style.display = 'none'; btnAcoes.style.display = 'none'; }
}

function desmarcarTodos() {
    estado.selecionadosLote.clear();
    document.querySelectorAll('#listaCorpo input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('selecionarTodos').checked = false;
    atualizarBarraSelecao();
}

function abrirModalAcoesLote() {
    if (estado.selecionadosLote.size === 0) return alert('Selecione pelo menos um jovem.');
    document.getElementById('loteContadorSelecionados').textContent = estado.selecionadosLote.size;
    document.getElementById('loteAcaoSelect').value = '';
    document.getElementById('loteOpcoesStatus').style.display = 'none';
    document.getElementById('loteMotivoSuspensao').style.display = 'none';
    document.getElementById('modalAcoesLote').style.display = 'flex';
}

function fecharModalAcoesLote() { document.getElementById('modalAcoesLote').style.display = 'none'; }

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('loteAcaoSelect')?.addEventListener('change', function() {
        document.getElementById('loteOpcoesStatus').style.display = this.value === 'alterar_status' ? 'block' : 'none';
    });
    document.getElementById('loteNovoStatus')?.addEventListener('change', function() {
        document.getElementById('loteMotivoSuspensao').style.display = this.value === 'SUSPENSO' ? 'block' : 'none';
    });
});

async function executarAcaoLote() {
    const acao = document.getElementById('loteAcaoSelect').value;
    if (!acao) return alert('Selecione uma ação.');
    const ids = Array.from(estado.selecionadosLote);
    const jovens = estado.jovens.filter(j => ids.includes(j.id));
    
    if (acao === 'excluir') {
        if (!confirm(`Excluir PERMANENTEMENTE ${jovens.length} jovens?`)) return;
        try {
            for (const j of jovens) { await upstash('DEL', `jovem:${j.id}`); await upstash('SREM', 'jovens:all', j.id); }
            estado.jovens = estado.jovens.filter(j => !ids.includes(j.id));
            desmarcarTodos(); fecharModalAcoesLote(); await carregarTodosDados();
            alert(`✅ ${jovens.length} jovens excluídos!`);
        } catch (err) { alert('Erro: ' + err.message); }
        return;
    }
    
    if (acao === 'alterar_status') {
        const novoStatus = document.getElementById('loteNovoStatus').value;
        if (!novoStatus) return alert('Selecione o novo status.');
        let motivo = '';
        if (novoStatus === 'SUSPENSO') { motivo = document.getElementById('loteMotivoInput').value.trim(); if (!motivo) return alert('Informe o motivo.'); }
        if (!confirm(`Alterar status de ${jovens.length} jovens para "${novoStatus}"?`)) return;
        try {
            for (const j of jovens) {
                j.status = novoStatus;
                if (novoStatus === 'SUSPENSO') { j.motivoSuspensao = motivo; j.dataSuspensao = new Date().toISOString(); j.suspensoPor = estado.usuarioAtual?.nome || 'Sistema'; }
                else { j.motivoSuspensao = ''; j.dataSuspensao = ''; }
                if (!j.observacoes) j.observacoes = [];
                j.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto: `📌 Status alterado em lote para "${novoStatus}"${motivo ? ' - Motivo: ' + motivo : ''}` });
                await upstash('SET', `jovem:${j.id}`, JSON.stringify(j));
            }
            desmarcarTodos(); fecharModalAcoesLote(); await carregarTodosDados();
            alert(`✅ Status de ${jovens.length} jovens alterado para "${novoStatus}"!`);
        } catch (err) { alert('Erro: ' + err.message); }
        return;
    }
    alert('Ação não reconhecida.');
}

// ============================================================
// MÊS ANIVERSÁRIO
// ============================================================
window.atualizarMesAniversario = function() {
    const nascInput = document.getElementById('campo_NASC.');
    const mesInput = document.getElementById('campo_MÊS ANIVERSARIO');
    if (!nascInput || !mesInput) return alert('Campos não encontrados.');
    const nascValue = nascInput.value;
    if (!nascValue) return alert('Preencha a data de nascimento primeiro.');
    const data = new Date(nascValue);
    if (isNaN(data.getTime())) return alert('Data inválida.');
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    mesInput.value = meses[data.getMonth()];
    mesInput.style.borderColor = '#10b981'; mesInput.style.background = '#f0fdf4';
    setTimeout(() => { mesInput.style.borderColor = ''; mesInput.style.background = ''; }, 2000);
};

window.atualizarTodosMesesAniversario = async function() {
    if (!confirm('Atualizar "MÊS ANIVERSARIO" para TODOS os jovens?')) return;
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    let atualizados = 0, ignorados = 0, erros = 0;
    for (const jovem of estado.jovens) {
        const nascStr = jovem['NASC.'];
        if (!nascStr) { ignorados++; continue; }
        try {
            const data = new Date(nascStr);
            if (isNaN(data.getTime())) { ignorados++; continue; }
            const mesNome = meses[data.getMonth()];
            if (jovem['MÊS ANIVERSARIO'] !== mesNome) {
                jovem['MÊS ANIVERSARIO'] = mesNome;
                await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
                atualizados++;
            }
        } catch (err) { erros++; console.error(err); }
    }
    await carregarTodosDados();
    alert(`✅ ${atualizados} atualizados! ⚠️ ${ignorados} ignorados (sem data) ❌ ${erros} erros`);
};

// ============================================================
// FICHA MODAL
// ============================================================
window.abrirFichaModal = function(jovemId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    document.getElementById('fichaTitulo').textContent = `📋 Ficha de ${jovem['NOME'] || jovem['REFERENCIA'] || 'Jovem'}`;
    
    let html = `<div style="margin-bottom:1rem;"><h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:6px;">📋 Dados Pessoais</h3><div class="ficha-grid" style="margin-top:8px;">`;
    CAMPOS.forEach(([key, label]) => {
        const valor = jovem[key] || '-';
        html += `<div class="ficha-campo"><strong>${label}</strong><span>${valor}</span></div>`;
    });
    html += `<div class="ficha-campo"><strong>STATUS</strong><span style="font-weight:600; padding:4px 12px; border-radius:20px; background:${jovem.status === 'REGULAR' ? '#dbeafe' : jovem.status === 'IRREGULAR' ? '#fef3c7' : jovem.status === 'EM DESCUMPRIMENTO' ? '#fee2e2' : jovem.status === 'SUSPENSO' ? '#fce7f3' : jovem.status === 'MEDIDA FINALIZADA' ? '#d1fae5' : '#e5e7eb'}; color:${jovem.status === 'REGULAR' ? '#1e40af' : jovem.status === 'IRREGULAR' ? '#92400e' : jovem.status === 'EM DESCUMPRIMENTO' ? '#991b1b' : jovem.status === 'SUSPENSO' ? '#be185d' : jovem.status === 'MEDIDA FINALIZADA' ? '#065f46' : '#374151'};">${jovem.status || 'REGULAR'}</span></div>`;
    html += `<div class="ficha-campo"><strong>Horas Atribuídas</strong><span>${jovem['HORAS'] || 0}h</span></div>`;
    html += `<div class="ficha-campo"><strong>Horas Cumpridas</strong><span>${calcularHorasCumpridas(jovem)}h</span></div>`;
    html += `<div class="ficha-campo"><strong>Saldo</strong><span>${calcularSaldo(jovem)}h</span></div>`;
    
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        const realizadas = acoes.filter(a => a.realizado).length;
        html += `<div class="ficha-campo" style="grid-column:1/-1;"><strong>Ações LA (${realizadas}/${acoes.length})</strong>`;
        if (acoes.length > 0) {
            html += acoes.map(a => `
                <div style="padding:4px 8px; margin:4px 0; background:${a.realizado ? '#d1fae5' : '#fffbeb'}; border-radius:4px; border-left:3px solid ${a.realizado ? '#10b981' : '#f59e0b'}; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
                    <span style="font-size:0.85rem; ${a.realizado ? 'text-decoration:line-through; color:#065f46;' : ''}">${a.texto}</span>
                    <span style="font-size:0.7rem; color:#6b7280;">${a.prazo ? 'Vence: ' + new Date(a.prazo).toLocaleDateString('pt-BR') : 'Sem prazo'}</span>
                    <span style="font-size:0.7rem; font-weight:600; color:${a.realizado ? '#065f46' : '#92400e'};">${a.realizado ? '✅ Feito' : '⏳ Pendente'}</span>
                </div>
            `).join('');
        } else { html += '<span style="font-size:0.85rem; color:#6b7280;">Nenhuma ação</span>'; }
        html += `</div>`;
    }
    html += `</div></div>`;
    
    const hist = jovem.historicoFrequencia || [];
    html += `<div style="margin-bottom:1rem;"><h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:6px;">📊 Frequência (${hist.length})</h3>`;
    if (hist.length > 0) {
        html += `<div style="max-height:200px; overflow-y:auto; margin-top:8px;"><table style="width:100%; font-size:0.8rem; border-collapse:collapse;"><thead><tr style="background:#f1f5f9;"><th style="padding:6px 8px; text-align:left;">Data</th><th style="padding:6px 8px; text-align:left;">Tipo</th><th style="padding:6px 8px; text-align:left;">Horas</th><th style="padding:6px 8px; text-align:left;">Obs</th></tr></thead><tbody>`;
        html += hist.slice().reverse().map(h => `
            <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:6px 8px;">${new Date(h.data).toLocaleString('pt-BR')}</td>
                <td style="padding:6px 8px;">${h.tipo === 'entrada' ? '🚪 Entrada' : '🚪 Saída'}</td>
                <td style="padding:6px 8px;">${h.tipo === 'entrada' ? (h.horas || 0) + 'h' : '-'}</td>
                <td style="padding:6px 8px;">${h.observacao || '-'}</td>
            </tr>
        `).join('');
        html += `</tbody></table></div>`;
    } else { html += '<p style="color:#6b7280;">Nenhum registro.</p>'; }
    html += `</div>`;
    
    const obs = jovem.observacoes || [];
    html += `<div style="margin-bottom:1rem;"><h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:6px;">📝 Observações (${obs.length})</h3>`;
    if (obs.length > 0) {
        html += `<div style="max-height:200px; overflow-y:auto; margin-top:8px;">`;
        html += obs.slice().reverse().map(o => `
            <div style="background:#f8fafc; padding:8px 12px; margin-bottom:6px; border-radius:6px; border-left:3px solid #8b5cf6;">
                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#6b7280;">
                    <strong>${o.profissional || 'Sistema'}</strong>
                    <span>${new Date(o.data).toLocaleString('pt-BR')}</span>
                </div>
                <p style="margin-top:4px; color:#1e293b; white-space:pre-wrap;">${o.texto}</p>
            </div>
        `).join('');
        html += `</div>`;
    } else { html += '<p style="color:#6b7280;">Nenhuma observação.</p>'; }
    html += `</div>`;
    
    const oficinas = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id));
    html += `<div><h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:6px;">🛠️ Oficinas (${oficinas.length})</h3>`;
    if (oficinas.length > 0) {
        html += `<div style="max-height:200px; overflow-y:auto; margin-top:8px;">`;
        html += oficinas.slice().reverse().map(o => `
            <div style="background:#f8fafc; padding:6px 12px; margin-bottom:6px; border-radius:6px; border-left:3px solid ${o.reverte ? '#10b981' : '#6c757d'};">
                <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px;">
                    <span><strong>${o.conteudo}</strong></span>
                    <span style="font-size:0.8rem; color:#6b7280;">${new Date(o.data).toLocaleDateString('pt-BR')} - ${o.periodo}</span>
                </div>
                ${o.reverte ? '<span style="font-size:0.7rem; color:#10b981;">✅ Reverte</span>' : ''}
                ${o.isCurso ? '<span style="font-size:0.7rem; color:#3b82f6;">📚 Curso</span>' : ''}
            </div>
        `).join('');
        html += `</div>`;
    } else { html += '<p style="color:#6b7280;">Nenhuma oficina.</p>'; }
    html += `</div>`;
    
    const avaliacoes = estado.avaliacoes.filter(a => a.jovemId === jovem.id);
    if (avaliacoes.length > 0) {
        html += `<div style="margin-top:1rem;"><h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:6px;">📋 Avaliações (${avaliacoes.length})</h3><div style="max-height:200px; overflow-y:auto; margin-top:8px;">`;
        html += avaliacoes.slice().reverse().map(a => `
            <div style="background:#f5f3ff; padding:8px 12px; margin-bottom:6px; border-radius:6px; border-left:3px solid #8b5cf6;">
                <div style="display:flex; justify-content:space-between; flex-wrap:wrap;">
                    <strong>${a.profissionalNome}</strong>
                    <span style="font-size:0.75rem; color:#6b7280;">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                </div>
                <div style="font-size:0.8rem; color:#8b5cf6;">${a.area}</div>
                <p style="margin-top:4px; color:#1e293b; white-space:pre-wrap; font-size:0.85rem;">${a.conteudo}</p>
            </div>
        `).join('');
        html += `</div></div>`;
    }
    
    document.getElementById('fichaConteudo').innerHTML = html;
    document.getElementById('modalFicha').style.display = 'flex';
};

// ============================================================
// OBSERVAÇÕES
// ============================================================
function renderizarAcompanhamento() {
    const agora = new Date();
    const tabela7 = document.getElementById('tabela7dias');
    const tabela14 = document.getElementById('tabela14dias');
    if (!tabela7 || !tabela14) return;
    
    const semComparecimento = estado.jovens.filter(j => {
        if (j['MEDIDA'] === 'Liberação' || j.status === 'SUSPENSO' || j.status === 'MEDIDA FINALIZADA' || j.status === 'LIBERADO') return false;
        const hist = j.historicoFrequencia || [];
        if (hist.length === 0) return true;
        const ultimo = new Date(Math.max(...hist.map(h => new Date(h.data))));
        return Math.floor((agora - ultimo) / (1000*60*60*24)) >= 7;
    });
    
    const sem7 = semComparecimento.filter(j => {
        const hist = j.historicoFrequencia || [];
        if (hist.length === 0) return true;
        return Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000*60*60*24)) < 14;
    });
    const sem14 = semComparecimento.filter(j => {
        const hist = j.historicoFrequencia || [];
        if (hist.length === 0) return true;
        return Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000*60*60*24)) >= 14;
    });
    
    tabela7.innerHTML = sem7.map(j => {
        const hist = j.historicoFrequencia || [];
        const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';
        const dias = hist.length > 0 ? Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000*60*60*24)) : '?';
        return `<tr><td>${j['NOME'] || '-'}</td><td>${j.status || 'REGULAR'}</td><td>${ultimo}</td><td>${dias}</td><td><button onclick="abrirFichaModal('${j.id}')" class="btn-sm btn-sm-primary"><i class="fas fa-file-alt"></i></button> <button onclick="marcarIrregular('${j.id}')" class="btn-sm btn-sm-warning">Marcar IRREGULAR</button></td></tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; color:#6b7280;">✅ Nenhum jovem com 7+ dias.</td></tr>';
    
    tabela14.innerHTML = sem14.map(j => {
        const hist = j.historicoFrequencia || [];
        const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';
        const dias = hist.length > 0 ? Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000*60*60*24)) : '?';
        return `<tr><td>${j['NOME'] || '-'}</td><td>${j.status || 'REGULAR'}</td><td>${ultimo}</td><td>${dias}</td><td><button onclick="abrirFichaModal('${j.id}')" class="btn-sm btn-sm-primary"><i class="fas fa-file-alt"></i></button> <button onclick="marcarDescumprimento('${j.id}')" class="btn-sm btn-sm-danger">Marcar EM DESCUMPRIMENTO</button></td></tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; color:#10b981;">✅ Nenhum jovem com 14+ dias.</td></tr>';
}

window.marcarIrregular = async function(jovemId) {
    if (!confirm('Marcar como "IRREGULAR"?')) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    jovem.status = 'IRREGULAR';
    if (!jovem.observacoes) jovem.observacoes = [];
    jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto: '🟡 Status alterado para "IRREGULAR" - 7+ dias sem comparecer.' });
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); await carregarTodosDados(); alert('✅ Status alterado.'); } catch (err) { alert('Erro: ' + err.message); }
};

window.marcarDescumprimento = async function(jovemId) {
    if (!confirm('Marcar como "EM DESCUMPRIMENTO"?')) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    jovem.status = 'EM DESCUMPRIMENTO';
    jovem.dataDescumprimento = new Date().toISOString();
    if (!jovem.observacoes) jovem.observacoes = [];
    jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto: '🔴 Status alterado para "EM DESCUMPRIMENTO" - 14+ dias sem comparecer.' });
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); await carregarTodosDados(); alert('✅ Status alterado.'); } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// METAS LA
// ============================================================
function listarMetasLAProximas() {
    const container = document.getElementById('listaMetasLAProximas');
    if (!container) return;
    const hoje = new Date();
    const limite = new Date(hoje.getTime() + 7*24*60*60*1000);
    let metas = [];
    
    estado.jovens.forEach(j => {
        if (j['MEDIDA'] !== 'LA') return;
        (j.acoesLA || []).forEach(a => {
            if (!a.prazo) return;
            const dataPrazo = new Date(a.prazo);
            if (isNaN(dataPrazo.getTime())) return;
            if (dataPrazo >= hoje && dataPrazo <= limite) {
                metas.push({ nome: j['NOME'] || j['REFERENCIA'] || 'Sem nome', acao: a.texto, prazo: dataPrazo, jovemId: j.id });
            }
        });
    });
    metas.sort((a,b) => a.prazo - b.prazo);
    if (metas.length === 0) { container.innerHTML = '<p style="color:#6b7280;">Nenhuma meta com vencimento próximo (≤ 7 dias).</p>'; return; }
    container.innerHTML = metas.map(m => `
        <div style="background:white; border-radius:10px; padding:10px 14px; border-left:4px solid #f59e0b; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
            <div><span style="font-weight:600;">${m.nome}</span> — ${m.acao} <span style="font-size:0.75rem; color:#6b7280;">Vence: ${m.prazo.toLocaleDateString('pt-BR')}</span></div>
            <span style="font-size:0.7rem; font-weight:600; background:#fef3c7; color:#92400e; padding:2px 10px; border-radius:20px;">⏳ Próximo</span>
        </div>
    `).join('');
}

// ============================================================
// AÇÕES LA
// ============================================================
function renderizarAcoesLA() {
    const lista = document.getElementById('listaAcoesLA');
    const select = document.getElementById('laSelectJovem');
    if (!lista || !select) return;
    
    const jovensLA = estado.jovens.filter(j => j['MEDIDA'] === 'LA');
    select.innerHTML = '<option value="">Selecione</option>' + jovensLA.map(j => `<option value="${j.id}">${j['NOME'] || 'Sem nome'}</option>`).join('');
    
    const jovemId = select.value;
    let acoes = [];
    if (jovemId) {
        const j = estado.jovens.find(x => x.id === jovemId);
        if (j) acoes = j.acoesLA || [];
    } else {
        estado.jovens.forEach(j => { if (j['MEDIDA'] === 'LA') (j.acoesLA || []).forEach(a => acoes.push({ ...a, jovemNome: j['NOME'] || 'Sem nome', jovemId: j.id })); });
    }
    lista.innerHTML = acoes.map(a => `
        <div style="background:#f8fafc; border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; border-left:4px solid ${a.realizado ? '#10b981' : '#f59e0b'};">
            <div><div><strong>${a.texto}</strong></div><div style="font-size:0.75rem; color:#64748b;">${a.jovemNome ? `Jovem: ${a.jovemNome} - ` : ''}Vence: ${a.prazo ? new Date(a.prazo).toLocaleDateString('pt-BR') : 'Sem prazo'} ${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</div></div>
            <div><button class="btn-sm btn-sm-success" onclick="toggleAcaoLaGeral('${a.jovemId || jovemId}', ${a.id})">${a.realizado ? 'Desmarcar' : 'Marcar Feito'}</button> <button class="btn-sm btn-sm-danger" onclick="removerAcaoLaGeral('${a.jovemId || jovemId}', ${a.id})">🗑️</button></div>
        </div>
    `).join('') || '<p style="color:#6b7280;">Nenhuma ação cadastrada.</p>';
}

window.adicionarAcaoLA = async function() {
    const jovemId = document.getElementById('laSelectJovem').value;
    const acaoTexto = document.getElementById('laAcaoInput').value.trim();
    const prazo = document.getElementById('laPrazoInput').value;
    if (!jovemId) return alert('Selecione um jovem.');
    if (!acaoTexto) return alert('Digite a ação.');
    if (!prazo) return alert('Defina a data de vencimento.');
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    jovem.acoesLA = jovem.acoesLA || [];
    jovem.acoesLA.push({ id: Date.now(), texto: acaoTexto, realizado: false, data: new Date().toISOString(), prazo: prazo });
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); document.getElementById('laAcaoInput').value = ''; document.getElementById('laPrazoInput').value = ''; renderizarAcoesLA(); listarMetasLAProximas(); alert('Ação adicionada!'); } catch (err) { alert('Erro: ' + err.message); }
};

window.toggleAcaoLaGeral = async function(jovemId, acaoId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    const acao = jovem.acoesLA.find(a => a.id === acaoId);
    if (!acao) return alert('Ação não encontrada.');
    acao.realizado = !acao.realizado;
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); renderizarAcoesLA(); listarMetasLAProximas(); } catch (err) { alert('Erro: ' + err.message); }
};

window.removerAcaoLaGeral = async function(jovemId, acaoId) {
    if (!confirm('Remover esta ação?')) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    jovem.acoesLA = jovem.acoesLA.filter(a => a.id !== acaoId);
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); renderizarAcoesLA(); listarMetasLAProximas(); } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// AVALIAÇÕES
// ============================================================
function popularSelectProfissionaisAvaliacao() {
    const select = document.getElementById('avaliacaoProfissional');
    if (!select) return;
    const profs = estado.profissionais.filter(p => p.nome);
    select.innerHTML = '<option value="">Selecione...</option>' + profs.map(p => `<option value="${p.id}">${p.nome}${p.funcao ? ' - ' + p.funcao : ''}${p.registro ? ' (Reg: ' + p.registro + ')' : ''}</option>`).join('');
}

window.abrirModalAvaliacao = function() {
    const jovemId = document.getElementById('selectJovemAcomp').value;
    if (!jovemId) return alert('Selecione um jovem primeiro.');
    estado._avaliacaoJovemId = jovemId;
    document.getElementById('avaliacaoData').value = new Date().toISOString().split('T')[0];
    document.getElementById('avaliacaoConteudo').value = '';
    popularSelectProfissionaisAvaliacao();
    document.getElementById('modalAvaliacao').style.display = 'flex';
};

window.fecharModalAvaliacao = function() { document.getElementById('modalAvaliacao').style.display = 'none'; estado._avaliacaoJovemId = null; };

window.salvarAvaliacao = async function() {
    const jovemId = estado._avaliacaoJovemId;
    if (!jovemId) return alert('Selecione um jovem.');
    const profissionalId = document.getElementById('avaliacaoProfissional').value;
    const data = document.getElementById('avaliacaoData').value;
    const area = document.getElementById('avaliacaoArea').value;
    const conteudo = document.getElementById('avaliacaoConteudo').value.trim();
    if (!profissionalId || !data || !conteudo) return alert('Preencha todos os campos.');
    const profissional = estado.profissionais.find(p => p.id === profissionalId);
    if (!profissional) return alert('Profissional não encontrado.');
    const avaliacao = { id: 'av_' + Date.now(), jovemId, profissionalId, profissionalNome: profissional.nome, profissionalFuncao: profissional.funcao || '', profissionalRegistro: profissional.registro || '', data, area, conteudo, criadoEm: new Date().toISOString() };
    try {
        await upstash('SET', `avaliacao:${avaliacao.id}`, JSON.stringify(avaliacao));
        await upstash('SADD', 'avaliacoes:all', avaliacao.id);
        estado.avaliacoes.push(avaliacao);
        const jovem = estado.jovens.find(j => j.id === jovemId);
        if (jovem) { if (!jovem.avaliacoes) jovem.avaliacoes = []; jovem.avaliacoes.push(avaliacao.id); await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); }
        fecharModalAvaliacao(); carregarFichaIndividual(); alert('✅ Avaliação salva!');
    } catch (err) { alert('Erro: ' + err.message); }
};

window.excluirAvaliacao = async function(avaliacaoId) {
    if (!confirm('Excluir esta avaliação?')) return;
    try { await upstash('DEL', `avaliacao:${avaliacaoId}`); await upstash('SREM', 'avaliacoes:all', avaliacaoId); estado.avaliacoes = estado.avaliacoes.filter(a => a.id !== avaliacaoId); const jovem = estado.jovens.find(j => j.avaliacoes && j.avaliacoes.includes(avaliacaoId)); if (jovem) { jovem.avaliacoes = jovem.avaliacoes.filter(id => id !== avaliacaoId); await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); } carregarFichaIndividual(); alert('✅ Avaliação excluída!'); } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// ACOMPANHAMENTO INDIVIDUAL
// ============================================================
function popularSelectAcompInd() {
    const select = document.getElementById('selectJovemAcomp');
    if (!select) return;
    select.innerHTML = '<option value="">Selecione...</option>' + estado.jovens.sort((a,b) => (a['NOME']||'').localeCompare(b['NOME']||'', 'pt-BR')).map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''} ${j.status === 'SUSPENSO' ? '🔴' : j.status === 'EM DESCUMPRIMENTO' ? '⚠️' : j.status === 'MEDIDA FINALIZADA' ? '✅' : ''}</option>`).join('');
}

window.carregarFichaIndividual = function() {
    const id = document.getElementById('selectJovemAcomp').value;
    const container = document.getElementById('fichaIndividual');
    const btnPrint = document.getElementById('btnImprimirFicha');
    if (!id) { container.style.display = 'none'; if (btnPrint) btnPrint.style.display = 'none'; return; }
    const jovem = estado.jovens.find(j => j.id === id);
    if (!jovem) return;
    container.style.display = 'block'; if (btnPrint) btnPrint.style.display = 'inline-block';
    
    let acoesLAHTML = '';
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        const profs = estado.usuarios.filter(u => u.nivel === 'tecnico' || u.nivel === 'gestor');
        const profAtual = estado.usuarios.find(u => u.id === jovem.profissionalLA);
        acoesLAHTML = `
            <h3 style="margin-top:1rem; border-bottom:2px solid #e2e8f0; padding-bottom:4px;">⚖️ Acompanhamento LA</h3>
            <div style="margin-bottom:12px;"><label style="font-weight:bold;">Profissional Responsável:</label><select onchange="vincularProfissionalLA('${jovem.id}', this.value)" style="padding:4px 8px; border-radius:6px; margin-left:10px; border:1px solid #d1d9e6;">${profs.map(p => `<option value="${p.id}" ${jovem.profissionalLA === p.id ? 'selected' : ''}>${p.nome}</option>`).join('')}</select>${profAtual ? `<span style="margin-left:12px; color:#10b981;">✅ ${profAtual.nome}</span>` : ''}</div>
            <ul style="list-style:none; padding:0;">${acoes.map(a => `<li style="padding:8px 12px; background:#f8fafc; border:1px solid #e2e8f0; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center; border-radius:6px; flex-wrap:wrap; gap:6px;"><span style="${a.realizado ? 'text-decoration:line-through; color:#10b981;' : ''}">${a.texto} ${a.prazo ? `<span style="font-size:0.65rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span>` : ''}</span><div><button class="btn-sm ${a.realizado ? 'btn-sm-success' : 'btn-sm-warning'}" onclick="toggleAcaoLA('${jovem.id}', ${a.id})">${a.realizado ? '✅ Feito' : 'Marcar Feito'}</button></div></li>`).join('')}</ul>
        `;
    }
    
    const dadosDiv = document.getElementById('fichaDadosPessoais');
    if (dadosDiv) {
        dadosDiv.innerHTML = `<div class="ficha-grid">${CAMPOS.map(([key,label]) => `<div class="ficha-campo"><strong>${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}<div class="ficha-campo"><strong>ID Digital:</strong> ${jovem['ID_DIGITAL'] || '-'}</div><div class="ficha-campo"><strong>Horas Atribuídas:</strong> ${jovem['HORAS'] || 0}h</div><div class="ficha-campo"><strong>Horas Cumpridas:</strong> ${calcularHorasCumpridas(jovem)}h</div><div class="ficha-campo"><strong>Saldo:</strong> ${calcularSaldo(jovem)}h</div>${jovem.motivoSuspensao ? `<div class="ficha-campo" style="grid-column:1/-1; background:#fce7f3; padding:6px; border-radius:4px;"><strong style="color:#be185d;">Motivo da Suspensão:</strong> ${jovem.motivoSuspensao}</div>` : ''}${jovem.status === 'EM DESCUMPRIMENTO' ? `<div class="ficha-campo" style="grid-column:1/-1; background:#fee2e2; padding:6px; border-radius:4px;"><strong style="color:#991b1b;">⚠️ Status: EM DESCUMPRIMENTO</strong></div>` : ''}${jovem.status === 'IRREGULAR' ? `<div class="ficha-campo" style="grid-column:1/-1; background:#fef3c7; padding:6px; border-radius:4px;"><strong style="color:#92400e;">🟡 Status: IRREGULAR</strong></div>` : ''}</div>${acoesLAHTML}`;
    }
    
    const freqDiv = document.getElementById('fichaFrequencia');
    if (freqDiv) {
        const hist = jovem.historicoFrequencia || [];
        const totalHoras = hist.reduce((s,h) => s + parseNum(h.horas), 0);
        freqDiv.innerHTML = `<p><strong>Total de frequências:</strong> ${hist.length} registros</p><p><strong>Horas cumpridas (sistema):</strong> ${totalHoras.toFixed(1)}h</p>${hist.length > 0 ? `<table style="margin-top:8px; width:100%;"><thead><tr><th>Tipo</th><th>Data/Hora</th><th>Horas</th><th>Obs</th></tr></thead><tbody>${hist.map(h => `<tr><td>${h.tipo === 'saida' ? '🚪 Saída' : '🚪 Entrada'}</td><td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td>${h.tipo === 'saida' ? '-' : (parseNum(h.horas) || 0) + 'h'}</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:#6b7280;">Nenhum registro.</p>'}`;
    }
    
    const ofDiv = document.getElementById('fichaOficinas');
    if (ofDiv) {
        const oficinas = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id));
        ofDiv.innerHTML = oficinas.length > 0 ? `<table style="margin-top:8px; width:100%;"><thead><tr><th>Data</th><th>Conteúdo</th><th>Benefício Social</th></tr></thead><tbody>${oficinas.map(o => `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.conteudo}</td><td>${o.reverte ? '✅ Sim' : 'Não'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:#6b7280;">Nenhuma oficina.</p>';
    }
    
    const docDiv = document.getElementById('fichaDocumentos');
    if (docDiv) {
        const docs = jovem.documentos || [];
        docDiv.innerHTML = docs.length > 0 ? docs.map((d,i) => `<div class="doc-item"><span>📄 ${d.nome} (${d.tipo})</span><div>${d.base64 ? `<a href="${d.base64}" download="${d.nome}" class="btn-sm btn-sm-primary" style="text-decoration:none;">📥 Baixar</a>` : ''}<button onclick="removerDocumento('${id}', ${i})" class="btn-sm btn-sm-danger">🗑️</button></div></div>`).join('') : '<p style="color:#6b7280;">Nenhum documento.</p>';
    }
    
    const obsDiv = document.getElementById('fichaObservacoes');
    if (obsDiv) {
        const obs = jovem.observacoes || [];
        obsDiv.innerHTML = obs.length > 0 ? obs.map(o => `<div class="obs-item"><strong>${o.profissional || 'Sistema'}</strong> - <small>${new Date(o.data).toLocaleDateString('pt-BR')} ${new Date(o.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small><p>${o.texto}</p></div>`).join('') : '<p style="color:#6b7280;">Nenhuma observação.</p>';
    }
    
    const avalDiv = document.getElementById('fichaAvaliacoes');
    if (avalDiv) {
        const avaliacoes = estado.avaliacoes.filter(a => a.jovemId === jovem.id);
        avalDiv.innerHTML = avaliacoes.length > 0 ? avaliacoes.map(a => `<div class="obs-item" style="border-left-color:#8b5cf6; background:#f5f3ff;"><div style="display:flex; justify-content:space-between; flex-wrap:wrap;"><strong>${a.profissionalNome}</strong><span style="font-size:0.75rem; color:#6b7280;">${a.area} - ${new Date(a.data).toLocaleDateString('pt-BR')}</span></div>${a.profissionalFuncao ? `<span style="font-size:0.75rem; color:#6b7280;">${a.profissionalFuncao}${a.profissionalRegistro ? ' - Reg: ' + a.profissionalRegistro : ''}</span>` : ''}<p style="margin-top:6px; white-space:pre-wrap;">${a.conteudo}</p><div style="margin-top:4px;"><button onclick="excluirAvaliacao('${a.id}')" class="btn-sm btn-sm-danger">🗑️ Excluir</button></div></div>`).join('') : '<p style="color:#6b7280;">Nenhuma avaliação.</p>';
    }
    estado._jovemDocAtual = jovem.id;
};

window.toggleAcaoLA = async function(jovemId, acaoId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    const acao = jovem.acoesLA.find(a => a.id === acaoId);
    if (!acao) return;
    acao.realizado = !acao.realizado;
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    carregarFichaIndividual(); carregarLista(); listarMetasLAProximas();
};

window.vincularProfissionalLA = async function(jovemId, profId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    jovem.profissionalLA = profId;
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    carregarFichaIndividual(); alert('Profissional vinculado!');
};

window.salvarObsAcomp = async function() {
    const jovemId = document.getElementById('selectJovemAcomp').value;
    const texto = document.getElementById('obsAcompTexto').value.trim();
    if (!texto) return alert('Digite a observação.');
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    jovem.observacoes = jovem.observacoes || [];
    jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto });
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); document.getElementById('obsAcompTexto').value = ''; carregarFichaIndividual(); alert('Observação salva!'); } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// RELATÓRIOS
// ============================================================
function renderizarRelatorios() {
    const tbody1 = document.querySelector('#tabelaProjecao tbody');
    if (tbody1) {
        const agora = new Date();
        const HORAS_POR_QUINZENA = 8;
        let saldos = estado.jovens.filter(j => j['MEDIDA'] && j['MEDIDA'] !== 'Liberação' && j['MEDIDA'] !== 'LA' && j.status !== 'SUSPENSO' && j.status !== 'EM DESCUMPRIMENTO' && j.status !== 'MEDIDA FINALIZADA').map(j => { const horasTotal = parseNum(j['HORAS']); const horasFeitas = (j.historicoFrequencia || []).reduce((s,h) => s + parseNum(h.horas), 0); return Math.max(0, horasTotal - horasFeitas); });
        tbody1.innerHTML = '';
        for (let mes = 0; mes < 3; mes++) {
            const dataMes = new Date(agora.getFullYear(), agora.getMonth() + mes, 1);
            const mesNome = dataMes.toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
            const diasMes = new Date(dataMes.getFullYear(), dataMes.getMonth() + 1, 0).getDate();
            const ativosQ1 = saldos.filter(s => s > 0).length;
            const horasQ1 = saldos.reduce((sum,s) => sum + Math.min(s, HORAS_POR_QUINZENA), 0);
            saldos = saldos.map(s => Math.max(0, s - HORAS_POR_QUINZENA));
            const q1Inicio = new Date(dataMes.getFullYear(), dataMes.getMonth(), 1);
            const q1Fim = new Date(dataMes.getFullYear(), dataMes.getMonth(), 15);
            tbody1.innerHTML += `<tr><td>1ª Quin. ${mesNome}</td><td>${q1Inicio.toLocaleDateString('pt-BR')} - ${q1Fim.toLocaleDateString('pt-BR')}</td><td>${ativosQ1}</td><td>${horasQ1}h</td></tr>`;
            const ativosQ2 = saldos.filter(s => s > 0).length;
            const horasQ2 = saldos.reduce((sum,s) => sum + Math.min(s, HORAS_POR_QUINZENA), 0);
            saldos = saldos.map(s => Math.max(0, s - HORAS_POR_QUINZENA));
            const q2Inicio = new Date(dataMes.getFullYear(), dataMes.getMonth(), 16);
            const q2Fim = new Date(dataMes.getFullYear(), dataMes.getMonth(), diasMes);
            tbody1.innerHTML += `<tr><td>2ª Quin. ${mesNome}</td><td>${q2Inicio.toLocaleDateString('pt-BR')} - ${q2Fim.toLocaleDateString('pt-BR')}</td><td>${ativosQ2}</td><td>${horasQ2}h</td></tr>`;
        }
    }
    
    const tbody2 = document.querySelector('#tabelaAniversariantes tbody');
    if (tbody2) {
        const agora = new Date();
        const anoAtual = agora.getFullYear();
        const mesAtual = agora.getMonth();
        const aniversariantes = estado.jovens.map(j => {
            const nascStr = j['NASC.'];
            if (!nascStr) return null;
            const nasc = new Date(nascStr);
            if (isNaN(nasc.getTime())) return null;
            const mesNasc = nasc.getMonth();
            const diaNasc = nasc.getDate() + 1;
            let mesTarget = mesNasc;
            let anoTarget = anoAtual;
            if (mesNasc < mesAtual || (mesNasc === mesAtual && diaNasc < agora.getDate())) anoTarget = anoAtual + 1;
            const diffMeses = (anoTarget - anoAtual) * 12 + (mesTarget - mesAtual);
            if (diffMeses < 0 || diffMeses >= 3) return null;
            return { nome: j['NOME'] || j['REFERENCIA'] || 'Sem nome', status: j.status || 'REGULAR', nasc, diaNasc, mesTarget, anoTarget, idadeQueFara: anoTarget - nasc.getFullYear(), dataEvento: new Date(anoTarget, mesTarget, diaNasc) };
        }).filter(Boolean).sort((a,b) => a.dataEvento - b.dataEvento);
        tbody2.innerHTML = aniversariantes.length > 0 ? aniversariantes.map(a => {
            let bgStatus = a.status === 'SUSPENSO' ? 'badge-suspenso' : a.status === 'EM DESCUMPRIMENTO' ? 'badge-descumprimento' : a.status === 'IRREGULAR' ? 'badge-irregular' : a.status === 'MEDIDA FINALIZADA' ? 'badge-finalizada' : a.status === 'REGULAR' ? 'badge-regular' : a.status === 'LIBERADO' ? 'badge-liberado' : 'badge-regular';
            return `<tr><td>${a.nome}</td><td><span class="badge ${bgStatus}">${a.status}</span></td><td>${a.nasc.toLocaleDateString('pt-BR')}</td><td>${String(a.diaNasc).padStart(2,'0')}/${String(a.mesTarget+1).padStart(2,'0')}/${a.anoTarget}</td><td>${a.idadeQueFara} anos</td></tr>`;
        }).join('') : '<tr><td colspan="5" style="text-align:center; color:#6b7280;">Nenhum aniversariante nos próximos 3 meses.</td></tr>';
    }
}

window.imprimirRelatorioCompleto = function() {
    const win = window.open('', '_blank');
    if (!win) return alert('Permita pop-ups.');
    let logoBase64 = estado._logoBase64 || '';
    let html = `<!DOCTYPE html><html><head><title>Relatório Completo</title><style>body{font-family:'Segoe UI',sans-serif; padding:30px;} table{width:100%; border-collapse:collapse; font-size:12px;} th,td{padding:6px 10px; border-bottom:1px solid #e2e8f0;} th{background:#f1f5f9;} .badge{display:inline-block; padding:2px 10px; border-radius:12px; font-size:10px; font-weight:600;} .badge-regular{background:#dbeafe;color:#1e40af;} .badge-irregular{background:#fef3c7;color:#92400e;} .badge-em-descumprimento{background:#fee2e2;color:#991b1b;} .badge-suspenso{background:#fce7f3;color:#be185d;} .badge-medida-finalizada{background:#d1fae5;color:#065f46;} .badge-liberado{background:#e5e7eb;color:#374151;} .header{text-align:center; margin-bottom:20px;} .no-print{text-align:center; margin-top:20px;} .btn-print{background:#2c3e66;color:white;padding:10px 30px;border:none;border-radius:6px;cursor:pointer;} .btn-close{background:#6c757d;color:white;padding:10px 30px;border:none;border-radius:6px;cursor:pointer;margin-left:10px;} .col-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;} .info-box{background:#f8fafc;padding:12px;border-radius:6px;border:1px solid #e2e8f0;} .info-box strong{display:block;color:#2c3e66;} @media print{.no-print{display:none;}}</style></head><body><div class="header">${logoBase64 ? `<img src="${logoBase64}" style="max-height:80px;">` : ''}<h1>📊 Relatório Completo</h1><p>${new Date().toLocaleString('pt-BR')}</p></div>`;
    html += `<div style="margin-bottom:20px;"><h2>📊 Resumo</h2><div class="col-2"><div class="info-box"><strong>Total Jovens</strong>${estado.jovens.length}</div><div class="info-box"><strong>REGULAR</strong>${estado.jovens.filter(j=>j.status==='REGULAR').length}</div><div class="info-box"><strong>IRREGULAR</strong>${estado.jovens.filter(j=>j.status==='IRREGULAR').length}</div><div class="info-box"><strong>DESCUMPRIMENTO</strong>${estado.jovens.filter(j=>j.status==='EM DESCUMPRIMENTO').length}</div><div class="info-box"><strong>SUSPENSO</strong>${estado.jovens.filter(j=>j.status==='SUSPENSO').length}</div><div class="info-box"><strong>FINALIZADA</strong>${estado.jovens.filter(j=>j.status==='MEDIDA FINALIZADA').length}</div><div class="info-box"><strong>LIBERADO</strong>${estado.jovens.filter(j=>j.status==='LIBERADO'||j['MEDIDA']==='Liberação').length}</div><div class="info-box"><strong>Oficinas</strong>${estado.oficinas.length}</div></div></div>`;
    html += `<div style="margin-bottom:20px;"><h2>👥 Lista de Jovens</h2><table><thead><tr><th>Nome</th><th>Medida</th><th>Status</th><th>Horas Atrib.</th><th>Horas Cumpr.</th><th>Saldo</th></tr></thead><tbody>${estado.jovens.sort((a,b)=>(a['NOME']||'').localeCompare(b['NOME']||'')).map(j => `<tr><td>${j['NOME']||j['REFERENCIA']||'-'}</td><td>${j['MEDIDA']||'-'}</td><td><span class="badge badge-${(j.status||'regular').toLowerCase().replace(' ','-')}">${j.status||'REGULAR'}</span></td><td>${j['HORAS']||0}h</td><td>${calcularHorasCumpridas(j)}h</td><td>${calcularSaldo(j)}h</td></tr>`).join('')}</tbody></table></div>`;
    html += `<div style="margin-bottom:20px;"><h2>📋 Avaliações</h2>${estado.avaliacoes.length > 0 ? `<table><thead><tr><th>Jovem</th><th>Profissional</th><th>Área</th><th>Data</th></tr></thead><tbody>${estado.avaliacoes.map(a => { const j = estado.jovens.find(x => x.id === a.jovemId); return `<tr><td>${j ? j['NOME']||j['REFERENCIA']||'Sem nome' : 'Não encontrado'}</td><td>${a.profissionalNome}</td><td>${a.area}</td><td>${new Date(a.data).toLocaleDateString('pt-BR')}</td></tr>`; }).join('')}</tbody></table>` : '<p>Nenhuma avaliação.</p>'}</div>`;
    html += `<div style="margin-bottom:20px;"><h2>🛠️ Oficinas</h2>${estado.oficinas.length > 0 ? `<table><thead><tr><th>Data</th><th>Conteúdo</th><th>Participantes</th><th>Benefício</th></tr></thead><tbody>${estado.oficinas.slice().reverse().map(o => `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.conteudo}</td><td>${(o.jovensIds||[]).map(id => { const j = estado.jovens.find(x=>x.id===id); return j ? j['NOME']||j['REFERENCIA'] : 'Desconhecido'; }).join(', ') || 'Nenhum'}</td><td>${o.reverte ? '✅ Sim' : 'Não'}</td></tr>`).join('')}</tbody></table>` : '<p>Nenhuma oficina.</p>'}</div>`;
    html += `<div class="no-print"><button class="btn-print" onclick="window.print()">🖨️ Imprimir</button><button class="btn-close" onclick="window.close()">Fechar</button></div></body></html>`;
    win.document.write(html); win.document.close();
};

window.exportarRelatorioCompleto = function() { alert('Clique em "Imprimir" e selecione "Salvar como PDF".'); imprimirRelatorioCompleto(); };

window.abrirRelatorioRevertencia = function() {
    const ofs = estado.oficinas.filter(o => o.reverte);
    if (ofs.length === 0) return alert('Nenhuma oficina revertida.');
    let logoBase64 = estado._logoBase64 || '';
    let html = `<html><head><title>Relatório Revertência</title><style>body{font-family:sans-serif; padding:30px;} table{width:100%;border-collapse:collapse;} th,td{padding:6px 10px;border-bottom:1px solid #e2e8f0;} th{background:#f1f5f9;} .header{text-align:center;}</style></head><body><div class="header">${logoBase64 ? `<img src="${logoBase64}" style="max-height:80px;">` : ''}<h1>🌱 Oficinas Revertidas</h1><p>${new Date().toLocaleString('pt-BR')}</p></div><table><thead><tr><th>Data</th><th>Período</th><th>Conteúdo</th><th>Participantes</th></tr></thead><tbody>${ofs.map(o => `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.periodo||'-'}</td><td>${o.conteudo}</td><td>${(o.jovensIds||[]).map(id => { const j = estado.jovens.find(x=>x.id===id); return j ? j['NOME']||j['REFERENCIA'] : 'Desconhecido'; }).join(', ') || 'Nenhum'}</td></tr>`).join('')}</tbody></table></body></html>`;
    const win = window.open('', '_blank'); if (win) { win.document.write(html); win.document.close(); }
};

window.abrirRelatorioAvaliacoes = function() {
    if (estado.avaliacoes.length === 0) return alert('Nenhuma avaliação.');
    let logoBase64 = estado._logoBase64 || '';
    let html = `<html><head><title>Relatório Avaliações</title><style>body{font-family:sans-serif; padding:30px;} .avaliacao-item{background:#f8fafc; border-left:4px solid #8b5cf6; padding:12px; margin-bottom:10px; border-radius:4px;} .header{text-align:center;} .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;} .badge-regular{background:#dbeafe;color:#1e40af;} .badge-irregular{background:#fef3c7;color:#92400e;} .badge-em-descumprimento{background:#fee2e2;color:#991b1b;} .badge-suspenso{background:#fce7f3;color:#be185d;} .badge-medida-finalizada{background:#d1fae5;color:#065f46;} .badge-liberado{background:#e5e7eb;color:#374151;}</style></head><body><div class="header">${logoBase64 ? `<img src="${logoBase64}" style="max-height:80px;">` : ''}<h1>📋 Avaliações Profissionais</h1><p>${new Date().toLocaleString('pt-BR')}</p></div>`;
    const avaliacoesPorJovem = {};
    estado.avaliacoes.forEach(a => { if (!avaliacoesPorJovem[a.jovemId]) { const j = estado.jovens.find(x=>x.id===a.jovemId); avaliacoesPorJovem[a.jovemId] = { nome: j ? (j['NOME']||j['REFERENCIA']||'Sem nome') : 'Jovem não encontrado', status: j ? j.status : 'REGULAR', avaliacoes: [] }; } avaliacoesPorJovem[a.jovemId].avaliacoes.push(a); });
    Object.keys(avaliacoesPorJovem).sort((a,b) => (avaliacoesPorJovem[a].nome||'').localeCompare(avaliacoesPorJovem[b].nome||'')).forEach(jovemId => {
        const info = avaliacoesPorJovem[jovemId];
        let bgStatus = info.status === 'SUSPENSO' ? 'badge-suspenso' : info.status === 'EM DESCUMPRIMENTO' ? 'badge-em-descumprimento' : info.status === 'IRREGULAR' ? 'badge-irregular' : info.status === 'MEDIDA FINALIZADA' ? 'badge-medida-finalizada' : info.status === 'REGULAR' ? 'badge-regular' : info.status === 'LIBERADO' ? 'badge-liberado' : 'badge-regular';
        html += `<div style="margin-top:20px;"><h3>${info.nome} <span class="badge ${bgStatus}">${info.status}</span></h3>`;
        info.avaliacoes.forEach(a => { html += `<div class="avaliacao-item"><div style="display:flex;justify-content:space-between;"><strong>${a.profissionalNome}</strong><span>${new Date(a.data).toLocaleDateString('pt-BR')}</span></div><div>${a.area}</div><div style="white-space:pre-wrap; margin-top:6px;">${a.conteudo}</div></div>`; });
        html += `</div>`;
    });
    html += `</body></html>`;
    const win = window.open('', '_blank'); if (win) { win.document.write(html); win.document.close(); }
};

window.abrirRelatorioLA = function() {
    const jovensLA = estado.jovens.filter(j => j['MEDIDA'] === 'LA');
    if (jovensLA.length === 0) return alert('Nenhum jovem com LA.');
    let logoBase64 = estado._logoBase64 || '';
    let totalAcoes = 0, totalRealizadas = 0;
    let html = `<html><head><title>Relatório LA</title><style>body{font-family:sans-serif; padding:30px;} .header{text-align:center;} .acao-item{padding:8px 12px; margin-bottom:6px; border-radius:4px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;} .acao-item.pendente{background:#fffbeb; border-left:4px solid #f59e0b;} .acao-item.realizado{background:#ecfdf5; border-left:4px solid #10b981;}</style></head><body><div class="header">${logoBase64 ? `<img src="${logoBase64}" style="max-height:80px;">` : ''}<h1>⚖️ Ações LA</h1><p>${new Date().toLocaleString('pt-BR')}</p></div>`;
    jovensLA.forEach(j => {
        const acoes = j.acoesLA || [];
        const realizadas = acoes.filter(a => a.realizado).length;
        totalAcoes += acoes.length; totalRealizadas += realizadas;
        html += `<div style="margin-top:16px;"><h3>${j['NOME']||j['REFERENCIA']||'Sem nome'} (${realizadas}/${acoes.length})</h3>`;
        if (acoes.length === 0) { html += '<p style="color:#6b7280;">Nenhuma ação.</p>'; } else {
            acoes.forEach(a => { const statusClass = a.realizado ? 'realizado' : 'pendente'; html += `<div class="acao-item ${statusClass}"><div><span>${a.texto}</span><div style="font-size:0.75rem; color:#6b7280;">${a.prazo ? 'Vence: ' + new Date(a.prazo).toLocaleDateString('pt-BR') : 'Sem prazo'}</div></div><span>${a.realizado ? '✅ Realizado' : '⏳ Pendente'}</span></div>`; });
        }
        html += `</div>`;
    });
    const progresso = totalAcoes > 0 ? ((totalRealizadas / totalAcoes) * 100).toFixed(1) : 0;
    html += `<div style="margin-top:20px; background:#fffbeb; padding:12px; border-radius:8px; border:1px solid #f59e0b;"><strong>📊 Resumo:</strong> ${totalAcoes} ações • ${totalRealizadas} realizadas • ${progresso}%</div></body></html>`;
    const win = window.open('', '_blank'); if (win) { win.document.write(html); win.document.close(); }
};

window.imprimirFichaIndividual = function() {
    const id = document.getElementById('selectJovemAcomp').value;
    if (!id) return alert('Selecione um jovem.');
    const jovem = estado.jovens.find(j => j.id === id);
    if (!jovem) return alert('Jovem não encontrado.');
    const win = window.open('', '_blank');
    if (!win) return alert('Permita pop-ups.');
    let logoBase64 = estado._logoBase64 || '';
    let html = `<!DOCTYPE html><html><head><title>Ficha Individual</title><style>body{font-family:sans-serif; padding:30px;} .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;} .field{padding:4px 0;border-bottom:1px solid #f1f5f9;} .field strong{font-size:11px;text-transform:uppercase;color:#6b7280;display:block;} .header{text-align:center;margin-bottom:20px;} .status-badge{display:inline-block;padding:2px 12px;border-radius:12px;font-size:11px;font-weight:600;} .status-REGULAR{background:#dbeafe;color:#1e40af;} .status-IRREGULAR{background:#fef3c7;color:#92400e;} .status-EM_DESCUMPRIMENTO{background:#fee2e2;color:#991b1b;} .status-SUSPENSO{background:#fce7f3;color:#be185d;} .status-MEDIDA_FINALIZADA{background:#d1fae5;color:#065f46;} .status-LIBERADO{background:#e5e7eb;color:#374151;} table{width:100%;border-collapse:collapse;font-size:12px;} th,td{padding:6px 10px;border-bottom:1px solid #e9edf2;} th{background:#f1f5f9;} </style></head><body><div class="header">${logoBase64 ? `<img src="${logoBase64}" style="max-height:80px;">` : ''}<h1>📋 Ficha Individual</h1><p>${jovem['NOME']||'Sem nome'} - ${new Date().toLocaleDateString('pt-BR')}</p><p><span class="status-badge status-${(jovem.status||'REGULAR').replace(/ /g,'_')}">${jovem.status||'REGULAR'}</span></p></div>`;
    html += `<div style="margin-bottom:16px;"><h2>Dados Pessoais</h2><div class="grid">${CAMPOS.map(([key,label]) => `<div class="field"><strong>${label}</strong><span>${jovem[key]||'-'}</span></div>`).join('')}<div class="field"><strong>ID Digital</strong><span>${jovem['ID_DIGITAL']||'-'}</span></div><div class="field"><strong>Horas Atribuídas</strong><span>${jovem['HORAS']||0}h</span></div><div class="field"><strong>Horas Cumpridas</strong><span>${calcularHorasCumpridas(jovem)}h</span></div><div class="field"><strong>Saldo</strong><span>${calcularSaldo(jovem)}h</span></div></div></div>`;
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        html += `<div style="margin-bottom:16px;"><h2>Ações LA</h2>${acoes.map(a => `<div style="padding:6px; background:${a.realizado ? '#d1fae5' : '#f8fafc'}; margin-bottom:4px; border-radius:4px;">${a.texto} ${a.prazo ? `<span style="font-size:0.7rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span>` : ''} - ${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</div>`).join('')}</div>`;
    }
    const avaliacoes = estado.avaliacoes.filter(a => a.jovemId === jovem.id);
    if (avaliacoes.length > 0) {
        html += `<div style="margin-bottom:16px;"><h2>📋 Avaliações</h2>${avaliacoes.map(a => `<div style="background:#f5f3ff;border-left:3px solid #8b5cf6;padding:8px 12px;margin-bottom:6px;border-radius:4px;"><div style="display:flex;justify-content:space-between;"><strong>${a.profissionalNome}</strong><span>${new Date(a.data).toLocaleDateString('pt-BR')}</span></div><div>${a.area}</div><div style="white-space:pre-wrap;margin-top:4px;">${a.conteudo}</div></div>`).join('')}</div>`;
    }
    const hist = jovem.historicoFrequencia || [];
    html += `<div><h2>Frequência</h2><p>Total: ${hist.reduce((s,h)=>s+parseFloat(h.horas||0),0).toFixed(1)}h | Saldo: ${calcularSaldo(jovem)}h</p>${hist.length > 0 ? `<table><thead><tr><th>Tipo</th><th>Data</th><th>Horas</th></tr></thead><tbody>${hist.map(h => `<tr><td>${h.tipo === 'saida' ? 'Saída' : 'Entrada'}</td><td>${new Date(h.data).toLocaleDateString('pt-BR')}</td><td>${h.tipo === 'saida' ? '-' : (h.horas||0) + 'h'}</td></tr>`).join('')}</tbody></table>` : '<p>Nenhum registro.</p>'}</div>`;
    html += `</body></html>`;
    win.document.write(html); win.document.close();
};

// ============================================================
// PONTO DIGITAL E NA LINHA
// ============================================================
window.registrarPontoNaLinha = async function(jovemId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    if (jovem['MEDIDA'] === 'Liberação') return alert('❌ Jovem liberado.');
    if (jovem.status === 'SUSPENSO') return alert('❌ Jovem suspenso.');
    if (jovem.status === 'MEDIDA FINALIZADA') return alert('❌ Medida finalizada.');
    if (jovem.status === 'IRREGULAR') {
        if (!confirm('Jovem irregular. Reativar para REGULAR?')) return;
        jovem.status = 'REGULAR';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto: '✅ Reativado para REGULAR ao registrar presença.' });
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    }
    if (jovem.status === 'EM DESCUMPRIMENTO') {
        if (!confirm('Jovem em descumprimento. Reativar para REGULAR?')) return;
        jovem.status = 'REGULAR';
        jovem.dataDescumprimento = '';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto: '✅ Reativado para REGULAR ao registrar presença.' });
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    }
    const now = new Date();
    jovem.historicoFrequencia = jovem.historicoFrequencia || [];
    const hist = jovem.historicoFrequencia;
    const hojeStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let entradaAberta = null;
    for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].tipo === 'entrada') { const eDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime(); if (eDia === hojeStr) { entradaAberta = hist[i]; break; } }
        if (hist[i].tipo === 'saida') { const sDia = new Date(new Date(hist[i].data).getFullYear(), new Date(hist[i].data).getMonth(), new Date(hist[i].data).getDate()).getTime(); if (sDia === hojeStr) break; }
    }
    if (entradaAberta) {
        if (jovem['MEDIDA'] === 'LA') {
            entradaAberta.horaSaida = now.toISOString();
            hist.push({ data: now.toISOString(), horas: 0, tipo: 'saida', observacao: 'Saída (LA)', entradaReferencia: new Date(entradaAberta.data).getTime() });
            alert(`✅ Saída LA registrada para ${jovem['NOME']}`);
        } else {
            const diffMs = now.getTime() - new Date(entradaAberta.data).getTime();
            const horasReais = diffMs / (1000*60*60);
            const horasArredondadas = Math.round(horasReais * 4) / 4;
            entradaAberta.horas = parseFloat(horasArredondadas.toFixed(2));
            entradaAberta.horaSaida = now.toISOString();
            hist.push({ data: now.toISOString(), horas: 0, tipo: 'saida', observacao: '', entradaReferencia: new Date(entradaAberta.data).getTime() });
            alert(`✅ Saída registrada para ${jovem['NOME']} (${horasArredondadas.toFixed(2)}h)`);
        }
    } else {
        hist.push({ data: now.toISOString(), horas: 0, tipo: 'entrada', observacao: jovem['MEDIDA'] === 'LA' ? 'Entrada (LA)' : '' });
        alert(`✅ Entrada registrada para ${jovem['NOME']}`);
    }
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); await carregarTodosDados(); } catch (err) { alert('Erro: ' + err.message); }
};

async function registrarPontoDigital() {
    const id = document.getElementById('inputDigital').value.trim();
    if (!id) return alert('Digite o código da digital.');
    const jovem = estado.jovens.find(j => j['ID_DIGITAL'] === id);
    if (!jovem) return alert('Código não encontrado.');
    if (jovem.status === 'SUSPENSO') return alert('Jovem suspenso.');
    if (jovem.status === 'MEDIDA FINALIZADA') return alert('Medida finalizada.');
    if (jovem['MEDIDA'] === 'Liberação') return alert('Jovem liberado.');
    await registrarPontoNaLinha(jovem.id);
    document.getElementById('inputDigital').value = '';
}

// ============================================================
// REGISTRO MANUAL
// ============================================================
function abrirRegistroManual() {
    const select = document.getElementById('manualJovem');
    if (!select) return;
    const jovensDisponiveis = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação' && j.status !== 'SUSPENSO' && j.status !== 'MEDIDA FINALIZADA');
    if (jovensDisponiveis.length === 0) {
        alert('Não há jovens disponíveis.');
        select.innerHTML = '<option value="">Nenhum</option>';
    } else {
        select.innerHTML = jovensDisponiveis.sort((a,b) => (a['NOME']||'').localeCompare(b['NOME']||'', 'pt-BR')).map(j => `<option value="${j.id}">${j['NOME']||j['REFERENCIA']} - ${j['MEDIDA']||''}</option>`).join('');
    }
    document.getElementById('modalRegistroManual').style.display = 'flex';
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('manualDataHora').value = now.toISOString().slice(0,16);
}

async function salvarRegistroManual() {
    const jovemId = document.getElementById('manualJovem').value;
    const dataEntrada = document.getElementById('manualDataHora').value;
    const horas = parseFloat(document.getElementById('manualHoras').value);
    const obs = document.getElementById('manualObs').value.trim();
    if (!jovemId || !dataEntrada) return alert('Selecione jovem e data/hora.');
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    if (jovem.status === 'SUSPENSO' || jovem.status === 'MEDIDA FINALIZADA' || jovem['MEDIDA'] === 'Liberação') return alert('Jovem não pode registrar ponto.');
    if (jovem.status === 'IRREGULAR') {
        if (!confirm('Reativar para REGULAR?')) return;
        jovem.status = 'REGULAR';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto: '✅ Reativado para REGULAR (registro manual).' });
    }
    if (jovem.status === 'EM DESCUMPRIMENTO') {
        if (!confirm('Reativar para REGULAR?')) return;
        jovem.status = 'REGULAR';
        jovem.dataDescumprimento = '';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({ data: new Date().toISOString(), profissional: estado.usuarioAtual?.nome || 'Sistema', texto: '✅ Reativado para REGULAR (registro manual).' });
    }
    jovem.historicoFrequencia = jovem.historicoFrequencia || [];
    const dataEntradaDate = new Date(dataEntrada);
    if (jovem['MEDIDA'] === 'LA') {
        jovem.historicoFrequencia.push({ data: dataEntradaDate.toISOString(), horas: 0, tipo: 'entrada', observacao: obs || 'Registro manual (LA)' });
        const dataSaida = new Date(dataEntradaDate.getTime() + 30*60*1000);
        jovem.historicoFrequencia.push({ data: dataSaida.toISOString(), horas: 0, tipo: 'saida', observacao: 'Saída (LA)', entradaReferencia: dataEntradaDate.getTime() });
    } else {
        jovem.historicoFrequencia.push({ data: dataEntradaDate.toISOString(), horas: horas, tipo: 'entrada', observacao: obs || 'Registro manual' });
        if (horas > 0) {
            const dataSaida = new Date(dataEntradaDate.getTime() + horas*60*60*1000);
            jovem.historicoFrequencia.push({ data: dataSaida.toISOString(), horas: 0, tipo: 'saida', observacao: '', entradaReferencia: dataEntradaDate.getTime() });
        }
    }
    try { await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem)); document.getElementById('modalRegistroManual').style.display = 'none'; await carregarTodosDados(); alert('✅ Registro salvo!'); } catch (err) { alert('Erro: ' + err.message); }
}

// ============================================================
// OFICINAS
// ============================================================
function renderizarJovensOficina() {
    const div = document.getElementById('listaJovensOficina');
    if (!div) return;
    const jovens = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação' && j.status !== 'SUSPENSO' && j.status !== 'EM DESCUMPRIMENTO' && j.status !== 'MEDIDA FINALIZADA').sort((a,b) => (a['NOME']||'').localeCompare(b['NOME']||'', 'pt-BR'));
    div.innerHTML = jovens.map(j => `<label class="jovem-checkbox"><input type="checkbox" value="${j.id}"><span class="jovem-nome">${j['NOME'] || j['REFERENCIA']}</span></label>`).join('');
}

window.filtrarJovensOficina = function() {
    const busca = document.getElementById('buscaJovensOficina').value.toLowerCase();
    document.querySelectorAll('#listaJovensOficina .jovem-checkbox').forEach(label => {
        const nome = label.querySelector('.jovem-nome').textContent.toLowerCase();
        label.style.display = nome.includes(busca) ? '' : 'none';
    });
};

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
                if (j && j['MEDIDA'] !== 'LA' && j.status !== 'MEDIDA FINALIZADA') {
                    j.historicoFrequencia = j.historicoFrequencia || [];
                    j.historicoFrequencia.push({ data: new Date().toISOString(), horas: 4, tipo: 'entrada', observacao: `Oficina: ${conteudo}${isCurso ? ' (Curso Obrigatório)' : ''}` });
                    await upstash('SET', `jovem:${j.id}`, JSON.stringify(j));
                }
            }
        }
        renderizarOficinas(); document.getElementById('oficinaConteudo').value = ''; document.querySelectorAll('#listaJovensOficina input').forEach(cb => cb.checked = false); alert('✅ Oficina salva!'); await carregarTodosDados();
    } catch (err) { alert('Erro: ' + err.message); }
}

function renderizarOficinas() {
    renderizarJovensOficina();
    const div = document.getElementById('listaOficinas');
    if (!div) return;
    div.innerHTML = estado.oficinas.slice().reverse().map(o => {
        const dataFmt = new Date(o.data).toLocaleDateString('pt-BR');
        const jovensNomes = (o.jovensIds || []).map(id => { const j = estado.jovens.find(x => x.id === id); return j ? (j['NOME'] || j['REFERENCIA']) : 'Desconhecido'; });
        return `<div class="oficina-card ${o.reverte ? 'reverte' : ''}"><div class="info"><div class="titulo">📅 ${dataFmt} - ${o.periodo}</div><div class="detalhes"><span>${o.conteudo}</span><span>👥 ${jovensNomes.length} jovens</span></div><div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">${o.reverte ? '<span class="tag tag-green">✅ Benefício social</span>' : ''}${o.isCurso ? '<span class="tag tag-blue">📚 Curso</span>' : ''}${jovensNomes.map(n => `<span class="tag">${n}</span>`).join('')}</div></div><div><button onclick="abrirModalExclusao('oficina','${o.id}', '${o.conteudo}')" class="btn-sm btn-sm-danger">🗑️</button></div></div>`;
    }).join('');
}

// ============================================================
// PLANEJAMENTO
// ============================================================
async function salvarPlanejamento() {
    const data = document.getElementById('planData').value;
    const periodo = document.getElementById('planPeriodo').value;
    const titulo = document.getElementById('planTitulo').value.trim();
    const descricao = document.getElementById('planDesc').value.trim();
    const materiais = document.getElementById('planMats').value.trim();
    const reverte = document.getElementById('planReverte').checked;
    if (!data || !titulo) return alert('Preencha data e título.');
    const plan = { id: 'plan_' + Date.now(), data, periodo, titulo, descricao, materiais, reverte, realizada: false, dataCriacao: new Date().toISOString() };
    await upstash('SET', `planejamento:${plan.id}`, JSON.stringify(plan));
    await upstash('SADD', 'planejamentos:all', plan.id);
    estado.planejamentos.push(plan);
    document.getElementById('planData').value = ''; document.getElementById('planTitulo').value = ''; document.getElementById('planDesc').value = ''; document.getElementById('planMats').value = ''; document.getElementById('planReverte').checked = false;
    renderizarPlanejamentos(); alert('✅ Planejamento salvo!');
}

window.converterPlanejamentoEmOficina = function(planId) {
    const plan = estado.planejamentos.find(p => p.id === planId);
    if (!plan) return alert('Planejamento não encontrado.');
    document.getElementById('oficinaData').value = plan.data;
    document.getElementById('oficinaPeriodo').value = plan.periodo;
    document.getElementById('oficinaConteudo').value = `${plan.titulo}\n${plan.descricao || ''}`;
    document.getElementById('oficinaReverte').checked = plan.reverte;
    navigateTo('pageOficinas');
    plan.realizada = true; upstash('SET', `planejamento:${plan.id}`, JSON.stringify(plan)); alert('✅ Planejamento convertido!'); renderizarPlanejamentos();
};

function renderizarPlanejamentos() {
    const listaHTML = document.getElementById('listaPlanejamentosHTML');
    if (!listaHTML) return;
    const podeConverter = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) || estado.usuarioAtual?.nivel === 'oficineiro';
    listaHTML.innerHTML = estado.planejamentos.filter(p => !p.realizada).map(p => `
        <div style="background:#fff; border:1px solid #e2e8f0; border-left:4px solid ${p.reverte ? '#10b981' : '#3b82f6'}; padding:14px 16px; border-radius:10px; box-shadow:0 2px 4px rgba(0,0,0,0.04);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
                <div style="flex:1;">
                    <h4 style="color:#1e2a4a; margin-bottom:4px;">${p.titulo}</h4>
                    <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.8rem; color:#6b7280; margin-bottom:4px;">
                        <span>📅 ${new Date(p.data).toLocaleDateString('pt-BR')}</span>
                        <span>🕐 ${p.periodo}</span>
                        ${p.reverte ? '<span style="color:#10b981;">✅ Reverte</span>' : ''}
                    </div>
                    ${p.descricao ? `<p style="color:#475569; font-size:0.85rem; margin-bottom:4px;">${p.descricao}</p>` : ''}
                    ${p.materiais ? `<p style="font-size:0.75rem; color:#6b7280;"><strong>Materiais:</strong> ${p.materiais}</p>` : ''}
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    ${podeConverter ? `<button class="btn-sm btn-sm-success" onclick="converterPlanejamentoEmOficina('${p.id}')">🔄 Converter</button>` : ''}
                    <button class="btn-sm btn-sm-danger" onclick="abrirModalExclusao('planejamento', '${p.id}', '${p.titulo}')">🗑️</button>
                </div>
            </div>
        </div>
    `).join('') || '<p style="color:#6b7280; text-align:center; padding:1rem;">Nenhum planejamento salvo.</p>';
}

// ============================================================
// USUÁRIOS
// ============================================================
function renderizarUsuarios() {
    const tbody = document.getElementById('listaUsuarios');
    if (!tbody) return;
    const podeConfigurarHorarios = ['gestor','desenvolvedor','admin'].includes(estado.usuarioAtual?.nivel);
    const podeAlterarNivel = ['gestor','desenvolvedor','admin'].includes(estado.usuarioAtual?.nivel);
    const usuariosAtivos = estado.usuarios.filter(u => u.status === 'ativo');
    if (usuariosAtivos.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#6b7280;">Nenhum usuário ativo.</td></tr>'; return; }
    tbody.innerHTML = usuariosAtivos.map(u => {
        const isDesenvolvedor = u.nivel === 'desenvolvedor' || u.nivel === 'admin';
        const isProprioUsuario = u.id === estado.usuarioAtual?.id;
        let botoesHorarios = '';
        if (podeConfigurarHorarios) {
            if (isProprioUsuario) botoesHorarios = `<button onclick="abrirModalHorarios('${u.id}')" class="btn-sm btn-sm-primary">👤 Meu Horário</button>`;
            else if (isDesenvolvedor) botoesHorarios = `<span style="font-size:0.65rem; color:#10b981;">🔓 Irrestrito</span>`;
            else botoesHorarios = `<button onclick="abrirModalHorarios('${u.id}')" class="btn-sm btn-sm-warning">⏱️ Horários</button>`;
        }
        let botoesNivel = '';
        if (podeAlterarNivel && !isProprioUsuario && !isDesenvolvedor) {
            const niveis = ['gestor','tecnico','oficineiro','autoridade','jovem'];
            botoesNivel = `<select onchange="alterarNivelUsuario('${u.id}', this.value)" style="padding:2px 6px; font-size:0.7rem; border:1px solid #d1d9e6; border-radius:4px;"><option value="">Alterar</option>${niveis.map(n => `<option value="${n}" ${u.nivel === n ? 'selected' : ''}>${NIVEIS_ACESSO[n]?.nome || n}</option>`).join('')}</select>`;
        }
        const podeExcluir = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) && !isProprioUsuario;
        const botaoExcluir = podeExcluir ? `<button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-sm btn-sm-danger">🗑️</button>` : '';
        return `<tr><td>${u.nome||'-'}</td><td>${u.email||'-'}</td><td>${NIVEIS_ACESSO[u.nivel]?.nome||u.nivel||'-'} ${isDesenvolvedor ? '🛡️' : ''}</td><td><span style="color:#10b981;">${u.status}</span></td><td style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">${botoesHorarios} ${botoesNivel} ${botaoExcluir}</td></tr>`;
    }).join('');
}

window.alterarNivelUsuario = async function(userId, novoNivel) {
    if (!['gestor','desenvolvedor'].includes(estado.usuarioAtual?.nivel)) return alert('Sem permissão.');
    const user = estado.usuarios.find(u => u.id === userId);
    if (!user) return alert('Usuário não encontrado.');
    if (user.id === estado.usuarioAtual.id) return alert('Não pode alterar seu próprio nível.');
    if (user.nivel === 'desenvolvedor' && estado.usuarioAtual.nivel !== 'desenvolvedor') return alert('Apenas desenvolvedor pode alterar outro desenvolvedor.');
    if (!confirm(`Alterar nível de ${user.nome} para "${novoNivel}"?`)) return;
    const nivelAnterior = user.nivel;
    user.nivel = novoNivel;
    try { await upstash('SET', `user:${user.id}`, JSON.stringify(user)); await carregarTodosDados(); alert(`✅ Nível alterado: ${user.nome} ${nivelAnterior} → ${novoNivel}`); } catch (err) { alert('Erro: ' + err.message); }
};

function renderizarPendentes() {
    const tbody = document.getElementById('listaPendentes');
    if (!tbody) return;
    const pendentes = estado.usuarios.filter(u => u.status !== 'ativo');
    tbody.innerHTML = pendentes.map(u => `<tr><td>${u.nome||'-'}</td><td>${u.email||'-'}</td><td>${NIVEIS_ACESSO[u.nivel]?.nome||u.nivel||'-'}</td><td>${NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) ? `<button onclick="aprovarUsuario('${u.id}', '${u.nivel}')" class="btn-sm btn-sm-success">✅ Aprovar</button> <button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-sm btn-sm-danger">🗑️ Rejeitar</button>` : '<span style="color:#6b7280;">Aguardando</span>'}</td></tr>`).join('');
}

async function salvarNovoUsuario() {
    const nivel = document.getElementById('userNivel').value;
    if (nivel === 'desenvolvedor') return alert('Não é possível cadastrar Desenvolvedor.');
    const user = { id: 'usr_' + Date.now(), nome: document.getElementById('userNome').value.trim(), email: document.getElementById('userEmail').value.trim(), senha: document.getElementById('userSenha').value.trim(), nivel, status: 'ativo' };
    if (!user.nome || !user.email || !user.senha) return alert('Preencha todos os campos.');
    try { await upstash('SET', `user:${user.id}`, JSON.stringify(user)); await upstash('SADD', 'users:all', user.id); estado.usuarios.push(user); renderizarUsuarios(); ['userNome','userEmail','userSenha'].forEach(id => document.getElementById(id).value = ''); } catch (err) { alert('Erro: ' + err.message); }
}

window.aprovarUsuario = async function(id, nivel) {
    const user = estado.usuarios.find(u => u.id === id);
    if (!user) return;
    if (nivel === 'jovem') {
        estado._userParaVincular = user;
        const select = document.getElementById('selectVincularJovem');
        select.innerHTML = '<option value="">Selecione o Jovem...</option>' + estado.jovens.map(j => `<option value="${j['CPF'] || j.id}">${j['NOME'] || j['REFERENCIA']} (CPF: ${j['CPF'] || 'Não informado'})</option>`).join('');
        document.getElementById('modalVincularJovem').style.display = 'flex';
    } else {
        user.status = 'ativo';
        try { await upstash('SET', `user:${user.id}`, JSON.stringify(user)); await carregarTodosDados(); alert('✅ Usuário aprovado!'); } catch (err) { alert('Erro: ' + err.message); }
    }
};

function fecharModalVincular() { document.getElementById('modalVincularJovem').style.display = 'none'; estado._userParaVincular = null; }

async function salvarVinculoJovem() {
    const cpfOuId = document.getElementById('selectVincularJovem').value;
    if (!cpfOuId) return alert('Selecione um jovem.');
    const user = estado._userParaVincular;
    if (!user) return;
    user.cpf = cpfOuId; user.status = 'ativo';
    try { await upstash('SET', `user:${user.id}`, JSON.stringify(user)); fecharModalVincular(); await carregarTodosDados(); alert('✅ Jovem vinculado e aprovado!'); } catch (err) { alert('Erro: ' + err.message); }
}

// ============================================================
// HORÁRIOS DE ACESSO
// ============================================================
window.abrirModalHorarios = function(id) {
    const u = estado.usuarios.find(x => x.id === id);
    if (!u) return alert('Usuário não encontrado.');
    estado.usuarioEdicaoHorario = u;
    document.getElementById('nomeUserHorario').textContent = u.nome;
    const dias = ['segunda','terca','quarta','quinta','sexta'];
    const cfg = u.horarios || {};
    document.getElementById('gridHorarios').innerHTML = `<div style="background:#f0fdf4; padding:8px 12px; border-radius:8px; margin-bottom:12px; border:1px solid #86efac;"><strong>👤 ${u.nome}</strong> <span style="margin-left:10px; font-size:0.75rem; color:#6b7280;">(${NIVEIS_ACESSO[u.nivel]?.nome||u.nivel})</span></div><label style="font-weight:600; display:block; margin-bottom:8px;"><input type="checkbox" id="horariosAtivosGlobais" ${u.horariosConfigurados ? 'checked' : ''}> Limitar Acesso por Horário</label><div id="diasContainer" style="display:${u.horariosConfigurados ? 'block' : 'none'}; margin-top:10px;">${dias.map(d => `<div style="display:flex; gap:10px; align-items:center; margin-bottom:6px; flex-wrap:wrap; background:#f8fafc; padding:4px 10px; border-radius:6px;"><input type="checkbox" id="chk_${d}" ${cfg[d]?.ativo ? 'checked' : ''}> <span style="width:70px; text-transform:capitalize; font-weight:500;">${d}</span> <input type="time" id="ini_${d}" value="${cfg[d]?.inicio || '08:00'}" style="padding:4px 8px; border:1px solid #d1d9e6; border-radius:4px;"> até <input type="time" id="fim_${d}" value="${cfg[d]?.fim || '17:00'}" style="padding:4px 8px; border:1px solid #d1d9e6; border-radius:4px;"></div>`).join('')}</div><p style="font-size:0.7rem; color:#6b7280; margin-top:6px;">* Desenvolvedores têm acesso irrestrito.</p>`;
    document.getElementById('horariosAtivosGlobais').onchange = (e) => { document.getElementById('diasContainer').style.display = e.target.checked ? 'block' : 'none'; };
    document.getElementById('modalHorarios').style.display = 'flex';
};

window.salvarHorariosUsuario = async function() {
    const u = estado.usuarioEdicaoHorario;
    if (!u) return;
    u.horariosConfigurados = document.getElementById('horariosAtivosGlobais').checked;
    u.horarios = {};
    ['segunda','terca','quarta','quinta','sexta'].forEach(d => {
        u.horarios[d] = { ativo: document.getElementById(`chk_${d}`).checked, inicio: document.getElementById(`ini_${d}`).value, fim: document.getElementById(`fim_${d}`).value };
    });
    try { await upstash('SET', `user:${u.id}`, JSON.stringify(u)); document.getElementById('modalHorarios').style.display = 'none'; alert('✅ Horários salvos!'); await carregarTodosDados(); } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// MENSAGENS
// ============================================================
function renderizarMensagens() {
    const div = document.getElementById('listaMensagens');
    if (!div) return;
    const destinatario = document.getElementById('msgDestinatario');
    if (destinatario) {
        const usuariosAtivos = estado.usuarios.filter(u => u.status === 'ativo' && u.id !== estado.usuarioAtual?.id);
        const autoridades = usuariosAtivos.filter(u => u.nivel === 'autoridade' || u.nivel === 'gestor');
        destinatario.innerHTML = '<option value="">Selecione...</option>' + autoridades.map(u => `<option value="${u.id}">${u.nome} (${NIVEIS_ACESSO[u.nivel]?.nome||u.nivel})</option>`).join('');
    }
    const mensagens = estado.mensagens.filter(m => m.para === estado.usuarioAtual?.id || m.de === estado.usuarioAtual?.id).sort((a,b) => new Date(b.data) - new Date(a.data));
    div.innerHTML = mensagens.length > 0 ? mensagens.map(m => {
        const remetente = estado.usuarios.find(u => u.id === m.de);
        const isParaMim = m.para === estado.usuarioAtual?.id;
        return `<div style="background:${isParaMim ? '#eff6ff' : '#f8fafc'}; border-radius:8px; padding:10px 14px; margin-bottom:6px; border-left:4px solid ${isParaMim ? '#3b82f6' : '#6c757d'};"><div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;"><div><strong>${remetente?.nome || 'Sistema'}</strong><span style="font-size:0.65rem; color:#6b7280; margin-left:8px;">${new Date(m.data).toLocaleString('pt-BR')}</span></div><span style="font-size:0.65rem; color:#6b7280;">${isParaMim ? '📩 Recebida' : '📤 Enviada'}</span></div><div style="font-weight:500; margin-top:4px;">${m.assunto}</div><div style="color:#475569; margin-top:4px;">${m.texto}</div></div>`;
    }).join('') : '<p style="color:#6b7280; text-align:center; padding:1rem;">Nenhuma mensagem.</p>';
}

async function enviarMensagem() {
    const para = document.getElementById('msgDestinatario').value;
    const assunto = document.getElementById('msgAssunto').value.trim();
    const texto = document.getElementById('msgTexto').value.trim();
    if (!para || !assunto || !texto) return alert('Preencha todos os campos.');
    const msg = { id: 'msg_' + Date.now(), de: estado.usuarioAtual.id, para, assunto, texto, data: new Date().toISOString(), lida: false };
    try { await upstash('SET', `mensagem:${msg.id}`, JSON.stringify(msg)); await upstash('SADD', 'mensagens:all', msg.id); estado.mensagens.push(msg); document.getElementById('msgAssunto').value = ''; document.getElementById('msgTexto').value = ''; renderizarMensagens(); alert('✅ Mensagem enviada!'); } catch (err) { alert('Erro: ' + err.message); }
}

// ============================================================
// PROFISSIONAIS
// ============================================================
function renderizarProfissionais() {
    const div = document.getElementById('listaProfissionais');
    if (!div) return;
    div.innerHTML = estado.profissionais.map(p => `<div style="background:#f8fafc; border-radius:12px; padding:10px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; border-left:4px solid #2c3e66;"><div><strong>${p.nome || 'Sem nome'}</strong>${p.funcao ? `<span style="color:#6b7280; margin-left:8px;">${p.funcao}</span>` : ''}${p.registro ? `<span style="font-size:0.7rem; color:#6b7280; margin-left:8px;">Reg: ${p.registro}</span>` : ''}${p.numero ? `<span style="font-size:0.7rem; color:#6b7280; margin-left:8px;">Nº ${p.numero}</span>` : ''}</div><div><button onclick="abrirModalExclusao('profissional', '${p.id}', '${p.nome}')" class="btn-sm btn-sm-danger">🗑️</button></div></div>`).join('') || '<p style="color:#6b7280; text-align:center; padding:1rem;">Nenhum profissional cadastrado.</p>';
}

async function salvarProfissional() {
    const nome = document.getElementById('profNome').value.trim();
    if (!nome) return alert('Preencha o nome.');
    const profissional = { id: 'prof_' + Date.now(), nome, funcao: document.getElementById('profFuncao').value.trim(), registro: document.getElementById('profRegistro').value.trim(), numero: document.getElementById('profNumero').value.trim() };
    try { await upstash('SET', `profissional:${profissional.id}`, JSON.stringify(profissional)); await upstash('SADD', 'profissionais:all', profissional.id); estado.profissionais.push(profissional); document.getElementById('profNome').value = ''; document.getElementById('profFuncao').value = ''; document.getElementById('profRegistro').value = ''; document.getElementById('profNumero').value = ''; renderizarProfissionais(); alert('✅ Profissional salvo!'); } catch (err) { alert('Erro: ' + err.message); }
}

// ============================================================
// EXCLUSÃO
// ============================================================
window.abrirModalExclusao = function(tipo, id, nome) {
    estado.exclusaoPendente = { tipo, id };
    document.getElementById('textoConfirmExclusao').textContent = `Apagar permanentemente: ${nome}`;
    document.getElementById('modalConfirmExclusao').style.display = 'flex';
};

window.executarExclusao = async function() {
    if (!estado.exclusaoPendente) return;
    const { tipo, id } = estado.exclusaoPendente;
    try {
        if (tipo === 'jovem') { await upstash('DEL', `jovem:${id}`); await upstash('SREM', 'jovens:all', id); estado.jovens = estado.jovens.filter(j => j.id !== id); estado.selecionadosLote.delete(id); }
        else if (tipo === 'usuario') { await upstash('DEL', `user:${id}`); await upstash('SREM', 'users:all', id); estado.usuarios = estado.usuarios.filter(u => u.id !== id); }
        else if (tipo === 'oficina') { await upstash('DEL', `oficina:${id}`); await upstash('SREM', 'oficinas:all', id); estado.oficinas = estado.oficinas.filter(o => o.id !== id); }
        else if (tipo === 'planejamento') { await upstash('DEL', `planejamento:${id}`); await upstash('SREM', 'planejamentos:all', id); estado.planejamentos = estado.planejamentos.filter(p => p.id !== id); }
        else if (tipo === 'profissional') { await upstash('DEL', `profissional:${id}`); await upstash('SREM', 'profissionais:all', id); estado.profissionais = estado.profissionais.filter(p => p.id !== id); }
        document.getElementById('modalConfirmExclusao').style.display = 'none';
        await carregarTodosDados();
        alert('✅ Registro excluído!');
    } catch (err) { alert('Erro: ' + err.message); }
};

// ============================================================
// CONFIGURAÇÕES
// ============================================================
async function salvarNovaSenha() {
    const s1 = document.getElementById('novaSenhaInput').value;
    const s2 = document.getElementById('confirmarNovaSenhaInput').value;
    if (!s1 || s1.length < 6) return alert('Mínimo 6 caracteres.');
    if (s1 !== s2) return alert('Senhas não coincidem.');
    try { estado.usuarioAtual.senha = s1; await upstash('SET', `user:${estado.usuarioAtual.id}`, JSON.stringify(estado.usuarioAtual)); alert('Senha alterada!'); document.getElementById('novaSenhaInput').value = ''; document.getElementById('confirmarNovaSenhaInput').value = ''; } catch (err) { alert('Erro: ' + err.message); }
}

async function carregarLogo() {
    try {
        const logoBase64 = await upstash('GET', 'config:logo');
        if (logoBase64) {
            const logoLogin = document.getElementById('logoLogin');
            if (logoLogin) { logoLogin.src = logoBase64; logoLogin.style.display = 'block'; }
            estado._logoBase64 = logoBase64;
        }
    } catch (e) { console.error('Erro logo', e); }
}

async function salvarLogo() {
    const fileInput = document.getElementById('novaLogoInput');
    if (!fileInput || !fileInput.files[0]) return alert('Selecione uma imagem.');
    try {
        const base64 = await fileToBase64(fileInput.files[0]);
        await upstash('SET', 'config:logo', base64);
        const logoLogin = document.getElementById('logoLogin');
        if (logoLogin) { logoLogin.src = base64; logoLogin.style.display = 'block'; }
        estado._logoBase64 = base64;
        alert('Logo atualizado!');
        fileInput.value = '';
    } catch (err) { alert('Erro: ' + err.message); }
}

// ============================================================
// DASHBOARD JOVEM
// ============================================================
function renderizarDashboardJovem() {
    const cards = document.getElementById('jovemInfoCards');
    const freqDiv = document.getElementById('jovemFrequencia');
    if (!cards || !freqDiv) return;
    if (estado.jovens.length === 0) { cards.innerHTML = '<p style="color:#6b7280;">Nenhum dado.</p>'; freqDiv.innerHTML = ''; return; }
    const jovem = estado.jovens[0];
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        const concluidas = acoes.filter(a => a.realizado).length;
        const progresso = acoes.length > 0 ? ((concluidas / acoes.length) * 100).toFixed(0) : 0;
        const profissional = estado.usuarios.find(u => u.id === jovem.profissionalLA);
        cards.innerHTML = `<div class="card"><h4>Nome</h4><p>${jovem['NOME']||'-'}</p></div><div class="card"><h4>Medida</h4><p>LA</p></div><div class="card"><h4>Ações Concluídas</h4><p style="font-size:1.3rem; color:#10b981;">${concluidas}/${acoes.length}</p></div><div class="card"><h4>Progresso</h4><p style="font-size:1.3rem; color:#3b82f6;">${progresso}%</p></div>${profissional ? `<div class="card"><h4>Técnico</h4><p>${profissional.nome}</p></div>` : ''}`;
        freqDiv.innerHTML = `<div class="card" style="margin-top:12px;"><h3>📝 Minhas Ações</h3><ul style="list-style:none; padding:0; margin-top:12px;">${acoes.map(a => `<li style="padding:8px 12px; background:${a.realizado ? '#d1fae5' : '#fffbeb'}; margin-bottom:6px; border-radius:6px; border-left:4px solid ${a.realizado ? '#10b981' : '#f59e0b'}; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;"><span>${a.texto} ${a.prazo ? `<span style="font-size:0.65rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span>` : ''}</span><span style="color:${a.realizado ? '#065f46' : '#92400e'};">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span></li>`).join('')}</ul></div>`;
    } else {
        const horasTotal = parseFloat(jovem['HORAS'] || 0);
        const hist = jovem.historicoFrequencia || [];
        const saldo = calcularSaldo(jovem);
        cards.innerHTML = `<div class="card"><h4>Nome</h4><p>${jovem['NOME']||'-'}</p></div><div class="card"><h4>Horas a Cumprir</h4><p style="font-size:1.3rem; color:#2c3e66;">${horasTotal}h</p></div><div class="card"><h4>Horas Cumpridas</h4><p style="font-size:1.3rem; color:#10b981;">${calcularHorasCumpridas(jovem)}h</p></div><div class="card"><h4>Saldo</h4><p style="font-size:1.3rem; color:#f59e0b;">${saldo}h</p></div>`;
        freqDiv.innerHTML = `<div class="card" style="margin-top:12px;"><h3>📊 Minhas Frequências</h3>${hist.length > 0 ? `<table style="width:100%; margin-top:8px;"><thead><tr><th>Data</th><th>Horas</th><th>Obs</th></tr></thead><tbody>${hist.map(h => `<tr><td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</td><td>${h.horas}h</td><td>${h.observacao||'-'}</td></tr>`).join('')}</tbody></table>` : '<p style="color:#6b7280;">Nenhum registro.</p>'}</div>`;
    }
}

// ============================================================
// EXPORTAR EXCEL – IDÊNTICO AO IMPORTE
// ============================================================
function exportarExcel() {
    const camposPlanilha = [
        'REFERENCIA','NOME','NOME DO RESPONSÁVEL','REINCIDÊNCIA','MEDIDA',
        'MESES','HORAS','PROTETIVA','NASC.','MÊS ANIVERSARIO','NATURALIDADE',
        'IDADE','GÊNERO','COR','COMPOSIÇÃO FAMILIAR','RENDA','BENEFICIO',
        'PAA','ENDEREÇO','BAIRRO','TELEFONE','CRAS','UBS','CPF',
        'ESTUDA?','SÉRIE','ESCOLA','TRABALHA?','FUNÇÃO','VINCULO','REDE',
        'USO DE SPA?','QUAL?','PREFERE NOME SOCIAL?','QUAL NOME SOCIAL?'
    ];
    const headerMap = {
        'REFERENCIA':'REFERENCIA','NOME':'NOME','NOME DO RESPONSÁVEL':'NOME DO RESPONSÁVEL',
        'REINCIDÊNCIA':'REINCIDÊNCIA','MEDIDA':'MEDIDA','MESES':'MESES','HORAS':'HORAS',
        'PROTETIVA':'PROTETIVA','NASC.':'NASC.','MÊS ANIVERSARIO':'MÊS ANIVERSARIO',
        'NATURALIDADE':'NATURALIDADE','IDADE':'IDADE','GÊNERO':'GÊNERO','COR':'COR',
        'COMPOSIÇÃO FAMILIAR':'COMPOSIÇÃO FAMILIAR','RENDA':'RENDA','BENEFICIO':'BENEFICIO',
        'PAA':'PAA','ENDEREÇO':'ENDEREÇO','BAIRRO':'BAIRRO','TELEFONE':'TELEFONE',
        'CRAS':'CRAS','UBS':'UBS','CPF':'CPF','ESTUDA?':'ESTUDA?','SÉRIE':'SÉRIE',
        'ESCOLA':'ESCOLA','TRABALHA?':'TRABALHA?','FUNÇÃO':'FUNÇÃO','VINCULO':'VÍNCULO',
        'REDE':'REDE','USO DE SPA?':'USO DE SPA?','QUAL?':'QUAL?',
        'PREFERE NOME SOCIAL?':'PREFERE NOME SOCIAL?','QUAL NOME SOCIAL?':'QUAL NOME SOCIAL?'
    };
    const data = estado.jovens.map(j => {
        const row = {};
        camposPlanilha.forEach(campo => {
            const header = headerMap[campo] || campo;
            const chave = Object.keys(j).find(k => k === campo || k === header);
            row[header] = chave ? (j[chave] || '') : '';
        });
        row['STATUS'] = j.status || 'REGULAR';
        row['HORAS_ATRIBUIDAS'] = j['HORAS'] || 0;
        row['HORAS_CUMPRIDAS'] = calcularHorasCumpridas(j);
        row['SALDO'] = calcularSaldo(j);
        if (j['ID_DIGITAL']) row['ID_DIGITAL'] = j['ID_DIGITAL'];
        return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Jovens');
    const colWidths = [];
    const headers = Object.keys(data[0] || {});
    headers.forEach(h => {
        let maxLen = h.length;
        data.forEach(row => { const val = String(row[h] || ''); if (val.length > maxLen) maxLen = val.length; });
        colWidths.push({ wch: Math.min(Math.max(maxLen + 2, 12), 40) });
    });
    ws['!cols'] = colWidths;
    XLSX.writeFile(wb, `relatorio_jovens_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ============================================================
// IMPORTAR PLANILHA – CORRIGIDO E OTIMIZADO
// ============================================================
async function importarPlanilha() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return alert('Nenhum arquivo.');
        const statusDiv = document.getElementById('statusImportacao');
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#fffbeb';
        statusDiv.style.color = '#92400e';
        statusDiv.textContent = '⏳ Processando planilha...';
        try {
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { type: 'array', cellStyles: false, cellDates: false, cellFormula: false, sheetRows: 2000 });
            
            // === IDENTIFICAR A ABA CORRETA ===
            let sheetName = 'GERAL'; // Nome da aba principal
            if (!wb.SheetNames.includes(sheetName)) {
                // Se não encontrar "GERAL", pega a primeira aba
                sheetName = wb.SheetNames[0];
            }
            const ws = wb.Sheets[sheetName];
            if (!ws) throw new Error(`Aba "${sheetName}" não encontrada.`);
            
            // === CONVERTER PARA JSON ===
            const rows = XLSX.utils.sheet_to_json(ws, { 
                raw: true, 
                defval: '', 
                header: 1  // Array de arrays para melhor controle
            });
            
            if (!rows || rows.length === 0) throw new Error('Planilha vazia.');
            
            // === ENCONTRAR CABEÇALHO ===
            let headerRowIndex = -1;
            let headerRow = null;
            
            for (let i = 0; i < Math.min(30, rows.length); i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;
                
                // Verificar se é a linha de cabeçalho (contém "NOME" e outras colunas chave)
                const rowStr = row.join(' ').toUpperCase();
                if (rowStr.includes('NOME') && (rowStr.includes('MEDIDA') || rowStr.includes('NASC') || rowStr.includes('CPF'))) {
                    headerRowIndex = i;
                    headerRow = row;
                    break;
                }
            }
            
            if (headerRowIndex === -1 || !headerRow) {
                // Tentar encontrar pelo nome da primeira coluna
                for (let i = 0; i < Math.min(30, rows.length); i++) {
                    const row = rows[i];
                    if (!row || row.length === 0) continue;
                    const firstCell = String(row[0] || '').toUpperCase().trim();
                    if (firstCell === 'NOME') {
                        headerRowIndex = i;
                        headerRow = row;
                        break;
                    }
                }
            }
            
            if (headerRowIndex === -1 || !headerRow) {
                throw new Error('Cabeçalho da planilha não encontrado.');
            }
            
            // === MAPEAMENTO DE COLUNAS ===
            // Mapeia os nomes das colunas para índices
            const colMap = {};
            const headerMap = {
                'REFERENCIA': ['REFERENCIA', 'REFERÊNCIA', 'REF'],
                'NOME': ['NOME', 'NOME COMPLETO'],
                'NOME DO RESPONSÁVEL': ['NOME DO RESPONSÁVEL', 'RESPONSÁVEL'],
                'REINCIDÊNCIA': ['REINCIDÊNCIA', 'REINCIDENCIA'],
                'MEDIDA': ['MEDIDA', 'MSE', 'MEDIDA SOCIOEDUCATIVA'],
                'MESES': ['MESES'],
                'HORAS': ['HORAS', 'TOTAL HORAS', 'HORAS_ATRIBUIDAS'],
                'PROTETIVA': ['PROTETIVA'],
                'NASC.': ['NASC.', 'NASCIMENTO', 'DATA NASC'],
                'MÊS ANIVERSARIO': ['MÊS ANIVERSARIO', 'MÊS ANIVER.'],
                'NATURALIDADE': ['NATURALIDADE'],
                'IDADE': ['IDADE'],
                'GÊNERO': ['GÊNERO', 'GENERO'],
                'COR': ['COR'],
                'COMPOSIÇÃO FAMILIAR': ['COMPOSIÇÃO FAMILIAR'],
                'RENDA': ['RENDA'],
                'BENEFICIO': ['BENEFICIO', 'BENEFÍCIO'],
                'PAA': ['PAA'],
                'ENDEREÇO': ['ENDEREÇO', 'ENDERECO'],
                'BAIRRO': ['BAIRRO'],
                'TELEFONE': ['TELEFONE', 'TEL', 'TELEFONE1'],
                'CRAS': ['CRAS'],
                'UBS': ['UBS'],
                'CPF': ['CPF'],
                'ESTUDA?': ['ESTUDA?', 'ESTUDA'],
                'SÉRIE': ['SÉRIE', 'SERIE'],
                'ESCOLA': ['ESCOLA'],
                'TRABALHA?': ['TRABALHA?', 'TRABALHA'],
                'FUNÇÃO': ['FUNÇÃO', 'FUNCAO'],
                'VINCULO': ['VINCULO', 'VÍNCULO'],
                'REDE': ['REDE'],
                'USO DE SPA?': ['USO DE SPA?', 'USO DE SPA'],
                'QUAL?': ['QUAL?', 'QUAL'],
                'PREFERE NOME SOCIAL?': ['PREFERE NOME SOCIAL?'],
                'QUAL NOME SOCIAL?': ['QUAL NOME SOCIAL?', 'NOME SOCIAL']
            };
            
            for (const [campo, possiveisNomes] of Object.entries(headerMap)) {
                for (let i = 0; i < headerRow.length; i++) {
                    const cell = String(headerRow[i] || '').toUpperCase().trim();
                    for (const nome of possiveisNomes) {
                        if (cell === nome.toUpperCase() || cell.includes(nome.toUpperCase())) {
                            colMap[campo] = i;
                            break;
                        }
                    }
                    if (colMap[campo] !== undefined) break;
                }
            }
            
            // Verificar se encontrou a coluna NOME
            if (colMap['NOME'] === undefined) {
                throw new Error('Coluna "NOME" não encontrada. Verifique o cabeçalho da planilha.');
            }
            
            console.log('✅ Mapeamento de colunas:', colMap);
            
            // === EXTRAIR DADOS ===
            const dataRows = [];
            for (let i = headerRowIndex + 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;
                
                // Verificar se a linha tem algum dado relevante
                const hasData = row.some(cell => cell && String(cell).trim() !== '');
                if (!hasData) continue;
                
                // Verificar se é uma linha de legenda ou título
                const firstCell = String(row[0] || '').toUpperCase().trim();
                const palavrasIgnorar = ['NOVOS ADOLESCENTES', 'REGULAR', 'IRREGULAR', 'EM DESCUMPRIMENTO', 
                                        'CÓDIGOS FAMILIARES', 'PACTUAÇÃO', 'MEDIDA FINALIZADA', 'LEGENDA',
                                        'TOTAL', 'NOME', 'REFERENCIA', 'SITUAÇÃO', 'STATUS', 'TER', 'QUIN', 'SÁB'];
                let ignorar = false;
                for (const palavra of palavrasIgnorar) {
                    if (firstCell.includes(palavra)) {
                        ignorar = true;
                        break;
                    }
                }
                if (ignorar) continue;
                
                dataRows.push(row);
            }
            
            if (dataRows.length === 0) throw new Error('Nenhuma linha de dados encontrada.');
            
            console.log(`📊 Encontrados ${dataRows.length} jovens para importar.`);
            
            // === PROCESSAR DADOS ===
            let importados = 0, atualizados = 0, erros = 0;
            statusDiv.textContent = `⏳ Importando ${dataRows.length} jovens...`;
            
            for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
                const row = dataRows[rowIndex];
                try {
                    if (rowIndex % 10 === 0) {
                        statusDiv.textContent = `⏳ Importando ${rowIndex + 1}/${dataRows.length}...`;
                        await new Promise(r => setTimeout(r, 10));
                    }
                    
                    // Extrair nome
                    let nome = '';
                    if (colMap['NOME'] !== undefined && row[colMap['NOME']]) {
                        nome = String(row[colMap['NOME']]).trim();
                    }
                    if (!nome && colMap['REFERENCIA'] !== undefined && row[colMap['REFERENCIA']]) {
                        nome = String(row[colMap['REFERENCIA']]).trim();
                    }
                    if (!nome) continue;
                    
                    // Buscar jovem existente por CPF ou nome
                    let jovemExistente = null;
                    let cpfPlanilha = '';
                    if (colMap['CPF'] !== undefined && row[colMap['CPF']]) {
                        cpfPlanilha = String(row[colMap['CPF']]).replace(/\D/g, '');
                        if (cpfPlanilha && cpfPlanilha.length >= 11) {
                            jovemExistente = estado.jovens.find(j => (j['CPF'] || '').replace(/\D/g, '') === cpfPlanilha);
                        }
                    }
                    if (!jovemExistente) {
                        const nomeBusca = nome.toUpperCase().trim();
                        jovemExistente = estado.jovens.find(j => {
                            const jNome = (j['NOME'] || '').toUpperCase().trim();
                            return jNome === nomeBusca || jNome.includes(nomeBusca) || nomeBusca.includes(jNome);
                        });
                    }
                    
                    // Construir objeto do jovem
                    const dadosJovem = {
                        'NOME': nome,
                        'REFERENCIA': colMap['REFERENCIA'] !== undefined ? String(row[colMap['REFERENCIA']] || '').trim() : '',
                        'NOME DO RESPONSÁVEL': colMap['NOME DO RESPONSÁVEL'] !== undefined ? String(row[colMap['NOME DO RESPONSÁVEL']] || '').trim() : '',
                        'REINCIDÊNCIA': colMap['REINCIDÊNCIA'] !== undefined ? String(row[colMap['REINCIDÊNCIA']] || '').trim() : '',
                        'MEDIDA': colMap['MEDIDA'] !== undefined ? String(row[colMap['MEDIDA']] || '').trim() : '',
                        'MESES': colMap['MESES'] !== undefined ? String(row[colMap['MESES']] || '').trim() : '',
                        'HORAS': colMap['HORAS'] !== undefined ? parseNum(row[colMap['HORAS']]) : 0,
                        'PROTETIVA': colMap['PROTETIVA'] !== undefined ? String(row[colMap['PROTETIVA']] || '').trim() : '',
                        'NASC.': colMap['NASC.'] !== undefined ? parseDataBrasil(row[colMap['NASC.']]) : '',
                        'NATURALIDADE': colMap['NATURALIDADE'] !== undefined ? String(row[colMap['NATURALIDADE']] || '').trim() : '',
                        'IDADE': colMap['IDADE'] !== undefined ? parseInt(row[colMap['IDADE']]) || 0 : 0,
                        'GÊNERO': colMap['GÊNERO'] !== undefined ? String(row[colMap['GÊNERO']] || '').trim() : '',
                        'COR': colMap['COR'] !== undefined ? String(row[colMap['COR']] || '').trim() : '',
                        'COMPOSIÇÃO FAMILIAR': colMap['COMPOSIÇÃO FAMILIAR'] !== undefined ? String(row[colMap['COMPOSIÇÃO FAMILIAR']] || '').trim() : '',
                        'RENDA': colMap['RENDA'] !== undefined ? String(row[colMap['RENDA']] || '').trim() : '',
                        'BENEFICIO': colMap['BENEFICIO'] !== undefined ? String(row[colMap['BENEFICIO']] || '').trim() : '',
                        'PAA': colMap['PAA'] !== undefined ? String(row[colMap['PAA']] || '').trim() : '',
                        'ENDEREÇO': colMap['ENDEREÇO'] !== undefined ? String(row[colMap['ENDEREÇO']] || '').trim() : '',
                        'BAIRRO': colMap['BAIRRO'] !== undefined ? String(row[colMap['BAIRRO']] || '').trim() : '',
                        'TELEFONE': colMap['TELEFONE'] !== undefined ? String(row[colMap['TELEFONE']] || '').trim() : '',
                        'CRAS': colMap['CRAS'] !== undefined ? String(row[colMap['CRAS']] || '').trim() : '',
                        'UBS': colMap['UBS'] !== undefined ? String(row[colMap['UBS']] || '').trim() : '',
                        'CPF': colMap['CPF'] !== undefined ? String(row[colMap['CPF']] || '').trim() : '',
                        'ESTUDA?': colMap['ESTUDA?'] !== undefined ? String(row[colMap['ESTUDA?']] || '').trim() : '',
                        'SÉRIE': colMap['SÉRIE'] !== undefined ? String(row[colMap['SÉRIE']] || '').trim() : '',
                        'ESCOLA': colMap['ESCOLA'] !== undefined ? String(row[colMap['ESCOLA']] || '').trim() : '',
                        'TRABALHA?': colMap['TRABALHA?'] !== undefined ? String(row[colMap['TRABALHA?']] || '').trim() : '',
                        'FUNÇÃO': colMap['FUNÇÃO'] !== undefined ? String(row[colMap['FUNÇÃO']] || '').trim() : '',
                        'VINCULO': colMap['VINCULO'] !== undefined ? String(row[colMap['VINCULO']] || '').trim() : '',
                        'REDE': colMap['REDE'] !== undefined ? String(row[colMap['REDE']] || '').trim() : '',
                        'USO DE SPA?': colMap['USO DE SPA?'] !== undefined ? String(row[colMap['USO DE SPA?']] || '').trim() : '',
                        'QUAL?': colMap['QUAL?'] !== undefined ? String(row[colMap['QUAL?']] || '').trim() : '',
                        'PREFERE NOME SOCIAL?': colMap['PREFERE NOME SOCIAL?'] !== undefined ? String(row[colMap['PREFERE NOME SOCIAL?']] || '').trim() : '',
                        'QUAL NOME SOCIAL?': colMap['QUAL NOME SOCIAL?'] !== undefined ? String(row[colMap['QUAL NOME SOCIAL?']] || '').trim() : '',
                    };
                    
                    // Normalizar gênero
                    if (dadosJovem['GÊNERO']) {
                        const g = dadosJovem['GÊNERO'].toUpperCase();
                        if (g.includes('MASC')) dadosJovem['GÊNERO'] = 'M';
                        else if (g.includes('FEM')) dadosJovem['GÊNERO'] = 'F';
                        else if (g.includes('NB') || g.includes('NÃO BINÁRIO')) dadosJovem['GÊNERO'] = 'NB';
                    }
                    
                    // Se tem data de nascimento, calcular mês aniversário
                    if (dadosJovem['NASC.']) {
                        const dataNasc = new Date(dadosJovem['NASC.']);
                        if (!isNaN(dataNasc.getTime())) {
                            const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                            dadosJovem['MÊS ANIVERSARIO'] = meses[dataNasc.getMonth()];
                        }
                    }
                    
                    // Se tem status na planilha, usar
                    let status = 'REGULAR';
                    if (colMap['STATUS'] !== undefined && row[colMap['STATUS']]) {
                        const statusRaw = String(row[colMap['STATUS']]).toUpperCase().trim();
                        const statusMap = {
                            'REGULAR': 'REGULAR',
                            'IRREGULAR': 'IRREGULAR',
                            'EM DESCUMPRIMENTO': 'EM DESCUMPRIMENTO',
                            'SUSPENSO': 'SUSPENSO',
                            'MEDIDA FINALIZADA': 'MEDIDA FINALIZADA',
                            'LIBERADO': 'LIBERADO'
                        };
                        for (const [key, value] of Object.entries(statusMap)) {
                            if (statusRaw.includes(key) || key.includes(statusRaw)) {
                                status = value;
                                break;
                            }
                        }
                    }
                    
                    // Salvar ou atualizar
                    if (jovemExistente) {
                        // Atualizar dados mantendo histórico
                        const jovemAtualizado = { ...jovemExistente };
                        for (const [key, value] of Object.entries(dadosJovem)) {
                            if (value !== undefined && value !== '') {
                                jovemAtualizado[key] = value;
                            }
                        }
                        jovemAtualizado.status = status;
                        await upstash('SET', `jovem:${jovemExistente.id}`, JSON.stringify(jovemAtualizado));
                        const index = estado.jovens.findIndex(j => j.id === jovemExistente.id);
                        if (index !== -1) estado.jovens[index] = jovemAtualizado;
                        atualizados++;
                    } else {
                        // Criar novo jovem
                        const novoId = 'j_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                        const novoJovem = {
                            id: novoId,
                            status: status,
                            historicoFrequencia: [],
                            observacoes: [],
                            documentos: [],
                            acoesLA: [],
                            avaliacoes: [],
                            'HORAS': dadosJovem['HORAS'] || 0,
                            'HORAS_CUMPRIDAS': 0,
                            'SALDO': 0,
                            ...dadosJovem
                        };
                        // Garantir que todos os campos existam
                        for (const [key] of CAMPOS) {
                            if (novoJovem[key] === undefined) novoJovem[key] = '';
                        }
                        await upstash('SET', `jovem:${novoId}`, JSON.stringify(novoJovem));
                        await upstash('SADD', 'jovens:all', novoId);
                        estado.jovens.push(novoJovem);
                        importados++;
                    }
                } catch (rowError) {
                    erros++;
                    console.error('Erro na linha:', rowIndex, rowError);
                }
            }
            
            // === FINALIZAR ===
            await carregarTodosDados();
            
            let mensagem = `✅ Importação concluída!`;
            if (importados > 0) mensagem += ` ${importados} novos jovens importados.`;
            if (atualizados > 0) mensagem += ` ${atualizados} jovens atualizados.`;
            if (erros > 0) mensagem += ` ⚠️ ${erros} erros.`;
            mensagem += ` Total de jovens: ${estado.jovens.length}`;
            
            statusDiv.style.background = '#d1fae5';
            statusDiv.style.color = '#065f46';
            statusDiv.textContent = mensagem;
            
            // Atualizar interface
            carregarLista();
            renderizarDashboard();
            renderizarAcompanhamento();
            popularSelectAcompInd();
            renderizarRelatorios();
            
            alert(mensagem);
            
        } catch (err) {
            statusDiv.style.background = '#fee2e2';
            statusDiv.style.color = '#991b1b';
            statusDiv.textContent = '❌ Erro: ' + err.message;
            alert('Erro na importação: ' + err.message);
            console.error('Erro detalhado:', err);
        }
    };
    input.click();
}

// ============================================================
// AVISO E POLLING
// ============================================================
function exibirAvisoObservacoes() {}

function iniciarPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        if (estado.usuarioAtual && estado.usuarioAtual.nivel !== 'jovem') {
            try { await carregarTodosDados(); } catch (e) { console.error('Polling error:', e); }
        }
    }, 60000);
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    // Eventos de login/cadastro
    document.getElementById('loginBtn').addEventListener('click', fazerLogin);
    document.getElementById('loginSenha').addEventListener('keypress', e => { if (e.key === 'Enter') fazerLogin(); });
    document.getElementById('logoutBtn').addEventListener('click', deslogarSistema);
    document.getElementById('mostrarCadastroBtn').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('telaLogin').style.display = 'none'; document.getElementById('telaCadastro').style.display = 'flex'; });
    document.getElementById('voltarLoginBtn').addEventListener('click', () => { document.getElementById('telaCadastro').style.display = 'none'; document.getElementById('telaLogin').style.display = 'flex'; });
    document.getElementById('cadastrarBtn').addEventListener('click', async () => {
        const nome = document.getElementById('cadastroNome').value.trim();
        const email = document.getElementById('cadastroEmail').value.trim();
        const senha = document.getElementById('cadastroSenha').value.trim();
        const senha2 = document.getElementById('cadastroSenhaConfirm').value.trim();
        const nivel = document.getElementById('cadastroNivel').value;
        if (!nome || !email || !senha) return alert('Preencha todos os campos.');
        if (senha !== senha2) return alert('Senhas não coincidem.');
        if (senha.length < 6) return alert('Mínimo 6 caracteres.');
        try {
            const user = { id: 'usr_' + Date.now(), nome, email, senha, nivel, status: 'pendente', cpf: '' };
            await upstash('SET', `user:${user.id}`, JSON.stringify(user));
            await upstash('SADD', 'users:all', user.id);
            document.getElementById('cadastroSucesso').style.display = 'block';
            document.getElementById('cadastroSucesso').textContent = 'Cadastro enviado! Aguarde aprovação.';
            ['cadastroNome','cadastroEmail','cadastroSenha','cadastroSenhaConfirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        } catch (err) { document.getElementById('cadastroErro').textContent = 'Erro: ' + err.message; }
    });
    
    // Outros eventos
    document.getElementById('salvarBtn').addEventListener('click', salvarJovem);
    document.getElementById('importarExcelBtn').addEventListener('click', importarPlanilha);
    document.getElementById('limparFormBtn').addEventListener('click', limparFormulario);
    document.getElementById('btnPontoDigital').addEventListener('click', registrarPontoDigital);
    document.getElementById('exportarExcelBtn').addEventListener('click', exportarExcel);
    document.getElementById('registroManualBtn').addEventListener('click', abrirRegistroManual);
    document.getElementById('manualSalvar').addEventListener('click', salvarRegistroManual);
    document.getElementById('salvarOficinaBtn').addEventListener('click', salvarOficina);
    document.getElementById('salvarProfissionalBtn').addEventListener('click', salvarProfissional);
    document.getElementById('userSalvarBtn').addEventListener('click', salvarNovoUsuario);
    document.getElementById('btnNovoJovemHeader').addEventListener('click', () => navigateTo('pageCadastro'));
    document.getElementById('btnRegistrarPontoHeader').addEventListener('click', () => navigateTo('pageLista'));
    
    document.querySelectorAll('#filtrosFrequencia select, #filtrosFrequencia input').forEach(el => { el?.addEventListener('change', carregarLista); el?.addEventListener('input', carregarLista); });
    document.getElementById('buscaFrequencia')?.addEventListener('input', function() { const filtroNome = document.getElementById('filtroNome'); if (filtroNome) { filtroNome.value = this.value; carregarLista(); } });
    
    renderizarCamposFormulario();
    const emailSalvo = localStorage.getItem('usuarioLogado');
    if (emailSalvo) document.getElementById('loginEmail').value = emailSalvo;
    renderizarFiltrosCheckbox();
    
    // Fechar modais com clique no overlay
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
    });
});

console.log('Sistema Socioeducativo v3.0 carregado!');
