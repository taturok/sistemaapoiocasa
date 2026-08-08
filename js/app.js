// ============================================================
// SISTEMA DE CONTROLE DE MEDIDAS SOCIOEDUCATIVAS v2.0
// BACKEND: UPSTASH REDIS REST API
// ============================================================

// ============================================================
// CONFIGURAÇÃO UPSTASH
// ============================================================
const UPSTASH_URL = 'https://enhanced-lobster-167489.upstash.io';
const UPSTASH_TOKEN = 'gQAAAAAAAo5BAAIgcDI0NjUxNzdjMzdiYzg0YTBlOTFkZWZjY2Y0MGI5YjQ1YQ';

// ============================================================
// NÍVEIS DE ACESSO E PERMISSÕES
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
    ['QUAL NOME SOCIAL?','NOME SOCIAL','text']
];

// ============================================================
// ESTADO GLOBAL
// ============================================================
let estado = {
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
    usuarioEdicaoHorario: null,
    acoesLATemporarias: [],
    selecionadosLote: new Set()
};
let intervaloCronometro = null;
let pollingInterval = null;
let _jovemDocAtual = null;
let _avaliacaoJovemId = null;

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
        catch (err) { lastErr = err; if (i < retries - 1) await new Promise(r => setTimeout(r, 1500)); }
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
// NAVEGAÇÃO (MENU LATERAL)
// ============================================================
function navigateTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');

    const titles = {
        'pageDashboard': 'Dashboard',
        'pageCadastro': 'Cadastrar / Editar Jovem',
        'pageLista': 'Lista Geral',
        'pageAcompInd': 'Acompanhamento Individual',
        'pageObservacoes': 'Observações',
        'pageOficinas': 'Oficinas Realizadas',
        'pagePlanejamento': 'Planejamento de Oficinas',
        'pageRelatorios': 'Relatórios',
        'pageLA': 'Ações LA',
        'pageUsuarios': 'Gerenciar Usuários',
        'pagePendentes': 'Solicitações Pendentes',
        'pageMensagens': 'Mensagens',
        'pageProfissionais': 'Profissionais',
        'pageConfig': 'Configurações',
        'pageDashboardJovem': 'Minhas Ações'
    };
    const icons = {
        'pageDashboard': 'chart-pie',
        'pageCadastro': 'user-plus',
        'pageLista': 'list-ul',
        'pageAcompInd': 'user-circle',
        'pageObservacoes': 'eye',
        'pageOficinas': 'tools',
        'pagePlanejamento': 'calendar-plus',
        'pageRelatorios': 'file-alt',
        'pageLA': 'handshake',
        'pageUsuarios': 'users-cog',
        'pagePendentes': 'user-clock',
        'pageMensagens': 'envelope',
        'pageProfissionais': 'user-md',
        'pageConfig': 'cog',
        'pageDashboardJovem': 'user'
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl && titles[pageId]) {
        titleEl.innerHTML = `<i class="fas fa-${icons[pageId] || 'circle'}"></i> ${titles[pageId]}`;
    }
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`.menu-item[data-page="${pageId}"]`);
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
    btn.disabled = true;
    btn.textContent = 'Conectando...';
    document.getElementById('loginErro').textContent = '';

    try {
        await withRetry(() => upstash('PING'));

        const adminExists = await upstash('EXISTS', 'user:admin001');
        if (adminExists === 0) {
            const adminData = JSON.stringify({
                id: 'admin001',
                nome: 'Administrador',
                email: 'admin@teste.com',
                senha: '123',
                nivel: 'desenvolvedor',
                status: 'ativo'
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
                if (u.email === email && u.senha === senha) {
                    user = u;
                    break;
                }
            }
        }

        if (!user) {
            document.getElementById('loginErro').textContent = 'E-mail ou senha incorretos.';
            return;
        }
        if (user.status !== 'ativo') {
            document.getElementById('loginErro').textContent = 'Cadastro pendente de aprovação.';
            return;
        }

        estado.usuarioAtual = user;
        estado.online = true;
        localStorage.setItem('usuarioLogado', user.email);
        localStorage.setItem('nivelUsuario', user.nivel);

        document.getElementById('telaLogin').classList.add('hidden');
        const mainContent = document.querySelector('.main-content');
        mainContent.classList.add('visible');
        mainContent.style.display = 'flex';

        document.getElementById('nomeUsuarioHeader').textContent = user.nome || user.email;
        document.getElementById('nivelUsuarioHeader').textContent = NIVEIS_ACESSO[user.nivel]?.nome || user.nivel;

        mostrarAbasPorNivel(user.nivel);
        carregarLogo();

        if (user.nivel === 'jovem') {
            carregarJovemPeloCPF(user.cpf);
        } else {
            await carregarTodosDados();
            if (['gestor', 'tecnico', 'desenvolvedor'].includes(user.nivel)) {
                setTimeout(() => exibirAvisoObservacoes(), 1500);
            }
        }
        iniciarPolling();
    } catch (err) {
        document.getElementById('loginErro').textContent = 'Erro: ' + err.message;
        console.error('Erro no login:', err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
    }
}

function deslogarSistema() {
    estado.usuarioAtual = null;
    localStorage.removeItem('usuarioLogado');
    localStorage.removeItem('nivelUsuario');

    const mainContent = document.querySelector('.main-content');
    mainContent.classList.remove('visible');
    mainContent.style.display = 'none';

    const telaLogin = document.getElementById('telaLogin');
    telaLogin.classList.remove('hidden');
    telaLogin.style.display = 'flex';

    document.getElementById('loginEmail').value = '';
    document.getElementById('loginSenha').value = '';

    if (intervaloCronometro) clearInterval(intervaloCronometro);
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
        
        console.log('Dados carregados:', {
            jovens: estado.jovens.length,
            usuarios: estado.usuarios.length,
            profissionais: estado.profissionais.length,
            oficinas: estado.oficinas.length,
            avaliacoes: estado.avaliacoes.length
        });
        
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
        estado.online = true;
        renderizarDashboardJovem();
    } catch (err) {
        console.error('Erro ao carregar dados do jovem:', err);
    }
}

function atualizarInterfaceCompleta() {
    console.log('Atualizando interface completa...');
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
// ABAS POR NÍVEL (MENU)
// ============================================================
function mostrarAbasPorNivel(nivel) {
    let nivelNormalizado = (nivel || '').toLowerCase().trim();
    if (['admin', 'administrador', 'desenvolvedor'].includes(nivelNormalizado)) nivelNormalizado = 'desenvolvedor';
    if (['oficineira'].includes(nivelNormalizado)) nivelNormalizado = 'oficineiro';
    if (['técnico'].includes(nivelNormalizado)) nivelNormalizado = 'tecnico';
    if (['gestora'].includes(nivelNormalizado)) nivelNormalizado = 'gestor';
    if (['autoridade jurídica', 'autoridade juridica'].includes(nivelNormalizado)) nivelNormalizado = 'autoridade';

    const permissoes = {
        'desenvolvedor': ['pageDashboard', 'pageCadastro', 'pageLista', 'pageAcompInd', 'pageObservacoes', 'pageOficinas', 'pagePlanejamento', 'pageRelatorios', 'pageLA', 'pageUsuarios', 'pagePendentes', 'pageMensagens', 'pageProfissionais', 'pageConfig'],
        'admin': ['pageDashboard', 'pageCadastro', 'pageLista', 'pageAcompInd', 'pageObservacoes', 'pageOficinas', 'pagePlanejamento', 'pageRelatorios', 'pageLA', 'pageUsuarios', 'pagePendentes', 'pageMensagens', 'pageProfissionais', 'pageConfig'],
        'gestor': ['pageDashboard', 'pageCadastro', 'pageLista', 'pageAcompInd', 'pageObservacoes', 'pageOficinas', 'pagePlanejamento', 'pageRelatorios', 'pageLA', 'pageUsuarios', 'pagePendentes', 'pageMensagens', 'pageProfissionais', 'pageConfig'],
        'tecnico': ['pageDashboard', 'pageCadastro', 'pageLista', 'pageAcompInd', 'pageObservacoes', 'pageOficinas', 'pageRelatorios', 'pageLA', 'pageMensagens', 'pageProfissionais'],
        'oficineiro': ['pageDashboard', 'pageOficinas', 'pagePlanejamento', 'pageRelatorios'],
        'autoridade': ['pageDashboard', 'pageCadastro', 'pageLista', 'pageAcompInd', 'pageObservacoes', 'pageRelatorios', 'pageMensagens', 'pageLA'],
        'jovem': ['pageDashboardJovem']
    };
    const paginasPermitidas = permissoes[nivelNormalizado] || ['pageDashboard'];

    document.querySelectorAll('.menu-item[data-page]').forEach(item => {
        const page = item.dataset.page;
        item.style.display = paginasPermitidas.includes(page) ? '' : 'none';
    });

    const first = paginasPermitidas[0];
    if (first) navigateTo(first);
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
    return Math.max(0, horasTotal - horasFeitas + ajusteManual).toFixed(1);
}

function calcularHorasCumpridas(jovem) {
    if (jovem['MEDIDA'] === 'LA') return 0;
    return (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0).toFixed(1);
}

// ============================================================
// DASHBOARD
// ============================================================
function renderizarDashboard() {
    const cards = document.getElementById('cardsDashboard');
    if (!cards) {
        console.error('Elemento cardsDashboard não encontrado');
        return;
    }
    
    if (estado.jovens.length === 0) {
        cards.innerHTML = `
            <div class="card" style="grid-column: 1 / -1; text-align:center; padding:40px;">
                <div class="card-icon" style="font-size:3rem; color:#94a3b8;"><i class="fas fa-users"></i></div>
                <p style="color:#6b7280; font-size:1.1rem; margin-top:10px;">Nenhum jovem cadastrado</p>
                <p style="color:#94a3b8; font-size:0.9rem;">Importe uma planilha ou cadastre um novo jovem</p>
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
        <div class="card card-info"><div class="card-icon"><i class="fas fa-users"></i></div><div class="card-value">${total}</div><div class="card-label">Total de Jovens</div></div>
        <div class="card card-success"><div class="card-icon"><i class="fas fa-check-circle"></i></div><div class="card-value">${regular}</div><div class="card-label">REGULAR</div><div class="card-sub">Em cumprimento normal</div></div>
        <div class="card card-warning"><div class="card-icon"><i class="fas fa-exclamation-circle"></i></div><div class="card-value">${irregular}</div><div class="card-label">IRREGULAR</div><div class="card-sub">7+ dias sem comparecer</div></div>
        <div class="card card-danger"><div class="card-icon"><i class="fas fa-exclamation-triangle"></i></div><div class="card-value">${descumprimento}</div><div class="card-label">EM DESCUMPRIMENTO</div><div class="card-sub">14+ dias sem comparecer</div></div>
        <div class="card" style="border-left:4px solid #8b5cf6;"><div class="card-icon"><i class="fas fa-pause-circle"></i></div><div class="card-value">${suspenso}</div><div class="card-label">SUSPENSO</div><div class="card-sub">Afastamento temporário</div></div>
        <div class="card" style="border-left:4px solid #1A2A4A;"><div class="card-icon"><i class="fas fa-flag-checkered"></i></div><div class="card-value">${medidaFinalizada}</div><div class="card-label">MEDIDA FINALIZADA</div></div>
        <div class="card" style="border-left:4px solid #94a3b8;"><div class="card-icon"><i class="fas fa-door-open"></i></div><div class="card-value">${liberado}</div><div class="card-label">LIBERADO</div></div>
    `;
    renderizarGraficos();
}

function renderizarGraficos() {
    try {
        Object.values(estado.graficos).forEach(c => {
            if (c && c.destroy) c.destroy();
        });
        estado.graficos = {};

        const regular = estado.jovens.filter(j => j.status === 'REGULAR');

        const medidas = {};
        regular.forEach(j => {
            const m = j['MEDIDA'] || 'Não informada';
            medidas[m] = (medidas[m] || 0) + 1;
        });
        const ctx1 = document.getElementById('graficoMedidas')?.getContext('2d');
        if (ctx1 && Object.keys(medidas).length > 0) {
            estado.graficos.medidas = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: Object.keys(medidas),
                    datasets: [{ label: 'Jovens', data: Object.values(medidas), backgroundColor: '#2563EB' }]
                },
                options: { responsive: true, maintainAspectRatio: true }
            });
        }

        const generos = { M: 0, F: 0, NB: 0 };
        estado.jovens.forEach(j => {
            const g = j['GÊNERO'] || 'M';
            if (generos[g] !== undefined) generos[g]++;
        });
        const ctx2 = document.getElementById('graficoGenero')?.getContext('2d');
        if (ctx2 && (generos.M > 0 || generos.F > 0 || generos.NB > 0)) {
            estado.graficos.genero = new Chart(ctx2, {
                type: 'pie',
                data: {
                    labels: ['Masculino', 'Feminino', 'Não-binário'],
                    datasets: [{ data: [generos.M, generos.F, generos.NB], backgroundColor: ['#2563EB', '#10b981', '#f59e0b'] }]
                },
                options: { responsive: true, maintainAspectRatio: true }
            });
        }

        const idades = { '12-15': 0, '16-18': 0, '19+': 0 };
        estado.jovens.forEach(j => {
            const idade = parseInt(j['IDADE']) || 0;
            if (idade >= 12 && idade <= 15) idades['12-15']++;
            else if (idade >= 16 && idade <= 18) idades['16-18']++;
            else if (idade >= 19) idades['19+']++;
        });
        const ctx3 = document.getElementById('graficoIdade')?.getContext('2d');
        if (ctx3 && (idades['12-15'] > 0 || idades['16-18'] > 0 || idades['19+'] > 0)) {
            estado.graficos.idade = new Chart(ctx3, {
                type: 'bar',
                data: {
                    labels: ['12 a 15', '16 a 18', '19+'],
                    datasets: [{ label: 'Jovens', data: [idades['12-15'], idades['16-18'], idades['19+']], backgroundColor: '#8b5cf6' }]
                },
                options: { responsive: true, maintainAspectRatio: true }
            });
        }

        const reverte = estado.oficinas.filter(o => o.reverte).length;
        const naoReverte = estado.oficinas.length - reverte;
        const ctx5 = document.getElementById('graficoReverte')?.getContext('2d');
        if (ctx5 && (reverte > 0 || naoReverte > 0)) {
            estado.graficos.reverte = new Chart(ctx5, {
                type: 'pie',
                data: {
                    labels: ['Reverte em benefício social', 'Não reverte'],
                    datasets: [{ data: [reverte, naoReverte], backgroundColor: ['#10b981', '#6c757d'] }]
                },
                options: { responsive: true, maintainAspectRatio: true }
            });
        }
    } catch (e) {
        console.error('Erro ao renderizar gráficos:', e);
    }
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
    if (containerAcoes) {
        containerAcoes.style.display = 'none';
    }
}

window.toggleAcoesLA = function() {
    const medida = document.getElementById('campo_MEDIDA')?.value;
    const container = document.getElementById('containerAcoesLA');
    if (container) {
        container.style.display = medida === 'LA' ? 'block' : 'none';
    }
}

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
    input.value = '';
    prazoInput.value = '';
    atualizarListaAcoesLAForm();
};

window.atualizarListaAcoesLAForm = function() {
    const ul = document.getElementById('listaAcoesLAForm');
    if (!ul) return;
    ul.innerHTML = estado.acoesLATemporarias.map(a => `<li style="margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding:4px 0;">
        <span>${a.texto} <span style="font-size:0.7rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span></span>
        <span style="color:red; cursor:pointer; font-weight:bold; margin-left:10px;" onclick="removerAcaoLAForm(${a.id})">✕</span>
    </li>`).join('');
};

window.removerAcaoLAForm = function(id) {
    estado.acoesLATemporarias = estado.acoesLATemporarias.filter(a => a.id !== id);
    atualizarListaAcoesLAForm();
};

async function salvarJovem() {
    const nome = document.getElementById('campo_NOME')?.value.trim();
    if (!nome) return alert('Preencha pelo menos o nome.');

    const jovemExistente = estado.jovens.find(j => (j['NOME'] || '').toUpperCase() === nome.toUpperCase() && j.id !== window._editarId);
    const jovem = {
        id: window._editarId || (jovemExistente ? jovemExistente.id : 'j_' + Date.now()),
        status: window._editarId ? estado.jovens.find(j => j.id === window._editarId)?.status || 'REGULAR' : 'REGULAR'
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
        if (!window._editarId && !jovemExistente) await upstash('SADD', 'jovens:all', jovem.id);
        estado.jovens = estado.jovens.filter(j => j.id !== jovem.id);
        estado.jovens.push(jovem);

        atualizarInterfaceCompleta();
        limparFormulario();
        alert('Jovem salvo com sucesso!');
    } catch (err) {
        alert('Erro ao salvar: ' + err.message);
    }
}

function limparFormulario() {
    CAMPOS.forEach(([key]) => {
        const el = document.getElementById(`campo_${key}`);
        if (el) el.value = '';
    });
    if (document.getElementById('campo_ID_DIGITAL')) document.getElementById('campo_ID_DIGITAL').value = '';
    estado.acoesLATemporarias = [];
    atualizarListaAcoesLAForm();
    toggleAcoesLA();
    window._editarId = null;
}

// ============================================================
// SELEÇÃO EM LOTE
// ============================================================
function toggleSelecionarTodos() {
    const checkboxes = document.querySelectorAll('#listaCorpo input[type="checkbox"]');
    const selecionarTodos = document.getElementById('selecionarTodos');
    checkboxes.forEach(cb => {
        cb.checked = selecionarTodos.checked;
        if (selecionarTodos.checked) {
            estado.selecionadosLote.add(cb.dataset.id);
        } else {
            estado.selecionadosLote.delete(cb.dataset.id);
        }
    });
    atualizarBarraSelecao();
}

function toggleSelecionarJovem(id) {
    const cb = document.querySelector(`#listaCorpo input[data-id="${id}"]`);
    if (!cb) return;
    if (cb.checked) {
        estado.selecionadosLote.add(id);
    } else {
        estado.selecionadosLote.delete(id);
    }
    atualizarBarraSelecao();
}

function atualizarBarraSelecao() {
    const barra = document.getElementById('barraSelecaoLote');
    const contador = document.getElementById('contadorSelecionados');
    const btnAcoes = document.getElementById('btnAcoesLote');
    const total = estado.selecionadosLote.size;

    if (total > 0) {
        barra.style.display = 'flex';
        btnAcoes.style.display = 'inline-flex';
        contador.textContent = total;
    } else {
        barra.style.display = 'none';
        btnAcoes.style.display = 'none';
    }
}

function desmarcarTodos() {
    estado.selecionadosLote.clear();
    document.querySelectorAll('#listaCorpo input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('selecionarTodos').checked = false;
    atualizarBarraSelecao();
}

function abrirModalAcoesLote() {
    if (estado.selecionadosLote.size === 0) {
        alert('Selecione pelo menos um jovem.');
        return;
    }
    document.getElementById('loteContadorSelecionados').textContent = estado.selecionadosLote.size;
    document.getElementById('loteAcaoSelect').value = '';
    document.getElementById('loteOpcoesStatus').style.display = 'none';
    document.getElementById('loteMotivoSuspensao').style.display = 'none';
    document.getElementById('modalAcoesLote').style.display = 'flex';
}

function fecharModalAcoesLote() {
    document.getElementById('modalAcoesLote').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('loteAcaoSelect')?.addEventListener('change', function() {
        const statusDiv = document.getElementById('loteOpcoesStatus');
        if (this.value === 'alterar_status') {
            statusDiv.style.display = 'block';
        } else {
            statusDiv.style.display = 'none';
        }
    });

    document.getElementById('loteNovoStatus')?.addEventListener('change', function() {
        const motivoDiv = document.getElementById('loteMotivoSuspensao');
        motivoDiv.style.display = this.value === 'SUSPENSO' ? 'block' : 'none';
    });
});

async function executarAcaoLote() {
    const acao = document.getElementById('loteAcaoSelect').value;
    if (!acao) return alert('Selecione uma ação.');

    const ids = Array.from(estado.selecionadosLote);
    const jovens = estado.jovens.filter(j => ids.includes(j.id));

    if (acao === 'excluir') {
        if (!confirm(`Tem certeza que deseja excluir PERMANENTEMENTE ${jovens.length} jovens?`)) return;
        try {
            for (const j of jovens) {
                await upstash('DEL', `jovem:${j.id}`);
                await upstash('SREM', 'jovens:all', j.id);
            }
            estado.jovens = estado.jovens.filter(j => !ids.includes(j.id));
            desmarcarTodos();
            fecharModalAcoesLote();
            await carregarTodosDados();
            alert(`✅ ${jovens.length} jovens excluídos com sucesso!`);
        } catch (err) {
            alert('Erro ao excluir: ' + err.message);
        }
        return;
    }

    if (acao === 'alterar_status') {
        const novoStatus = document.getElementById('loteNovoStatus').value;
        if (!novoStatus) return alert('Selecione o novo status.');

        let motivo = '';
        if (novoStatus === 'SUSPENSO') {
            motivo = document.getElementById('loteMotivoInput').value.trim();
            if (!motivo) return alert('Informe o motivo da suspensão.');
        }

        if (!confirm(`Tem certeza que deseja alterar o status de ${jovens.length} jovens para "${novoStatus}"?`)) return;

        try {
            for (const j of jovens) {
                j.status = novoStatus;
                if (novoStatus === 'SUSPENSO') {
                    j.motivoSuspensao = motivo;
                    j.dataSuspensao = new Date().toISOString();
                    j.suspensoPor = estado.usuarioAtual?.nome || 'Sistema';
                } else {
                    j.motivoSuspensao = '';
                    j.dataSuspensao = '';
                }
                if (!j.observacoes) j.observacoes = [];
                j.observacoes.push({
                    data: new Date().toISOString(),
                    profissional: estado.usuarioAtual?.nome || 'Sistema',
                    texto: `📌 Status alterado em lote para "${novoStatus}"${motivo ? ' - Motivo: ' + motivo : ''}`
                });
                await upstash('SET', `jovem:${j.id}`, JSON.stringify(j));
            }
            desmarcarTodos();
            fecharModalAcoesLote();
            await carregarTodosDados();
            alert(`✅ Status de ${jovens.length} jovens alterado para "${novoStatus}" com sucesso!`);
        } catch (err) {
            alert('Erro ao alterar status: ' + err.message);
        }
        return;
    }

    alert('Ação não reconhecida.');
}

// ============================================================
// STATUS - ALTERAÇÃO MANUAL
// ============================================================
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
    estado.acoesLATemporarias = j.acoesLA || [];
    toggleAcoesLA();
    atualizarListaAcoesLAForm();
    navigateTo('pageCadastro');
};

window.alterarStatusManual = async function(jovemId, novoStatus) {
    if (!NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel)) {
        alert('❌ Você não tem permissão para alterar status.');
        return;
    }
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) {
        alert('Jovem não encontrado.');
        return;
    }
    const statusPermitidos = ['REGULAR', 'IRREGULAR', 'EM DESCUMPRIMENTO', 'SUSPENSO', 'MEDIDA FINALIZADA', 'LIBERADO'];
    if (!statusPermitidos.includes(novoStatus)) {
        alert('Status inválido.');
        return;
    }
    if (!confirm(`Tem certeza que deseja alterar o status de ${jovem['NOME']} de "${jovem.status}" para "${novoStatus}"?`)) {
        return;
    }
    const statusAnterior = jovem.status;
    jovem.status = novoStatus;
    if (novoStatus === 'SUSPENSO') {
        const motivo = prompt('Digite o motivo da suspensão:');
        if (motivo) {
            jovem.motivoSuspensao = motivo;
            jovem.dataSuspensao = new Date().toISOString();
            jovem.suspensoPor = estado.usuarioAtual?.nome || 'Sistema';
        } else {
            alert('Motivo obrigatório para suspensão.');
            return;
        }
    } else {
        jovem.motivoSuspensao = '';
        jovem.dataSuspensao = '';
    }
    if (!jovem.observacoes) jovem.observacoes = [];
    jovem.observacoes.push({
        data: new Date().toISOString(),
        profissional: estado.usuarioAtual?.nome || 'Sistema',
        texto: `📌 Status alterado manualmente de "${statusAnterior}" para "${novoStatus}"${jovem.motivoSuspensao ? ' - Motivo: ' + jovem.motivoSuspensao : ''}`
    });
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        await carregarTodosDados();
        alert(`✅ Status alterado para "${novoStatus}" com sucesso!`);
    } catch (err) {
        alert('Erro ao alterar status: ' + err.message);
    }
};

// ============================================================
// LISTA GERAL E FILTROS - COM CHECKBOX MÚLTIPLA
// ============================================================
function renderizarFiltrosCheckbox() {
    // Filtro de Medida
    const medidasContainer = document.getElementById('filtroMedida');
    if (medidasContainer) {
        const medidas = ['LA', 'PSC', 'Internação', 'Liberação'];
        medidasContainer.innerHTML = medidas.map(m => 
            `<label style="margin-right:10px; font-weight:400; font-size:0.8rem; display:inline-block;">
                <input type="checkbox" value="${m}" onchange="carregarLista()"> ${m}
            </label>`
        ).join('');
    }

    // Filtro de Status
    const statusContainer = document.getElementById('filtroStatus');
    if (statusContainer) {
        const status = ['REGULAR', 'IRREGULAR', 'EM DESCUMPRIMENTO', 'SUSPENSO', 'MEDIDA FINALIZADA', 'LIBERADO'];
        statusContainer.innerHTML = status.map(s => 
            `<label style="margin-right:10px; font-weight:400; font-size:0.8rem; display:inline-block;">
                <input type="checkbox" value="${s}" onchange="carregarLista()"> ${s}
            </label>`
        ).join('');
    }

    // Filtro de Gênero
    const generoContainer = document.getElementById('filtroGenero');
    if (generoContainer) {
        const generos = ['M', 'F', 'NB'];
        const labels = {'M':'Masculino', 'F':'Feminino', 'NB':'Não-binário'};
        generoContainer.innerHTML = generos.map(g => 
            `<label style="margin-right:10px; font-weight:400; font-size:0.8rem; display:inline-block;">
                <input type="checkbox" value="${g}" onchange="carregarLista()"> ${labels[g] || g}
            </label>`
        ).join('');
    }

    // Filtro de Idade
    const idadeContainer = document.getElementById('filtroIdade');
    if (idadeContainer) {
        const idades = ['12-15', '16-18', '19+'];
        idadeContainer.innerHTML = idades.map(i => 
            `<label style="margin-right:10px; font-weight:400; font-size:0.8rem; display:inline-block;">
                <input type="checkbox" value="${i}" onchange="carregarLista()"> ${i}
            </label>`
        ).join('');
    }
}

function getFiltrosSelecionados(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// ============================================================
// FUNÇÃO CARREGAR LISTA - CORRIGIDA
// ============================================================
function carregarLista() {
    const tbody = document.getElementById('listaCorpo');
    if (!tbody) {
        console.error('Elemento listaCorpo não encontrado');
        return;
    }

    if (estado.jovens.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:40px; color:#6b7280;">Nenhum jovem cadastrado. Importe uma planilha ou cadastre um novo jovem.</td></tr>`;
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
    }).sort((a, b) => (a['NOME'] || '').localeCompare((b['NOME'] || ''), 'pt-BR'));

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
        const renderSaldo = j['MEDIDA'] === 'LA' ? `Ações: ${j.acoesLA?.filter(a=>a.realizado).length || 0}/${j.acoesLA?.length || 0}` : `${saldo}h`;

        const hoje = new Date();
        const hojeStr = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
        let temEntradaAberta = false;

        const podeRegistrarPonto = j['MEDIDA'] !== 'Liberação' &&
            j.status !== 'SUSPENSO' &&
            j.status !== 'MEDIDA FINALIZADA';

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
            const opcoes = ['REGULAR', 'IRREGULAR', 'EM DESCUMPRIMENTO', 'SUSPENSO', 'MEDIDA FINALIZADA', 'LIBERADO'];
            botoesStatus = `
                <select onchange="alterarStatusManual('${j.id}', this.value)" style="padding:2px 6px; font-size:0.7rem; border:1px solid #d1d9e6; border-radius:4px; background:white;">
                    <option value="">Status</option>
                    ${opcoes.map(s => `<option value="${s}" ${j.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
            `;
        }

        let motivoStatus = '';
        if (j.status === 'SUSPENSO' && j.motivoSuspensao) {
            motivoStatus = `<span title="${j.motivoSuspensao}" style="cursor:help; font-size:0.75rem; color:#be185d;">${j.motivoSuspensao.substring(0, 20)}${j.motivoSuspensao.length > 20 ? '...' : ''}</span>`;
        }

        let botaoPonto = '';
        if (podeRegistrarPonto) {
            botaoPonto = `<button onclick="registrarPontoNaLinha('${j.id}')" class="btn-sm ${temEntradaAberta ? 'btn-sm-warning' : 'btn-sm-success'}">${temEntradaAberta ? '🚪 Saída' : '🚪 Entrada'}</button>`;
        }

        const isSelecionado = estado.selecionadosLote.has(j.id);

        return `<tr>
            <td><input type="checkbox" data-id="${j.id}" ${isSelecionado ? 'checked' : ''} onchange="toggleSelecionarJovem('${j.id}')"></td>
            <td>${j['NOME'] || j['REFERENCIA'] || '-'}</td>
            <td>${j['ID_DIGITAL'] || '-'}</td>
            <td>${j['IDADE'] || '-'}</td>
            <td>${j['MEDIDA'] || '-'}</td>
            <td>${horasAtribuidas}h</td>
            <td>${horasCumpridas}h</td>
            <td>${renderSaldo}</td>
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

// ============================================================
// FUNÇÃO ABRIR FICHA MODAL - CORRIGIDA (ADICIONADA)
// ============================================================
window.abrirFichaModal = function(jovemId) {
    if (!jovemId) {
        alert('ID do jovem não fornecido.');
        return;
    }
    
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) {
        alert('Jovem não encontrado.');
        return;
    }
    
    // Preencher o modal com os dados do jovem
    document.getElementById('fichaTitulo').textContent = `📋 Ficha de ${jovem['NOME'] || jovem['REFERENCIA'] || 'Jovem'}`;
    
    // Criar o conteúdo da ficha
    let html = `
        <div style="margin-bottom:20px;">
            <h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:8px;">📋 Dados Pessoais</h3>
            <div class="grid-campos" style="display:grid; grid-template-columns:1fr 1fr; gap:8px 20px; margin-top:12px;">
    `;
    
    // Adicionar todos os campos do jovem
    CAMPOS.forEach(([key, label]) => {
        const valor = jovem[key] || '-';
        html += `
            <div class="campo-item" style="padding:6px 0; border-bottom:1px solid #f1f5f9;">
                <strong style="color:#6b7280; font-size:0.75rem; display:block; text-transform:uppercase;">${label}</strong>
                <span style="font-size:0.9rem;">${valor}</span>
            </div>
        `;
    });
    
    // Status e informações adicionais
    html += `
        <div class="campo-item" style="padding:6px 0; border-bottom:1px solid #f1f5f9;">
            <strong style="color:#6b7280; font-size:0.75rem; display:block; text-transform:uppercase;">STATUS</strong>
            <span style="font-size:0.9rem; font-weight:600; padding:4px 12px; border-radius:20px; background:${jovem.status === 'REGULAR' ? '#dbeafe' : jovem.status === 'IRREGULAR' ? '#fef3c7' : jovem.status === 'EM DESCUMPRIMENTO' ? '#fee2e2' : jovem.status === 'SUSPENSO' ? '#fce7f3' : jovem.status === 'MEDIDA FINALIZADA' ? '#d1fae5' : '#e5e7eb'}; color:${jovem.status === 'REGULAR' ? '#1e40af' : jovem.status === 'IRREGULAR' ? '#92400e' : jovem.status === 'EM DESCUMPRIMENTO' ? '#991b1b' : jovem.status === 'SUSPENSO' ? '#be185d' : jovem.status === 'MEDIDA FINALIZADA' ? '#065f46' : '#374151'};">
                ${jovem.status || 'REGULAR'}
            </span>
        </div>
        <div class="campo-item" style="padding:6px 0; border-bottom:1px solid #f1f5f9;">
            <strong style="color:#6b7280; font-size:0.75rem; display:block; text-transform:uppercase;">Horas Atribuídas</strong>
            <span style="font-size:0.9rem;">${jovem['HORAS'] || 0}h</span>
        </div>
        <div class="campo-item" style="padding:6px 0; border-bottom:1px solid #f1f5f9;">
            <strong style="color:#6b7280; font-size:0.75rem; display:block; text-transform:uppercase;">Horas Cumpridas</strong>
            <span style="font-size:0.9rem;">${calcularHorasCumpridas(jovem)}h</span>
        </div>
        <div class="campo-item" style="padding:6px 0; border-bottom:1px solid #f1f5f9;">
            <strong style="color:#6b7280; font-size:0.75rem; display:block; text-transform:uppercase;">Saldo</strong>
            <span style="font-size:0.9rem;">${calcularSaldo(jovem)}h</span>
        </div>
    `;
    
    // Se for LA, mostrar ações
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        const realizadas = acoes.filter(a => a.realizado).length;
        html += `
            <div class="campo-item" style="padding:6px 0; border-bottom:1px solid #f1f5f9; grid-column:1/-1;">
                <strong style="color:#6b7280; font-size:0.75rem; display:block; text-transform:uppercase;">Ações LA (${realizadas}/${acoes.length})</strong>
                ${acoes.length > 0 ? acoes.map(a => `
                    <div style="padding:4px 8px; margin:4px 0; background:${a.realizado ? '#d1fae5' : '#fffbeb'}; border-radius:4px; border-left:3px solid ${a.realizado ? '#10b981' : '#f59e0b'}; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
                        <span style="font-size:0.85rem; ${a.realizado ? 'text-decoration:line-through; color:#065f46;' : ''}">${a.texto}</span>
                        <span style="font-size:0.7rem; color:#6b7280;">${a.prazo ? 'Vence: ' + new Date(a.prazo).toLocaleDateString('pt-BR') : 'Sem prazo'}</span>
                        <span style="font-size:0.7rem; font-weight:600; color:${a.realizado ? '#065f46' : '#92400e'};">${a.realizado ? '✅ Feito' : '⏳ Pendente'}</span>
                    </div>
                `).join('') : '<span style="font-size:0.85rem; color:#6b7280;">Nenhuma ação cadastrada</span>'}
            </div>
        `;
    }
    
    html += `</div></div>`;
    
    // Frequência
    const hist = jovem.historicoFrequencia || [];
    html += `
        <div style="margin-bottom:20px;">
            <h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:8px;">📊 Frequência (${hist.length} registros)</h3>
            ${hist.length > 0 ? `
                <div style="max-height:200px; overflow-y:auto; margin-top:10px;">
                    <table style="width:100%; font-size:0.85rem; border-collapse:collapse;">
                        <thead><tr style="background:#f1f5f9;"><th style="padding:6px 8px; text-align:left;">Data</th><th style="padding:6px 8px; text-align:left;">Tipo</th><th style="padding:6px 8px; text-align:left;">Horas</th><th style="padding:6px 8px; text-align:left;">Obs</th></tr></thead>
                        <tbody>
                            ${hist.slice().reverse().map(h => `
                                <tr style="border-bottom:1px solid #f1f5f9;">
                                    <td style="padding:6px 8px;">${new Date(h.data).toLocaleString('pt-BR')}</td>
                                    <td style="padding:6px 8px;">${h.tipo === 'entrada' ? '🚪 Entrada' : '🚪 Saída'}</td>
                                    <td style="padding:6px 8px;">${h.tipo === 'entrada' ? (h.horas || 0) + 'h' : '-'}</td>
                                    <td style="padding:6px 8px;">${h.observacao || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<p style="color:#6b7280; margin-top:8px;">Nenhum registro de frequência.</p>'}
        </div>
    `;
    
    // Observações
    const obs = jovem.observacoes || [];
    html += `
        <div style="margin-bottom:20px;">
            <h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:8px;">📝 Observações (${obs.length})</h3>
            ${obs.length > 0 ? `
                <div style="max-height:200px; overflow-y:auto; margin-top:10px;">
                    ${obs.slice().reverse().map(o => `
                        <div style="background:#f8fafc; padding:10px 14px; margin-bottom:8px; border-radius:6px; border-left:3px solid #8b5cf6;">
                            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#6b7280;">
                                <strong>${o.profissional || 'Sistema'}</strong>
                                <span>${new Date(o.data).toLocaleString('pt-BR')}</span>
                            </div>
                            <p style="margin-top:4px; color:#1e293b; white-space:pre-wrap;">${o.texto}</p>
                        </div>
                    `).join('')}
                </div>
            ` : '<p style="color:#6b7280; margin-top:8px;">Nenhuma observação registrada.</p>'}
        </div>
    `;
    
    // Oficinas
    const oficinas = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id));
    html += `
        <div>
            <h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:8px;">🛠️ Oficinas Participadas (${oficinas.length})</h3>
            ${oficinas.length > 0 ? `
                <div style="max-height:200px; overflow-y:auto; margin-top:10px;">
                    ${oficinas.slice().reverse().map(o => `
                        <div style="background:#f8fafc; padding:8px 14px; margin-bottom:6px; border-radius:6px; border-left:3px solid ${o.reverte ? '#10b981' : '#6c757d'};">
                            <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                                <span><strong>${o.conteudo}</strong></span>
                                <span style="font-size:0.85rem; color:#6b7280;">${new Date(o.data).toLocaleDateString('pt-BR')} - ${o.periodo}</span>
                            </div>
                            ${o.reverte ? '<span style="font-size:0.75rem; color:#10b981;">✅ Reverte em benefício social</span>' : ''}
                            ${o.isCurso ? '<span style="font-size:0.75rem; color:#3b82f6;">📚 Curso Obrigatório</span>' : ''}
                            <div style="font-size:0.75rem; color:#6b7280; margin-top:4px;">
                                👥 ${(o.jovensIds || []).map(id => {
                                    const j = estado.jovens.find(x => x.id === id);
                                    return j ? (j['NOME'] || j['REFERENCIA'] || 'Desconhecido') : 'Desconhecido';
                                }).join(', ')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : '<p style="color:#6b7280; margin-top:8px;">Nenhuma oficina registrada.</p>'}
        </div>
    `;
    
    // Avaliações
    const avaliacoes = estado.avaliacoes.filter(a => a.jovemId === jovem.id);
    if (avaliacoes.length > 0) {
        html += `
            <div style="margin-top:20px;">
                <h3 style="color:#2c3e66; border-bottom:2px solid #e2e8f0; padding-bottom:8px;">📋 Avaliações Profissionais (${avaliacoes.length})</h3>
                <div style="max-height:200px; overflow-y:auto; margin-top:10px;">
                    ${avaliacoes.slice().reverse().map(a => `
                        <div style="background:#f5f3ff; padding:10px 14px; margin-bottom:8px; border-radius:6px; border-left:3px solid #8b5cf6;">
                            <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px;">
                                <strong>${a.profissionalNome}</strong>
                                <span style="font-size:0.8rem; color:#6b7280;">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                            </div>
                            <div style="font-size:0.8rem; color:#8b5cf6;">${a.area}</div>
                            ${a.profissionalFuncao || a.profissionalRegistro ? `<div style="font-size:0.75rem; color:#6b7280;">${a.profissionalFuncao || ''}${a.profissionalRegistro ? ' - Reg: ' + a.profissionalRegistro : ''}</div>` : ''}
                            <p style="margin-top:6px; color:#1e293b; white-space:pre-wrap; font-size:0.9rem;">${a.conteudo}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    document.getElementById('fichaConteudo').innerHTML = html;
    document.getElementById('modalFicha').style.display = 'flex';
};

function atualizarContadorLista(total) {
    let contadorContainer = document.getElementById('contadorContainer');
    if (!contadorContainer) {
        const tabelaWrapper = document.querySelector('#pageLista .table-wrapper');
        if (tabelaWrapper) {
            contadorContainer = document.createElement('div');
            contadorContainer.id = 'contadorContainer';
            tabelaWrapper.appendChild(contadorContainer);
        }
    }

    if (contadorContainer) {
        contadorContainer.innerHTML = `
            <div id="contadorListaJovens" style="padding: 10px 15px; font-weight: 600; color: #1e2a4a; background: #f1f5f9; border-radius: 0 0 12px 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-wrap:wrap; gap:8px;">
                <span>👥 Total de jovens: <strong style="color: #2c3e66; font-size: 1.1rem;">${total}</strong></span>
                <span style="font-size: 0.85rem; color: #6b7280;">${total === 1 ? '1 jovem exibido' : `${total} jovens exibidos`}</span>
            </div>
        `;
    }
}

// ============================================================
// OBSERVAÇÕES E AÇÕES MANUAIS
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
        return `<tr>
            <td>${j['NOME'] || '-'}</td>
            <td>${j.status || 'REGULAR'}</td>
            <td>${ultimo}</td>
            <td>${dias}</td>
            <td>
                <button onclick="abrirFichaModal('${j.id}')" class="btn-sm btn-sm-primary"><i class="fas fa-file-alt"></i></button>
                <button onclick="marcarIrregular('${j.id}')" class="btn-sm btn-sm-warning"><i class="fas fa-exclamation-circle"></i> Marcar IRREGULAR</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; color:#6b7280;">✅ Nenhum jovem com 7+ dias sem comparecer.</td></tr>';

    tabela14.innerHTML = sem14.map(j => {
        const hist = j.historicoFrequencia || [];
        const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';
        const dias = hist.length > 0 ? Math.floor((agora - new Date(Math.max(...hist.map(h => new Date(h.data))))) / (1000 * 60 * 60 * 24)) : '?';
        return `<tr>
            <td>${j['NOME'] || '-'}</td>
            <td>${j.status || 'REGULAR'}</td>
            <td>${ultimo}</td>
            <td>${dias}</td>
            <td>
                <button onclick="abrirFichaModal('${j.id}')" class="btn-sm btn-sm-primary"><i class="fas fa-file-alt"></i></button>
                <button onclick="marcarDescumprimento('${j.id}')" class="btn-sm btn-sm-danger"><i class="fas fa-exclamation-triangle"></i> Marcar EM DESCUMPRIMENTO</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; color:#10b981;">✅ Nenhum jovem com 14+ dias sem comparecer.</td></tr>';
}

window.marcarIrregular = async function(jovemId) {
    if (!confirm('Tem certeza que deseja marcar este jovem como "IRREGULAR" (7+ dias sem comparecer)?')) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) {
        alert('Jovem não encontrado.');
        return;
    }
    jovem.status = 'IRREGULAR';
    if (!jovem.observacoes) jovem.observacoes = [];
    jovem.observacoes.push({
        data: new Date().toISOString(),
        profissional: estado.usuarioAtual?.nome || 'Sistema',
        texto: '🟡 Status alterado manualmente para "IRREGULAR" - 7+ dias sem comparecer.'
    });
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        await carregarTodosDados();
        alert('✅ Status alterado para IRREGULAR.');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

window.marcarDescumprimento = async function(jovemId) {
    if (!confirm('Tem certeza que deseja marcar este jovem como "EM DESCUMPRIMENTO" (14+ dias sem comparecer)?')) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) {
        alert('Jovem não encontrado.');
        return;
    }
    jovem.status = 'EM DESCUMPRIMENTO';
    jovem.dataDescumprimento = new Date().toISOString();
    if (!jovem.observacoes) jovem.observacoes = [];
    jovem.observacoes.push({
        data: new Date().toISOString(),
        profissional: estado.usuarioAtual?.nome || 'Sistema',
        texto: '🔴 Status alterado manualmente para "EM DESCUMPRIMENTO" - 14+ dias sem comparecer.'
    });
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        await carregarTodosDados();
        alert('✅ Status alterado para EM DESCUMPRIMENTO.');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

// ============================================================
// METAS LA PRÓXIMAS AO VENCIMENTO
// ============================================================
function listarMetasLAProximas() {
    const container = document.getElementById('listaMetasLAProximas');
    if (!container) return;
    const hoje = new Date();
    const limite = new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000);
    let metas = [];

    estado.jovens.forEach(j => {
        if (j['MEDIDA'] !== 'LA') return;
        const acoes = j.acoesLA || [];
        acoes.forEach(a => {
            if (!a.prazo) return;
            const dataPrazo = new Date(a.prazo);
            if (isNaN(dataPrazo.getTime())) return;
            if (dataPrazo >= hoje && dataPrazo <= limite) {
                metas.push({
                    nome: j['NOME'] || j['REFERENCIA'] || 'Sem nome',
                    acao: a.texto,
                    prazo: dataPrazo,
                    jovemId: j.id
                });
            }
        });
    });
    metas.sort((a, b) => a.prazo - b.prazo);

    if (metas.length === 0) {
        container.innerHTML = '<p style="color:#6b7280;">Nenhuma meta com vencimento próximo (≤ 7 dias).</p>';
        return;
    }
    container.innerHTML = metas.map(m => `
        <div class="meta-card ${m.prazo < new Date() ? 'vencido' : ''}">
            <div class="meta-info">
                <span class="nome">${m.nome}</span>
                <span class="acao">${m.acao}</span>
                <span class="prazo"><i class="far fa-calendar-alt"></i> Vence em: ${m.prazo.toLocaleDateString('pt-BR')}</span>
            </div>
            <span class="meta-badge ${m.prazo < new Date() ? 'vencido' : 'urgente'}">
                ${m.prazo < new Date() ? '⚠️ Vencido' : '⏳ Próximo'}
            </span>
        </div>
    `).join('');
}

// ============================================================
// AÇÕES LA - ABA ESPECÍFICA
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
        estado.jovens.forEach(j => {
            if (j['MEDIDA'] === 'LA') {
                (j.acoesLA || []).forEach(a => {
                    acoes.push({ ...a, jovemNome: j['NOME'] || 'Sem nome', jovemId: j.id });
                });
            }
        });
    }
    lista.innerHTML = acoes.map(a => `
        <div style="background:#f8fafc; border-radius:10px; padding:12px; display:flex; justify-content:space-between; align-items:center; border-left:4px solid ${a.realizado ? '#10b981' : '#f59e0b'};">
            <div>
                <div><strong>${a.texto}</strong></div>
                <div style="font-size:0.8rem; color:#64748b;">
                    ${a.jovemNome ? `Jovem: ${a.jovemNome} - ` : ''}
                    Vence: ${a.prazo ? new Date(a.prazo).toLocaleDateString('pt-BR') : 'Sem prazo'}
                    ${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}
                </div>
            </div>
            <div>
                <button class="btn-sm btn-sm-success" onclick="toggleAcaoLaGeral('${a.jovemId || jovemId}', ${a.id})">
                    ${a.realizado ? 'Desmarcar' : 'Marcar Feito'}
                </button>
                <button class="btn-sm btn-sm-danger" onclick="removerAcaoLaGeral('${a.jovemId || jovemId}', ${a.id})">🗑️</button>
            </div>
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
    jovem.acoesLA.push({
        id: Date.now(),
        texto: acaoTexto,
        realizado: false,
        data: new Date().toISOString(),
        prazo: prazo
    });
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        document.getElementById('laAcaoInput').value = '';
        document.getElementById('laPrazoInput').value = '';
        renderizarAcoesLA();
        listarMetasLAProximas();
        alert('Ação adicionada!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

window.toggleAcaoLaGeral = async function(jovemId, acaoId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    const acao = jovem.acoesLA.find(a => a.id === acaoId);
    if (!acao) return alert('Ação não encontrada.');
    acao.realizado = !acao.realizado;
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        renderizarAcoesLA();
        listarMetasLAProximas();
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

window.removerAcaoLaGeral = async function(jovemId, acaoId) {
    if (!confirm('Remover esta ação?')) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return alert('Jovem não encontrado.');
    jovem.acoesLA = jovem.acoesLA.filter(a => a.id !== acaoId);
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        renderizarAcoesLA();
        listarMetasLAProximas();
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

// ============================================================
// AVALIAÇÕES PROFISSIONAIS
// ============================================================
function popularSelectProfissionaisAvaliacao() {
    const select = document.getElementById('avaliacaoProfissional');
    if (!select) return;
    const profs = estado.profissionais.filter(p => p.nome);
    select.innerHTML = '<option value="">Selecione um profissional...</option>' +
        profs.map(p => `<option value="${p.id}">${p.nome}${p.funcao ? ' - ' + p.funcao : ''}${p.registro ? ' (Reg: ' + p.registro + ')' : ''}</option>`).join('');
}

window.abrirModalAvaliacao = function() {
    const jovemId = document.getElementById('selectJovemAcomp').value;
    if (!jovemId) {
        alert('Selecione um jovem primeiro.');
        return;
    }
    _avaliacaoJovemId = jovemId;
    document.getElementById('avaliacaoData').value = new Date().toISOString().split('T')[0];
    document.getElementById('avaliacaoConteudo').value = '';
    popularSelectProfissionaisAvaliacao();
    document.getElementById('modalAvaliacao').style.display = 'flex';
};

window.fecharModalAvaliacao = function() {
    document.getElementById('modalAvaliacao').style.display = 'none';
    _avaliacaoJovemId = null;
};

window.salvarAvaliacao = async function() {
    const jovemId = _avaliacaoJovemId;
    if (!jovemId) { alert('Selecione um jovem primeiro.'); return; }
    
    const profissionalId = document.getElementById('avaliacaoProfissional').value;
    const data = document.getElementById('avaliacaoData').value;
    const area = document.getElementById('avaliacaoArea').value;
    const conteudo = document.getElementById('avaliacaoConteudo').value.trim();
    
    if (!profissionalId) { alert('Selecione um profissional.'); return; }
    if (!data) { alert('Selecione a data da avaliação.'); return; }
    if (!conteudo) { alert('Digite o conteúdo da avaliação.'); return; }
    
    const profissional = estado.profissionais.find(p => p.id === profissionalId);
    if (!profissional) { alert('Profissional não encontrado.'); return; }
    
    const avaliacao = {
        id: 'av_' + Date.now(),
        jovemId: jovemId,
        profissionalId: profissionalId,
        profissionalNome: profissional.nome,
        profissionalFuncao: profissional.funcao || '',
        profissionalRegistro: profissional.registro || '',
        data: data,
        area: area,
        conteudo: conteudo,
        criadoEm: new Date().toISOString()
    };
    
    try {
        await upstash('SET', `avaliacao:${avaliacao.id}`, JSON.stringify(avaliacao));
        await upstash('SADD', 'avaliacoes:all', avaliacao.id);
        estado.avaliacoes.push(avaliacao);
        
        const jovem = estado.jovens.find(j => j.id === jovemId);
        if (jovem) {
            if (!jovem.avaliacoes) jovem.avaliacoes = [];
            jovem.avaliacoes.push(avaliacao.id);
            await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        }
        
        fecharModalAvaliacao();
        carregarFichaIndividual();
        alert('✅ Avaliação salva com sucesso!');
    } catch (err) {
        alert('Erro ao salvar avaliação: ' + err.message);
    }
};

window.excluirAvaliacao = async function(avaliacaoId) {
    if (!confirm('Tem certeza que deseja excluir esta avaliação?')) return;
    try {
        await upstash('DEL', `avaliacao:${avaliacaoId}`);
        await upstash('SREM', 'avaliacoes:all', avaliacaoId);
        estado.avaliacoes = estado.avaliacoes.filter(a => a.id !== avaliacaoId);
        
        const jovem = estado.jovens.find(j => j.avaliacoes && j.avaliacoes.includes(avaliacaoId));
        if (jovem) {
            jovem.avaliacoes = jovem.avaliacoes.filter(id => id !== avaliacaoId);
            await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        }
        
        carregarFichaIndividual();
        alert('✅ Avaliação excluída com sucesso!');
    } catch (err) {
        alert('Erro ao excluir avaliação: ' + err.message);
    }
};

// ============================================================
// ACOMPANHAMENTO INDIVIDUAL - FICHA COM AVALIAÇÕES
// ============================================================
function popularSelectAcompInd() {
    const select = document.getElementById('selectJovemAcomp');
    if (!select) return;
    select.innerHTML = '<option value="">Selecione um jovem...</option>' +
        estado.jovens.sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'))
        .map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''} ${j.status === 'SUSPENSO' ? '🔴' : j.status === 'EM DESCUMPRIMENTO' ? '⚠️' : j.status === 'MEDIDA FINALIZADA' ? '✅' : ''}</option>`).join('');
}

window.carregarFichaIndividual = function() {
    const id = document.getElementById('selectJovemAcomp').value;
    const container = document.getElementById('fichaIndividual');
    const btnPrint = document.getElementById('btnImprimirFicha');

    if (!id) {
        container.style.display = 'none';
        if (btnPrint) btnPrint.style.display = 'none';
        return;
    }
    const jovem = estado.jovens.find(j => j.id === id);
    if (!jovem) return;

    container.style.display = 'block';
    if (btnPrint) btnPrint.style.display = 'inline-block';

    let acoesLAHTML = '';
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        const profs = estado.usuarios.filter(u => u.nivel === 'tecnico' || u.nivel === 'gestor');
        const profAtual = estado.usuarios.find(u => u.id === jovem.profissionalLA);
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
                    <li style="padding:10px; background:#f8fafc; border:1px solid #e2e8f0; margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; border-radius:8px; flex-wrap:wrap; gap:8px;">
                        <span style="${a.realizado ? 'text-decoration:line-through; color:#10b981;' : ''}">
                            ${a.texto} ${a.prazo ? `<span style="font-size:0.7rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span>` : ''}
                        </span>
                        <div>
                            <span style="font-size:0.7rem; color:#6b7280; margin-right:10px;">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                            <button class="btn-sm ${a.realizado ? 'btn-sm-success' : 'btn-sm-warning'}" onclick="toggleAcaoLA('${jovem.id}', ${a.id})">
                                ${a.realizado ? '✅ Feito' : 'Marcar Feito'}
                            </button>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    const dadosDiv = document.getElementById('fichaDadosPessoais');
    if (dadosDiv) {
        dadosDiv.innerHTML = `
            <div class="ficha-grid">
                ${CAMPOS.map(([key, label]) => `<div class="ficha-campo"><strong>${label}:</strong> ${jovem[key] || '-'}</div>`).join('')}
                <div class="ficha-campo"><strong>ID Digital:</strong> ${jovem['ID_DIGITAL'] || '-'}</div>
                <div class="ficha-campo"><strong>Horas Atribuídas:</strong> ${jovem['HORAS'] || 0}h</div>
                <div class="ficha-campo"><strong>Horas Cumpridas:</strong> ${calcularHorasCumpridas(jovem)}h</div>
                <div class="ficha-campo"><strong>Saldo:</strong> ${calcularSaldo(jovem)}h</div>
                ${jovem.motivoSuspensao ? `<div class="ficha-campo" style="grid-column:1/-1; background:#fce7f3; padding:8px; border-radius:4px;"><strong style="color:#be185d;">Motivo da Suspensão:</strong> ${jovem.motivoSuspensao}</div>` : ''}
                ${jovem.status === 'EM DESCUMPRIMENTO' ? `<div class="ficha-campo" style="grid-column:1/-1; background:#fee2e2; padding:8px; border-radius:4px;"><strong style="color:#991b1b;">⚠️ Status: EM DESCUMPRIMENTO</strong></div>` : ''}
                ${jovem.status === 'IRREGULAR' ? `<div class="ficha-campo" style="grid-column:1/-1; background:#fef3c7; padding:8px; border-radius:4px;"><strong style="color:#92400e;">🟡 Status: IRREGULAR</strong></div>` : ''}
            </div>
            ${acoesLAHTML}
        `;
    }

    const freqDiv = document.getElementById('fichaFrequencia');
    if (freqDiv) {
        const hist = jovem.historicoFrequencia || [];
        const totalHoras = hist.reduce((s, h) => s + parseNum(h.horas), 0);
        freqDiv.innerHTML = `
            <p><strong>Total de frequências:</strong> ${hist.length} registros</p>
            <p><strong>Total de horas:</strong> ${totalHoras.toFixed(1)}h</p>
            <p><strong>Saldo restante:</strong> ${calcularSaldo(jovem)}h</p>
            ${hist.length > 0 ? `
                <table style="margin-top:12px; width:100%;">
                    <thead><tr><th>Tipo</th><th>Data/Hora</th><th>Horas</th><th>Observação</th></tr></thead>
                    <tbody>
                        ${hist.map(h => `<tr>
                            <td>${h.tipo === 'saida' ? '🚪 Saída' : '🚪 Entrada'}</td>
                            <td>${new Date(h.data).toLocaleDateString('pt-BR')} ${new Date(h.data).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</td>
                            <td>${h.tipo === 'saida' ? '-' : (parseNum(h.horas) || 0) + 'h'}</td>
                            <td>${h.observacao || '-'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            ` : '<p style="color:#6b7280;">Nenhum registro de frequência.</p>'}
        `;
    }

    const ofDiv = document.getElementById('fichaOficinas');
    if (ofDiv) {
        const oficinasParticipadas = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id));
        ofDiv.innerHTML = oficinasParticipadas.length > 0 ?
            `<table style="margin-top:12px; width:100%;"><thead><tr><th>Data</th><th>Conteúdo</th><th>Benefício Social</th></tr></thead><tbody>
                ${oficinasParticipadas.map(o => `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.conteudo}</td><td>${o.reverte ? '✅ Sim' : 'Não'}</td></tr>`).join('')}
            </tbody></table>` :
            '<p style="color:#6b7280;">Nenhuma oficina registrada.</p>';
    }

    const docDiv = document.getElementById('fichaDocumentos');
    if (docDiv) {
        const docs = jovem.documentos || [];
        docDiv.innerHTML = docs.length > 0 ?
            docs.map((d, i) => `<div class="doc-item"><span>📄 ${d.nome} (${d.tipo})</span><div>${d.base64 ? `<a href="${d.base64}" download="${d.nome}" class="btn-sm btn-sm-primary" style="text-decoration:none;">📥 Baixar</a>` : ''}<button onclick="removerDocumento('${id}', ${i})" class="btn-sm btn-sm-danger">🗑️</button></div></div>`).join('') :
            '<p style="color:#6b7280;">Nenhum documento anexado.</p>';
    }

    const obsDiv = document.getElementById('fichaObservacoes');
    if (obsDiv) {
        const obs = jovem.observacoes || [];
        obsDiv.innerHTML = obs.length > 0 ?
            obs.map(o => `<div class="obs-item"><strong>${o.profissional || 'Sistema'}</strong> - <small>${new Date(o.data).toLocaleDateString('pt-BR')} ${new Date(o.data).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</small><p>${o.texto}</p></div>`).join('') :
            '<p style="color:#6b7280;">Nenhuma observação registrada.</p>';
    }

    // ============================================================
    // AVALIAÇÕES PROFISSIONAIS NA FICHA
    // ============================================================
    const avalDiv = document.getElementById('fichaAvaliacoes');
    if (avalDiv) {
        const avaliacoes = estado.avaliacoes.filter(a => a.jovemId === jovem.id);
        avalDiv.innerHTML = avaliacoes.length > 0 ?
            avaliacoes.map(a => `
                <div class="obs-item" style="border-left-color:#8b5cf6; background:#f5f3ff;">
                    <div style="display:flex; justify-content:space-between; flex-wrap:wrap;">
                        <strong>${a.profissionalNome}</strong>
                        <span style="font-size:0.8rem; color:#6b7280;">${a.area} - ${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                    </div>
                    ${a.profissionalFuncao ? `<span style="font-size:0.8rem; color:#6b7280;">${a.profissionalFuncao}${a.profissionalRegistro ? ' - Reg: ' + a.profissionalRegistro : ''}</span>` : ''}
                    <p style="margin-top:8px; white-space:pre-wrap;">${a.conteudo}</p>
                    <div style="margin-top:6px;">
                        <button onclick="excluirAvaliacao('${a.id}')" class="btn-sm btn-sm-danger">🗑️ Excluir</button>
                    </div>
                </div>
            `).join('') :
            '<p style="color:#6b7280;">Nenhuma avaliação registrada.</p>';
    }

    _jovemDocAtual = jovem.id;
};

window.toggleAcaoLA = async function(jovemId, acaoId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    const acao = jovem.acoesLA.find(a => a.id === acaoId);
    if (!acao) return;
    acao.realizado = !acao.realizado;
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    carregarFichaIndividual();
    carregarLista();
    listarMetasLAProximas();
};

window.vincularProfissionalLA = async function(jovemId, profId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    jovem.profissionalLA = profId;
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    carregarFichaIndividual();
    alert('Profissional vinculado com sucesso!');
};

window.salvarObsAcomp = async function() {
    const jovemId = document.getElementById('selectJovemAcomp').value;
    const texto = document.getElementById('obsAcompTexto').value.trim();
    if (!texto) return alert('Digite a observação.');
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    jovem.observacoes = jovem.observacoes || [];
    jovem.observacoes.push({
        data: new Date().toISOString(),
        profissional: estado.usuarioAtual?.nome || 'Sistema',
        texto: texto
    });
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        document.getElementById('obsAcompTexto').value = '';
        carregarFichaIndividual();
        alert('Observação salva!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

// ============================================================
// RELATÓRIOS DETALHADOS
// ============================================================
function renderizarRelatorios() {
    // Projeção Quinzenal
    const tbody1 = document.querySelector('#tabelaProjecao tbody');
    if (tbody1) {
        const agora = new Date();
        const HORAS_POR_QUINZENA = 8;
        let saldos = estado.jovens
            .filter(j => j['MEDIDA'] && j['MEDIDA'] !== 'Liberação' && j['MEDIDA'] !== 'LA' && j.status !== 'SUSPENSO' && j.status !== 'EM DESCUMPRIMENTO' && j.status !== 'MEDIDA FINALIZADA')
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

    // Aniversariantes com status
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
            return {
                nome: j['NOME'] || j['REFERENCIA'] || 'Sem nome',
                status: j.status || 'REGULAR',
                nasc: nasc,
                diaNasc: diaNasc,
                mesTarget: mesTarget,
                anoTarget: anoTarget,
                idadeQueFara: anoTarget - nasc.getFullYear(),
                dataEvento: new Date(anoTarget, mesTarget, diaNasc)
            };
        }).filter(Boolean).sort((a, b) => a.dataEvento - b.dataEvento);
        
        tbody2.innerHTML = aniversariantes.length > 0 ? aniversariantes.map(a => {
            let bgStatus = a.status === 'SUSPENSO' ? 'badge-suspenso' :
                a.status === 'EM DESCUMPRIMENTO' ? 'badge-descumprimento' :
                a.status === 'IRREGULAR' ? 'badge-irregular' :
                a.status === 'MEDIDA FINALIZADA' ? 'badge-finalizada' :
                a.status === 'REGULAR' ? 'badge-regular' :
                a.status === 'LIBERADO' ? 'badge-liberado' :
                'badge-regular';
            return `<tr>
                <td>${a.nome}</td>
                <td><span class="badge ${bgStatus}">${a.status}</span></td>
                <td>${a.nasc.toLocaleDateString('pt-BR')}</td>
                <td>${String(a.diaNasc).padStart(2, '0')}/${String(a.mesTarget + 1).padStart(2, '0')}/${a.anoTarget}</td>
                <td>${a.idadeQueFara} anos</td>
            </tr>`;
        }).join('') : '<tr><td colspan="5" style="text-align:center; color:#6b7280;">Nenhum aniversariante nos próximos 3 meses.</td></tr>';
    }
}

// ============================================================
// RELATÓRIO DE AVALIAÇÕES PROFISSIONAIS
// ============================================================
window.abrirRelatorioAvaliacoes = function() {
    if (estado.avaliacoes.length === 0) {
        alert('Nenhuma avaliação registrada.');
        return;
    }
    
    let logoBase64 = window._logoBase64 || '';
    if (!logoBase64) {
        const logoImg = document.querySelector('#logoImg, .header .logo-img, .logo-img');
        if (logoImg && logoImg.src && logoImg.src.startsWith('data:image')) {
            logoBase64 = logoImg.src;
        }
    }
    
    let html = `<html><head><title>Relatório de Avaliações Profissionais</title><style>
        body{font-family:'Segoe UI',Arial,sans-serif; padding:30px; background:#f0f4f8;}
        .container{max-width:1000px; margin:0 auto; background:white; border-radius:12px; padding:30px; box-shadow:0 4px 20px rgba(0,0,0,0.08);}
        .header{text-align:center; margin-bottom:25px; border-bottom:3px solid #8b5cf6; padding-bottom:15px;}
        .header-logo{max-height:80px; max-width:150px; object-fit:contain;}
        .header h1{color:#2c3e66; font-size:22px;}
        .header p{color:#6b7280; font-size:14px;}
        .avaliacao-item{background:#f8fafc; border-left:4px solid #8b5cf6; padding:15px; margin-bottom:15px; border-radius:4px;}
        .avaliacao-header{display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom:8px;}
        .avaliacao-header .profissional{font-weight:bold; color:#2c3e66;}
        .avaliacao-header .data{color:#6b7280; font-size:0.9rem;}
        .avaliacao-area{color:#8b5cf6; font-weight:500; font-size:0.85rem;}
        .avaliacao-conteudo{white-space:pre-wrap; margin-top:10px; color:#1e293b;}
        .avaliacao-credenciais{font-size:0.8rem; color:#6b7280;}
        .badge{display:inline-block; padding:2px 10px; border-radius:12px; font-size:11px; font-weight:600;}
        .badge-regular{background:#dbeafe; color:#1e40af;}
        .badge-irregular{background:#fef3c7; color:#92400e;}
        .badge-em-descumprimento{background:#fee2e2; color:#991b1b;}
        .badge-suspenso{background:#fce7f3; color:#be185d;}
        .badge-medida-finalizada{background:#d1fae5; color:#065f46;}
        .badge-liberado{background:#e5e7eb; color:#374151;}
        .total{background:#f5f3ff; padding:15px; border-radius:8px; margin-top:20px; border:1px solid #8b5cf6;}
        .footer{text-align:center; margin-top:20px; padding-top:15px; border-top:1px solid #e2e8f0; color:#94a3b8; font-size:0.8rem;}
        @media print{body{padding:20px; background:white;}}
    </style></head><body>
    <div class="container">
        <div class="header">
            ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" class="header-logo">` : ''}
            <h1>📋 Relatório de Avaliações Profissionais</h1>
            <p>Gerado em ${new Date().toLocaleString('pt-BR')}</p>
        </div>
        <p style="color:#6b7280; margin-bottom:15px;">Total: <strong>${estado.avaliacoes.length}</strong> avaliações registradas</p>`;
    
    // Agrupar por jovem
    const avaliacoesPorJovem = {};
    estado.avaliacoes.forEach(a => {
        if (!avaliacoesPorJovem[a.jovemId]) {
            const jovem = estado.jovens.find(j => j.id === a.jovemId);
            avaliacoesPorJovem[a.jovemId] = {
                nome: jovem ? (jovem['NOME'] || jovem['REFERENCIA'] || 'Sem nome') : 'Jovem não encontrado',
                status: jovem ? jovem.status : 'REGULAR',
                avaliacoes: []
            };
        }
        avaliacoesPorJovem[a.jovemId].avaliacoes.push(a);
    });
    
    const chavesOrdenadas = Object.keys(avaliacoesPorJovem).sort((a, b) => 
        (avaliacoesPorJovem[a].nome || '').localeCompare(avaliacoesPorJovem[b].nome || '')
    );
    
    chavesOrdenadas.forEach(jovemId => {
        const info = avaliacoesPorJovem[jovemId];
        let bgStatus = info.status === 'SUSPENSO' ? 'badge-suspenso' :
            info.status === 'EM DESCUMPRIMENTO' ? 'badge-em-descumprimento' :
            info.status === 'IRREGULAR' ? 'badge-irregular' :
            info.status === 'MEDIDA FINALIZADA' ? 'badge-medida-finalizada' :
            info.status === 'REGULAR' ? 'badge-regular' :
            info.status === 'LIBERADO' ? 'badge-liberado' :
            'badge-regular';
        
        html += `
            <div style="margin-top:25px;">
                <h3 style="color:#2c3e66; border-bottom:1px solid #e2e8f0; padding-bottom:5px;">
                    ${info.nome}
                    <span class="badge ${bgStatus}">${info.status}</span>
                </h3>`;
        
        info.avaliacoes.forEach(a => {
            html += `
                <div class="avaliacao-item">
                    <div class="avaliacao-header">
                        <span class="profissional">${a.profissionalNome}</span>
                        <span class="data">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div class="avaliacao-area">📌 ${a.area}</div>
                    <div class="avaliacao-credenciais">${a.profissionalFuncao || ''}${a.profissionalRegistro ? ' - Reg: ' + a.profissionalRegistro : ''}</div>
                    <div class="avaliacao-conteudo">${a.conteudo}</div>
                </div>
            `;
        });
        
        html += `</div>`;
    });
    
    html += `
        <div class="total">
            <strong>📊 Resumo:</strong> ${estado.avaliacoes.length} avaliações • ${chavesOrdenadas.length} jovens avaliados
        </div>
        <div class="footer">
            Sistema de Controle de Medidas Socioeducativas • v2.0
        </div>
    </div></body></html>`;
    
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
};

// ============================================================
// RELATÓRIO DE AÇÕES LA
// ============================================================
window.abrirRelatorioLA = function() {
    const jovensLA = estado.jovens.filter(j => j['MEDIDA'] === 'LA');
    if (jovensLA.length === 0) {
        alert('Nenhum jovem com Liberdade Assistida encontrado.');
        return;
    }
    
    let logoBase64 = window._logoBase64 || '';
    if (!logoBase64) {
        const logoImg = document.querySelector('#logoImg, .header .logo-img, .logo-img');
        if (logoImg && logoImg.src && logoImg.src.startsWith('data:image')) {
            logoBase64 = logoImg.src;
        }
    }
    
    let totalAcoes = 0;
    let totalRealizadas = 0;
    
    let html = `<html><head><title>Relatório de Ações LA</title><style>
        body{font-family:'Segoe UI',Arial,sans-serif; padding:30px; background:#f0f4f8;}
        .container{max-width:1000px; margin:0 auto; background:white; border-radius:12px; padding:30px; box-shadow:0 4px 20px rgba(0,0,0,0.08);}
        .header{text-align:center; margin-bottom:25px; border-bottom:3px solid #f59e0b; padding-bottom:15px;}
        .header-logo{max-height:80px; max-width:150px; object-fit:contain;}
        .header h1{color:#2c3e66; font-size:22px;}
        .header p{color:#6b7280; font-size:14px;}
        .acao-item{padding:10px 15px; margin-bottom:8px; border-radius:4px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;}
        .acao-item.pendente{background:#fffbeb; border-left:4px solid #f59e0b;}
        .acao-item.realizado{background:#ecfdf5; border-left:4px solid #10b981;}
        .acao-item .texto{font-weight:500;}
        .acao-item .status{font-size:0.85rem; font-weight:600;}
        .acao-item .status.pendente{color:#92400e;}
        .acao-item .status.realizado{color:#065f46;}
        .acao-item .data{font-size:0.8rem; color:#6b7280;}
        .acao-item .prazo{font-size:0.8rem; color:#6b7280;}
        .total{background:#fffbeb; padding:15px; border-radius:8px; margin-top:20px; border:1px solid #f59e0b;}
        .badge{display:inline-block; padding:2px 10px; border-radius:12px; font-size:11px; font-weight:600;}
        .badge-regular{background:#dbeafe; color:#1e40af;}
        .footer{text-align:center; margin-top:20px; padding-top:15px; border-top:1px solid #e2e8f0; color:#94a3b8; font-size:0.8rem;}
        @media print{body{padding:20px; background:white;}}
    </style></head><body>
    <div class="container">
        <div class="header">
            ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" class="header-logo">` : ''}
            <h1>⚖️ Relatório de Ações de Liberdade Assistida</h1>
            <p>Gerado em ${new Date().toLocaleString('pt-BR')}</p>
        </div>
        <p style="color:#6b7280; margin-bottom:15px;">Jovens com LA: <strong>${jovensLA.length}</strong></p>`;
    
    jovensLA.forEach(j => {
        const acoes = j.acoesLA || [];
        const realizadas = acoes.filter(a => a.realizado).length;
        totalAcoes += acoes.length;
        totalRealizadas += realizadas;
        
        html += `
            <div style="margin-top:25px;">
                <h3 style="color:#2c3e66; border-bottom:1px solid #e2e8f0; padding-bottom:5px;">
                    ${j['NOME'] || j['REFERENCIA'] || 'Sem nome'}
                    <span style="font-size:0.85rem; color:#6b7280;">(${realizadas}/${acoes.length} ações)</span>
                </h3>`;
        
        if (acoes.length === 0) {
            html += `<p style="color:#6b7280;">Nenhuma ação cadastrada.</p>`;
        } else {
            acoes.forEach(a => {
                const statusClass = a.realizado ? 'realizado' : 'pendente';
                html += `
                    <div class="acao-item ${statusClass}">
                        <div>
                            <div class="texto">${a.texto}</div>
                            <div class="data">Criado: ${new Date(a.data).toLocaleDateString('pt-BR')}</div>
                            ${a.prazo ? `<div class="prazo">Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')}</div>` : ''}
                        </div>
                        <span class="status ${statusClass}">${a.realizado ? '✅ Realizado' : '⏳ Pendente'}</span>
                    </div>
                `;
            });
        }
        
        html += `</div>`;
    });
    
    const progresso = totalAcoes > 0 ? ((totalRealizadas / totalAcoes) * 100).toFixed(1) : 0;
    
    html += `
        <div class="total">
            <strong>📊 Resumo:</strong> ${totalAcoes} ações • ${totalRealizadas} realizadas • ${progresso}% de conclusão
        </div>
        <div class="footer">
            Sistema de Controle de Medidas Socioeducativas • v2.0
        </div>
    </div></body></html>`;
    
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
};

// ============================================================
// RELATÓRIO DE REVERTÊNCIA
// ============================================================
window.abrirRelatorioRevertencia = function() {
    const ofs = estado.oficinas.filter(o => o.reverte);
    if (ofs.length === 0) {
        alert('Nenhuma oficina revertida encontrada.');
        return;
    }
    
    let logoBase64 = window._logoBase64 || '';
    if (!logoBase64) {
        const logoImg = document.querySelector('#logoImg, .header .logo-img, .logo-img');
        if (logoImg && logoImg.src && logoImg.src.startsWith('data:image')) {
            logoBase64 = logoImg.src;
        }
    }
    
    let html = `<html><head><title>Relatório de Revertência</title><style>
        body{font-family:'Segoe UI',Arial,sans-serif; padding:30px; background:#f0f4f8;}
        .container{max-width:900px; margin:0 auto; background:white; border-radius:12px; padding:30px; box-shadow:0 4px 20px rgba(0,0,0,0.08);}
        .header{text-align:center; margin-bottom:25px; border-bottom:3px solid #10b981; padding-bottom:15px;}
        .header-logo{max-height:80px; max-width:150px; object-fit:contain;}
        .header h1{color:#2c3e66; font-size:22px;}
        .header p{color:#6b7280; font-size:14px;}
        table{width:100%; border-collapse:collapse; margin-top:15px;}
        th{background:#f1f5f9; color:#1e293b; font-weight:600; padding:10px 12px; text-align:left; border-bottom:2px solid #e2e8f0;}
        td{padding:8px 12px; border-bottom:1px solid #f1f5f9;}
        .total{background:#ecfdf5; padding:15px; border-radius:8px; margin-top:20px; border:1px solid #10b981;}
        .footer{text-align:center; margin-top:20px; padding-top:15px; border-top:1px solid #e2e8f0; color:#94a3b8; font-size:0.8rem;}
        @media print{body{padding:20px; background:white;}}
    </style></head><body>
    <div class="container">
        <div class="header">
            ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" class="header-logo">` : ''}
            <h1>🌱 Relatório de Oficinas Revertidas em Benefício Social</h1>
            <p>Gerado em ${new Date().toLocaleString('pt-BR')}</p>
        </div>
        <p style="color:#6b7280; margin-bottom:15px;">Total: <strong>${ofs.length}</strong> oficinas revertidas</p>`;
    
    html += `<table><thead><tr><th>Data</th><th>Período</th><th>Conteúdo</th><th>Participantes</th></tr></thead><tbody>`;
    ofs.forEach(o => {
        const jovens = (o.jovensIds || []).map(id => {
            const j = estado.jovens.find(x => x.id === id);
            return j ? (j['NOME'] || j['REFERENCIA']) : 'Desconhecido';
        }).join(', ') || 'Nenhum';
        html += `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.periodo || '-'}</td><td>${o.conteudo}</td><td>${jovens}</td></tr>`;
    });
    html += `</tbody></table>`;
    
    const todosJovens = new Set();
    ofs.forEach(o => (o.jovensIds || []).forEach(id => todosJovens.add(id)));
    html += `<div class="total"><strong>📊 Jovens beneficiados:</strong> ${todosJovens.size} jovens únicos</div>`;
    
    html += `<div class="footer">Sistema de Controle de Medidas Socioeducativas • v2.0</div>
    </div></body></html>`;
    
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
};

// ============================================================
// RELATÓRIO COMPLETO - IMPRIMIR
// ============================================================
window.imprimirRelatorioCompleto = function() {
    const win = window.open('', '_blank');
    if (!win) { alert('Por favor, permita pop-ups para imprimir o relatório.'); return; }
    
    let logoBase64 = window._logoBase64 || '';
    if (!logoBase64) {
        const logoImg = document.querySelector('#logoImg, .header .logo-img, .logo-img');
        if (logoImg && logoImg.src && logoImg.src.startsWith('data:image')) {
            logoBase64 = logoImg.src;
        }
    }
    
    let html = `<!DOCTYPE html>
    <html><head><title>Relatório Completo - Sistema Socioeducativo</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:'Segoe UI',Arial,sans-serif; padding:40px; background:white; color:#1e293b;}
        .header{text-align:center; margin-bottom:30px; border-bottom:3px solid #2c3e66; padding-bottom:20px;}
        .header-logo{max-height:80px; max-width:150px; object-fit:contain;}
        .header h1{color:#2c3e66; font-size:24px; margin-top:10px;}
        .header p{color:#6b7280; font-size:14px;}
        .section{margin-bottom:25px;}
        .section h2{color:#2c3e66; font-size:18px; border-bottom:2px solid #e2e8f0; padding-bottom:8px; margin-bottom:15px;}
        table{width:100%; border-collapse:collapse; font-size:12px; margin-top:10px;}
        th{background:#f1f5f9; font-weight:600; padding:8px 10px; text-align:left; border-bottom:2px solid #e2e8f0;}
        td{padding:6px 10px; border-bottom:1px solid #f1f5f9;}
        .badge{display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:600;}
        .badge-regular{background:#dbeafe; color:#1e40af;}
        .badge-irregular{background:#fef3c7; color:#92400e;}
        .badge-em-descumprimento{background:#fee2e2; color:#991b1b;}
        .badge-suspenso{background:#fce7f3; color:#be185d;}
        .badge-medida-finalizada{background:#d1fae5; color:#065f46;}
        .badge-liberado{background:#e5e7eb; color:#374151;}
        .footer{text-align:center; margin-top:30px; padding-top:15px; border-top:1px solid #e2e8f0; color:#94a3b8; font-size:11px;}
        .col-2{display:grid; grid-template-columns:1fr 1fr; gap:20px;}
        .info-box{background:#f8fafc; padding:12px; border-radius:6px; border:1px solid #e2e8f0;}
        .info-box strong{display:block; color:#2c3e66;}
        .no-print{text-align:center; margin-top:20px;}
        .no-print button{padding:10px 30px; border:none; border-radius:6px; font-size:16px; cursor:pointer;}
        .btn-print{background:#2c3e66; color:white;}
        .btn-close{background:#6c757d; color:white; margin-left:10px;}
        @media print{body{padding:20px;} .no-print{display:none;}}
    </style>
    </head><body>
    <div class="header">
        ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" class="header-logo">` : ''}
        <h1>📊 Relatório Completo do Sistema</h1>
        <p>Relatório gerado em ${new Date().toLocaleString('pt-BR')}</p>
    </div>
    
    <div class="section">
        <h2>📊 Resumo Geral</h2>
        <div class="col-2">
            <div class="info-box"><strong>Total de Jovens</strong> ${estado.jovens.length}</div>
            <div class="info-box"><strong>REGULAR</strong> ${estado.jovens.filter(j => j.status === 'REGULAR').length}</div>
            <div class="info-box"><strong>IRREGULAR</strong> ${estado.jovens.filter(j => j.status === 'IRREGULAR').length}</div>
            <div class="info-box"><strong>EM DESCUMPRIMENTO</strong> ${estado.jovens.filter(j => j.status === 'EM DESCUMPRIMENTO').length}</div>
            <div class="info-box"><strong>SUSPENSO</strong> ${estado.jovens.filter(j => j.status === 'SUSPENSO').length}</div>
            <div class="info-box"><strong>MEDIDA FINALIZADA</strong> ${estado.jovens.filter(j => j.status === 'MEDIDA FINALIZADA').length}</div>
            <div class="info-box"><strong>LIBERADO</strong> ${estado.jovens.filter(j => j.status === 'LIBERADO' || j['MEDIDA'] === 'Liberação').length}</div>
            <div class="info-box"><strong>Oficinas Realizadas</strong> ${estado.oficinas.length}</div>
            <div class="info-box"><strong>Avaliações Profissionais</strong> ${estado.avaliacoes.length}</div>
        </div>
    </div>
    
    <div class="section">
        <h2>👥 Lista de Jovens</h2>
        <table>
            <thead><tr><th>Nome</th><th>Medida</th><th>Status</th><th>Horas Atribuídas</th><th>Horas Cumpridas</th><th>Saldo</th></tr></thead>
            <tbody>
                ${estado.jovens.sort((a,b) => (a['NOME'] || '').localeCompare(b['NOME'] || '')).map(j => `
                    <tr>
                        <td>${j['NOME'] || j['REFERENCIA'] || '-'}</td>
                        <td>${j['MEDIDA'] || '-'}</td>
                        <td><span class="badge badge-${(j.status || 'regular').toLowerCase().replace(' ', '-')}">${j.status || 'REGULAR'}</span></td>
                        <td>${j['HORAS'] || 0}h</td>
                        <td>${calcularHorasCumpridas(j)}h</td>
                        <td>${calcularSaldo(j)}h</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    
    <div class="section">
        <h2>📋 Avaliações Profissionais</h2>
        ${estado.avaliacoes.length > 0 ? `
            <table>
                <thead><tr><th>Jovem</th><th>Profissional</th><th>Área</th><th>Data</th></tr></thead>
                <tbody>
                    ${estado.avaliacoes.map(a => {
                        const jovem = estado.jovens.find(j => j.id === a.jovemId);
                        return `<tr>
                            <td>${jovem ? jovem['NOME'] || jovem['REFERENCIA'] || 'Sem nome' : 'Não encontrado'}</td>
                            <td>${a.profissionalNome}</td>
                            <td>${a.area}</td>
                            <td>${new Date(a.data).toLocaleDateString('pt-BR')}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        ` : '<p style="color:#6b7280;">Nenhuma avaliação registrada.</p>'}
    </div>
    
    <div class="section">
        <h2>🛠️ Oficinas Realizadas</h2>
        ${estado.oficinas.length > 0 ? `
            <table>
                <thead><tr><th>Data</th><th>Conteúdo</th><th>Participantes</th><th>Benefício Social</th></tr></thead>
                <tbody>
                    ${estado.oficinas.slice().reverse().map(o => `
                        <tr>
                            <td>${new Date(o.data).toLocaleDateString('pt-BR')}</td>
                            <td>${o.conteudo}</td>
                            <td>${(o.jovensIds || []).map(id => {
                                const j = estado.jovens.find(x => x.id === id);
                                return j ? j['NOME'] || j['REFERENCIA'] : 'Desconhecido';
                            }).join(', ') || 'Nenhum'}</td>
                            <td>${o.reverte ? '✅ Sim' : 'Não'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : '<p style="color:#6b7280;">Nenhuma oficina registrada.</p>'}
    </div>
    
    <div class="section">
        <h2>⚖️ Ações de Liberdade Assistida</h2>
        ${estado.jovens.filter(j => j['MEDIDA'] === 'LA').length > 0 ? `
            <table>
                <thead><tr><th>Jovem</th><th>Ação</th><th>Status</th><th>Vencimento</th></tr></thead>
                <tbody>
                    ${estado.jovens.filter(j => j['MEDIDA'] === 'LA').flatMap(j => 
                        (j.acoesLA || []).map(a => `
                            <tr>
                                <td>${j['NOME'] || j['REFERENCIA'] || 'Sem nome'}</td>
                                <td>${a.texto}</td>
                                <td>${a.realizado ? '✅ Realizado' : '⏳ Pendente'}</td>
                                <td>${a.prazo ? new Date(a.prazo).toLocaleDateString('pt-BR') : 'Sem prazo'}</td>
                            </tr>
                        `)
                    ).join('')}
                </tbody>
            </table>
        ` : '<p style="color:#6b7280;">Nenhuma ação de LA registrada.</p>'}
    </div>
    
    <div class="footer">
        Sistema de Controle de Medidas Socioeducativas • v2.0<br>
        Relatório gerado automaticamente em ${new Date().toLocaleString('pt-BR')}
    </div>
    <div class="no-print">
        <button class="btn-print" onclick="window.print()">🖨️ Imprimir</button>
        <button class="btn-close" onclick="window.close()">Fechar</button>
    </div>
    </body></html>`;
    
    win.document.write(html);
    win.document.close();
};

window.exportarRelatorioCompleto = function() {
    alert('Para exportar como PDF, clique em "Imprimir" e selecione "Salvar como PDF" como destino.');
    imprimirRelatorioCompleto();
};

// ============================================================
// PONTO DIGITAL E NA LINHA
// ============================================================
window.registrarPontoNaLinha = async function(jovemId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;

    if (jovem['MEDIDA'] === 'Liberação') return alert('❌ Jovem está liberado.');
    if (jovem.status === 'SUSPENSO') return alert('❌ Jovem está suspenso.');
    if (jovem.status === 'MEDIDA FINALIZADA') return alert('❌ Jovem já finalizou a medida.');

    if (jovem.status === 'IRREGULAR') {
        if (!confirm('Este jovem está irregular (7+ dias sem comparecer). Deseja reativá-lo para REGULAR ao registrar presença?')) return;
        jovem.status = 'REGULAR';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({
            data: new Date().toISOString(),
            profissional: estado.usuarioAtual?.nome || 'Sistema',
            texto: '✅ Jovem reativado para REGULAR ao registrar presença.'
        });
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    }
    if (jovem.status === 'EM DESCUMPRIMENTO') {
        if (!confirm('Este jovem está em descumprimento. Deseja reativá-lo para REGULAR ao registrar presença?')) return;
        jovem.status = 'REGULAR';
        jovem.dataDescumprimento = '';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({
            data: new Date().toISOString(),
            profissional: estado.usuarioAtual?.nome || 'Sistema',
            texto: '✅ Jovem reativado para REGULAR ao registrar presença.'
        });
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    }

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
        if (jovem['MEDIDA'] === 'LA') {
            entradaAberta.horaSaida = now.toISOString();
            hist.push({ data: now.toISOString(), horas: 0, tipo: 'saida', observacao: 'Saída (LA)', entradaReferencia: new Date(entradaAberta.data).getTime() });
            alert(`✅ Saída registrada para ${jovem['NOME']} às ${now.toLocaleTimeString('pt-BR')}`);
        } else {
            const diffMs = now.getTime() - new Date(entradaAberta.data).getTime();
            const horasReais = diffMs / (1000 * 60 * 60);
            const horasArredondadas = Math.round(horasReais * 4) / 4;
            entradaAberta.horas = parseFloat(horasArredondadas.toFixed(2));
            entradaAberta.horaSaida = now.toISOString();
            hist.push({ data: now.toISOString(), horas: 0, tipo: 'saida', observacao: '', entradaReferencia: new Date(entradaAberta.data).getTime() });
            alert(`✅ Saída registrada para ${jovem['NOME']} às ${now.toLocaleTimeString('pt-BR')} (${horasArredondadas.toFixed(2)}h)`);
        }
    } else {
        hist.push({ data: now.toISOString(), horas: 0, tipo: 'entrada', observacao: jovem['MEDIDA'] === 'LA' ? 'Entrada (LA)' : '' });
        alert(`✅ Entrada registrada para ${jovem['NOME']} em ${now.toLocaleString('pt-BR')}`);
    }

    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        await carregarTodosDados();
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

async function registrarPontoDigital() {
    const id = document.getElementById('inputDigital').value.trim();
    if (!id) return alert('Digite o código da digital.');
    const jovem = estado.jovens.find(j => j['ID_DIGITAL'] === id);
    if (!jovem) return alert('Código não encontrado.');
    if (jovem.status === 'SUSPENSO') return alert('Jovem está suspenso.');
    if (jovem.status === 'MEDIDA FINALIZADA') return alert('Jovem já finalizou a medida.');
    if (jovem['MEDIDA'] === 'Liberação') return alert('Jovem está liberado.');
    await registrarPontoNaLinha(jovem.id);
    document.getElementById('inputDigital').value = '';
}

// ============================================================
// REGISTRO MANUAL
// ============================================================
function abrirRegistroManual() {
    const select = document.getElementById('manualJovem');
    if (!select) return;
    const jovensDisponiveis = estado.jovens.filter(j =>
        j['MEDIDA'] !== 'Liberação' &&
        j.status !== 'SUSPENSO' &&
        j.status !== 'MEDIDA FINALIZADA'
    );
    if (jovensDisponiveis.length === 0) {
        alert('Não há jovens disponíveis para registro manual.');
        select.innerHTML = '<option value="">Nenhum jovem disponível</option>';
    } else {
        select.innerHTML = jovensDisponiveis
            .sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'))
            .map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''} ${j.status === 'EM DESCUMPRIMENTO' ? '⚠️' : ''} ${j.status === 'IRREGULAR' ? '🟡' : ''} ${j['MEDIDA'] === 'LA' ? '📋' : ''}</option>`)
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
    if (jovem.status === 'SUSPENSO') return alert('❌ Jovem está suspenso.');
    if (jovem.status === 'MEDIDA FINALIZADA') return alert('❌ Jovem já finalizou a medida.');
    if (jovem['MEDIDA'] === 'Liberação') return alert('❌ Jovem está liberado.');

    if (jovem.status === 'IRREGULAR') {
        if (!confirm('Este jovem está irregular. Deseja reativá-lo para REGULAR ao registrar presença?')) return;
        jovem.status = 'REGULAR';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({
            data: new Date().toISOString(),
            profissional: estado.usuarioAtual?.nome || 'Sistema',
            texto: '✅ Jovem reativado para REGULAR ao registrar presença manual.'
        });
    }
    if (jovem.status === 'EM DESCUMPRIMENTO') {
        if (!confirm('Este jovem está em descumprimento. Deseja reativá-lo para REGULAR ao registrar presença?')) return;
        jovem.status = 'REGULAR';
        jovem.dataDescumprimento = '';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({
            data: new Date().toISOString(),
            profissional: estado.usuarioAtual?.nome || 'Sistema',
            texto: '✅ Jovem reativado para REGULAR ao registrar presença manual.'
        });
    }

    jovem.historicoFrequencia = jovem.historicoFrequencia || [];
    const dataEntradaDate = new Date(dataEntrada);

    if (jovem['MEDIDA'] === 'LA') {
        jovem.historicoFrequencia.push({
            data: dataEntradaDate.toISOString(),
            horas: 0,
            tipo: 'entrada',
            observacao: obs || 'Registro manual (LA)'
        });
        const dataSaida = new Date(dataEntradaDate.getTime() + 30 * 60 * 1000);
        jovem.historicoFrequencia.push({
            data: dataSaida.toISOString(),
            horas: 0,
            tipo: 'saida',
            observacao: 'Saída (LA)',
            entradaReferencia: dataEntradaDate.getTime()
        });
    } else {
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
    }

    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        document.getElementById('modalRegistroManual').style.display = 'none';
        await carregarTodosDados();
        alert(`✅ Registro salvo para ${jovem['NOME']}`);
    } catch (err) {
        alert('Erro: ' + err.message);
    }
}

// ============================================================
// OFICINAS
// ============================================================
function renderizarJovensOficina() {
    const div = document.getElementById('listaJovensOficina');
    if (!div) return;
    const jovens = estado.jovens.filter(j =>
        j['MEDIDA'] !== 'Liberação' &&
        j.status !== 'SUSPENSO' &&
        j.status !== 'EM DESCUMPRIMENTO' &&
        j.status !== 'MEDIDA FINALIZADA'
    ).sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'));
    div.innerHTML = jovens.map(j => `<label class="jovem-checkbox"><input type="checkbox" value="${j.id}"><span class="jovem-nome">${j['NOME'] || j['REFERENCIA']}</span></label>`).join('');
}

window.filtrarJovensOficina = function() {
    const busca = document.getElementById('buscaJovensOficina').value.toLowerCase();
    const labels = document.querySelectorAll('#listaJovensOficina .jovem-checkbox');
    labels.forEach(label => {
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
    } catch (err) {
        alert('Erro: ' + err.message);
    }
}

function renderizarOficinas() {
    renderizarJovensOficina();
    const div = document.getElementById('listaOficinas');
    if (!div) return;
    div.innerHTML = estado.oficinas.slice().reverse().map(o => {
        const dataFmt = new Date(o.data).toLocaleDateString('pt-BR');
        const jovensNomes = (o.jovensIds || []).map(id => {
            const j = estado.jovens.find(x => x.id === id);
            return j ? (j['NOME'] || j['REFERENCIA']) : 'Desconhecido';
        });
        return `<div class="oficina-card ${o.reverte ? 'reverte' : ''}">
            <div class="info">
                <div class="titulo">📅 ${dataFmt} - ${o.periodo}</div>
                <div class="detalhes">
                    <span>${o.conteudo}</span>
                    <span>👥 ${jovensNomes.length} jovens</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">
                    ${o.reverte ? '<span class="tag tag-green">✅ Benefício social</span>' : ''}
                    ${o.isCurso ? '<span class="tag tag-blue">📚 Curso Obrigatório</span>' : ''}
                    ${jovensNomes.map(n => `<span class="tag">${n}</span>`).join('')}
                </div>
            </div>
            <div>
                <button onclick="abrirModalExclusao('oficina','${o.id}', '${o.conteudo}')" class="btn-sm btn-sm-danger">🗑️</button>
            </div>
        </div>`;
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

    if (!data || !titulo) return alert('Preencha a data e o título da oficina.');

    const plan = {
        id: 'plan_' + Date.now(),
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

    navigateTo('pageOficinas');
    plan.realizada = true;
    upstash('SET', `planejamento:${plan.id}`, JSON.stringify(plan));
    alert('✅ Planejamento convertido! Preencha os jovens presentes e salve a oficina.');
    renderizarPlanejamentos();
};

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
                    ${podeConverter ? `<button class="btn-sm btn-sm-success" onclick="converterPlanejamentoEmOficina('${p.id}')">🔄 Converter</button>` : ''}
                    <button class="btn-sm btn-sm-danger" onclick="abrirModalExclusao('planejamento', '${p.id}', '${p.titulo}')">🗑️</button>
                </div>
            </div>
        </div>
    `).join('') || '<p style="color:#6b7280; text-align:center; padding:20px;">Nenhum planejamento salvo.</p>';
}

// ============================================================
// USUÁRIOS
// ============================================================
function renderizarUsuarios() {
    const tbody = document.getElementById('listaUsuarios');
    if (!tbody) return;

    const podeConfigurarHorarios = ['gestor', 'desenvolvedor', 'admin'].includes(estado.usuarioAtual?.nivel);
    const podeAlterarNivel = ['gestor', 'desenvolvedor', 'admin'].includes(estado.usuarioAtual?.nivel);

    const usuariosAtivos = estado.usuarios.filter(u => u.status === 'ativo');

    if (usuariosAtivos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#6b7280;">Nenhum usuário ativo encontrado.</td></tr>';
        return;
    }

    tbody.innerHTML = usuariosAtivos.map(u => {
        const isDesenvolvedor = u.nivel === 'desenvolvedor' || u.nivel === 'admin';
        const isProprioUsuario = u.id === estado.usuarioAtual?.id;

        let botoesHorarios = '';
        if (podeConfigurarHorarios) {
            if (isProprioUsuario) {
                botoesHorarios = `<button onclick="abrirModalHorarios('${u.id}')" class="btn-sm btn-sm-primary">👤 Meu Horário</button>`;
            } else if (isDesenvolvedor) {
                botoesHorarios = `<span style="font-size:0.65rem; color:#10b981;">🔓 Acesso irrestrito</span>`;
            } else {
                botoesHorarios = `<button onclick="abrirModalHorarios('${u.id}')" class="btn-sm btn-sm-warning">⏱️ Horários</button>`;
            }
        }

        let botoesNivel = '';
        if (podeAlterarNivel && !isProprioUsuario && !isDesenvolvedor) {
            const niveis = ['gestor', 'tecnico', 'oficineiro', 'autoridade', 'jovem'];
            botoesNivel = `
                <select onchange="alterarNivelUsuario('${u.id}', this.value)" style="padding:2px 6px; font-size:0.7rem; border:1px solid #d1d9e6; border-radius:4px;">
                    <option value="">Alterar Nível</option>
                    ${niveis.map(n => `<option value="${n}" ${u.nivel === n ? 'selected' : ''}>${NIVEIS_ACESSO[n]?.nome || n}</option>`).join('')}
                </select>
            `;
        }

        const podeExcluir = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) && !isProprioUsuario;
        const botaoExcluir = podeExcluir ? `<button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-sm btn-sm-danger">🗑️</button>` : '';

        return `
        <tr>
            <td>${u.nome || '-'}</td>
            <td>${u.email || '-'}</td>
            <td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel || '-'} ${isDesenvolvedor ? ' 🛡️' : ''}</td>
            <td><span style="color:#10b981;">${u.status}</span></td>
            <td style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">
                ${botoesHorarios}
                ${botoesNivel}
                ${botaoExcluir}
            </td>
        </tr>
    `}).join('');
}

window.alterarNivelUsuario = async function(userId, novoNivel) {
    if (!['gestor', 'desenvolvedor'].includes(estado.usuarioAtual?.nivel)) {
        alert('❌ Você não tem permissão para alterar níveis de acesso.');
        return;
    }
    const user = estado.usuarios.find(u => u.id === userId);
    if (!user) {
        alert('Usuário não encontrado.');
        return;
    }
    if (user.id === estado.usuarioAtual.id) {
        alert('❌ Você não pode alterar seu próprio nível de acesso.');
        return;
    }
    if (user.nivel === 'desenvolvedor' && estado.usuarioAtual.nivel !== 'desenvolvedor') {
        alert('❌ Apenas desenvolvedores podem alterar o nível de outro desenvolvedor.');
        return;
    }
    if (!confirm(`Tem certeza que deseja alterar o nível de ${user.nome} de "${user.nivel}" para "${novoNivel}"?`)) {
        return;
    }
    const nivelAnterior = user.nivel;
    user.nivel = novoNivel;
    try {
        await upstash('SET', `user:${user.id}`, JSON.stringify(user));
        await carregarTodosDados();
        alert(`✅ Nível de acesso alterado com sucesso!\n${user.nome}: ${nivelAnterior} → ${novoNivel}`);
    } catch (err) {
        alert('Erro ao alterar nível: ' + err.message);
    }
};

function renderizarPendentes() {
    const tbody = document.getElementById('listaPendentes');
    if (!tbody) return;
    const pendentes = estado.usuarios.filter(u => u.status !== 'ativo');
    tbody.innerHTML = pendentes.map(u => `
        <tr>
            <td>${u.nome || '-'}</td>
            <td>${u.email || '-'}</td>
            <td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel || '-'}</td>
            <td>
                ${NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) ? `
                    <button onclick="aprovarUsuario('${u.id}', '${u.nivel}')" class="btn-sm btn-sm-success">✅ Aprovar</button>
                    <button onclick="abrirModalExclusao('usuario', '${u.id}', '${u.nome}')" class="btn-sm btn-sm-danger">🗑️ Rejeitar</button>
                ` : '<span style="color:#6b7280;">Aguardando aprovação</span>'}
            </td>
        </tr>
    `).join('');
}

async function salvarNovoUsuario() {
    const nivel = document.getElementById('userNivel').value;
    if (nivel === 'desenvolvedor') return alert('Não é possível cadastrar Desenvolvedor.');

    const user = {
        id: 'usr_' + Date.now(),
        nome: document.getElementById('userNome').value.trim(),
        email: document.getElementById('userEmail').value.trim(),
        senha: document.getElementById('userSenha').value.trim(),
        nivel: nivel,
        status: 'ativo'
    };
    if (!user.nome || !user.email || !user.senha) return alert('Preencha todos os campos.');
    try {
        await upstash('SET', `user:${user.id}`, JSON.stringify(user));
        await upstash('SADD', 'users:all', user.id);
        estado.usuarios.push(user);
        renderizarUsuarios();
        ['userNome', 'userEmail', 'userSenha'].forEach(id => document.getElementById(id).value = '');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
}

window.aprovarUsuario = async function(id, nivel) {
    const user = estado.usuarios.find(u => u.id === id);
    if (!user) return;

    if (nivel === 'jovem') {
        window._userParaVincular = user;
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
        } catch (err) {
            alert('Erro: ' + err.message);
        }
    }
};

function fecharModalVincular() {
    document.getElementById('modalVincularJovem').style.display = 'none';
    window._userParaVincular = null;
}

async function salvarVinculoJovem() {
    const cpfOuId = document.getElementById('selectVincularJovem').value;
    if (!cpfOuId) return alert('Selecione um jovem.');
    const user = window._userParaVincular;
    if (!user) return;
    user.cpf = cpfOuId;
    user.status = 'ativo';
    try {
        await upstash('SET', `user:${user.id}`, JSON.stringify(user));
        fecharModalVincular();
        await carregarTodosDados();
        alert('✅ Jovem vinculado e aprovado com sucesso!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
}

// ============================================================
// HORÁRIOS DE ACESSO
// ============================================================
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
    `;

    document.getElementById('horariosAtivosGlobais').onchange = (e) => {
        document.getElementById('diasContainer').style.display = e.target.checked ? 'block' : 'none';
    };

    document.getElementById('modalHorarios').style.display = 'flex';
};

window.salvarHorariosUsuario = async function() {
    const u = estado.usuarioEdicaoHorario;
    if (!u) return;

    u.horariosConfigurados = document.getElementById('horariosAtivosGlobais').checked;
    u.horarios = {};
    ['segunda', 'terca', 'quarta', 'quinta', 'sexta'].forEach(d => {
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
        renderizarMensagens();
        alert('✅ Mensagem enviada com sucesso!');
    } catch (err) {
        alert('Erro ao enviar mensagem: ' + err.message);
    }
}

// ============================================================
// PROFISSIONAIS
// ============================================================
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
                <button onclick="abrirModalExclusao('profissional', '${p.id}', '${p.nome}')" class="btn-sm btn-sm-danger">🗑️</button>
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

// ============================================================
// EXCLUSÃO
// ============================================================
window.abrirModalExclusao = function(tipo, id, nome) {
    estado.exclusaoPendente = { tipo, id };
    document.getElementById('textoConfirmExclusao').textContent = `Você está prestes a apagar permanentemente os registros de: ${nome}`;
    document.getElementById('modalConfirmExclusao').style.display = 'flex';
};

window.executarExclusao = async function() {
    if (!estado.exclusaoPendente) return;
    const { tipo, id } = estado.exclusaoPendente;
    try {
        if (tipo === 'jovem') {
            await upstash('DEL', `jovem:${id}`);
            await upstash('SREM', 'jovens:all', id);
            estado.jovens = estado.jovens.filter(j => j.id !== id);
            estado.selecionadosLote.delete(id);
        } else if (tipo === 'usuario') {
            await upstash('DEL', `user:${id}`);
            await upstash('SREM', 'users:all', id);
            estado.usuarios = estado.usuarios.filter(u => u.id !== id);
        } else if (tipo === 'oficina') {
            await upstash('DEL', `oficina:${id}`);
            await upstash('SREM', 'oficinas:all', id);
            estado.oficinas = estado.oficinas.filter(o => o.id !== id);
        } else if (tipo === 'planejamento') {
            await upstash('DEL', `planejamento:${id}`);
            await upstash('SREM', 'planejamentos:all', id);
            estado.planejamentos = estado.planejamentos.filter(p => p.id !== id);
        } else if (tipo === 'profissional') {
            await upstash('DEL', `profissional:${id}`);
            await upstash('SREM', 'profissionais:all', id);
            estado.profissionais = estado.profissionais.filter(p => p.id !== id);
        }
        document.getElementById('modalConfirmExclusao').style.display = 'none';
        await carregarTodosDados();
        alert('✅ Registro excluído com sucesso!');
    } catch (err) {
        alert('Erro ao excluir: ' + err.message);
    }
};

// ============================================================
// CONFIGURAÇÕES - SENHA E LOGO
// ============================================================
async function salvarNovaSenha() {
    const s1 = document.getElementById('novaSenhaInput').value;
    const s2 = document.getElementById('confirmarNovaSenhaInput').value;
    if (!s1 || s1.length < 6) return alert('Senha deve ter no mínimo 6 caracteres.');
    if (s1 !== s2) return alert('As senhas não coincidem.');
    try {
        estado.usuarioAtual.senha = s1;
        await upstash('SET', `user:${estado.usuarioAtual.id}`, JSON.stringify(estado.usuarioAtual));
        alert('Senha alterada com sucesso!');
        document.getElementById('novaSenhaInput').value = '';
        document.getElementById('confirmarNovaSenhaInput').value = '';
    } catch (err) {
        alert('Erro ao alterar senha: ' + err.message);
    }
}

async function carregarLogo() {
    try {
        const logoBase64 = await upstash('GET', 'config:logo');
        if (logoBase64) {
            const logoImg = document.querySelector('#logoImg, .header .logo-img, .logo-img');
            if (logoImg) logoImg.src = logoBase64;
            const logoLogin = document.getElementById('logoLogin');
            if (logoLogin) {
                logoLogin.src = logoBase64;
                logoLogin.style.display = 'block';
            }
            window._logoBase64 = logoBase64;
        }
    } catch (e) {
        console.error('Erro ao carregar logo', e);
    }
}

async function salvarLogo() {
    const fileInput = document.getElementById('novaLogoInput');
    if (!fileInput || !fileInput.files[0]) {
        const fileInputAlt = document.getElementById('novaLogoInputAlt');
        if (fileInputAlt && fileInputAlt.files[0]) {
            try {
                const base64 = await fileToBase64(fileInputAlt.files[0]);
                await upstash('SET', 'config:logo', base64);
                atualizarLogoInterface(base64);
                alert('Logo atualizado com sucesso!');
                fileInputAlt.value = '';
                return;
            } catch (err) {
                alert('Erro ao salvar logo: ' + err.message);
                return;
            }
        }
        return alert('Selecione uma imagem.');
    }
    
    try {
        const base64 = await fileToBase64(fileInput.files[0]);
        await upstash('SET', 'config:logo', base64);
        atualizarLogoInterface(base64);
        alert('Logo atualizado com sucesso!');
        fileInput.value = '';
    } catch (err) {
        alert('Erro ao salvar logo: ' + err.message);
    }
}

function atualizarLogoInterface(base64) {
    const logoImg = document.querySelector('#logoImg, .header .logo-img, .logo-img');
    if (logoImg) logoImg.src = base64;
    const logoLogin = document.getElementById('logoLogin');
    if (logoLogin) {
        logoLogin.src = base64;
        logoLogin.style.display = 'block';
    }
    window._logoBase64 = base64;
}

// ============================================================
// DASHBOARD JOVEM
// ============================================================
function renderizarDashboardJovem() {
    const cards = document.getElementById('jovemInfoCards');
    const freqDiv = document.getElementById('jovemFrequencia');
    if (!cards || !freqDiv) return;
    if (estado.jovens.length === 0) {
        cards.innerHTML = '<p style="color:#6b7280;">Nenhum dado encontrado.</p>';
        freqDiv.innerHTML = '';
        return;
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
                    ${acoes.map(a => `<li style="padding:10px; background:${a.realizado ? '#d1fae5' : '#fffbeb'}; margin-bottom:8px; border-radius:8px; border-left:4px solid ${a.realizado ? '#10b981' : '#f59e0b'}; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <span><strong>${a.texto}</strong> ${a.prazo ? `<span style="font-size:0.7rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span>` : ''} - <span style="color:${a.realizado ? '#065f46' : '#92400e'};">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span></span>
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

// ============================================================
// IMPRIMIR FICHA INDIVIDUAL (COM LOGO)
// ============================================================
window.imprimirFichaIndividual = function() {
    const id = document.getElementById('selectJovemAcomp').value;
    if (!id) { alert('Selecione um jovem primeiro.'); return; }
    const jovem = estado.jovens.find(j => j.id === id);
    if (!jovem) { alert('Jovem não encontrado.'); return; }
    const win = window.open('', '_blank');
    if (!win) { alert('Por favor, permita pop-ups para imprimir a ficha.'); return; }

    let logoBase64 = window._logoBase64 || '';
    if (!logoBase64) {
        const logoImg = document.querySelector('#logoImg, .header .logo-img, .logo-img');
        if (logoImg && logoImg.src && logoImg.src.startsWith('data:image')) {
            logoBase64 = logoImg.src;
        }
    }

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Ficha Individual - ${jovem['NOME'] || 'Sem nome'}</title>
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
            .status-badge { display: inline-block; padding: 2px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; }
            .status-REGULAR { background: #dbeafe; color: #1e40af; }
            .status-IRREGULAR { background: #fef3c7; color: #92400e; }
            .status-EM_DESCUMPRIMENTO { background: #fee2e2; color: #991b1b; }
            .status-SUSPENSO { background: #fce7f3; color: #be185d; }
            .status-MEDIDA_FINALIZADA { background: #d1fae5; color: #065f46; }
            .status-LIBERADO { background: #e5e7eb; color: #374151; }
            .avaliacao-item { background: #f5f3ff; border-left: 3px solid #8b5cf6; padding: 10px; margin-bottom: 8px; border-radius: 4px; }
            .avaliacao-item .profissional { font-weight: bold; }
            .avaliacao-item .data { font-size: 0.8rem; color: #6b7280; }
            .avaliacao-item .area { color: #8b5cf6; font-weight: 500; font-size: 0.85rem; }
            .avaliacao-item .conteudo { margin-top: 6px; white-space: pre-wrap; }
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
                <p style="font-size:12px; margin-top:4px;">
                    <span class="status-badge status-${(jovem.status || 'REGULAR').replace(/ /g, '_')}">
                        ${jovem.status || 'REGULAR'}
                    </span>
                </p>
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
    html += `<div class="field"><strong>Horas Atribuídas</strong><span>${jovem['HORAS'] || 0}h</span></div>`;
    html += `<div class="field"><strong>Horas Cumpridas</strong><span>${calcularHorasCumpridas(jovem)}h</span></div>`;
    html += `<div class="field"><strong>Saldo</strong><span>${calcularSaldo(jovem)}h</span></div>`;
    html += `</div></div>`;

    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        html += `<div class="section"><h2>Ações LA</h2>`;
        acoes.forEach(a => {
            html += `<div style="padding:6px; background:${a.realizado ? '#d1fae5' : '#f8fafc'}; margin-bottom:4px; border-radius:4px;"><span>${a.texto}</span> ${a.prazo ? `<span style="font-size:0.7rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span>` : ''} - <span style="color:${a.realizado ? '#065f46' : '#92400e'};">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span></div>`;
        });
        html += `</div>`;
    }

    // Avaliações
    const avaliacoes = estado.avaliacoes.filter(a => a.jovemId === jovem.id);
    if (avaliacoes.length > 0) {
        html += `<div class="section"><h2>📋 Avaliações Profissionais</h2>`;
        avaliacoes.forEach(a => {
            html += `
                <div class="avaliacao-item">
                    <div style="display:flex; justify-content:space-between; flex-wrap:wrap;">
                        <span class="profissional">${a.profissionalNome}</span>
                        <span class="data">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div class="area">${a.area}</div>
                    ${a.profissionalFuncao || a.profissionalRegistro ? `<div style="font-size:0.8rem; color:#6b7280;">${a.profissionalFuncao || ''}${a.profissionalRegistro ? ' - Reg: ' + a.profissionalRegistro : ''}</div>` : ''}
                    <div class="conteudo">${a.conteudo}</div>
                </div>
            `;
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

// ============================================================
// EXPORTAR EXCEL
// ============================================================
function exportarExcel() {
    const camposPlanilha = [
        'REFERENCIA', 'NOME', 'NOME DO RESPONSÁVEL', 'REINCIDÊNCIA', 'MEDIDA',
        'MESES', 'HORAS', 'PROTETIVA', 'NASC.', 'MÊS ANIVERSARIO', 'NATURALIDADE',
        'IDADE', 'GÊNERO', 'COR', 'COMPOSIÇÃO FAMILIAR', 'RENDA', 'BENEFICIO',
        'PAA', 'ENDEREÇO', 'BAIRRO', 'TELEFONE', 'CRAS', 'UBS', 'CPF',
        'ESTUDA?', 'SÉRIE', 'ESCOLA', 'TRABALHA?', 'FUNÇÃO', 'VINCULO', 'REDE',
        'USO DE SPA?', 'QUAL?', 'PREFERE NOME SOCIAL?', 'QUAL NOME SOCIAL?'
    ];

    const headerMap = {
        'REFERENCIA': 'REFERENCIA',
        'NOME': 'NOME',
        'NOME DO RESPONSÁVEL': 'NOME DO RESPONSÁVEL',
        'REINCIDÊNCIA': 'REINCIDÊNCIA',
        'MEDIDA': 'MEDIDA',
        'MESES': 'MESES',
        'HORAS': 'HORAS',
        'PROTETIVA': 'PROTETIVA',
        'NASC.': 'NASC.',
        'MÊS ANIVERSARIO': 'MÊS ANIVERSARIO',
        'NATURALIDADE': 'NATURALIDADE',
        'IDADE': 'IDADE',
        'GÊNERO': 'GÊNERO',
        'COR': 'COR',
        'COMPOSIÇÃO FAMILIAR': 'COMPOSIÇÃO FAMILIAR',
        'RENDA': 'RENDA',
        'BENEFICIO': 'BENEFICIO',
        'PAA': 'PAA',
        'ENDEREÇO': 'ENDEREÇO',
        'BAIRRO': 'BAIRRO',
        'TELEFONE': 'TELEFONE',
        'CRAS': 'CRAS',
        'UBS': 'UBS',
        'CPF': 'CPF',
        'ESTUDA?': 'ESTUDA?',
        'SÉRIE': 'SÉRIE',
        'ESCOLA': 'ESCOLA',
        'TRABALHA?': 'TRABALHA?',
        'FUNÇÃO': 'FUNÇÃO',
        'VINCULO': 'VÍNCULO',
        'REDE': 'REDE',
        'USO DE SPA?': 'USO DE SPA?',
        'QUAL?': 'QUAL?',
        'PREFERE NOME SOCIAL?': 'PREFERE NOME SOCIAL?',
        'QUAL NOME SOCIAL?': 'QUAL NOME SOCIAL?'
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
        if (j['ID_DIGITAL']) {
            row['ID_DIGITAL'] = j['ID_DIGITAL'];
        }
        return row;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Jovens');

    const colWidths = [];
    const headers = Object.keys(data[0] || {});
    headers.forEach(h => {
        let maxLen = h.length;
        data.forEach(row => {
            const val = String(row[h] || '');
            if (val.length > maxLen) maxLen = val.length;
        });
        colWidths.push({ wch: Math.min(Math.max(maxLen + 2, 12), 40) });
    });
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, `relatorio_jovens_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ============================================================
// IMPORTAR PLANILHA - OTIMIZADO PARA ARQUIVOS GRANDES
// ============================================================
async function importarPlanilha() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) {
            alert('Nenhum arquivo selecionado.');
            return;
        }
        
        const statusDiv = document.getElementById('statusImportacao');
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#fffbeb';
        statusDiv.style.color = '#92400e';
        statusDiv.textContent = '⏳ Processando planilha... Isso pode levar alguns segundos.';

        try {
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { 
                type: 'array',
                cellStyles: false,
                cellDates: false,
                cellFormula: false,
                sheetRows: 1000
            });
            
            const sheetName = wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            
            if (!ws) {
                throw new Error('Planilha vazia ou formato inválido.');
            }
            
            const rows = XLSX.utils.sheet_to_json(ws, { 
                raw: true,
                defval: '',
                header: 'A'
            });
            
            if (!rows || rows.length === 0) {
                throw new Error('Planilha vazia.');
            }
            
            let startRow = 0;
            let foundHeader = false;
            for (let i = 0; i < Math.min(20, rows.length); i++) {
                const row = rows[i];
                const rowValues = Object.values(row).filter(v => v && v.toString().trim() !== '');
                const hasHeader = rowValues.some(v => {
                    const str = v.toString().toUpperCase().trim();
                    return str === 'NOME' || str === 'REFERENCIA' || str === 'REFERÊNCIA';
                });
                if (hasHeader) {
                    startRow = i;
                    foundHeader = true;
                    break;
                }
            }
            
            if (!foundHeader) {
                throw new Error('Cabeçalho da planilha não encontrado.');
            }
            
            const headers = rows[startRow] || {};
            const dataRows = rows.slice(startRow + 1).filter(row => {
                return Object.values(row).some(val => val && val.toString().trim() !== '');
            });

            if (dataRows.length === 0) {
                throw new Error('Nenhuma linha de dados encontrada.');
            }

            console.log(`Processando ${dataRows.length} linhas...`);

            function findColumnIndex(headerNames) {
                for (const h of Object.keys(headers)) {
                    const hVal = String(headers[h] || '').toUpperCase().trim();
                    for (const name of headerNames) {
                        const nameUpper = name.toUpperCase().trim();
                        if (hVal === nameUpper || hVal.includes(nameUpper) || nameUpper.includes(hVal)) {
                            return h;
                        }
                    }
                }
                return null;
            }

            const colMap = {
                NOME: findColumnIndex(['NOME', 'NOME COMPLETO', 'NOME DO ADOLESCENTE']),
                REFERENCIA: findColumnIndex(['REFERENCIA', 'REF']),
                RESPONSAVEL: findColumnIndex(['NOME DO RESPONSÁVEL', 'RESPONSÁVEL']),
                REINCIDENCIA: findColumnIndex(['REINCIDÊNCIA', 'REINCIDENCIA']),
                MEDIDA: findColumnIndex(['MEDIDA', 'MSE', 'TIPO DE MEDIDA']),
                MESES: findColumnIndex(['MESES']),
                HORAS: findColumnIndex(['HORAS', 'TOTAL HORAS']),
                PROTETIVA: findColumnIndex(['PROTETIVA']),
                NASCIMENTO: findColumnIndex(['NASC.', 'NASCIMENTO', 'DATA NASC']),
                NATURALIDADE: findColumnIndex(['NATURALIDADE']),
                IDADE: findColumnIndex(['IDADE']),
                GENERO: findColumnIndex(['GÊNERO', 'GENERO']),
                COR: findColumnIndex(['COR']),
                CPF: findColumnIndex(['CPF']),
                TELEFONE: findColumnIndex(['TELEFONE', 'TEL']),
                ENDERECO: findColumnIndex(['ENDEREÇO', 'ENDERECO']),
                BAIRRO: findColumnIndex(['BAIRRO']),
                ESCOLA: findColumnIndex(['ESCOLA']),
                SERIE: findColumnIndex(['SÉRIE', 'SERIE']),
                ESTUDA: findColumnIndex(['ESTUDA?', 'ESTUDA']),
                TRABALHA: findColumnIndex(['TRABALHA?', 'TRABALHA']),
                FUNCAO: findColumnIndex(['FUNÇÃO', 'FUNCAO']),
                USO_SPA: findColumnIndex(['USO DE SPA?', 'USO DE SPA']),
                QUAL_SPA: findColumnIndex(['QUAL?', 'QUAL']),
                NOME_SOCIAL: findColumnIndex(['QUAL NOME SOCIAL?', 'NOME SOCIAL', 'NOME SOCIAL?']),
                STATUS: findColumnIndex(['STATUS', 'SITUAÇÃO', 'SITUACAO'])
            };

            if (!colMap.NOME) {
                throw new Error('Coluna "NOME" não encontrada.');
            }

            const campoParaColuna = {
                'REFERENCIA': colMap.REFERENCIA,
                'NOME': colMap.NOME,
                'NOME DO RESPONSÁVEL': colMap.RESPONSAVEL,
                'REINCIDÊNCIA': colMap.REINCIDENCIA,
                'MEDIDA': colMap.MEDIDA,
                'MESES': colMap.MESES,
                'HORAS': colMap.HORAS,
                'PROTETIVA': colMap.PROTETIVA,
                'NASC.': colMap.NASCIMENTO,
                'NATURALIDADE': colMap.NATURALIDADE,
                'IDADE': colMap.IDADE,
                'GÊNERO': colMap.GENERO,
                'COR': colMap.COR,
                'CPF': colMap.CPF,
                'TELEFONE': colMap.TELEFONE,
                'ENDEREÇO': colMap.ENDERECO,
                'BAIRRO': colMap.BAIRRO,
                'ESCOLA': colMap.ESCOLA,
                'SÉRIE': colMap.SERIE,
                'ESTUDA?': colMap.ESTUDA,
                'TRABALHA?': colMap.TRABALHA,
                'FUNÇÃO': colMap.FUNCAO,
                'USO DE SPA?': colMap.USO_SPA,
                'QUAL?': colMap.QUAL_SPA,
                'QUAL NOME SOCIAL?': colMap.NOME_SOCIAL
            };

            let importados = 0;
            let atualizados = 0;
            let erros = 0;
            let ignorados = 0;
            let linhasProcessadas = 0;

            statusDiv.textContent = `⏳ Processando ${dataRows.length} linhas...`;

            const batchSize = 10;
            for (let batchStart = 0; batchStart < dataRows.length; batchStart += batchSize) {
                const batchEnd = Math.min(batchStart + batchSize, dataRows.length);
                const batch = dataRows.slice(batchStart, batchEnd);
                
                for (let rowIndex = 0; rowIndex < batch.length; rowIndex++) {
                    const row = batch[rowIndex];
                    linhasProcessadas++;
                    
                    try {
                        if (linhasProcessadas % 10 === 0) {
                            statusDiv.textContent = `⏳ Processando ${linhasProcessadas}/${dataRows.length} linhas...`;
                            await new Promise(r => setTimeout(r, 10));
                        }
                        
                        let nome = '';
                        if (colMap.NOME && row[colMap.NOME]) {
                            nome = String(row[colMap.NOME]).trim();
                        }
                        
                        if (!nome) {
                            if (row['A']) nome = String(row['A']).trim();
                            if (!nome && row['B']) nome = String(row['B']).trim();
                        }
                        
                        if (!nome) {
                            ignorados++;
                            continue;
                        }
                        
                        const nomeUpper = nome.toUpperCase().trim();
                        const palavrasIgnorar = [
                            'NOVOS ADOLESCENTES', 'REGULAR', 'IRREGULAR', 'EM DESCUMPRIMENTO',
                            'CÓDIGOS FAMILIARES', 'PACTUAÇÃO', 'MEDIDA FINALIZADA', 'LEGENDA',
                            'TOTAL', 'NOME', 'REFERENCIA', 'SITUAÇÃO', 'STATUS',
                            'PEDIR EXT', 'EXT ANDAMENTO', 'ENCERRADO'
                        ];
                        
                        let ignorar = false;
                        for (const palavra of palavrasIgnorar) {
                            if (nomeUpper.includes(palavra)) {
                                ignorar = true;
                                break;
                            }
                        }
                        
                        if (ignorar) {
                            ignorados++;
                            continue;
                        }

                        let statusPlanilha = 'REGULAR';
                        if (colMap.STATUS && row[colMap.STATUS]) {
                            const statusRaw = String(row[colMap.STATUS]).toUpperCase().trim();
                            const statusMap = {
                                'REGULAR': 'REGULAR',
                                'ATIVO': 'REGULAR',
                                'IRREGULAR': 'IRREGULAR',
                                'SUSPENSO': 'SUSPENSO',
                                'EM DESCUMPRIMENTO': 'EM DESCUMPRIMENTO',
                                'DESCUMPRIMENTO': 'EM DESCUMPRIMENTO',
                                'CONCLUÍDO': 'MEDIDA FINALIZADA',
                                'CONCLUIDO': 'MEDIDA FINALIZADA',
                                'FINALIZADA': 'MEDIDA FINALIZADA',
                                'FINALIZADO': 'MEDIDA FINALIZADA',
                                'MEDIDA FINALIZADA': 'MEDIDA FINALIZADA',
                                'LIBERADO': 'LIBERADO',
                                'LIBERAÇÃO': 'LIBERADO'
                            };
                            statusPlanilha = statusMap[statusRaw] || statusRaw;
                        }

                        let jovemExistente = null;
                        
                        let cpfPlanilha = '';
                        if (colMap.CPF && row[colMap.CPF]) {
                            cpfPlanilha = String(row[colMap.CPF]).replace(/\D/g, '');
                        }
                        
                        if (cpfPlanilha && cpfPlanilha.length >= 11) {
                            jovemExistente = estado.jovens.find(j => (j['CPF'] || '').replace(/\D/g, '') === cpfPlanilha);
                        }
                        
                        if (!jovemExistente) {
                            const nomeBusca = nome.toUpperCase().trim();
                            jovemExistente = estado.jovens.find(j => {
                                const jNome = (j['NOME'] || '').toUpperCase().trim();
                                return jNome === nomeBusca || jNome.includes(nomeBusca) || nomeBusca.includes(jNome);
                            });
                        }

                        const dadosJovem = {};
                        
                        for (const [campo, coluna] of Object.entries(campoParaColuna)) {
                            if (coluna && row[coluna] !== undefined && row[coluna] !== '') {
                                let valor = String(row[coluna]).trim();
                                
                                if (campo === 'GÊNERO') {
                                    if (valor.toUpperCase().includes('MASC')) valor = 'M';
                                    else if (valor.toUpperCase().includes('FEM')) valor = 'F';
                                    else if (valor.toUpperCase().includes('NÃO BINÁRIO') || valor.toUpperCase().includes('NB')) valor = 'NB';
                                }
                                if ((campo === 'HORAS' || campo === 'MESES') && valor) {
                                    valor = parseFloat(String(valor).replace(',', '.')) || 0;
                                }
                                if (campo === 'IDADE' && valor) {
                                    valor = parseInt(valor) || 0;
                                }
                                
                                dadosJovem[campo] = valor;
                            }
                        }
                        
                        dadosJovem['NOME'] = nome;

                        if (jovemExistente) {
                            const jovemId = jovemExistente.id;
                            
                            const historicoFrequencia = jovemExistente.historicoFrequencia || [];
                            const observacoes = jovemExistente.observacoes || [];
                            const documentos = jovemExistente.documentos || [];
                            const acoesLA = jovemExistente.acoesLA || [];
                            const profissionalLA = jovemExistente.profissionalLA || '';
                            
                            const jovemAtualizado = { 
                                id: jovemId, 
                                profissionalLA: profissionalLA,
                                historicoFrequencia: historicoFrequencia,
                                observacoes: observacoes,
                                documentos: documentos,
                                acoesLA: acoesLA,
                                avaliacoes: jovemExistente.avaliacoes || []
                            };
                            
                            for (const [key, value] of Object.entries(dadosJovem)) {
                                jovemAtualizado[key] = value;
                            }
                            
                            for (const [key] of CAMPOS) {
                                if (!jovemAtualizado[key] && jovemExistente[key] !== undefined) {
                                    jovemAtualizado[key] = jovemExistente[key];
                                }
                            }
                            
                            jovemAtualizado.status = statusPlanilha;
                            
                            await upstash('SET', `jovem:${jovemId}`, JSON.stringify(jovemAtualizado));
                            
                            const index = estado.jovens.findIndex(j => j.id === jovemId);
                            if (index !== -1) {
                                estado.jovens[index] = jovemAtualizado;
                            }
                            
                            atualizados++;
                            
                        } else {
                            const novoId = 'j_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                            const novoJovem = { 
                                id: novoId, 
                                status: statusPlanilha,
                                historicoFrequencia: [],
                                observacoes: [],
                                documentos: [],
                                acoesLA: [],
                                avaliacoes: []
                            };
                            
                            for (const [key, value] of Object.entries(dadosJovem)) {
                                novoJovem[key] = value;
                            }
                            
                            for (const [key] of CAMPOS) {
                                if (!novoJovem[key]) novoJovem[key] = '';
                            }
                            
                            await upstash('SET', `jovem:${novoId}`, JSON.stringify(novoJovem));
                            await upstash('SADD', 'jovens:all', novoId);
                            estado.jovens.push(novoJovem);
                            importados++;
                        }
                        
                    } catch (rowError) {
                        console.error('Erro ao processar linha:', row, rowError);
                        erros++;
                    }
                }
                
                await new Promise(r => setTimeout(r, 50));
            }

            await carregarTodosDados();
            
            let mensagem = `✅ Importação concluída!`;
            if (importados > 0) mensagem += ` ${importados} novos adicionados.`;
            if (atualizados > 0) mensagem += ` ${atualizados} atualizados.`;
            if (ignorados > 0) mensagem += ` ${ignorados} linhas ignoradas.`;
            if (erros > 0) mensagem += ` ⚠️ ${erros} erros.`;
            mensagem += ` Total de linhas processadas: ${linhasProcessadas}`;
            
            statusDiv.style.background = '#d1fae5';
            statusDiv.style.color = '#065f46';
            statusDiv.textContent = mensagem;
            
            carregarLista();
            renderizarDashboard();
            renderizarAcompanhamento();
            popularSelectAcompInd();
            
            alert(mensagem);
            
        } catch (err) {
            statusDiv.style.background = '#fee2e2';
            statusDiv.style.color = '#991b1b';
            statusDiv.textContent = '❌ Erro: ' + err.message;
            console.error('Erro na importação:', err);
            alert('Erro na importação: ' + err.message + '\n\nTente salvar a planilha como .csv ou remover abas extras.');
        }
    };
    
    input.click();
}

// ============================================================
// AVISO DE OBSERVAÇÕES PARA GESTOR
// ============================================================
function exibirAvisoObservacoes() {}

// ============================================================
// POLLING
// ============================================================
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

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM carregado, inicializando sistema...');
    
    document.getElementById('loginBtn').addEventListener('click', fazerLogin);
    document.getElementById('loginSenha').addEventListener('keypress', e => { if (e.key === 'Enter') fazerLogin(); });
    document.getElementById('logoutBtn').addEventListener('click', deslogarSistema);
    document.getElementById('mostrarCadastroBtn').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('telaLogin').style.display = 'none';
        document.getElementById('telaCadastro').style.display = 'flex';
    });
    document.getElementById('voltarLoginBtn').addEventListener('click', () => {
        document.getElementById('telaCadastro').style.display = 'none';
        document.getElementById('telaLogin').style.display = 'flex';
    });
    document.getElementById('cadastrarBtn').addEventListener('click', cadastrarUsuario);
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

    renderizarCamposFormulario();
    verificarLoginLocal();
    renderizarFiltrosCheckbox();
});

function verificarLoginLocal() {
    const email = localStorage.getItem('usuarioLogado');
    if (email) document.getElementById('loginEmail').value = email;
}

// ============================================================
// CADASTRO DE USUÁRIO (SOLICITAÇÃO)
// ============================================================
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
        ['cadastroNome', 'cadastroEmail', 'cadastroSenha', 'cadastroSenhaConfirm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    } catch (err) {
        document.getElementById('cadastroErro').textContent = 'Erro: ' + err.message;
    }
}

// ============================================================
// FUNÇÕES DE COMPATIBILIDADE
// ============================================================
function salvarNovaSenhaAlt() {
    const s1 = document.getElementById('novaSenhaInputAlt').value;
    const s2 = document.getElementById('confirmarNovaSenhaInputAlt').value;
    if (!s1 || s1.length < 6) return alert('Senha deve ter no mínimo 6 caracteres.');
    if (s1 !== s2) return alert('As senhas não coincidem.');
    salvarNovaSenha();
}

function salvarLogoAlt() {
    const fileInput = document.getElementById('novaLogoInputAlt');
    if (fileInput && fileInput.files[0]) {
        salvarLogo();
    }
}

function injetarHTMLDinamico() {}

console.log('Sistema Socioeducativo v2.0 carregado com sucesso!');
