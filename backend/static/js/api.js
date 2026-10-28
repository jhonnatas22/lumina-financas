/**
 * Camada de API — conecta o frontend ao backend FastAPI.
 * Se o backend estiver indisponível, opera em "modo demonstração" local,
 * garantindo que todas as telas funcionem imediatamente.
 */
const API = (() => {
  // Em produção (Render), frontend e backend são o mesmo serviço, então a API
  // fica na mesma origem. 'lumina_api_url' no localStorage permite sobrescrever
  // (ex: apontar para outro backend) quando necessário.
  const BASE = localStorage.getItem('lumina_api_url') || '';
  const DEMO_KEY = 'lumina_demo_session';

  // ---------- Utilitários ----------
  const getToken = () => localStorage.getItem('lumina_token');
  const setSession = s => localStorage.setItem('lumina_token', s.access_token);
  const clearSession = () => localStorage.removeItem('lumina_token');

  async function request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (getToken()) headers['Authorization'] = `Bearer ${getToken()}`;
    try {
      const res = await fetch(BASE + path, { ...options, headers });
      if (res.status === 401) { clearSession(); location.href = 'login.html'; return; }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Erro ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      if (e instanceof TypeError) throw new Error('Backend offline — verifique se a API está rodando (uvicorn main:app).');
      throw e;
    }
  }

  // ---------- Seed de demonstração ----------
  const CATEGORIES = ['Alimentação','Transporte','Moradia','Saúde','Assinaturas','Lazer','Educação','Trabalho','Outros'];
  function seedDemo() {
    const tx = [
      ['2026-09-01','Salário',3500,'entrada','Trabalho'],
      ['2026-09-02','Supermercado União',-350.50,'saida','Alimentação'],
      ['2026-09-03','Internet',-99.90,'saida','Assinaturas'],
      ['2026-09-05','Aluguel',-1200,'saida','Moradia'],
      ['2026-09-06','Uber',-42.30,'saida','Transporte'],
      ['2026-09-08','Farmácia Central',-87.40,'saida','Saúde'],
      ['2026-09-10','Netflix',-39.90,'saida','Assinaturas'],
      ['2026-09-12','iFood',-64.80,'saida','Alimentação'],
      ['2026-09-15','Posto Shell',-180,'saida','Transporte'],
      ['2026-09-18','Curso de Inglês',-199,'saida','Educação'],
      ['2026-09-20','Cinema',-56,'saida','Lazer'],
      ['2026-08-01','Salário',3500,'entrada','Trabalho'],
      ['2026-08-02','Supermercado União',-310.20,'saida','Alimentação'],
      ['2026-08-05','Aluguel',-1200,'saida','Moradia'],
      ['2026-08-08','Uber',-38.90,'saida','Transporte'],
      ['2026-08-12','iFood',-58.40,'saida','Alimentação'],
      ['2026-08-15','Farmácia Central',-65.10,'saida','Saúde'],
      ['2026-08-18','Curso de Inglês',-199,'saida','Educação'],
    ].map((t, i) => ({ id: i + 1, data: t[0], descricao: t[1], valor: t[2], tipo: t[3], categoria: t[4], conta: 'Conta Corrente', observacao: '' }));
    localStorage.setItem('lumina_demo_tx', JSON.stringify(tx));
    localStorage.setItem('lumina_demo_goals', JSON.stringify([
      { id: 1, nome: 'Notebook novo', alvo: 4000, guardado: 1500 },
      { id: 2, nome: 'Reserva de emergência', alvo: 10000, guardado: 2750 },
      { id: 3, nome: 'Viagem para o litoral', alvo: 2500, guardado: 900 },
    ]));
    localStorage.setItem('lumina_demo_budgets', JSON.stringify([
      { id: 1, categoria: 'Alimentação', limite: 800 },
      { id: 2, categoria: 'Transporte', limite: 400 },
      { id: 3, categoria: 'Lazer', limite: 250 },
    ]));
  }
  const demo = {
    get tx() { return JSON.parse(localStorage.getItem('lumina_demo_tx') || '[]'); },
    set tx(v) { localStorage.setItem('lumina_demo_tx', JSON.stringify(v)); },
    get goals() { return JSON.parse(localStorage.getItem('lumina_demo_goals') || '[]'); },
    set goals(v) { localStorage.setItem('lumina_demo_goals', JSON.stringify(v)); },
    get budgets() { return JSON.parse(localStorage.getItem('lumina_demo_budgets') || '[]'); },
    set budgets(v) { localStorage.setItem('lumina_demo_budgets', JSON.stringify(v)); },
  };

  const isDemo = () => !!localStorage.getItem(DEMO_KEY);

  // ---------- Categorização automática (espelha o backend) ----------
  const RULES = [
    ['supermercado|mercado|hortifr|padaria|açougue|atacad', 'Alimentação'],
    ['uber|99app|99 pop|cabify|metrô|metrô|ônibus|combust|posto|shell|ipiranga|petrobras|estaciona', 'Transporte'],
    ['aluguel|condomínio|condominio|iptu|energia|água|agua|luz|gás|gas |internet|vivo|claro|tim ', 'Moradia'],
    ['farmácia|farmacia|drogaria|hospital|clínica|clinica|dentista|laborat', 'Saúde'],
    ['netflix|spotify|youtube|prime video|disney|hbo|globoplay|assinatura|mensalidade', 'Assinaturas'],
    ['cinema|streaming|show|teatro|bar |restaurante|lanchonete|pizzaria', 'Lazer'],
    ['curso|escola|faculdade|universidade|livro|udemy|hotmart', 'Educação'],
    ['salário|salario|freela|consultoria|dividendos|reembolso', 'Trabalho'],
  ];
  function categorize(descricao) {
    const d = (descricao || '').toLowerCase();
    for (const [re, cat] of RULES) if (new RegExp(re).test(d)) return cat;
    return 'Outros';
  }

  // ---------- API pública ----------
  return {
    BASE, CATEGORIES, categorize, isDemo, clearSession, demo,

    async register(payload) {
      try {
        return await request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      } catch (e) {
        // Modo demonstração: cria sessão local
        if (e.message.includes('Backend offline')) {
          const users = JSON.parse(localStorage.getItem('lumina_users') || '[]');
          if (users.find(u => u.email === payload.email)) throw new Error('E-mail já cadastrado.');
          users.push({ ...payload, senha: btoa(payload.senha), role: payload.role || 'cliente', created: new Date().toISOString() });
          localStorage.setItem('lumina_users', JSON.stringify(users));
          return { demo: true, msg: 'Conta criada em modo demonstração.' };
        }
        throw e;
      }
    },

    async login(email, senha, role) {
      try {
        const r = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, senha, role }) });
        setSession(r); return r;
      } catch (e) {
        if (e.message.includes('Backend offline')) {
          // Contas demo pré-definidas para os três perfis de acesso
          const demoAccounts = {
            'cliente@lumina.com': { nome: 'Cliente Demo', role: 'cliente' },
            'func@lumina.com': { nome: 'Funcionário Demo', role: 'funcionario' },
            'admin@lumina.com': { nome: 'Admin Demo', role: 'admin' },
          };
          let sess = null;
          if (demoAccounts[email] && senha === 'demo123') sess = demoAccounts[email];
          if (!sess) {
            const users = JSON.parse(localStorage.getItem('lumina_users') || '[]');
            const u = users.find(u => u.email === email && atob(u.senha) === senha);
            if (!u) throw new Error('E-mail ou senha inválidos.');
            if (role && u.role !== role) throw new Error(`Esta conta não possui acesso de ${role}.`);
            sess = { nome: u.nome, role: u.role };
          }
          if (role && sess.role !== role) throw new Error(`Acesso de ${role} não permitido para esta conta.`);
          localStorage.setItem(DEMO_KEY, JSON.stringify({ nome: sess.nome, email, role: sess.role }));
          if (!localStorage.getItem('lumina_demo_tx')) seedDemo();
          return { access_token: 'demo-' + Date.now(), demo: true };
        }
        throw e;
      }
    },

    async me() {
      if (isDemo()) return JSON.parse(localStorage.getItem(DEMO_KEY));
      return request('/api/auth/me');
    },

    logout() { clearSession(); localStorage.removeItem(DEMO_KEY); location.href = 'login.html'; },

    // ----- Transações -----
    async listTransacoes(filtros = {}) {
      if (isDemo()) {
        let tx = demo.tx;
        if (filtros.de) tx = tx.filter(t => t.data >= filtros.de);
        if (filtros.ate) tx = tx.filter(t => t.data <= filtros.ate);
        if (filtros.categoria) tx = tx.filter(t => t.categoria === filtros.categoria);
        if (filtros.tipo) tx = tx.filter(t => t.tipo === filtros.tipo);
        if (filtros.q) tx = tx.filter(t => t.descricao.toLowerCase().includes(filtros.q.toLowerCase()));
        return tx.sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
      }
      const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
      return request('/api/transacoes?' + qs);
    },

    async createTransacao(t) {
      if (isDemo()) {
        const list = demo.tx;
        t.id = Math.max(0, ...list.map(x => x.id)) + 1;
        t.categoria = t.categoria || categorize(t.descricao);
        t.valor = t.tipo === 'saida' && t.valor > 0 ? -Math.abs(t.valor) : Math.abs(t.valor);
        list.push(t); demo.tx = list; return t;
      }
      return request('/api/transacoes', { method: 'POST', body: JSON.stringify(t) });
    },

    async updateTransacao(id, t) {
      if (isDemo()) {
        const list = demo.tx.map(x => x.id === id ? { ...x, ...t } : x);
        demo.tx = list; return list.find(x => x.id === id);
      }
      return request(`/api/transacoes/${id}`, { method: 'PUT', body: JSON.stringify(t) });
    },

    async deleteTransacao(id) {
      if (isDemo()) { demo.tx = demo.tx.filter(x => x.id !== id); return { ok: true }; }
      return request(`/api/transacoes/${id}`, { method: 'DELETE' });
    },

    async importCSV(rows) {
      // rows: [{data, descricao, valor, tipo}]
      if (isDemo()) {
        const list = demo.tx;
        let novas = 0, duplicadas = 0;
        const chaves = new Set(list.map(t => `${t.data}|${t.descricao}|${t.valor}`));
        rows.forEach(r => {
          const chave = `${r.data}|${r.descricao}|${r.valor}`;
          if (chaves.has(chave)) { duplicadas++; return; }
          chaves.add(chave);
          list.push({ id: Math.max(0, ...list.map(x => x.id)) + 1, ...r, categoria: categorize(r.descricao), conta: 'Importado', observacao: '' });
          novas++;
        });
        demo.tx = list;
        return { importadas: novas, duplicadas, total: rows.length };
      }
      return request('/api/importacao/csv', { method: 'POST', body: JSON.stringify({ linhas: rows }) });
    },

    // ----- Dashboard -----
    async dashboard() {
      if (isDemo()) {
        const tx = demo.tx, now = new Date('2026-09-13');
        const mesAtual = tx.filter(t => t.data.startsWith('2026-09'));
        const mesAnt = tx.filter(t => t.data.startsWith('2026-08'));
        const rec = a => a.filter(t => t.tipo === 'entrada').reduce((s, t) => s + Math.abs(t.valor), 0);
        const des = a => a.filter(t => t.tipo === 'saida').reduce((s, t) => s + Math.abs(t.valor), 0);
        const porCat = {};
        mesAtual.filter(t => t.tipo === 'saida').forEach(t => porCat[t.categoria] = (porCat[t.categoria] || 0) + Math.abs(t.valor));
        const alertas = [];
        Object.entries(porCat).forEach(([cat, v]) => {
          const ant = mesAnt.filter(t => t.tipo === 'saida' && t.categoria === cat).reduce((s, t) => s + Math.abs(t.valor), 0);
          if (ant > 0 && v > ant * 1.2) alertas.push({ tipo: 'warning', titulo: `${cat} em alta`, msg: `Seus gastos com ${cat.toLowerCase()} subiram ${Math.round((v / ant - 1) * 100)}% em relação ao mês anterior.` });
        });
        demo.budgets.forEach(b => {
          const gasto = porCat[b.categoria] || 0;
          if (b.limite > 0 && gasto >= b.limite * .9) alertas.push({ tipo: 'danger', titulo: `Orçamento de ${b.categoria}`, msg: `Você já utilizou ${Math.round(gasto / b.limite * 100)}% do orçamento definido para ${b.categoria.toLowerCase()}.` });
        });
        const evolucao = {};
        tx.forEach(t => { const m = t.data.slice(0, 7); evolucao[m] = evolucao[m] || { receitas: 0, despesas: 0 }; evolucao[m][t.tipo === 'entrada' ? 'receitas' : 'despesas'] += Math.abs(t.valor); });
        return {
          saldo: tx.reduce((s, t) => s + t.valor, 0),
          receitas_mes: rec(mesAtual), despesas_mes: des(mesAtual),
          economia_mes: rec(mesAtual) - des(mesAtual),
          por_categoria: porCat, alertas,
          evolucao: Object.entries(evolucao).sort().map(([mes, v]) => ({ mes, ...v })),
        };
      }
      return request('/api/dashboard');
    },

    // ----- Metas / Orçamentos -----
    async listMetas() { return isDemo() ? demo.goals : request('/api/metas'); },
    async createMeta(m) {
      if (isDemo()) { const g = demo.goals; m.id = Math.max(0, ...g.map(x => x.id)) + 1; g.push(m); demo.goals = g; return m; }
      return request('/api/metas', { method: 'POST', body: JSON.stringify(m) });
    },
    async updateMeta(id, m) {
      if (isDemo()) { demo.goals = demo.goals.map(x => x.id === id ? { ...x, ...m } : x); return { ok: true }; }
      return request(`/api/metas/${id}`, { method: 'PUT', body: JSON.stringify(m) });
    },
    async deleteMeta(id) {
      if (isDemo()) { demo.goals = demo.goals.filter(x => x.id !== id); return { ok: true }; }
      return request(`/api/metas/${id}`, { method: 'DELETE' });
    },
    async listOrcamentos() { return isDemo() ? demo.budgets : request('/api/orcamentos'); },
    async createOrcamento(o) {
      if (isDemo()) { const b = demo.budgets; o.id = Math.max(0, ...b.map(x => x.id)) + 1; b.push(o); demo.budgets = b; return o; }
      return request('/api/orcamentos', { method: 'POST', body: JSON.stringify(o) });
    },
    async deleteOrcamento(id) {
      if (isDemo()) { demo.budgets = demo.budgets.filter(x => x.id !== id); return { ok: true }; }
      return request(`/api/orcamentos/${id}`, { method: 'DELETE' });
    },

    // ----- Relatórios -----
    async relatorio(ano, mes) {
      if (isDemo()) {
        const tx = demo.tx.filter(t => t.data.startsWith(`${ano}-${String(mes).padStart(2, '0')}`));
        const rec = tx.filter(t => t.tipo === 'entrada').reduce((s, t) => s + Math.abs(t.valor), 0);
        const des = tx.filter(t => t.tipo === 'saida').reduce((s, t) => s + Math.abs(t.valor), 0);
        const porCat = {};
        tx.filter(t => t.tipo === 'saida').forEach(t => porCat[t.categoria] = (porCat[t.categoria] || 0) + Math.abs(t.valor));
        return {
          receitas: rec, despesas: des, saldo: rec - des,
          maiores_categorias: Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([categoria, total]) => ({ categoria, total })),
          transacoes: tx,
        };
      }
      return request(`/api/relatorios/mensal?ano=${ano}&mes=${mes}`);
    },

    // ----- Admin / Funcionário -----
    async adminStats() {
      if (isDemo()) {
        const users = JSON.parse(localStorage.getItem('lumina_users') || '[]');
        return {
          usuarios: users.length || 42, ativos_mes: users.length || 35,
          receita_mrr: 1284.50, importacoes_mes: 890,
          ultimos_usuarios: users.length ? users.slice(-8).reverse() : [
            { nome: 'Mariana Duarte', email: 'mariana@email.com', plano: 'Pro', criado: '2026-09-11' },
            { nome: 'Rafael Lima', email: 'rafael@email.com', plano: 'Essencial', criado: '2026-09-10' },
            { nome: 'Juliana Alves', email: 'ju.alves@email.com', plano: 'Business', criado: '2026-09-08' },
          ],
        };
      }
      return request('/api/admin/stats');
    },
    async funcionarioFila() {
      if (isDemo()) return [
        { id: 1, usuario: 'Mariana Duarte', assunto: 'Importação CSV rejeitada', status: 'aberto', criado: '2026-09-12' },
        { id: 2, usuario: 'Rafael Lima', assunto: 'Dúvida sobre plano Pro', status: 'aberto', criado: '2026-09-12' },
        { id: 3, usuario: 'João Souza', assunto: 'Exportação de relatório em PDF', status: 'andamento', criado: '2026-09-11' },
        { id: 4, usuario: 'Ana Costa', assunto: 'Correção de categoria em lote', status: 'resolvido', criado: '2026-09-09' },
      ];
      return request('/api/funcionario/chamados');
    },

    fmt: v => (v < 0 ? '-' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    parseCSV: text => {
      const lines = text.trim().split(/\r?\n/);
      const header = lines[0].toLowerCase().split(',').map(h => h.trim());
      const col = n => header.findIndex(h => h.includes(n));
      const iData = col('data'), iDesc = col('descricao') > -1 ? col('descricao') : col('descri'), iVal = col('valor'), iTipo = col('tipo');
      return lines.slice(1).filter(l => l.trim()).map(l => {
        const c = l.split(',').map(x => x.trim());
        let data = c[iData];
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(data)) { const [d, m, a] = data.split('/'); data = `${a}-${m}-${d}`; }
        const valor = parseFloat(c[iVal].replace(/[R$\s]/g, '').replace('.', '').replace(',', '.')) || parseFloat(c[iVal]);
        const tipo = (c[iTipo] || (valor < 0 ? 'saida' : 'entrada')).toLowerCase();
        return { data, descricao: c[iDesc], valor: Math.abs(valor), tipo: tipo.includes('ent') || valor > 0 && !c[iTipo] ? 'entrada' : 'saida' };
      }).filter(r => r.data && r.descricao && !isNaN(r.valor));
    },
  };
})();
