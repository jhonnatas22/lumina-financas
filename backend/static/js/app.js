/* Dashboard do cliente — Lumina Finanças */
const App = (() => {
  let charts = {};
  const $ = s => document.querySelector(s);
  const CHART_COLORS = ['#6366f1','#22c55e','#f59e0b','#ec4899','#0ea5e9','#a855f7','#14b8a6','#f97316','#94a3b8'];
  const NOME_MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  let dadosDashboard = null;

  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.className = err ? 'toast err' : 'toast';
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3200);
  }

  function brl(v) { return API.fmt(v); }
  function dBr(iso) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; }
  function catChip(cat) {
    const slug = (cat || 'outros').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return `<span class="chip cat-${slug}">${cat || 'Outros'}</span>`;
  }
  function esc(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  // ---------- Navegação ----------
  function switchView(v) {
    ['dashboard','transacoes','importar','metas','orcamentos','relatorios'].forEach(x => {
      $('#view-' + x).style.display = x === v ? '' : 'none';
    });
    document.querySelectorAll('.side-nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
    $('#viewTitle').textContent = { dashboard:'Dashboard', transacoes:'Transações', importar:'Importar extrato', metas:'Metas financeiras', orcamentos:'Orçamentos', relatorios:'Relatórios' }[v];
    $('#sidebar').classList.remove('open');
    if (v === 'dashboard') carregarDashboard();
    if (v === 'transacoes') carregarTransacoes();
    if (v === 'metas') carregarMetas();
    if (v === 'orcamentos') carregarOrcamentos();
  }

  // ---------- Dashboard ----------
  async function carregarDashboard() {
    try {
      const d = dadosDashboard = await API.dashboard();
      $('#kSaldo').textContent = brl(d.saldo);
      $('#kRec').textContent = brl(d.receitas_mes);
      $('#kDes').textContent = brl(d.despesas_mes);
      $('#kEco').textContent = brl(d.economia_mes);
      const pct = d.receitas_mes > 0 ? Math.round(d.economia_mes / d.receitas_mes * 100) : 0;
      const tag = $('#kEcoPct');
      tag.textContent = pct + '%';
      tag.className = 'tag ' + (pct >= 0 ? 'pos' : 'neg');

      // Alertas
      const al = $('#alertList');
      if (!d.alertas.length) {
        al.innerHTML = `<div class="alert-item info"><strong>Tudo sob controle ✓</strong><span>Nenhum alerta no momento. Seus gastos estão dentro do esperado.</span></div>`;
      } else {
        al.innerHTML = d.alertas.map(a => `<div class="alert-item ${a.tipo === 'danger' ? 'danger' : ''}">
          <span class="alert-icon">${a.tipo === 'danger' ? '⛔' : '⚠'}</span>
          <div><strong>${esc(a.titulo)}</strong><span>${esc(a.msg)}</span></div></div>`).join('');
      }

      renderCharts(d);

      // Últimas movimentações
      const tx = (await API.listTransacoes()).slice(0, 6);
      $('#tbUltimas').innerHTML = tx.map(t => `<tr>
        <td>${dBr(t.data)}</td><td>${esc(t.descricao)}</td><td>${catChip(t.categoria)}</td>
        <td style="color:var(--muted)">${esc(t.conta || '—')}</td>
        <td style="text-align:right" class="${t.valor >= 0 ? 'val-pos' : 'val-neg'}">${brl(t.valor)}</td></tr>`).join('') ||
        `<tr><td colspan="5" style="text-align:center;color:var(--muted)">Nenhuma movimentação ainda — importe seu extrato.</td></tr>`;
    } catch (e) { toast(e.message, true); }
  }

  function renderCharts(d) {
    Chart.defaults.color = '#9aa4c0';
    Chart.defaults.font.family = 'Inter, sans-serif';
    const cats = Object.keys(d.por_categoria), vals = Object.values(d.por_categoria);

    if (charts.donut) charts.donut.destroy();
    charts.donut = new Chart($('#chartDonut'), {
      type: 'doughnut',
      data: { labels: cats, datasets: [{ data: vals, backgroundColor: CHART_COLORS, borderColor: '#151d31', borderWidth: 3 }] },
      options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => ` ${c.label}: ${brl(c.parsed)}` } } } },
    });

    if (charts.line) charts.line.destroy();
    charts.line = new Chart($('#chartLine'), {
      type: 'bar',
      data: {
        labels: d.evolucao.map(e => NOME_MESES[+e.mes.split('-')[1] - 1]),
        datasets: [
          { label: 'Receitas', data: d.evolucao.map(e => e.receitas), backgroundColor: '#22c55e', borderRadius: 6, barPercentage: .55 },
          { label: 'Despesas', data: d.evolucao.map(e => e.despesas), backgroundColor: '#6366f1', borderRadius: 6, barPercentage: .55 },
        ],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { usePointStyle: true } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${brl(c.parsed.y)}` } } }, scales: { y: { grid: { color: 'rgba(255,255,255,.06)' } }, x: { grid: { display: false } } } },
    });
  }

  // ---------- Transações ----------
  async function carregarTransacoes() {
    const filtros = {
      de: $('#fDe').value, ate: $('#fAte').value,
      categoria: $('#fCat').value, tipo: $('#fTipo').value, q: $('#fQ').value,
    };
    const vmax = parseFloat($('#fVal').value);
    try {
      let tx = await API.listTransacoes(filtros);
      if (!isNaN(vmax)) tx = tx.filter(t => Math.abs(t.valor) <= vmax);
      $('#tbTransacoes').innerHTML = tx.map(t => `<tr>
        <td>${dBr(t.data)}</td>
        <td>${esc(t.descricao)}${t.observacao ? `<br><small style="color:var(--muted)">${esc(t.observacao)}</small>` : ''}</td>
        <td>${catChip(t.categoria)}</td>
        <td style="color:var(--muted)">${esc(t.conta || '—')}</td>
        <td style="text-align:right" class="${t.valor >= 0 ? 'val-pos' : 'val-neg'}">${brl(t.valor)}</td>
        <td><div class="row-actions">
          <button onclick="App.editarTransacao(${t.id})">Editar</button>
          <button class="del" onclick="App.excluirTransacao(${t.id})">Excluir</button>
        </div></td></tr>`).join('') ||
        `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:26px">Nenhuma movimentação encontrada para os filtros aplicados.</td></tr>`;
    } catch (e) { toast(e.message, true); }
  }

  function fillCategorias(sel) {
    sel.innerHTML = API.CATEGORIES.map(c => `<option>${c}</option>`).join('');
  }

  function modal(title, bodyHTML, onConfirm) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modal').classList.add('open');
    $('#modalConfirm').onclick = async () => {
      try { await onConfirm(); fecharModal(); } catch (e) { toast(e.message, true); }
    };
  }
  function fecharModal() { $('#modal').classList.remove('open'); }

  function novaTransacao() {
    modal('Nova movimentação', `
      <div class="field"><label>Descrição</label><input id="mDesc" placeholder="Ex.: Compra de material"></div>
      <div class="field-row">
        <div class="field"><label>Valor (R$)</label><input id="mValor" type="number" step="0.01" min="0" placeholder="250,00"></div>
        <div class="field"><label>Data</label><input id="mData" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Tipo</label><select id="mTipo"><option value="saida">Despesa</option><option value="entrada">Receita</option></select></div>
        <div class="field"><label>Categoria</label><select id="mCat"></select></div>
      </div>
      <div class="field"><label>Conta</label><input id="mConta" placeholder="Ex.: Conta Corrente"></div>
      <div class="field"><label>Observação</label><textarea id="mObs" rows="2" placeholder="Opcional"></textarea></div>`, async () => {
      const desc = $('#mDesc').value.trim();
      const valor = parseFloat($('#mValor').value);
      if (!desc || isNaN(valor) || valor <= 0) throw new Error('Informe descrição e valor válidos.');
      const tipo = $('#mTipo').value;
      await API.createTransacao({
        data: $('#mData').value, descricao: desc, valor,
        tipo, categoria: $('#mCat').value || API.categorize(desc),
        conta: $('#mConta').value.trim() || 'Manual', observacao: $('#mObs').value.trim(),
      });
      toast('Movimentação criada com sucesso.');
      carregarDashboard(); carregarTransacoes();
    });
    fillCategorias($('#mCat'));
  }

  async function editarTransacao(id) {
    const tx = (await API.listTransacoes()).find(t => t.id === id);
    if (!tx) return;
    modal('Editar movimentação', `
      <div class="field"><label>Descrição</label><input id="mDesc" value="${esc(tx.descricao)}"></div>
      <div class="field-row">
        <div class="field"><label>Valor (R$)</label><input id="mValor" type="number" step="0.01" min="0" value="${Math.abs(tx.valor)}"></div>
        <div class="field"><label>Data</label><input id="mData" type="date" value="${tx.data}"></div>
      </div>
      <div class="field"><label>Categoria</label><select id="mCat"></select></div>
      <div class="field"><label>Observação</label><textarea id="mObs" rows="2">${esc(tx.observacao || '')}</textarea></div>`, async () => {
      await API.updateTransacao(id, {
        data: $('#mData').value, descricao: $('#mDesc').value.trim(),
        valor: parseFloat($('#mValor').value), categoria: $('#mCat').value,
        observacao: $('#mObs').value.trim(),
      });
      toast('Movimentação atualizada.');
      carregarDashboard(); carregarTransacoes();
    });
    const sel = $('#mCat'); fillCategorias(sel); sel.value = tx.categoria;
  }

  async function excluirTransacao(id) {
    if (!confirm('Excluir esta movimentação?')) return;
    await API.deleteTransacao(id);
    toast('Movimentação excluída.');
    carregarDashboard(); carregarTransacoes();
  }

  // ---------- Importação CSV ----------
  function setupUpload() {
    const zone = $('#upZone'), input = $('#fileCSV');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer.files[0]) processarArquivo(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => { if (input.files[0]) processarArquivo(input.files[0]); input.value = ''; });
  }

  async function processarArquivo(file) {
    if (!file.name.endsWith('.csv')) { toast('Envie um arquivo .csv', true); return; }
    try {
      const rows = API.parseCSV(await file.text());
      if (!rows.length) throw new Error('Nenhuma linha válida encontrada no arquivo.');
      const r = await API.importCSV(rows);
      $('#importResult').style.display = 'block';
      $('#impTitulo').textContent = 'Importação concluída';
      $('#impDetalhe').textContent = `${file.name} processado — validação, conversão de datas/valores e deduplicação aplicadas.`;
      $('#impTotal').textContent = r.total ?? rows.length;
      $('#impNovas').textContent = r.importadas ?? rows.length;
      $('#impDup').textContent = r.duplicadas ?? 0;
      $('#impCat').textContent = r.importadas ?? rows.length;
      dadosDashboard = null;
      toast(`${r.importadas ?? rows.length} movimentações importadas.`);
    } catch (e) { toast(e.message, true); }
  }

  function baixarExemplo() {
    const csv = 'data,descricao,valor,tipo\n01/09/2026,Salário,3500.00,entrada\n02/09/2026,Supermercado União,-350.50,saida\n03/09/2026,Internet,-99.90,saida\n05/09/2026,Aluguel,-1200.00,saida\n06/09/2026,Uber,-42.30,saida\n08/09/2026,Farmácia Central,-87.40,saida\n10/09/2026,Netflix,-39.90,saida\n12/09/2026,iFood,-64.80,saida';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'extrato_exemplo.csv'; a.click();
  }

  // ---------- Metas ----------
  async function carregarMetas() {
    const goals = await API.listMetas();
    $('#goalsGrid').innerHTML = goals.map(g => {
      const pct = Math.min(100, Math.round(g.guardado / g.alvo * 100));
      return `<div class="goal-tile">
        <h4>${esc(g.nome)}</h4>
        <div class="goal-bar"><span style="width:${pct}%"></span></div>
        <div class="goal-meta"><span>${brl(g.guardado)} de ${brl(g.alvo)}</span><b>${pct}%</b></div>
        <div class="row-actions" style="margin-top:12px">
          <button onclick="App.aportarMeta(${g.id})">+ Aporte</button>
          <button class="del" onclick="App.excluirMeta(${g.id})">Excluir</button>
        </div>
      </div>`;
    }).join('') || '<p style="color:var(--muted)">Nenhuma meta criada ainda.</p>';
  }
  function novaMeta() {
    modal('Nova meta financeira', `
      <div class="field"><label>Nome da meta</label><input id="mNome" placeholder="Ex.: Notebook novo"></div>
      <div class="field-row">
        <div class="field"><label>Valor necessário (R$)</label><input id="mAlvo" type="number" step="0.01" min="0"></div>
        <div class="field"><label>Já guardado (R$)</label><input id="mGuardado" type="number" step="0.01" min="0" value="0"></div>
      </div>`, async () => {
      await API.createMeta({ nome: $('#mNome').value.trim(), alvo: parseFloat($('#mAlvo').value), guardado: parseFloat($('#mGuardado').value) || 0 });
      toast('Meta criada.'); carregarMetas();
    });
  }
  async function aportarMeta(id) {
    const goals = await API.listMetas();
    const g = goals.find(x => x.id === id); if (!g) return;
    modal(`Aporte — ${g.nome}`, `
      <div class="field"><label>Valor do aporte (R$)</label><input id="mAporte" type="number" step="0.01" min="0" value="100"></div>`, async () => {
      await API.updateMeta(id, { guardado: g.guardado + (parseFloat($('#mAporte').value) || 0) });
      toast('Aporte registrado.'); carregarMetas();
    });
  }
  async function excluirMeta(id) {
    if (!confirm('Excluir esta meta?')) return;
    await API.deleteMeta(id); toast('Meta excluída.'); carregarMetas();
  }

  // ---------- Orçamentos ----------
  async function carregarOrcamentos() {
    const budgets = await API.listOrcamentos();
    let gastos = {};
    if (dadosDashboard) gastos = dadosDashboard.por_categoria;
    else { try { gastos = (await API.dashboard()).por_categoria; } catch (e) {} }
    $('#budgetList').innerHTML = budgets.map(b => {
      const g = gastos[b.categoria] || 0;
      const pct = b.limite > 0 ? Math.round(g / b.limite * 100) : 0;
      return `<div class="alert-item ${pct >= 90 ? 'danger' : pct >= 70 ? '' : 'info'}">
        <span class="alert-icon">${pct >= 90 ? '⛔' : '◔'}</span>
        <div style="flex:1"><strong>${esc(b.categoria)} — ${brl(g)} de ${brl(b.limite)} (${pct}%)</strong>
        <div class="goal-bar" style="margin-top:8px"><span style="width:${Math.min(100, pct)}%;${pct >= 90 ? 'background:linear-gradient(90deg,#ef4444,#f87171)' : ''}"></span></div></div>
        <button class="btn btn-danger btn-sm" onclick="App.excluirOrcamento(${b.id})">Excluir</button>
      </div>`;
    }).join('') || '<p style="color:var(--muted)">Nenhum orçamento definido.</p>';
  }
  function novoOrcamento() {
    modal('Novo orçamento mensal', `
      <div class="field"><label>Categoria</label><select id="mCat"></select></div>
      <div class="field"><label>Limite mensal (R$)</label><input id="mLimite" type="number" step="0.01" min="0"></div>`, async () => {
      await API.createOrcamento({ categoria: $('#mCat').value, limite: parseFloat($('#mLimite').value) });
      toast('Orçamento criado.'); carregarOrcamentos();
    });
    fillCategorias($('#mCat'));
  }
  async function excluirOrcamento(id) {
    await API.deleteOrcamento(id); toast('Orçamento removido.'); carregarOrcamentos();
  }

  // ---------- Relatórios ----------
  async function gerarRelatorio() {
    try {
      const r = await API.relatorio($('#relAno').value, $('#relMes').value);
      $('#relResult').style.display = 'block';
      $('#relRec').textContent = brl(r.receitas);
      $('#relDes').textContent = brl(r.despesas);
      $('#relSaldo').textContent = brl(r.saldo);
      const max = Math.max(...r.maiores_categorias.map(c => c.total), 1);
      $('#relCats').innerHTML = r.maiores_categorias.map((c, i) => `<tr>
        <td>${i + 1}</td><td>${catChip(c.categoria)} ${esc(c.categoria)}</td>
        <td style="text-align:right" class="val-neg">${brl(-c.total)}</td>
        <td><div class="goal-bar" style="margin:0"><span style="width:${c.total / max * 100}%"></span></div></td></tr>`).join('') ||
        '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sem despesas no período.</td></tr>';
    } catch (e) { toast(e.message, true); }
  }
  async function exportarCSV() {
    const tx = await API.listTransacoes();
    const csv = ['data,descricao,valor,tipo,categoria,conta',
      ...tx.map(t => [t.data, `"${t.descricao}"`, t.valor, t.tipo, t.categoria, `"${t.conta || ''}"`].join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'transacoes_lumina.csv'; a.click();
    toast('CSV exportado.');
  }
  function exportarPDF() { window.print(); }

  // ---------- Init ----------
  async function init() {
    if (!localStorage.getItem('lumina_token')) { location.href = 'login.html'; return; }
    $('#hoje').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    try {
      const me = await API.me();
      if (me.role === 'admin') { location.href = 'admin.html'; return; }
      if (me.role === 'funcionario') { location.href = 'funcionario.html'; return; }
      $('#userName').textContent = me.nome || 'Cliente';
      $('#userEmail').textContent = me.email || '';
      $('#userAvatar').textContent = (me.nome || 'C')[0].toUpperCase();
    } catch (e) { /* mantém sessão demo */ }

    document.querySelectorAll('.side-nav a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); switchView(a.dataset.view); }));
    const fCat = $('#fCat');
    fCat.innerHTML = '<option value="">Todas</option>' + API.CATEGORIES.map(c => `<option>${c}</option>`).join('');
    setupUpload();
    carregarDashboard();
  }
  document.addEventListener('DOMContentLoaded', init);

  return { switchView, novaTransacao, editarTransacao, excluirTransacao, fecharModal, baixarExemplo,
           carregarTransacoes, carregarDashboard, carregarOrcamentos, carregarMetas,
           novaMeta, aportarMeta, excluirMeta, novoOrcamento, excluirOrcamento,
           gerarRelatorio, exportarCSV, exportarPDF };
})();
