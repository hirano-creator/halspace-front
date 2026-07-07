'use strict';

const user = requireSpaceAuth();
if (user) {
  renderSidebarUser(user);

  let allProjects = [];
  let activeCardFilter = ''; // サマリーカードによる絞り込み

  /* 発注者：top-barに会社名表示 */
  if (!isAdmin(user) && !isModeler(user)) {
    const label = document.getElementById('companyLabel');
    const name = user.company_name ?? user.company;
    if (label && name) label.textContent = name;
  }

  /* 管理者・モデラー：会社フィルタ表示（管理リンクは管理者のみ） */
  if (isAdmin(user) || isModeler(user)) {
    document.getElementById('companyFilter').style.display = '';
  }
  if (isAdmin(user)) {
    document.getElementById('adminLink').style.display     = '';
    const adminNav = document.getElementById('adminNav');
    if (adminNav) adminNav.style.display = '';
  }

  /* 発注者（管理者でもモデラーでもない一般会員）は担当モデラー列・フィルタを非表示 */
  if (!isAdmin(user) && !isModeler(user)) {
    const modelerCol = document.getElementById('modelerCol');
    if (modelerCol) modelerCol.style.display = 'none';
  } else {
    document.getElementById('modelerFilter').style.display = '';
  }

  /* ── 会社フィルタ選択肢 ──
     モデラーは/admin/companiesにアクセスできない（管理者専用API）ため、
     モデラー向けの選択肢はloadProjects()内でプロジェクトデータから生成する。 */
  async function loadCompanyFilter() {
    if (!isAdmin(user)) return;
    try {
      const data = await api.get('/admin/companies');
      (data?.companies ?? MOCK.companies).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        document.getElementById('companyFilter').appendChild(opt);
      });
    } catch {
      MOCK.companies.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        document.getElementById('companyFilter').appendChild(opt);
      });
    }
  }

  /* ── プロジェクト取得 ── */
  async function loadProjects() {
    const cf = document.getElementById('companyFilter')?.value;
    try {
      const params = cf ? `?company_id=${cf}` : '';
      const data = await api.get('/projects' + params);
      allProjects = data?.projects ?? MOCK.projects;
    } catch {
      allProjects = MOCK.projects;
    }
    /* モデラー：会社フィルタの選択肢を更新。
       絞り込み済みのallProjectsからは全社分の選択肢を復元できないため、
       会社フィルタが未選択（＝全件取得）のときだけ選択肢を作り直す。
       /admin/companiesは管理者専用APIのためモデラーは呼べない。 */
    if (isModeler(user) && !isAdmin(user) && !cf) {
      const sel = document.getElementById('companyFilter');
      const cur = sel.value;
      sel.innerHTML = '<option value="">すべての会社</option>';
      const companies = [...new Map(
        allProjects
          .filter(p => p.company_id != null)
          .map(p => [p.company_id, p.company_name ?? p.company])
      ).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ja'));
      companies.forEach(([id, name]) => {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = name;
        if (String(id) === cur) opt.selected = true;
        sel.appendChild(opt);
      });
    }
    /* モデラーフィルタの選択肢を更新 */
    if (isAdmin(user) || isModeler(user)) {
      const sel = document.getElementById('modelerFilter');
      const cur = sel.value;
      sel.innerHTML = '<option value="">すべての担当モデラー</option>';
      const names = [...new Set(
        allProjects.map(p => p.modeler_name ?? p.modeler).filter(Boolean)
      )].sort();
      names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        if (name === cur) opt.selected = true;
        sel.appendChild(opt);
      });
      /* 未割当オプション */
      const unassigned = document.createElement('option');
      unassigned.value = '__unassigned__'; unassigned.textContent = '未割当';
      if (cur === '__unassigned__') unassigned.selected = true;
      sel.appendChild(unassigned);
    }
    renderTable();
  }

  /* ── サマリーカード ── */
  function renderSummary(ps) {
    const today = new Date();
    const in3d  = new Date(today.getTime() + 3 * 86400000);
    document.getElementById('countProgress').textContent =
      ps.filter(p => p.status === 'in_progress').length;
    document.getElementById('countReview').textContent =
      ps.filter(p => p.status === 'review_pending').length;
    document.getElementById('countAlert').textContent =
      ps.filter(p => p.deadline_requested && new Date(p.deadline_requested) <= in3d
                     && !['delivered', 'cancelled'].includes(p.status)).length;
    document.getElementById('countDelivered').textContent =
      ps.filter(p => p.status === 'delivered' &&
                     p.created_at?.startsWith(new Date().toISOString().slice(0, 7))).length;
  }

  const STATUS_LABEL = {
    draft:'下書き', submitted:'提出済み', in_progress:'モデリング中',
    review_pending:'検査待ち', revision_requested:'修正依頼中',
    approved:'承認済み', delivered:'納品完了', cancelled:'キャンセル',
  };
  const PRIORITY_LABEL = { urgent:'緊急', high:'高', normal:'通常', low:'低' };

  /* ── テーブル描画 ── */
  function renderTable() {
    const status   = document.getElementById('statusFilter').value;
    const priority = document.getElementById('priorityFilter').value;
    const modeler  = document.getElementById('modelerFilter')?.value ?? '';
    const search   = document.getElementById('searchInput').value.toLowerCase();
    const today    = new Date();
    const in3d     = new Date(today.getTime() + 3 * 86400000);
    const thisMonth = new Date().toISOString().slice(0, 7);

    let ps = [...allProjects];

    /* サマリーカードフィルタ（他フィルタより優先） */
    if (activeCardFilter === 'in_progress') {
      ps = ps.filter(p => p.status === 'in_progress');
    } else if (activeCardFilter === 'review_pending') {
      ps = ps.filter(p => p.status === 'review_pending');
    } else if (activeCardFilter === 'alert') {
      ps = ps.filter(p => p.deadline_requested && new Date(p.deadline_requested) <= in3d
                          && !['delivered','cancelled'].includes(p.status));
    } else if (activeCardFilter === 'delivered') {
      ps = ps.filter(p => p.status === 'delivered' && (p.created_at||'').startsWith(thisMonth));
    } else {
      if (status)   ps = ps.filter(p => p.status === status);
    }

    if (priority) ps = ps.filter(p => p.priority === priority);
    if (modeler === '__unassigned__') {
      ps = ps.filter(p => !(p.modeler_name ?? p.modeler));
    } else if (modeler) {
      ps = ps.filter(p => (p.modeler_name ?? p.modeler) === modeler);
    }
    if (search)   ps = ps.filter(p =>
      p.project_code.toLowerCase().includes(search) ||
      p.title.toLowerCase().includes(search));

    const tbody = document.getElementById('projectBody');
    const empty = document.getElementById('emptyMsg');
    tbody.innerHTML = '';
    empty.style.display = ps.length ? 'none' : '';

    ps.forEach(p => {
      const isAlert = p.deadline_requested && new Date(p.deadline_requested) <= in3d
                      && !['delivered', 'cancelled'].includes(p.status);

      /* 回答納期セル（APIフィールド: deadline_reply_status / deadline_replied） */
      const replyStatus = p.deadline_reply_status ?? p.deadline_reply?.status;
      const replyDate   = p.deadline_replied ?? p.deadline_reply?.date;
      let replyCell;
      if (!replyDate) {
        replyCell = '<span style="color:var(--muted);font-size:12px;">未回答</span>';
      } else if (replyStatus === 'ok') {
        replyCell = `<span style="color:var(--accent);font-weight:700;">${replyDate}</span>
                     <i class="fa-solid fa-circle-check" style="color:var(--accent);margin-left:4px;" title="対応可能"></i>`;
      } else if (replyStatus === 'negotiating') {
        replyCell = `<span style="color:var(--danger);font-weight:700;">${replyDate}</span>
                     <i class="fa-solid fa-arrows-rotate" style="color:var(--danger);margin-left:4px;" title="要調整"></i>`;
      } else {
        replyCell = replyDate || '—';
      }

      const companyName = p.company_name ?? p.company ?? '—';
      const modelerName = p.modeler_name ?? p.modeler;

      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => { location.href = `project-detail.html?id=${p.id}`; });
      tr.innerHTML = `
        <td style="font-size:13px;color:var(--muted);white-space:nowrap;">${(p.created_at||'—').slice(0,10)}</td>
        <td style="white-space:nowrap;"><code style="font-size:12px;color:var(--blue);">${p.project_code}</code></td>
        <td style="min-width:120px;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-weight:600;color:var(--dark);">${p.title}</span>
            ${isAlert ? '<i class="fa-solid fa-triangle-exclamation text-danger" title="期限間近"></i>' : ''}
          </div>
          ${(isAdmin(user) || isModeler(user)) ? `<span class="project-company-label" style="font-size:11px;color:var(--muted);">${companyName}</span>` : ''}
        </td>
        <td style="white-space:nowrap;"><span class="badge badge-${p.status}">${STATUS_LABEL[p.status]||p.status}</span></td>
        <td style="white-space:nowrap;"><span class="priority-${p.priority}">${PRIORITY_LABEL[p.priority]||p.priority}</span></td>
        <td style="font-size:13px;white-space:nowrap;${isAlert?'color:var(--danger);font-weight:700;':''}">${p.deadline_requested||'—'}</td>
        <td style="font-size:13px;white-space:nowrap;">${replyCell}</td>
        ${isAdmin(user) || isModeler(user) ? `<td style="font-size:13px;white-space:nowrap;">${modelerName||'<span style="color:var(--muted)">未割当</span>'}</td>` : ''}`;
      tbody.appendChild(tr);
    });
    renderSummary(allProjects);
  }

  /* サマリーカードのクリックでフィルタ */
  document.querySelectorAll('.summary-card[data-filter]').forEach(card => {
    card.addEventListener('click', () => {
      const f = card.dataset.filter;
      if (activeCardFilter === f) {
        /* 同じカードを再クリックで解除 */
        activeCardFilter = '';
        document.querySelectorAll('.summary-card').forEach(c => c.classList.remove('active'));
      } else {
        activeCardFilter = f;
        document.querySelectorAll('.summary-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        /* ステータスフィルタをリセット */
        document.getElementById('statusFilter').value = '';
      }
      /* 一覧へスクロール */
      document.querySelector('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      renderTable();
    });
  });

  document.getElementById('statusFilter').addEventListener('change', () => {
    activeCardFilter = '';
    document.querySelectorAll('.summary-card').forEach(c => c.classList.remove('active'));
    loadProjects();
  });
  document.getElementById('priorityFilter').addEventListener('change', renderTable);
  document.getElementById('modelerFilter')?.addEventListener('change', renderTable);
  document.getElementById('searchInput').addEventListener('input', renderTable);
  document.getElementById('companyFilter')?.addEventListener('change', loadProjects);

  loadCompanyFilter().then(() => loadProjects());

  // タブ表示中は30秒ごと＋タブ復帰時に即時、一覧を自動更新
  startAutoRefresh(loadProjects, 30000);
}
