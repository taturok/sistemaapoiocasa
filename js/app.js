// ============================================================
// NÚCLEO SOCIOEDUCATIVO - SISTEMA DE GESTÃO v3.0
// BACKEND: UPSTASH REDIS REST API
// ============================================================

// ============================================================
// CONFIGURAÇÃO UPSTASH
// ============================================================
const UPSTASH_URL = 'https://enhanced-lobster-167489.upstash.io';
const UPSTASH_TOKEN = 'gQAAAAAAAo5BAAIgcDI0NjUxNzdjMzdiYzg0YTBlOTFkZWZjY2Y0MGI5YjQ1YQ';

// ============================================================
// NÍVEIS DE ACESSO
// ============================================================
const NIVEIS_ACESSO = {
    desenvolvedor: { nome: 'Desenvolvedor' },
    gestor: { nome: 'Gestor' },
    tecnico: { nome: 'Técnico' },
    educador_social: { nome: 'Educador Social' },
    jovem: { nome: 'Jovem' },
    autoridade: { nome: 'Autoridade Jurídica' },
    admin: { nome: 'Desenvolvedor' }
};

const NIVEIS_COM_STATUS = ['desenvolvedor', 'admin', 'gestor', 'tecnico'];

// ============================================================
// CAMPOS DO FORMULÁRIO (baseado na planilha GERAL)
// ============================================================
const CAMPOS = [
    ['REFERENCIA','REFERÊNCIA','text'],
    ['NOME','NOME','text'],
    ['NOME DO RESPONSÁVEL','RESPONSÁVEL','text'],
    ['REINCIDÊNCIA','REINCIDÊNCIA','text'],
    ['MEDIDA','MEDIDA','select', [['','Selecione...'],['LA','LA - Liberdade Assistida'],['PSC','PSC - Prestação de Serviço'],['Internação','Internação'],['Liberação','Liberação']]],
    ['MESES','MESES','text'],
    ['HORAS','HORAS','number'],
    ['PROTETIVA','PROTETIVA','text'],
    ['NASC.','NASCIMENTO','date'],
    ['MÊS ANIVERSARIO','MÊS ANIVER.','text'],
    ['NATURALIDADE','NATURALIDADE','text'],
    ['IDADE','IDADE','number'],
    ['GÊNERO','GÊNERO','select',[['','Selecione...'],['M','Masculino'],['F','Feminino'],['NB','Não-binário']]],
    ['COR','COR','select',[['','Selecione...'],['Branca','Branca'],['Preta','Preta'],['Parda','Parda'],['Amarela','Amarela'],['Indígena','Indígena']]],
    ['COMPOSIÇÃO FAMILIAR','COMPOSIÇÃO FAMILIAR','text'],
    ['RENDA','RENDA','text'],
    ['BENEFICIO','BENEFÍCIO','text'],
    ['PAA','PAA','text'],
    ['ENDEREÇO','ENDEREÇO','text'],
    ['BAIRRO','BAIRRO','text'],
    ['TELEFONE','TELEFONE','text'],
    ['CRAS','CRAS','text'],
    ['UBS','UBS','text'],
    ['CPF','CPF','text'],
    ['ESTUDA?','ESTUDA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
    ['SÉRIE','SÉRIE','text'],
    ['ESCOLA','ESCOLA','text'],
    ['TRABALHA?','TRABALHA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
    ['FUNÇÃO','FUNÇÃO','text'],
    ['VINCULO','VÍNCULO','text'],
    ['REDE','REDE','text'],
    ['USO DE SPA?','USO DE SPA?','select',[['',''],['Sim','Sim'],['Não','Não']]],
    ['QUAL?','QUAL?','text']
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
    online: false,
    usuarioAtual: null,
    graficos: {},
    exclusaoPendente: null,
    acoesLATemporarias: [],
    selecionadosLote: new Set(),
    _editarId: null,
    _jovemDocAtual: null,
    _userParaVincular: null
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

function parseNum(val) {
    if (!val) return 0;
    const n = parseFloat(String(val).replace(',', '.'));
    return isNaN(n) ? 0 : n;
}

function calcularSaldo(jovem) {
    if (!jovem || jovem['MEDIDA'] === 'LA') return 0;
    const horasTotal = parseNum(jovem['HORAS']);
    const horasFeitas = (jovem.historicoFrequencia || []).reduce((s, h) => s + parseNum(h.horas), 0);
    return Math.max(0, horasTotal - horasFeitas);
}

// ============================================================
// NAVEGAÇÃO
// ============================================================
function navigateTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');

    const titles = {
        'pageDashboard': 'Dashboard',
        'pageCadastro': 'Cadastrar / Editar Jovem',
        'pageLista': 'Lista Geral',
        'pageAcomp': 'Acompanhamento Individual',
        'pageOficinas': 'Oficinas Realizadas',
        'pagePlanejamento': 'Planejamento de Oficinas',
        'pageLA': 'Ações LA',
        'pageRelatorios': 'Relatórios',
        'pageUsuarios': 'Gerenciar Usuários',
        'pagePendentes': 'Solicitações Pendentes',
        'pageConfig': 'Configurações',
        'pageJovemDashboard': 'Minhas Ações'
    };
    const icons = {
        'pageDashboard': 'chart-pie',
        'pageCadastro': 'user-plus',
        'pageLista': 'list-ul',
        'pageAcomp': 'user-circle',
        'pageOficinas': 'tools',
        'pagePlanejamento': 'calendar-plus',
        'pageLA': 'handshake',
        'pageRelatorios': 'file-alt',
        'pageUsuarios': 'users-cog',
        'pagePendentes': 'user-clock',
        'pageConfig': 'cog',
        'pageJovemDashboard': 'user'
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl && titles[pageId]) {
        titleEl.innerHTML = `<i class="fas fa-${icons[pageId] || 'circle'}"></i> ${titles[pageId]}`;
    }
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`.menu-item[data-page="${pageId}"]`);
    if (activeItem) activeItem.classList.add('active');

    // Carregar dados específicos da página
    if (pageId === 'pageLista') carregarLista();
    if (pageId === 'pageAcomp') popularSelectAcompInd();
    if (pageId === 'pageOficinas') { renderizarJovensOficina(); renderizarOficinas(); }
    if (pageId === 'pagePlanejamento') renderizarPlanejamentos();
    if (pageId === 'pageLA') renderizarAcoesLA();
    if (pageId === 'pageRelatorios') renderizarRelatorios();
    if (pageId === 'pageUsuarios') renderizarUsuarios();
    if (pageId === 'pagePendentes') renderizarPendentes();
    if (pageId === 'pageJovemDashboard') renderizarDashboardJovem();

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
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';
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

        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appWrapper').classList.add('active');

        // Atualizar header
        const avatar = document.getElementById('userAvatar');
        if (avatar) avatar.textContent = (user.nome || 'U')[0].toUpperCase();
        document.getElementById('nomeUsuarioHeader').textContent = user.nome || user.email;
        document.getElementById('nivelUsuarioHeader').textContent = NIVEIS_ACESSO[user.nivel]?.nome || user.nivel;

        mostrarAbasPorNivel(user.nivel);
        carregarLogo();
        await carregarTodosDados();
        iniciarPolling();

    } catch (err) {
        document.getElementById('loginErro').textContent = 'Erro: ' + err.message;
        console.error('Erro no login:', err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Entrar';
    }
}

function deslogarSistema() {
    estado.usuarioAtual = null;
    localStorage.removeItem('usuarioLogado');
    localStorage.removeItem('nivelUsuario');

    document.getElementById('appWrapper').classList.remove('active');
    document.getElementById('loginScreen').classList.remove('hidden');
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

        atualizarInterfaceCompleta();
    } catch (err) {
        console.error('Erro ao carregar dados:', err);
    }
}

function atualizarInterfaceCompleta() {
    renderizarCamposFormulario();
    renderizarDashboard();
    carregarLista();
    renderizarProfissionais();
    renderizarOficinas();
    renderizarUsuarios();
    renderizarPendentes();
    renderizarRelatorios();
    popularSelectAcompInd();
    renderizarPlanejamentos();
    renderizarAcoesLA();
}

// ============================================================
// ABAS POR NÍVEL
// ============================================================
function mostrarAbasPorNivel(nivel) {
    let nivelNormalizado = (nivel || '').toLowerCase().trim();
    if (['admin', 'administrador', 'desenvolvedor'].includes(nivelNormalizado)) nivelNormalizado = 'desenvolvedor';
    if (['oficineiro', 'educador'].includes(nivelNormalizado)) nivelNormalizado = 'educador_social';

    const permissoes = {
        'desenvolvedor': ['pageDashboard', 'pageCadastro', 'pageLista', 'pageAcomp', 'pageOficinas', 'pagePlanejamento', 'pageLA', 'pageRelatorios', 'pageUsuarios', 'pagePendentes', 'pageConfig'],
        'gestor': ['pageDashboard', 'pageCadastro', 'pageLista', 'pageAcomp', 'pageOficinas', 'pagePlanejamento', 'pageLA', 'pageRelatorios', 'pageUsuarios', 'pagePendentes', 'pageConfig'],
        'tecnico': ['pageDashboard', 'pageCadastro', 'pageLista', 'pageAcomp', 'pageOficinas', 'pagePlanejamento', 'pageLA', 'pageRelatorios'],
        'educador_social': ['pageDashboard', 'pageOficinas', 'pagePlanejamento', 'pageRelatorios'],
        'autoridade': ['pageDashboard', 'pageLista', 'pageAcomp', 'pageRelatorios'],
        'jovem': ['pageJovemDashboard']
    };
    const paginasPermitidas = permissoes[nivelNormalizado] || ['pageDashboard'];

    document.querySelectorAll('.menu-item[data-page]').forEach(item => {
        const page = item.dataset.page;
        item.style.display = paginasPermitidas.includes(page) ? '' : 'none';
    });

    const first = paginasPermitidas[0];
    if (first && !document.querySelector(`.menu-item[data-page="${first}"]`)) {
        document.querySelector('.menu-item[data-page]')?.click();
    }
}

// ============================================================
// DASHBOARD
// ============================================================
function renderizarDashboard() {
    const total = estado.jovens.length;

    const regular = estado.jovens.filter(j => j.status === 'REGULAR').length;
    const irregular = estado.jovens.filter(j => j.status === 'IRREGULAR').length;
    const descumprimento = estado.jovens.filter(j => j.status === 'EM DESCUMPRIMENTO').length;
    const suspenso = estado.jovens.filter(j => j.status === 'SUSPENSO').length;
    const finalizada = estado.jovens.filter(j => j.status === 'MEDIDA FINALIZADA').length;
    const liberado = estado.jovens.filter(j => j.status === 'LIBERADO' || j['MEDIDA'] === 'Liberação').length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statRegular').textContent = regular;
    document.getElementById('statIrregular').textContent = irregular;
    document.getElementById('statDescumprimento').textContent = descumprimento;
    document.getElementById('statSuspenso').textContent = suspenso;
    document.getElementById('statFinalizada').textContent = finalizada;
    document.getElementById('statLiberado').textContent = liberado;

    renderizarGraficos();
}

function renderizarGraficos() {
    try {
        Object.values(estado.graficos).forEach(c => {
            if (c && c.destroy) c.destroy();
        });
        estado.graficos = {};

        // Medidas
        const medidas = {};
        estado.jovens.forEach(j => {
            const m = j['MEDIDA'] || 'Não informada';
            medidas[m] = (medidas[m] || 0) + 1;
        });
        const ctx1 = document.getElementById('graficoMedidas')?.getContext('2d');
        if (ctx1 && Object.keys(medidas).length > 0) {
            estado.graficos.medidas = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: Object.keys(medidas),
                    datasets: [{ label: 'Jovens', data: Object.values(medidas), backgroundColor: '#1A3A6B' }]
                },
                options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
            });
        }

        // Gênero
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
                    datasets: [{ data: [generos.M, generos.F, generos.NB], backgroundColor: ['#1A3A6B', '#E87A2A', '#8B5CF6'] }]
                },
                options: { responsive: true, maintainAspectRatio: true }
            });
        }

        // Idade
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
                    datasets: [{ label: 'Jovens', data: [idades['12-15'], idades['16-18'], idades['19+']], backgroundColor: '#8B5CF6' }]
                },
                options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
            });
        }

        // Reverte
        const reverte = estado.oficinas.filter(o => o.reverte).length;
        const naoReverte = estado.oficinas.length - reverte;
        const ctx5 = document.getElementById('graficoReverte')?.getContext('2d');
        if (ctx5 && (reverte > 0 || naoReverte > 0)) {
            estado.graficos.reverte = new Chart(ctx5, {
                type: 'pie',
                data: {
                    labels: ['Reverte benefício', 'Não reverte'],
                    datasets: [{ data: [reverte, naoReverte], backgroundColor: ['#0F9D58', '#CBD5E1'] }]
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
    if (!grid) return;

    grid.innerHTML = CAMPOS.map(([key, label, type, options]) => {
        if (type === 'select' && options) {
            return `<div class="form-group"><label>${label}</label><select id="campo_${key}" onchange="if(this.id==='campo_MEDIDA') toggleAcoesLA()">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;
        }
        return `<div class="form-group"><label>${label}</label><input type="${type}" id="campo_${key}"></div>`;
    }).join('');

    const containerAcoes = document.getElementById('containerAcoesLA');
    if (containerAcoes) containerAcoes.style.display = 'none';
}

window.toggleAcoesLA = function() {
    const medida = document.getElementById('campo_MEDIDA')?.value;
    const container = document.getElementById('containerAcoesLA');
    if (container) {
        container.style.display = medida === 'LA' ? 'block' : 'none';
    }
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
    input.value = '';
    prazoInput.value = '';
    atualizarListaAcoesLAForm();
};

window.atualizarListaAcoesLAForm = function() {
    const ul = document.getElementById('listaAcoesLAForm');
    if (!ul) return;
    ul.innerHTML = estado.acoesLATemporarias.map(a => `<li style="margin-bottom:5px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--gray-200); padding:4px 0;">
        <span>${a.texto} <span style="font-size:0.7rem; color:var(--gray-500);">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span></span>
        <span style="color:var(--danger); cursor:pointer; font-weight:bold; margin-left:10px;" onclick="removerAcaoLAForm(${a.id})">✕</span>
    </li>`).join('');
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

    if (jovem['MEDIDA'] === 'LA') {
        jovem.acoesLA = [...estado.acoesLATemporarias];
    }

    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        if (!estado._editarId && !jovemExistente) await upstash('SADD', 'jovens:all', jovem.id);
        estado.jovens = estado.jovens.filter(j => j.id !== jovem.id);
        estado.jovens.push(jovem);

        await carregarTodosDados();
        limparFormulario();
        alert('✅ Jovem salvo com sucesso!');
    } catch (err) {
        alert('Erro ao salvar: ' + err.message);
    }
}

function limparFormulario() {
    CAMPOS.forEach(([key]) => {
        const el = document.getElementById(`campo_${key}`);
        if (el) el.value = '';
    });
    document.getElementById('campo_ID_DIGITAL').value = '';
    estado.acoesLATemporarias = [];
    atualizarListaAcoesLAForm();
    toggleAcoesLA();
    estado._editarId = null;
}

// ============================================================
// LISTA GERAL
// ============================================================
function carregarLista() {
    const tbody = document.getElementById('listaCorpo');
    if (!tbody) return;

    if (estado.jovens.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--gray-500);">Nenhum jovem cadastrado. Importe uma planilha ou cadastre um novo jovem.</td></tr>`;
        return;
    }

    const fNome = (document.getElementById('filtroNome')?.value || '').toLowerCase();
    const fMedida = document.getElementById('filtroMedida')?.value;
    const fStatus = document.getElementById('filtroStatus')?.value;
    const fGenero = document.getElementById('filtroGenero')?.value;

    let lista = estado.jovens.filter(j => {
        if (fNome && !(j['NOME'] || '').toLowerCase().includes(fNome) && !(j['ID_DIGITAL'] || '').includes(fNome)) return false;
        if (fMedida && j['MEDIDA'] !== fMedida) return false;
        if (fStatus && j.status !== fStatus) return false;
        if (fGenero && j['GÊNERO'] !== fGenero) return false;
        return true;
    }).sort((a, b) => (a['NOME'] || '').localeCompare((b['NOME'] || ''), 'pt-BR'));

    const podeAlterarStatus = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel);
    const podeEditar = ['gestor', 'tecnico', 'desenvolvedor'].includes(estado.usuarioAtual?.nivel);

    tbody.innerHTML = lista.map(j => {
        const hist = j.historicoFrequencia || [];
        const ultimo = hist.length > 0 ? new Date(Math.max(...hist.map(h => new Date(h.data)))).toLocaleDateString('pt-BR') : 'Nunca';

        let badgeClass = 'badge-regular';
        if (j.status === 'SUSPENSO') badgeClass = 'badge-suspenso';
        else if (j.status === 'EM DESCUMPRIMENTO') badgeClass = 'badge-descumprimento';
        else if (j.status === 'IRREGULAR') badgeClass = 'badge-irregular';
        else if (j.status === 'MEDIDA FINALIZADA') badgeClass = 'badge-finalizada';
        else if (j.status === 'LIBERADO') badgeClass = 'badge-liberado';

        const renderSaldo = j['MEDIDA'] === 'LA' ? `Ações: ${j.acoesLA?.filter(a=>a.realizado).length || 0}/${j.acoesLA?.length || 0}` : `${calcularSaldo(j).toFixed(1)}h`;

        const podeRegistrarPonto = j['MEDIDA'] !== 'Liberação' && j.status !== 'SUSPENSO' && j.status !== 'MEDIDA FINALIZADA';
        const hoje = new Date();
        const hojeStr = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
        let temEntradaAberta = false;
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
            botoesStatus = `<button onclick="abrirModalAlterarStatus('${j.id}')" class="btn btn-sm btn-outline" style="padding:4px 10px; font-size:11px;">📌 Status</button>`;
        }

        const isSelecionado = estado.selecionadosLote.has(j.id);

        return `<tr>
            <td><input type="checkbox" data-id="${j.id}" ${isSelecionado ? 'checked' : ''} onchange="toggleSelecionarJovem('${j.id}')"></td>
            <td><strong>${j['NOME'] || j['REFERENCIA'] || '-'}</strong></td>
            <td>${j['ID_DIGITAL'] || '-'}</td>
            <td>${j['IDADE'] || '-'}</td>
            <td>${j['MEDIDA'] || '-'}</td>
            <td>${renderSaldo}</td>
            <td><span class="badge ${badgeClass}">${j.status || 'REGULAR'}</span></td>
            <td>${ultimo}</td>
            <td style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                ${podeRegistrarPonto ? `<button onclick="registrarPontoNaLinha('${j.id}')" class="btn btn-sm ${temEntradaAberta ? 'btn-warning' : 'btn-success'}" style="padding:4px 10px; font-size:11px;">${temEntradaAberta ? '🚪 Saída' : '🚪 Entrada'}</button>` : ''}
                ${podeEditar ? `<button onclick="editarJovem('${j.id}')" class="btn btn-sm btn-primary" style="padding:4px 10px; font-size:11px;"><i class="fas fa-edit"></i></button>` : ''}
                <button onclick="abrirFichaModal('${j.id}')" class="btn btn-sm btn-outline" style="padding:4px 10px; font-size:11px;"><i class="fas fa-file-alt"></i></button>
                ${botoesStatus}
                ${podeEditar ? `<button onclick="abrirModalExclusao('jovem','${j.id}','${j['NOME']}')" class="btn btn-sm btn-danger" style="padding:4px 10px; font-size:11px;"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        </tr>`;
    }).join('');

    atualizarContadorLista(lista.length);
}

function atualizarContadorLista(total) {
    let container = document.getElementById('contadorContainer');
    if (!container) {
        const wrapper = document.querySelector('#pageLista .table-wrapper');
        if (wrapper) {
            container = document.createElement('div');
            container.id = 'contadorContainer';
            wrapper.appendChild(container);
        }
    }
    if (container) {
        container.innerHTML = `
            <div style="padding:12px 16px; font-weight:600; color:var(--gray-700); background:var(--gray-50); border-top:1px solid var(--gray-200); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border-radius:0 0 var(--radius-md) var(--radius-md);">
                <span>👥 Total: <strong style="color:var(--primary);">${total}</strong> jovens</span>
                <span style="font-size:13px; color:var(--gray-500);">${total === 1 ? '1 jovem exibido' : `${total} jovens exibidos`}</span>
            </div>
        `;
    }
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
}

function toggleSelecionarJovem(id) {
    const cb = document.querySelector(`#listaCorpo input[data-id="${id}"]`);
    if (!cb) return;
    if (cb.checked) {
        estado.selecionadosLote.add(id);
    } else {
        estado.selecionadosLote.delete(id);
    }
}

function desmarcarTodos() {
    estado.selecionadosLote.clear();
    document.querySelectorAll('#listaCorpo input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('selecionarTodos').checked = false;
}

// ============================================================
// PONTO DIGITAL E NA LINHA
// ============================================================
window.registrarPontoNaLinha = async function(jovemId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;

    if (jovem['MEDIDA'] === 'Liberação') return alert('❌ Jovem está liberado.');
    if (jovem.status === 'SUSPENSO') return alert('❌ Jovem está suspenso.');
    if (jovem.status === 'MEDIDA FINALIZADA') return alert('❌ Jovem já finalizou a medida.');

    // Reativar se estiver irregular ou em descumprimento
    if (jovem.status === 'IRREGULAR' || jovem.status === 'EM DESCUMPRIMENTO') {
        if (!confirm(`Este jovem está ${jovem.status}. Deseja reativá-lo para REGULAR ao registrar presença?`)) return;
        jovem.status = 'REGULAR';
        if (jovem.status === 'EM DESCUMPRIMENTO') jovem.dataDescumprimento = '';
        if (!jovem.observacoes) jovem.observacoes = [];
        jovem.observacoes.push({
            data: new Date().toISOString(),
            profissional: estado.usuarioAtual?.nome || 'Sistema',
            texto: `✅ Jovem reativado para REGULAR ao registrar presença.`
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
            alert(`✅ Saída registrada para ${jovem['NOME']} (${horasArredondadas.toFixed(2)}h)`);
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
    const jovensDisponiveis = estado.jovens.filter(j =>
        j['MEDIDA'] !== 'Liberação' &&
        j.status !== 'SUSPENSO' &&
        j.status !== 'MEDIDA FINALIZADA'
    );
    select.innerHTML = jovensDisponiveis.length > 0 ?
        jovensDisponiveis.map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''}</option>`).join('') :
        '<option value="">Nenhum jovem disponível</option>';

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

    if (jovem.status === 'IRREGULAR' || jovem.status === 'EM DESCUMPRIMENTO') {
        if (!confirm(`Este jovem está ${jovem.status}. Deseja reativá-lo para REGULAR?`)) return;
        jovem.status = 'REGULAR';
        if (jovem.status === 'EM DESCUMPRIMENTO') jovem.dataDescumprimento = '';
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
    div.innerHTML = jovens.map(j => `<label class="jovem-check"><input type="checkbox" value="${j.id}"><span>${j['NOME'] || j['REFERENCIA']}</span></label>`).join('');
}

window.filtrarJovensOficina = function() {
    const busca = document.getElementById('buscaJovensOficina').value.toLowerCase();
    const labels = document.querySelectorAll('#listaJovensOficina .jovem-check');
    labels.forEach(label => {
        const nome = label.querySelector('span').textContent.toLowerCase();
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
    const div = document.getElementById('listaOficinas');
    if (!div) return;
    div.innerHTML = estado.oficinas.slice().reverse().map(o => {
        const dataFmt = new Date(o.data).toLocaleDateString('pt-BR');
        const jovensNomes = (o.jovensIds || []).map(id => {
            const j = estado.jovens.find(x => x.id === id);
            return j ? (j['NOME'] || j['REFERENCIA']) : 'Desconhecido';
        });
        return `<div class="office-card ${o.reverte ? 'reverte' : ''}">
            <div class="office-info">
                <div class="office-title">📅 ${dataFmt} - ${o.periodo}</div>
                <div class="office-meta">${o.conteudo} • 👥 ${jovensNomes.length} jovens</div>
                <div class="office-tags">
                    ${o.reverte ? '<span class="tag tag-success">✅ Benefício social</span>' : ''}
                    ${o.isCurso ? '<span class="tag tag-info">📚 Curso Obrigatório</span>' : ''}
                    ${jovensNomes.map(n => `<span class="tag">${n}</span>`).join('')}
                </div>
            </div>
            <div>
                <button onclick="abrirModalExclusao('oficina','${o.id}','${o.conteudo}')" class="btn btn-sm btn-danger"><i class="fas fa-trash"></i></button>
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

    const podeConverter = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) || estado.usuarioAtual?.nivel === 'educador_social';

    listaHTML.innerHTML = estado.planejamentos.filter(p => !p.realizada).map(p => `
        <div style="background:white; border:1px solid var(--gray-200); border-left:4px solid ${p.reverte ? 'var(--success)' : 'var(--info)'}; padding:16px 20px; border-radius:var(--radius-sm);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
                <div style="flex:1;">
                    <h4 style="color:var(--gray-800); margin-bottom:4px;">${p.titulo}</h4>
                    <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:13px; color:var(--gray-500); margin-bottom:6px;">
                        <span>📅 ${new Date(p.data).toLocaleDateString('pt-BR')}</span>
                        <span>🕐 ${p.periodo}</span>
                        ${p.reverte ? '<span style="color:var(--success);">✅ Reverte benefício</span>' : ''}
                    </div>
                    ${p.descricao ? `<p style="color:var(--gray-600); font-size:14px; margin-bottom:4px;">${p.descricao}</p>` : ''}
                    ${p.materiais ? `<p style="font-size:12px; color:var(--gray-500);"><strong>Materiais:</strong> ${p.materiais}</p>` : ''}
                </div>
                <div style="display:flex; gap:8px;">
                    ${podeConverter ? `<button class="btn btn-sm btn-success" onclick="converterPlanejamentoEmOficina('${p.id}')">🔄 Converter</button>` : ''}
                    <button class="btn btn-sm btn-danger" onclick="abrirModalExclusao('planejamento','${p.id}','${p.titulo}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>
    `).join('') || '<p style="color:var(--gray-500); text-align:center; padding:20px;">Nenhum planejamento salvo.</p>';
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
        estado.jovens.forEach(j => {
            if (j['MEDIDA'] === 'LA') {
                (j.acoesLA || []).forEach(a => {
                    acoes.push({ ...a, jovemNome: j['NOME'] || 'Sem nome', jovemId: j.id });
                });
            }
        });
    }
    lista.innerHTML = acoes.map(a => `
        <div class="la-action-card ${a.realizado ? 'done' : ''}">
            <div class="action-info">
                <span class="action-text">${a.texto}</span>
                <span class="action-meta">${a.jovemNome ? `Jovem: ${a.jovemNome} • ` : ''}Vence: ${a.prazo ? new Date(a.prazo).toLocaleDateString('pt-BR') : 'Sem prazo'}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <span class="action-badge">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span>
                <button class="btn btn-sm ${a.realizado ? 'btn-outline' : 'btn-success'}" onclick="toggleAcaoLaGeral('${a.jovemId || jovemId}', ${a.id})">
                    ${a.realizado ? 'Desmarcar' : 'Marcar Feito'}
                </button>
                <button class="btn btn-sm btn-danger" onclick="removerAcaoLaGeral('${a.jovemId || jovemId}', ${a.id})"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('') || '<p style="color:var(--gray-500); text-align:center; padding:20px;">Nenhuma ação cadastrada.</p>';
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
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

// ============================================================
// RELATÓRIOS
// ============================================================
function renderizarRelatorios() {
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

    const tbody2 = document.querySelector('#tabelaAniversariantes tbody');
    if (tbody2) {
        const agora = new Date();
        const anoAtual = agora.getFullYear();
        const mesAtual = agora.getMonth();
        const aniversariantes = estado.jovens.filter(j => j['MEDIDA'] !== 'Liberação' && j.status !== 'MEDIDA FINALIZADA').map(j => {
            const nascStr = j['NASC.'];
            if (!nascStr) return null;
            const nasc = new Date(nascStr);
            if (isNaN(nasc.getTime())) return null;
            const mesNasc = nasc.getMonth();
            const diaNasc = nasc.getDate();
            let mesTarget = mesNasc;
            let anoTarget = anoAtual;
            if (mesNasc < mesAtual || (mesNasc === mesAtual && diaNasc < agora.getDate())) anoTarget = anoAtual + 1;
            const diffMeses = (anoTarget - anoAtual) * 12 + (mesTarget - mesAtual);
            if (diffMeses < 0 || diffMeses >= 3) return null;
            return {
                nome: j['NOME'] || j['REFERENCIA'],
                nasc,
                diaNasc,
                anoTarget,
                mesTarget,
                idadeQueFara: anoTarget - nasc.getFullYear(),
                dataEvento: new Date(anoTarget, mesTarget, diaNasc)
            };
        }).filter(Boolean).sort((a, b) => a.dataEvento - b.dataEvento);
        tbody2.innerHTML = aniversariantes.length > 0 ? aniversariantes.map(a =>
            `<tr><td>${a.nome}</td><td>${a.nasc.toLocaleDateString('pt-BR')}</td><td>${String(a.diaNasc).padStart(2, '0')}/${String(a.mesTarget + 1).padStart(2, '0')}/${a.anoTarget}</td><td>${a.idadeQueFara} anos</td></tr>`
        ).join('') : '<tr><td colspan="4" style="text-align:center; color:var(--gray-500);">Nenhum aniversariante nos próximos 3 meses.</td></tr>';
    }
}

window.abrirRelatorioRevertencia = function() {
    const ofs = estado.oficinas.filter(o => o.reverte);
    let html = `<html><head><title>Relatório de Revertência</title><style>
        body{font-family:Inter,sans-serif; padding:30px; background:#f0f4f8;}
        .container{max-width:900px; margin:0 auto; background:white; border-radius:12px; padding:30px; box-shadow:0 4px 20px rgba(0,0,0,0.08);}
        h1{color:#1A3A6B; border-bottom:3px solid #0F9D58; padding-bottom:10px;}
        table{width:100%; border-collapse:collapse; margin-top:15px;}
        th{background:#f1f5f9; color:#1e293b; font-weight:600; padding:10px 12px; text-align:left; border-bottom:2px solid #e2e8f0;}
        td{padding:8px 12px; border-bottom:1px solid #f1f5f9;}
        .badge{display:inline-block; padding:2px 10px; border-radius:12px; font-size:11px; font-weight:600; background:#0F9D58; color:white;}
        .total{background:#ecfdf5; padding:15px; border-radius:8px; margin-top:20px; border:1px solid #0F9D58;}
    </style></head><body>
    <div class="container">
        <h1>🌱 Relatório de Oficinas Revertidas</h1>
        <p style="color:#6b7280; margin:10px 0;">Oficinas que geraram benefício direto à sociedade.</p>
        <p style="color:#6b7280; font-size:0.9rem;">Total: <strong>${ofs.length}</strong> oficinas revertidas</p>`;
    if (ofs.length > 0) {
        html += `<table><thead><tr><th>Data</th><th>Período</th><th>Conteúdo</th><th>Participantes</th></tr></thead><tbody>`;
        ofs.forEach(o => {
            const jovens = o.jovensIds.map(id => estado.jovens.find(j => j.id === id)?.['NOME']).filter(Boolean).join(', ');
            html += `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.periodo || '-'}</td><td>${o.conteudo}</td><td>${jovens || 'Nenhum'}</td></tr>`;
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
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
};

// ============================================================
// ACOMPANHAMENTO INDIVIDUAL
// ============================================================
function popularSelectAcompInd() {
    const select = document.getElementById('selectJovemAcomp');
    if (!select) return;
    select.innerHTML = '<option value="">Selecione um jovem...</option>' +
        estado.jovens.sort((a, b) => (a['NOME'] || '').localeCompare(b['NOME'] || '', 'pt-BR'))
        .map(j => `<option value="${j.id}">${j['NOME'] || j['REFERENCIA']} - ${j['MEDIDA'] || ''}</option>`).join('');
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

    // Dados Pessoais
    const dadosDiv = document.getElementById('fichaDadosPessoais');
    if (dadosDiv) {
        dadosDiv.innerHTML = CAMPOS.map(([key, label]) => `
            <div style="padding:4px 0; border-bottom:1px solid var(--gray-200);">
                <strong style="font-size:11px; color:var(--gray-500); text-transform:uppercase; display:block;">${label}</strong>
                <span style="font-size:14px;">${jovem[key] || '-'}</span>
            </div>
        `).join('') + `
            <div style="padding:4px 0; border-bottom:1px solid var(--gray-200);">
                <strong style="font-size:11px; color:var(--gray-500); text-transform:uppercase; display:block;">ID Digital</strong>
                <span style="font-size:14px;">${jovem['ID_DIGITAL'] || '-'}</span>
            </div>
            <div style="padding:4px 0; border-bottom:1px solid var(--gray-200); grid-column:1/-1; background:${jovem.status === 'EM DESCUMPRIMENTO' ? 'var(--danger-light)' : jovem.status === 'IRREGULAR' ? 'var(--warning-light)' : 'transparent'}; padding:8px; border-radius:4px;">
                <strong style="font-size:11px; color:var(--gray-500); text-transform:uppercase; display:block;">Status</strong>
                <span style="font-size:14px; font-weight:600;">${jovem.status || 'REGULAR'}</span>
                ${jovem.motivoSuspensao ? `<span style="font-size:13px; color:var(--danger); display:block; margin-top:4px;">Motivo: ${jovem.motivoSuspensao}</span>` : ''}
            </div>
        `;
    }

    // Ações LA (se for LA)
    const freqDiv = document.getElementById('fichaFrequencia');
    if (freqDiv) {
        const hist = jovem.historicoFrequencia || [];
        const totalHoras = hist.reduce((s, h) => s + parseNum(h.hours || h.horas || 0), 0);
        const saldo = jovem['MEDIDA'] === 'LA' ? 'N/A' : calcularSaldo(jovem).toFixed(1) + 'h';

        let acoesLAHTML = '';
        if (jovem['MEDIDA'] === 'LA') {
            const acoes = jovem.acoesLA || [];
            const profs = estado.usuarios.filter(u => u.nivel === 'tecnico' || u.nivel === 'gestor');
            const profAtual = estado.usuarios.find(u => u.id === jovem.profissionalLA);
            const podeMarcar = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel);

            acoesLAHTML = `
                <div style="margin-top:16px; padding-top:16px; border-top:2px solid var(--gray-200);">
                    <h4 style="font-weight:600; color:var(--gray-700); margin-bottom:8px;">⚖️ Acompanhamento LA</h4>
                    <div style="margin-bottom:12px;">
                        <label style="font-weight:500; font-size:13px;">Profissional Responsável:</label>
                        <select onchange="vincularProfissionalLA('${jovem.id}', this.value)" style="padding:6px 12px; border:1px solid var(--gray-200); border-radius:var(--radius-sm); margin-left:8px;">
                            <option value="">Não atribuído</option>
                            ${profs.map(p => `<option value="${p.id}" ${jovem.profissionalLA === p.id ? 'selected' : ''}>${p.nome}</option>`).join('')}
                        </select>
                        ${profAtual ? `<span style="margin-left:12px; color:var(--success);">✅ ${profAtual.nome}</span>` : ''}
                    </div>
                    ${acoes.map(a => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:${a.realizado ? 'var(--success-light)' : 'var(--gray-50)'}; border-radius:var(--radius-sm); margin-bottom:4px; border-left:4px solid ${a.realizado ? 'var(--success)' : 'var(--warning)'};">
                            <div>
                                <span style="${a.realizado ? 'text-decoration:line-through; color:var(--success);' : ''}">${a.texto}</span>
                                ${a.prazo ? `<span style="font-size:11px; color:var(--gray-500); margin-left:8px;">Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')}</span>` : ''}
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:11px; color:var(--gray-500);">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                                ${podeMarcar ? `<button class="btn btn-sm ${a.realizado ? 'btn-outline' : 'btn-success'}" onclick="toggleAcaoLA('${jovem.id}', ${a.id})">${a.realizado ? 'Desmarcar' : 'Marcar Feito'}</button>` : `<span style="color:${a.realizado ? 'var(--success)' : 'var(--warning)'};">${a.realizado ? '✅' : '⏳'}</span>`}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        freqDiv.innerHTML = `
            <p><strong>Total de registros:</strong> ${hist.length}</p>
            <p><strong>Total de horas:</strong> ${totalHoras.toFixed(1)}h</p>
            <p><strong>Saldo restante:</strong> ${saldo}</p>
            ${hist.length > 0 ? `
                <div style="max-height:200px; overflow-y:auto; margin-top:8px;">
                    <table style="width:100%; font-size:13px;">
                        <thead><tr><th>Tipo</th><th>Data/Hora</th><th>Horas</th><th>Obs</th></tr></thead>
                        <tbody>${hist.map(h => `<tr><td>${h.tipo === 'saida' ? '🚪 Saída' : '🚪 Entrada'}</td><td>${new Date(h.data).toLocaleString('pt-BR')}</td><td>${h.tipo === 'saida' ? '-' : (parseNum(h.horas || h.hours || 0) || 0) + 'h'}</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            ` : '<p style="color:var(--gray-500);">Nenhum registro de frequência.</p>'}
            ${acoesLAHTML}
        `;
    }

    // Oficinas
    const ofDiv = document.getElementById('fichaOficinas');
    if (ofDiv) {
        const oficinasParticipadas = estado.oficinas.filter(o => (o.jovensIds || []).includes(jovem.id));
        ofDiv.innerHTML = oficinasParticipadas.length > 0 ?
            `<div style="max-height:180px; overflow-y:auto;"><table style="width:100%; font-size:13px;"><thead><tr><th>Data</th><th>Conteúdo</th><th>Benefício</th></tr></thead><tbody>${oficinasParticipadas.map(o => `<tr><td>${new Date(o.data).toLocaleDateString('pt-BR')}</td><td>${o.conteudo}</td><td>${o.reverte ? '✅ Sim' : 'Não'}</td></tr>`).join('')}</tbody></table></div>` :
            '<p style="color:var(--gray-500);">Nenhuma oficina registrada.</p>';
    }

    // Documentos
    const docDiv = document.getElementById('fichaDocumentos');
    if (docDiv) {
        const docs = jovem.documentos || [];
        docDiv.innerHTML = docs.length > 0 ?
            docs.map((d, i) => `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--gray-50); border-radius:var(--radius-sm); margin-bottom:4px; border:1px solid var(--gray-200);">
                <span>📄 ${d.nome} (${d.tipo})</span>
                <div>${d.base64 ? `<a href="${d.base64}" download="${d.nome}" class="btn btn-sm btn-primary" style="text-decoration:none;">📥</a>` : ''}<button onclick="removerDocumento('${jovem.id}', ${i})" class="btn btn-sm btn-danger"><i class="fas fa-trash"></i></button></div>
            </div>`).join('') :
            '<p style="color:var(--gray-500);">Nenhum documento anexado.</p>';
    }

    // Observações
    const obsDiv = document.getElementById('fichaObservacoes');
    if (obsDiv) {
        const obs = jovem.observacoes || [];
        obsDiv.innerHTML = obs.length > 0 ?
            obs.map(o => `<div style="padding:8px 12px; background:white; border-radius:var(--radius-sm); margin-bottom:4px; border-left:3px solid #8B5CF6; border:1px solid var(--gray-200); border-left-width:3px;">
                <strong style="font-size:12px; color:var(--gray-700);">${o.profissional || 'Sistema'}</strong>
                <span style="font-size:11px; color:var(--gray-500); margin-left:8px;">${new Date(o.data).toLocaleString('pt-BR')}</span>
                <p style="font-size:13px; margin-top:4px; color:var(--gray-600);">${o.texto}</p>
            </div>`).join('') :
            '<p style="color:var(--gray-500);">Nenhuma observação registrada.</p>';
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
};

window.vincularProfissionalLA = async function(jovemId, profId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    jovem.profissionalLA = profId;
    await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
    carregarFichaIndividual();
    alert('✅ Profissional vinculado com sucesso!');
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
        alert('✅ Observação salva!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

window.removerDocumento = async function(jovemId, index) {
    if (!confirm('Remover este documento?')) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    jovem.documentos = jovem.documentos || [];
    jovem.documentos.splice(index, 1);
    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        carregarFichaIndividual();
        alert('✅ Documento removido!');
    } catch (err) {
        alert('Erro: ' + err.message);
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
    const jovemId = _jovemDocAtual;
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
        alert('✅ Documento adicionado!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

window.abrirFichaModal = function(id) {
    if (!id) { alert('ID do jovem não fornecido.'); return; }
    const jovem = estado.jovens.find(j => j.id === id);
    if (!jovem) { alert('Jovem não encontrado.'); return; }
    const modalFicha = document.getElementById('modalFicha');
    if (!modalFicha) { alert('Modal não encontrado.'); return; }

    document.getElementById('fichaTitulo').textContent = `📋 Ficha: ${jovem['NOME'] || 'Sem nome'}`;

    let acoesLAHTML = '';
    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        const profs = estado.usuarios.filter(u => u.nivel === 'tecnico' || u.nivel === 'gestor');
        const profAtual = estado.usuarios.find(u => u.id === jovem.profissionalLA);
        const podeMarcar = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel);

        acoesLAHTML = `
            <div style="margin-top:16px; padding-top:16px; border-top:2px solid var(--gray-200);">
                <h4 style="font-weight:600; color:var(--gray-700); margin-bottom:8px;">⚖️ Acompanhamento LA</h4>
                <div style="margin-bottom:12px;">
                    <label style="font-weight:500; font-size:13px;">Profissional Responsável:</label>
                    <select onchange="vincularProfissionalLA('${jovem.id}', this.value)" style="padding:6px 12px; border:1px solid var(--gray-200); border-radius:var(--radius-sm); margin-left:8px;">
                        <option value="">Não atribuído</option>
                        ${profs.map(p => `<option value="${p.id}" ${jovem.profissionalLA === p.id ? 'selected' : ''}>${p.nome}</option>`).join('')}
                    </select>
                    ${profAtual ? `<span style="margin-left:12px; color:var(--success);">✅ ${profAtual.nome}</span>` : ''}
                </div>
                ${acoes.map(a => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:${a.realizado ? 'var(--success-light)' : 'var(--gray-50)'}; border-radius:var(--radius-sm); margin-bottom:4px; border-left:4px solid ${a.realizado ? 'var(--success)' : 'var(--warning)'};">
                        <div>
                            <span style="${a.realizado ? 'text-decoration:line-through; color:var(--success);' : ''}">${a.texto}</span>
                            ${a.prazo ? `<span style="font-size:11px; color:var(--gray-500); margin-left:8px;">Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')}</span>` : ''}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:11px; color:var(--gray-500);">${new Date(a.data).toLocaleDateString('pt-BR')}</span>
                            ${podeMarcar ? `<button class="btn btn-sm ${a.realizado ? 'btn-outline' : 'btn-success'}" onclick="toggleAcaoLA('${jovem.id}', ${a.id})">${a.realizado ? 'Desmarcar' : 'Marcar Feito'}</button>` : `<span style="color:${a.realizado ? 'var(--success)' : 'var(--warning)'};">${a.realizado ? '✅' : '⏳'}</span>`}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    const hist = jovem.historicoFrequencia || [];
    const totalHoras = hist.reduce((s, h) => s + parseNum(h.horas || h.hours || 0), 0);
    const saldo = jovem['MEDIDA'] === 'LA' ? 'N/A' : calcularSaldo(jovem).toFixed(1) + 'h';

    const frequenciaHTML = hist.length > 0 ?
        `<div style="max-height:200px; overflow-y:auto;"><table style="width:100%; font-size:13px;"><thead><tr><th>Tipo</th><th>Data/Hora</th><th>Horas</th><th>Obs</th></tr></thead><tbody>${hist.map(h => `<tr><td>${h.tipo === 'saida' ? '🚪 Saída' : '🚪 Entrada'}</td><td>${new Date(h.data).toLocaleString('pt-BR')}</td><td>${h.tipo === 'saida' ? '-' : (parseNum(h.horas || h.hours || 0) || 0) + 'h'}</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody></table></div>` :
        '<p style="color:var(--gray-500);">Sem registros de frequência</p>';

    document.getElementById('fichaConteudo').innerHTML = `
        <div style="margin-bottom:16px;">
            <h4 style="font-weight:600; color:var(--gray-700); border-bottom:2px solid var(--gray-200); padding-bottom:8px;">Dados Pessoais</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 20px; margin-top:8px;">
                ${CAMPOS.map(([key, label]) => `<div style="padding:4px 0; border-bottom:1px solid var(--gray-200);"><strong style="font-size:11px; color:var(--gray-500); text-transform:uppercase; display:block;">${label}</strong><span>${jovem[key] || '-'}</span></div>`).join('')}
                <div style="padding:4px 0; border-bottom:1px solid var(--gray-200);"><strong style="font-size:11px; color:var(--gray-500); text-transform:uppercase; display:block;">ID Digital</strong><span>${jovem['ID_DIGITAL'] || '-'}</span></div>
                <div style="padding:4px 0; border-bottom:1px solid var(--gray-200); grid-column:1/-1; background:${jovem.status === 'EM DESCUMPRIMENTO' ? 'var(--danger-light)' : jovem.status === 'IRREGULAR' ? 'var(--warning-light)' : 'transparent'}; padding:8px; border-radius:4px;">
                    <strong style="font-size:11px; color:var(--gray-500); text-transform:uppercase; display:block;">Status</strong>
                    <span style="font-weight:600;">${jovem.status || 'REGULAR'}</span>
                    ${jovem.motivoSuspensao ? `<span style="font-size:13px; color:var(--danger); display:block; margin-top:4px;">Motivo: ${jovem.motivoSuspensao}</span>` : ''}
                </div>
            </div>
        </div>
        ${acoesLAHTML}
        <div style="margin-top:16px; padding-top:16px; border-top:2px solid var(--gray-200);">
            <h4 style="font-weight:600; color:var(--gray-700); margin-bottom:8px;">📊 Frequência (${hist.length} registros | Total: ${totalHoras.toFixed(1)}h | Saldo: ${saldo})</h4>
            ${frequenciaHTML}
        </div>
    `;
    modalFicha.style.display = 'flex';
};

// ============================================================
// IMPRIMIR FICHA
// ============================================================
window.imprimirFichaIndividual = function() {
    const id = document.getElementById('selectJovemAcomp').value;
    if (!id) { alert('Selecione um jovem primeiro.'); return; }
    const jovem = estado.jovens.find(j => j.id === id);
    if (!jovem) { alert('Jovem não encontrado.'); return; }
    const win = window.open('', '_blank');
    if (!win) { alert('Por favor, permita pop-ups para imprimir.'); return; }

    let logoBase64 = window._logoBase64 || '';
    if (!logoBase64) {
        const logoImg = document.querySelector('.logo-img') || document.querySelector('#logoImg');
        if (logoImg && logoImg.src && logoImg.src.startsWith('data:image')) {
            logoBase64 = logoImg.src;
        }
    }

    let html = `
    <!DOCTYPE html>
    <html><head><title>Ficha Individual - ${jovem['NOME'] || 'Sem nome'}</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: Inter, Arial, sans-serif; padding:40px; background:white; }
        .header { text-align:center; margin-bottom:30px; border-bottom:3px solid #1A3A6B; padding-bottom:15px; display:flex; align-items:center; justify-content:center; gap:20px; flex-wrap:wrap; }
        .header-logo { max-height:70px; max-width:140px; object-fit:contain; }
        .header h1 { color:#1A3A6B; font-size:22px; }
        .section { margin-bottom:20px; }
        .section h2 { color:#1A3A6B; font-size:16px; border-bottom:2px solid #e2e8f0; padding-bottom:8px; margin-bottom:12px; }
        .grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 20px; }
        .field { padding:4px 0; border-bottom:1px solid #f1f5f9; }
        .field strong { font-size:10px; text-transform:uppercase; color:#6b7280; display:block; }
        .field span { font-size:13px; }
        table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
        th, td { padding:6px 10px; text-align:left; border-bottom:1px solid #e9edf2; }
        th { background:#f1f5f9; font-weight:600; }
        @media print { body { padding:20px; } }
    </style>
    </head><body>
        <div class="header">
            ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" class="header-logo">` : ''}
            <div><h1>📋 Ficha Individual</h1><p style="color:#6b7280;">${jovem['NOME'] || 'Sem nome'}</p><p style="color:#94a3b8; font-size:12px;">${new Date().toLocaleDateString('pt-BR')}</p></div>
        </div>
        <div class="section">
            <h2>Dados Pessoais</h2>
            <div class="grid">`;
    CAMPOS.forEach(([key, label]) => {
        html += `<div class="field"><strong>${label}</strong><span>${jovem[key] || '-'}</span></div>`;
    });
    html += `<div class="field"><strong>ID Digital</strong><span>${jovem['ID_DIGITAL'] || '-'}</span></div>`;
    html += `<div class="field" style="grid-column:1/-1;"><strong>Status</strong><span>${jovem.status || 'REGULAR'}</span></div>`;
    html += `</div></div>`;

    if (jovem['MEDIDA'] === 'LA') {
        const acoes = jovem.acoesLA || [];
        html += `<div class="section"><h2>Ações LA</h2>`;
        acoes.forEach(a => {
            html += `<div style="padding:6px; background:${a.realizado ? '#e6f7ee' : '#f8fafc'}; margin-bottom:4px; border-radius:4px;"><span>${a.texto}</span> ${a.prazo ? `<span style="font-size:0.7rem; color:#64748b;">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span>` : ''} - <span style="color:${a.realizado ? '#0F9D58' : '#92400e'};">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span></div>`;
        });
        html += `</div>`;
    }

    const hist = jovem.historicoFrequencia || [];
    const totalHoras = hist.reduce((s, h) => s + parseNum(h.horas || h.hours || 0), 0);
    html += `<div class="section"><h2>Frequência</h2><p>Total: ${totalHoras.toFixed(1)}h | Saldo: ${calcularSaldo(jovem).toFixed(1)}h</p>`;
    if (hist.length > 0) {
        html += `<table><thead><tr><th>Tipo</th><th>Data</th><th>Horas</th></tr></thead><tbody>`;
        hist.forEach(h => {
            html += `<tr><td>${h.tipo === 'saida' ? 'Saída' : 'Entrada'}</td><td>${new Date(h.data).toLocaleString('pt-BR')}</td><td>${h.tipo === 'saida' ? '-' : (parseNum(h.horas || h.hours || 0) || 0) + 'h'}</td></tr>`;
        });
        html += `</tbody></table>`;
    }
    html += `</div></body></html>`;

    win.document.write(html);
    win.document.close();
};

// ============================================================
// USUÁRIOS
// ============================================================
function renderizarUsuarios() {
    const tbody = document.getElementById('listaUsuarios');
    if (!tbody) return;

    const podeAlterarNivel = ['gestor', 'desenvolvedor'].includes(estado.usuarioAtual?.nivel);
    const usuariosAtivos = estado.usuarios.filter(u => u.status === 'ativo');

    tbody.innerHTML = usuariosAtivos.map(u => {
        const isDesenvolvedor = u.nivel === 'desenvolvedor' || u.nivel === 'admin';
        const isProprioUsuario = u.id === estado.usuarioAtual?.id;

        let botoesNivel = '';
        if (podeAlterarNivel && !isProprioUsuario && !isDesenvolvedor) {
            const niveis = ['gestor', 'tecnico', 'educador_social', 'autoridade', 'jovem'];
            botoesNivel = `
                <select onchange="alterarNivelUsuario('${u.id}', this.value)" style="padding:4px 8px; font-size:11px; border:1px solid var(--gray-200); border-radius:4px;">
                    <option value="">Alterar</option>
                    ${niveis.map(n => `<option value="${n}" ${u.nivel === n ? 'selected' : ''}>${NIVEIS_ACESSO[n]?.nome || n}</option>`).join('')}
                </select>
            `;
        }

        const podeExcluir = NIVEIS_COM_STATUS.includes(estado.usuarioAtual?.nivel) && !isProprioUsuario;

        return `<tr>
            <td>${u.nome || '-'}</td>
            <td>${u.email || '-'}</td>
            <td>${NIVEIS_ACESSO[u.nivel]?.nome || u.nivel || '-'} ${isDesenvolvedor ? '🛡️' : ''}</td>
            <td><span style="color:var(--success);">${u.status}</span></td>
            <td style="display:flex; gap:4px; flex-wrap:wrap;">
                ${botoesNivel}
                ${podeExcluir ? `<button onclick="abrirModalExclusao('usuario','${u.id}','${u.nome}')" class="btn btn-sm btn-danger"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--gray-500);">Nenhum usuário ativo encontrado.</td></tr>';
}

window.alterarNivelUsuario = async function(userId, novoNivel) {
    if (!novoNivel) return;
    if (!['gestor', 'desenvolvedor'].includes(estado.usuarioAtual?.nivel)) {
        alert('❌ Você não tem permissão.');
        return;
    }
    const user = estado.usuarios.find(u => u.id === userId);
    if (!user) return;
    if (user.id === estado.usuarioAtual.id) { alert('❌ Não pode alterar seu próprio nível.'); return; }
    if (user.nivel === 'desenvolvedor' && estado.usuarioAtual.nivel !== 'desenvolvedor') {
        alert('❌ Apenas desenvolvedores podem alterar outro desenvolvedor.');
        return;
    }
    if (!confirm(`Alterar nível de ${user.nome} de "${user.nivel}" para "${novoNivel}"?`)) return;
    const nivelAnterior = user.nivel;
    user.nivel = novoNivel;
    try {
        await upstash('SET', `user:${user.id}`, JSON.stringify(user));
        await carregarTodosDados();
        alert(`✅ Nível alterado: ${user.nome} → ${nivelAnterior} → ${novoNivel}`);
    } catch (err) {
        alert('Erro: ' + err.message);
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
                    <button onclick="aprovarUsuario('${u.id}', '${u.nivel}')" class="btn btn-sm btn-success">✅ Aprovar</button>
                    <button onclick="abrirModalExclusao('usuario','${u.id}','${u.nome}')" class="btn btn-sm btn-danger">🗑️ Rejeitar</button>
                ` : '<span style="color:var(--gray-500);">Aguardando</span>'}
            </td>
        </tr>
    `).join('');
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
            alert('✅ Usuário aprovado!');
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
        alert('✅ Jovem vinculado e aprovado!');
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
        alert('✅ Usuário cadastrado!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
}

// ============================================================
// PROFISSIONAIS
// ============================================================
function renderizarProfissionais() {
    const div = document.getElementById('listaProfissionais');
    if (!div) return;

    div.innerHTML = estado.profissionais.map(p => `
        <div style="background:white; border:1px solid var(--gray-200); border-radius:var(--radius-sm); padding:12px 16px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <strong>${p.nome || 'Sem nome'}</strong>
                ${p.funcao ? `<span style="color:var(--gray-500); margin-left:8px;">${p.funcao}</span>` : ''}
                ${p.registro ? `<span style="font-size:12px; color:var(--gray-400); margin-left:8px;">Reg: ${p.registro}</span>` : ''}
                ${p.numero ? `<span style="font-size:12px; color:var(--gray-400); margin-left:8px;">Nº ${p.numero}</span>` : ''}
            </div>
            <button onclick="abrirModalExclusao('profissional','${p.id}','${p.nome}')" class="btn btn-sm btn-danger"><i class="fas fa-trash"></i></button>
        </div>
    `).join('') || '<p style="color:var(--gray-500); text-align:center; padding:20px;">Nenhum profissional cadastrado.</p>';
}

async function salvarProfissional() {
    const nome = document.getElementById('profNome').value.trim();
    if (!nome) { alert('Preencha o nome do profissional.'); return; }
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
        alert('✅ Profissional salvo!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
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
        alert('✅ Registro excluído!');
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

// ============================================================
// ALTERAR STATUS (Modal)
// ============================================================
let _alterarStatusJovemId = null;

window.abrirModalAlterarStatus = function(jovemId) {
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;
    _alterarStatusJovemId = jovemId;
    document.getElementById('alterarStatusNome').textContent = `Alterar status de: ${jovem['NOME'] || jovem['REFERENCIA']}`;
    document.getElementById('alterarStatusSelect').value = jovem.status || 'REGULAR';
    document.getElementById('alterarStatusMotivo').style.display = 'none';
    document.getElementById('alterarStatusMotivoInput').value = '';
    document.getElementById('modalAlterarStatus').style.display = 'flex';
};

function fecharModalAlterarStatus() {
    document.getElementById('modalAlterarStatus').style.display = 'none';
    _alterarStatusJovemId = null;
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('alterarStatusSelect')?.addEventListener('change', function() {
        document.getElementById('alterarStatusMotivo').style.display = this.value === 'SUSPENSO' ? 'block' : 'none';
    });
});

window.confirmarAlterarStatus = async function() {
    const jovemId = _alterarStatusJovemId;
    if (!jovemId) return;
    const jovem = estado.jovens.find(j => j.id === jovemId);
    if (!jovem) return;

    const novoStatus = document.getElementById('alterarStatusSelect').value;
    let motivo = '';
    if (novoStatus === 'SUSPENSO') {
        motivo = document.getElementById('alterarStatusMotivoInput').value.trim();
        if (!motivo) return alert('Informe o motivo da suspensão.');
    }

    const statusAnterior = jovem.status;
    jovem.status = novoStatus;
    if (novoStatus === 'SUSPENSO') {
        jovem.motivoSuspensao = motivo;
        jovem.dataSuspensao = new Date().toISOString();
        jovem.suspensoPor = estado.usuarioAtual?.nome || 'Sistema';
    } else {
        jovem.motivoSuspensao = '';
        jovem.dataSuspensao = '';
    }
    if (!jovem.observacoes) jovem.observacoes = [];
    jovem.observacoes.push({
        data: new Date().toISOString(),
        profissional: estado.usuarioAtual?.nome || 'Sistema',
        texto: `📌 Status alterado de "${statusAnterior}" para "${novoStatus}"${motivo ? ' - Motivo: ' + motivo : ''}`
    });

    try {
        await upstash('SET', `jovem:${jovem.id}`, JSON.stringify(jovem));
        fecharModalAlterarStatus();
        await carregarTodosDados();
        alert(`✅ Status alterado para "${novoStatus}"!`);
    } catch (err) {
        alert('Erro: ' + err.message);
    }
};

// ============================================================
// AÇÕES EM LOTE
// ============================================================
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
        document.getElementById('loteOpcoesStatus').style.display = this.value === 'alterar_status' ? 'block' : 'none';
    });
    document.getElementById('loteNovoStatus')?.addEventListener('change', function() {
        document.getElementById('loteMotivoSuspensao').style.display = this.value === 'SUSPENSO' ? 'block' : 'none';
    });
});

window.executarAcaoLote = async function() {
    const acao = document.getElementById('loteAcaoSelect').value;
    if (!acao) return alert('Selecione uma ação.');

    const ids = Array.from(estado.selecionadosLote);
    const jovens = estado.jovens.filter(j => ids.includes(j.id));

    if (acao === 'excluir') {
        if (!confirm(`Excluir PERMANENTEMENTE ${jovens.length} jovens?`)) return;
        try {
            for (const j of jovens) {
                await upstash('DEL', `jovem:${j.id}`);
                await upstash('SREM', 'jovens:all', j.id);
            }
            estado.jovens = estado.jovens.filter(j => !ids.includes(j.id));
            desmarcarTodos();
            fecharModalAcoesLote();
            await carregarTodosDados();
            alert(`✅ ${jovens.length} jovens excluídos!`);
        } catch (err) {
            alert('Erro: ' + err.message);
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
        if (!confirm(`Alterar status de ${jovens.length} jovens para "${novoStatus}"?`)) return;

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
            alert(`✅ Status de ${jovens.length} jovens alterado para "${novoStatus}"!`);
        } catch (err) {
            alert('Erro: ' + err.message);
        }
        return;
    }

    alert('Ação não reconhecida.');
};

// ============================================================
// CONFIGURAÇÕES
// ============================================================
async function salvarNovaSenha() {
    const s1 = document.getElementById('novaSenhaInput').value;
    const s2 = document.getElementById('confirmarNovaSenhaInput').value;
    if (!s1 || s1.length < 6) return alert('Senha deve ter no mínimo 6 caracteres.');
    if (s1 !== s2) return alert('As senhas não coincidem.');
    try {
        estado.usuarioAtual.senha = s1;
        await upstash('SET', `user:${estado.usuarioAtual.id}`, JSON.stringify(estado.usuarioAtual));
        alert('✅ Senha alterada com sucesso!');
        document.getElementById('novaSenhaInput').value = '';
        document.getElementById('confirmarNovaSenhaInput').value = '';
    } catch (err) {
        alert('Erro: ' + err.message);
    }
}

async function carregarLogo() {
    try {
        const logoBase64 = await upstash('GET', 'config:logo');
        if (logoBase64) {
            window._logoBase64 = logoBase64;
        }
    } catch (e) {
        console.error('Erro ao carregar logo', e);
    }
}

async function salvarLogo() {
    const fileInput = document.getElementById('novaLogoInput');
    if (!fileInput || !fileInput.files[0]) {
        return alert('Selecione uma imagem.');
    }
    try {
        const base64 = await fileToBase64(fileInput.files[0]);
        await upstash('SET', 'config:logo', base64);
        window._logoBase64 = base64;
        alert('✅ Logo atualizado com sucesso!');
        fileInput.value = '';
    } catch (err) {
        alert('Erro ao salvar logo: ' + err.message);
    }
}

// ============================================================
// DASHBOARD JOVEM
// ============================================================
function renderizarDashboardJovem() {
    const cards = document.getElementById('jovemInfoCards');
    const freqDiv = document.getElementById('jovemFrequencia');
    if (!cards || !freqDiv) return;
    if (estado.jovens.length === 0) {
        cards.innerHTML = '<p style="color:var(--gray-500);">Nenhum dado encontrado.</p>';
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
            <div class="stat-card"><div class="stat-label">Nome</div><div class="stat-value" style="font-size:20px;">${jovem['NOME'] || '-'}</div></div>
            <div class="stat-card"><div class="stat-label">Medida</div><div class="stat-value" style="font-size:20px;">Liberdade Assistida</div></div>
            <div class="stat-card"><div class="stat-label">Ações Concluídas</div><div class="stat-value" style="color:var(--success);">${concluidas}/${acoes.length}</div></div>
            <div class="stat-card"><div class="stat-label">Progresso</div><div class="stat-value" style="color:var(--info);">${progresso}%</div></div>
            ${profissional ? `<div class="stat-card"><div class="stat-label">Técnico</div><div class="stat-value" style="font-size:18px;">${profissional.nome}</div></div>` : ''}
        `;
        freqDiv.innerHTML = `
            <div class="form-card">
                <h3>📝 Minhas Ações</h3>
                ${acoes.map(a => `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:${a.realizado ? 'var(--success-light)' : 'var(--gray-50)'}; border-radius:var(--radius-sm); margin-bottom:6px; border-left:4px solid ${a.realizado ? 'var(--success)' : 'var(--warning)'};">
                    <div><strong>${a.texto}</strong> ${a.prazo ? `<span style="font-size:12px; color:var(--gray-500);">(Vence: ${new Date(a.prazo).toLocaleDateString('pt-BR')})</span>` : ''}</div>
                    <span style="color:${a.realizado ? 'var(--success)' : 'var(--warning)'};">${a.realizado ? '✅ Cumprido' : '⏳ Pendente'}</span>
                </div>`).join('')}
            </div>`;
    } else {
        const horasTotal = parseFloat(jovem['HORAS'] || 0);
        const hist = jovem.historicoFrequencia || [];
        const horasFeitas = hist.reduce((s, h) => s + (parseFloat(h.horas || 0) || 0), 0);
        const saldo = Math.max(0, horasTotal - horasFeitas);

        cards.innerHTML = `
            <div class="stat-card"><div class="stat-label">Nome</div><div class="stat-value" style="font-size:20px;">${jovem['NOME'] || '-'}</div></div>
            <div class="stat-card"><div class="stat-label">Horas a Cumprir</div><div class="stat-value" style="color:var(--primary);">${horasTotal}h</div></div>
            <div class="stat-card"><div class="stat-label">Horas Cumpridas</div><div class="stat-value" style="color:var(--success);">${horasFeitas.toFixed(1)}h</div></div>
            <div class="stat-card"><div class="stat-label">Saldo Restante</div><div class="stat-value" style="color:var(--warning);">${saldo.toFixed(1)}h</div></div>
        `;
        freqDiv.innerHTML = `
            <div class="form-card">
                <h3>📊 Minhas Frequências</h3>
                ${hist.length > 0 ? `
                    <div style="max-height:250px; overflow-y:auto;">
                        <table style="width:100%; font-size:13px;">
                            <thead><tr><th>Data</th><th>Horas</th><th>Obs</th></tr></thead>
                            <tbody>${hist.map(h => `<tr><td>${new Date(h.data).toLocaleString('pt-BR')}</td><td>${h.horas || 0}h</td><td>${h.observacao || '-'}</td></tr>`).join('')}</tbody>
                        </table>
                    </div>
                ` : '<p style="color:var(--gray-500);">Nenhum registro de frequência.</p>'}
            </div>`;
    }
}

// ============================================================
// IMPORTAR PLANILHA
// ============================================================
async function importarPlanilha() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return alert('Nenhum arquivo selecionado.');

        const statusDiv = document.getElementById('statusImportacao');
        statusDiv.style.display = 'block';
        statusDiv.style.background = 'var(--warning-light)';
        statusDiv.style.color = 'var(--warning)';
        statusDiv.textContent = '⏳ Processando planilha...';

        try {
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { cellStyles: true, type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];

            if (!ws) throw new Error('Planilha vazia ou formato inválido.');

            const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '', header: 'A' });
            if (!rows || rows.length === 0) throw new Error('Planilha vazia.');

            // Encontrar linha de cabeçalho
            let startRow = 0;
            for (let i = 0; i < Math.min(10, rows.length); i++) {
                const row = rows[i];
                const hasData = Object.values(row).some(val => val && val.toString().trim() !== '');
                if (hasData) {
                    startRow = i;
                    break;
                }
            }

            const headers = rows[startRow] || {};
            const dataRows = rows.slice(startRow + 1).filter(row => {
                return Object.values(row).some(val => val && val.toString().trim() !== '');
            });

            if (dataRows.length === 0) throw new Error('Nenhuma linha de dados encontrada.');

            // Mapear colunas
            function findColumn(headerNames) {
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
                NOME: findColumn(['NOME', 'NOME COMPLETO']),
                RESPONSAVEL: findColumn(['NOME DO RESPONSÁVEL', 'RESPONSÁVEL']),
                REINCIDENCIA: findColumn(['REINCIDÊNCIA', 'REINCIDENCIA']),
                MEDIDA: findColumn(['MEDIDA', 'MSE']),
                MESES: findColumn(['MESES']),
                HORAS: findColumn(['HORAS', 'TOTAL HORAS']),
                PROTETIVA: findColumn(['PROTETIVA']),
                NASCIMENTO: findColumn(['NASC.', 'NASCIMENTO', 'DATA NASC']),
                NATURALIDADE: findColumn(['NATURALIDADE']),
                IDADE: findColumn(['IDADE']),
                GENERO: findColumn(['GÊNERO', 'GENERO']),
                COR: findColumn(['COR']),
                CPF: findColumn(['CPF']),
                TELEFONE: findColumn(['TELEFONE', 'TEL']),
                ENDERECO: findColumn(['ENDEREÇO', 'ENDERECO']),
                BAIRRO: findColumn(['BAIRRO']),
                ESCOLA: findColumn(['ESCOLA']),
                SERIE: findColumn(['SÉRIE', 'SERIE']),
                ESTUDA: findColumn(['ESTUDA?', 'ESTUDA']),
                TRABALHA: findColumn(['TRABALHA?', 'TRABALHA']),
                FUNCAO: findColumn(['FUNÇÃO', 'FUNCAO']),
                USO_SPA: findColumn(['USO DE SPA?', 'USO DE SPA']),
                QUAL_SPA: findColumn(['QUAL?', 'QUAL']),
                STATUS: findColumn(['STATUS', 'SITUAÇÃO', 'SITUACAO'])
            };

            const campoParaColuna = {
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
                'QUAL?': colMap.QUAL_SPA
            };

            let importados = 0;
            let atualizados = 0;
            let erros = 0;
            let ignorados = 0;

            for (const row of dataRows) {
                try {
                    let nome = '';
                    if (colMap.NOME && row[colMap.NOME]) {
                        nome = String(row[colMap.NOME]).trim();
                    }
                    if (!nome && row['A']) nome = String(row['A']).trim();
                    if (!nome && row['B']) nome = String(row['B']).trim();

                    if (!nome) { ignorados++; continue; }

                    // Pular linhas de legenda
                    const palavrasIgnorar = ['NOVOS ADOLESCENTES', 'REGULAR', 'IRREGULAR', 'EM DESCUMPRIMENTO',
                        'CÓDIGOS FAMILIARES', 'PACTUAÇÃO', 'MEDIDA FINALIZADA', 'LEGENDA', 'TOTAL', 'NOME', 'REFERENCIA'];
                    let ignorar = false;
                    for (const palavra of palavrasIgnorar) {
                        if (nome.toUpperCase().includes(palavra)) { ignorar = true; break; }
                    }
                    if (ignorar) { ignorados++; continue; }

                    // Status
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

                    // Buscar jovem existente
                    let cpfPlanilha = '';
                    if (colMap.CPF && row[colMap.CPF]) {
                        cpfPlanilha = String(row[colMap.CPF]).replace(/\D/g, '');
                    }

                    let jovemExistente = null;
                    if (cpfPlanilha && cpfPlanilha.length >= 11) {
                        jovemExistente = estado.jovens.find(j => (j['CPF'] || '').replace(/\D/g, '') === cpfPlanilha);
                    }
                    if (!jovemExistente) {
                        jovemExistente = estado.jovens.find(j => (j['NOME'] || '').toUpperCase().trim() === nome.toUpperCase().trim());
                    }

                    const dadosJovem = {};
                    for (const [campo, coluna] of Object.entries(campoParaColuna)) {
                        if (coluna && row[coluna] !== undefined && row[coluna] !== '') {
                            let valor = String(row[coluna]).trim();
                            if (campo === 'GÊNERO') {
                                if (valor.toUpperCase().includes('MASC')) valor = 'M';
                                else if (valor.toUpperCase().includes('FEM')) valor = 'F';
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
                        const jovemAtualizado = {
                            id: jovemId,
                            status: statusPlanilha,
                            historicoFrequencia: jovemExistente.historicoFrequencia || [],
                            observacoes: jovemExistente.observacoes || [],
                            documentos: jovemExistente.documentos || [],
                            acoesLA: jovemExistente.acoesLA || [],
                            profissionalLA: jovemExistente.profissionalLA || '',
                            ...dadosJovem
                        };
                        for (const [key] of CAMPOS) {
                            if (!jovemAtualizado[key] && jovemExistente[key] !== undefined) {
                                jovemAtualizado[key] = jovemExistente[key];
                            }
                        }
                        await upstash('SET', `jovem:${jovemId}`, JSON.stringify(jovemAtualizado));
                        const index = estado.jovens.findIndex(j => j.id === jovemId);
                        if (index !== -1) estado.jovens[index] = jovemAtualizado;
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
                            ...dadosJovem
                        };
                        for (const [key] of CAMPOS) {
                            if (!novoJovem[key]) novoJovem[key] = '';
                        }
                        await upstash('SET', `jovem:${novoId}`, JSON.stringify(novoJovem));
                        await upstash('SADD', 'jovens:all', novoId);
                        estado.jovens.push(novoJovem);
                        importados++;
                    }
                } catch (rowError) {
                    console.error('Erro na linha:', rowError);
                    erros++;
                }
            }

            await carregarTodosDados();
            let mensagem = `✅ Importação concluída!`;
            if (importados > 0) mensagem += ` ${importados} novos.`;
            if (atualizados > 0) mensagem += ` ${atualizados} atualizados.`;
            if (ignorados > 0) mensagem += ` ${ignorados} ignorados.`;
            if (erros > 0) mensagem += ` ⚠️ ${erros} erros.`;

            statusDiv.style.background = 'var(--success-light)';
            statusDiv.style.color = 'var(--success)';
            statusDiv.textContent = mensagem;
            alert(mensagem);
            carregarLista();
            renderizarDashboard();

        } catch (err) {
            statusDiv.style.background = 'var(--danger-light)';
            statusDiv.style.color = 'var(--danger)';
            statusDiv.textContent = '❌ Erro: ' + err.message;
            console.error('Erro na importação:', err);
            alert('Erro na importação: ' + err.message);
        }
    };

    input.click();
}

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
        'USO DE SPA?', 'QUAL?'
    ];

    const data = estado.jovens.map(j => {
        const row = {};
        camposPlanilha.forEach(campo => {
            const chave = Object.keys(j).find(k => k === campo);
            row[campo] = chave ? (j[chave] || '') : '';
        });
        row['STATUS'] = j.status || 'REGULAR';
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
        data.forEach(row => {
            const val = String(row[h] || '');
            if (val.length > maxLen) maxLen = val.length;
        });
        colWidths.push({ wch: Math.min(Math.max(maxLen + 2, 12), 40) });
    });
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, `jovens_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ============================================================
// CADASTRO DE USUÁRIO
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
        document.getElementById('cadastroSucesso').textContent = '✅ Cadastro enviado! Aguarde aprovação.';
        ['cadastroNome', 'cadastroEmail', 'cadastroSenha', 'cadastroSenhaConfirm'].forEach(id => {
            document.getElementById(id).value = '';
        });
    } catch (err) {
        document.getElementById('cadastroErro').textContent = 'Erro: ' + err.message;
    }
}

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
// EDIÇÃO DE JOVEM
// ============================================================
window.editarJovem = function(id) {
    if (!id) return alert('ID do jovem não fornecido.');
    const j = estado.jovens.find(x => x.id === id);
    if (!j) return alert('Jovem não encontrado.');
    estado._editarId = id;
    CAMPOS.forEach(([key]) => {
        const el = document.getElementById(`campo_${key}`);
        if (el) el.value = j[key] || '';
    });
    document.getElementById('campo_ID_DIGITAL').value = j['ID_DIGITAL'] || '';
    estado.acoesLATemporarias = j.acoesLA || [];
    toggleAcoesLA();
    atualizarListaAcoesLAForm();
    navigateTo('pageCadastro');
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Núcleo Socioeducativo v3.0 iniciando...');

    // Login
    document.getElementById('loginBtn').addEventListener('click', fazerLogin);
    document.getElementById('loginSenha').addEventListener('keypress', e => { if (e.key === 'Enter') fazerLogin(); });
    document.getElementById('logoutBtn').addEventListener('click', deslogarSistema);

    // Cadastro
    document.getElementById('mostrarCadastroBtn').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('cadastroScreen').style.display = 'flex';
    });
    document.getElementById('voltarLoginBtn').addEventListener('click', () => {
        document.getElementById('cadastroScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'flex';
    });
    document.getElementById('cadastrarBtn').addEventListener('click', cadastrarUsuario);

    // Formulário
    document.getElementById('salvarBtn').addEventListener('click', salvarJovem);
    document.getElementById('importarExcelBtn').addEventListener('click', importarPlanilha);
    document.getElementById('limparFormBtn').addEventListener('click', limparFormulario);

    // Lista
    document.getElementById('btnPontoDigital').addEventListener('click', registrarPontoDigital);
    document.getElementById('inputDigital').addEventListener('keypress', e => { if (e.key === 'Enter') registrarPontoDigital(); });
    document.getElementById('exportarExcelBtn').addEventListener('click', exportarExcel);
    document.getElementById('registroManualBtn').addEventListener('click', abrirRegistroManual);
    document.getElementById('manualSalvar').addEventListener('click', salvarRegistroManual);
    document.getElementById('manualCancelar').addEventListener('click', () => {
        document.getElementById('modalRegistroManual').style.display = 'none';
    });
    document.getElementById('buscaFrequencia').addEventListener('input', function() {
        const filtroNome = document.getElementById('filtroNome');
        if (filtroNome) { filtroNome.value = this.value; carregarLista(); }
    });

    // Oficinas
    document.getElementById('salvarOficinaBtn').addEventListener('click', salvarOficina);

    // Usuários
    document.getElementById('userSalvarBtn').addEventListener('click', salvarNovoUsuario);

    // Header
    document.getElementById('btnNovoJovemHeader').addEventListener('click', () => navigateTo('pageCadastro'));
    document.getElementById('btnRegistrarPontoHeader').addEventListener('click', () => navigateTo('pageLista'));

    // Filtros
    document.querySelectorAll('#filtrosFrequencia select, #filtrosFrequencia input').forEach(el => {
        el?.addEventListener('change', carregarLista);
        el?.addEventListener('input', carregarLista);
    });

    // Renderizar campos iniciais
    renderizarCamposFormulario();

    // Verificar login salvo
    const email = localStorage.getItem('usuarioLogado');
    if (email) document.getElementById('loginEmail').value = email;

    console.log('✅ Sistema carregado com sucesso!');
    console.log(`📋 Níveis: ${Object.keys(NIVEIS_ACESSO).join(', ')}`);
});
</script>
