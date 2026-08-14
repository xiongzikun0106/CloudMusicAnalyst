/* ========================================
   战斗 BGM 属性卡 - 前端交互
   ======================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // DOM
  const input = $('battleInput');
  const goBtn = $('battleGoBtn');
  const errorEl = $('battleError');
  const resultEl = $('battleResult');
  const candidatesEl = $('battleCandidates');
  const candidatesListEl = $('battleCandidatesList');
  const candidatesCancelBtn = $('battleCandidatesCancel');

  // 元素图标映射
  const ELEMENT_ICONS = {
    '火': '🔥', '水': '💧', '风': '🌪️', '雷': '⚡',
    '木': '🌿', '暗': '🌑', '其他': '🎵',
  };

  let lastCard = null;
  let lastReviewContext = null;
  let countdownTimer = null;
  let reviewRegenerating = false;

  // ---------- 工具 ----------
  function showError(msg) { errorEl.textContent = msg; }
  function clearError() { errorEl.textContent = ''; }

  function showLoading(text) {
    $('loadingText').textContent = text || '加载中...';
    $('loading').style.display = 'flex';
  }
  function hideLoading() { $('loading').style.display = 'none'; }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function fmt(val, digits) {
    if (val == null || isNaN(val)) return '--';
    return Number(val).toFixed(digits == null ? 2 : digits);
  }

  function fmtPercent(val) {
    if (val == null || isNaN(val)) return '--';
    return (Number(val) * 100).toFixed(1) + '%';
  }

  // ---------- 波形图 ----------
  function drawWaveform(wave) {
    const svg = $('waveformSvg');
    const empty = $('waveEmpty');
    const badge = $('waveBadge');
    svg.innerHTML = '';
    if (!wave || wave.length === 0) {
      empty.style.display = 'block';
      badge.textContent = '降级（无音频）';
      return;
    }
    empty.style.display = 'none';
    badge.textContent = '音频分析';

    const W = 600, H = 80;
    const mid = H / 2;
    const step = wave.length > 1 ? (W / (wave.length - 1)) : W;
    const points = [];
    wave.forEach((v, i) => {
      const x = i * step;
      const h = Math.max(2, v * (H - 10));
      points.push(`M${x},${mid - h / 2} L${x},${mid + h / 2}`);
    });
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    points.forEach((p) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', p);
      line.setAttribute('stroke', 'var(--primary)');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linecap', 'round');
      g.appendChild(line);
    });
    svg.appendChild(g);
  }

  // ---------- 冷却倒计时 ----------
  function startCountdown(seconds) {
    if (countdownTimer) clearInterval(countdownTimer);
    const el = $('cdCountdown');
    let remain = seconds;
    el.textContent = `⏱ ${formatTime(remain)}`;
    countdownTimer = setInterval(() => {
      remain -= 1;
      if (remain <= 0) {
        clearInterval(countdownTimer);
        el.textContent = '🔥 冷却完毕';
      } else {
        el.textContent = `⏱ ${formatTime(remain)}`;
      }
    }, 1000);
  }
  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}分${String(sec).padStart(2, '0')}秒`;
  }

  // ---------- 排面渲染 ----------
  const DIM_LABELS = {
    attack_speed: '攻速',
    burst: '爆发力',
    bpm: 'BPM',
    chorus_ratio: '副歌占比',
    cooldown_seconds: '冷却',
  };

  function renderRanking(ranking) {
    if (!ranking) return;
    $('rankSampleCount').textContent = ranking.sample_count;
    $('rankNote').textContent = ranking.note || '';

    // 综合战力
    const ov = ranking.overall || {};
    $('rankOverallScore').textContent = fmt(ov.score, 2);
    $('rankOverallRank').textContent = `第 ${ov.rank || 1} 名 · 百分位 ${fmt(ov.percentile, 1)}%`;

    // 单项
    const dims = ranking.dimensions || {};
    const dimsEl = $('rankDims');
    dimsEl.innerHTML = '';
    Object.entries(dims).forEach(([key, d]) => {
      const label = DIM_LABELS[key] || key;
      const row = document.createElement('div');
      row.className = 'rank-dim-row';
      row.innerHTML = `
        <div class="rank-dim-label">${label}</div>
        <div class="rank-dim-bar">
          <div class="rank-dim-fill" style="width:${Math.max(2, Math.min(100, d.percentile))}%"></div>
        </div>
        <div class="rank-dim-meta">
          <span>第 ${d.rank} 名</span>
          <span>${fmt(d.percentile, 1)}%</span>
        </div>`;
      const best = d.best;
      if (best) {
        const bestEl = document.createElement('div');
        bestEl.className = 'rank-dim-best';
        bestEl.textContent = `🏆 最强：${best}`;
        row.appendChild(bestEl);
      }
      dimsEl.appendChild(row);
    });

    // 系别分布
    const dist = ranking.element_distribution || {};
    const distEl = $('elementDistribution');
    distEl.innerHTML = '';
    const total = ranking.sample_count || 1;
    Object.entries(dist).forEach(([elem, count]) => {
      const chip = document.createElement('span');
      chip.className = 'element-chip';
      chip.textContent = `${ELEMENT_ICONS[elem] || '🎵'} ${elem}系 × ${count}`;
      chip.title = `占 ${((count / total) * 100).toFixed(1)}%`;
      distEl.appendChild(chip);
    });
  }

  // ---------- 属性卡渲染 ----------
  function renderCard(card) {
    const song = card.song || {};
    const analysis = card.analysis || {};
    const bc = card.battle_card || {};

    // 头部
    $('elementIcon').textContent = ELEMENT_ICONS[bc.element] || '🎵';
    $('battleTitle').textContent = song.title || '未知';
    $('battleArtist').textContent = song.artist || '';
    $('battleTags').textContent = (song.genre_tags || []).join(' · ') || '曲风未知';
    $('cooldownText').textContent = bc.cooldown_text || '--';
    $('cdCountdown').textContent = '';

    // 属性条
    const attackPct = Math.min(100, (bc.attack_speed || 0) / 2 * 100);
    $('statAttack').style.width = attackPct + '%';
    $('statAttackVal').textContent = fmt(bc.attack_speed);

    $('statBurst').style.width = Math.min(100, (bc.burst || 0) * 100) + '%';
    $('statBurstVal').textContent = fmt(bc.burst);

    $('statCharge').style.width = Math.min(100, (bc.charge_time_seconds || 0) / 60 * 100) + '%';
    $('statChargeVal').textContent = Math.round(bc.charge_time_seconds || 0) + 's';

    const bpm = analysis.bpm;
    $('statBpm').style.width = Math.min(100, (bpm || 0) / 220 * 100) + '%';
    $('statBpmVal').textContent = bpm ? Math.round(bpm) : '--';

    $('statChorus').style.width = Math.min(100, (analysis.chorus_ratio || 0) * 100) + '%';
    $('statChorusVal').textContent = fmtPercent(analysis.chorus_ratio);

    $('statSection').style.width = Math.min(100, (analysis.section_count || 0) / 16 * 100) + '%';
    $('statSectionVal').textContent = analysis.section_count || '--';

    // 技能
    $('skillName').textContent = `【${bc.element}系】${bc.skill_name || ''}`;
    $('skillDesc').textContent = bc.skill_description || '';
    $('elementEvidence').textContent = '🔍 ' + (bc.element_evidence || '');

    // LLM 锐评
    if (card.review) {
      $('battleReviewContent').textContent = card.review;
    } else {
      $('battleReviewContent').textContent = '（本次无锐评，可点击「再评一次」重新生成）';
    }
    lastReviewContext = card.review_context || null;

    // 波形
    drawWaveform(analysis.waveform);

    // 排面
    renderRanking(card.ranking);

    // 冷却倒计时
    if (bc.cooldown_seconds) startCountdown(bc.cooldown_seconds);

    // 显示结果
    resultEl.style.display = 'block';
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- 分析 ----------
  function isDirectInput(text) {
    // 纯数字 ID / 网易云链接 → 直接分析，不搜索
    return /^\d+$/.test(text) || /(music\.163\.com|163cn\.tv|163\.fm|163\.com)/i.test(text);
  }

  function hideCandidates() {
    candidatesEl.style.display = 'none';
    candidatesListEl.innerHTML = '';
  }

  function fmtDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function renderCandidates(candidates) {
    candidatesListEl.innerHTML = '';
    candidates.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'candidate-row';
      row.innerHTML = `
        <div class="candidate-main">
          <div class="candidate-title">${escapeHtml(c.name)}</div>
          <div class="candidate-artist">${escapeHtml(c.artist || '')}${c.album ? ' · ' + escapeHtml(c.album) : ''}</div>
        </div>
        <div class="candidate-meta">${fmtDuration(c.duration_seconds)}</div>
        <button class="btn primary btn-sm candidate-pick" data-id="${c.id}">选择</button>`;
      row.querySelector('.candidate-pick').addEventListener('click', () => {
        hideCandidates();
        analyzeSong(String(c.id));
      });
      candidatesListEl.appendChild(row);
    });
    candidatesEl.style.display = 'block';
  }

  async function analyzeSong(text) {
    clearError();
    showLoading('正在分析歌曲（下载音频 + 歌词解析 + AI 生成）...');
    goBtn.disabled = true;
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      lastCard = data;
      renderCard(data);
      loadBoard();
    } catch (err) {
      showError('❌ ' + (err.message || '分析失败'));
      resultEl.style.display = 'none';
    } finally {
      hideLoading();
      goBtn.disabled = false;
    }
  }

  async function handleAnalyze() {
    const text = input.value.trim();
    if (!text) { showError('请输入歌名、链接或歌曲 ID'); return; }
    clearError();
    hideCandidates();
    if (isDirectInput(text)) {
      await analyzeSong(text);
      return;
    }
    // 歌名 → 先搜索，命中多个版本时让用户确认，避免解析到同名/翻唱
    showLoading('正在搜索歌曲...');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      const candidates = data.candidates || [];
      if (candidates.length === 0) {
        showError('❌ 未搜索到歌曲，请换关键词或直接粘贴歌曲链接');
        return;
      }
      if (candidates.length === 1) {
        await analyzeSong(String(candidates[0].id));
        return;
      }
      renderCandidates(candidates);
    } catch (err) {
      showError('❌ ' + (err.message || '搜索失败'));
    } finally {
      hideLoading();
    }
  }
  // ---------- 排行榜 ----------
  async function loadBoard() {
    const dimension = $('boardDimension').value;
    const listEl = $('boardList');
    const statsEl = $('boardStats');
    listEl.innerHTML = '<div class="hint-text">加载中...</div>';
    try {
      const res = await fetch('/api/ranking?dimension=' + encodeURIComponent(dimension));
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '加载失败');
      if (!data.sample_count) {
        listEl.innerHTML = '<div class="hint-text">暂无历史卡片，快去生成第一张吧！</div>';
        statsEl.textContent = '';
        return;
      }
      listEl.innerHTML = '';
      data.items.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'board-row';
        row.innerHTML = `
          <span class="board-rank">#${i + 1}</span>
          <span class="board-icon">${ELEMENT_ICONS[item.element] || '🎵'}</span>
          <span class="board-title">${escapeHtml(item.title)}</span>
          <span class="board-artist">${escapeHtml(item.artist || '')}</span>
          <span class="board-value">${fmt(item.value)}</span>`;
        listEl.appendChild(row);
      });
      const stats = await fetch('/api/cache/stats').then(r => r.json());
      statsEl.textContent = `共 ${stats.sample_count} 份卡片（上限 ${stats.max_capacity}）· 音频分析 ${stats.audio_analysis_count} 份 · 降级 ${stats.degraded_count} 份`;
    } catch (err) {
      listEl.innerHTML = '<div class="hint-text">❌ ' + escapeHtml(err.message) + '</div>';
      statsEl.textContent = '';
    }
  }

  // ---------- 锐评复制 / 重新生成 ----------
  async function copyBattleReview() {
    const text = $('battleReviewContent').textContent || '';
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      const btn = $('battleReviewCopyBtn');
      btn.textContent = '✅ 已复制';
      setTimeout(() => { btn.textContent = '📋 复制'; }, 2000);
    }
  }

  async function regenerateBattleReview() {
    if (reviewRegenerating) return;
    if (!lastReviewContext) {
      $('battleReviewContent').textContent = '暂无可用上下文，请先重新生成属性卡。';
      return;
    }
    reviewRegenerating = true;
    const btn = $('battleReviewRegenBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 锐评中...';
    $('battleReviewContent').textContent = '（AI 正在重新锐评...）';
    try {
      const res = await fetch('/api/analyze/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_context: lastReviewContext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      $('battleReviewContent').textContent = data.review || '（无回复）';
    } catch (err) {
      $('battleReviewContent').textContent = '❌ 重新生成失败：' + (err.message || '未知错误');
    } finally {
      reviewRegenerating = false;
      btn.disabled = false;
      btn.textContent = '🔄 再评一次';
    }
  }

  function copyText(text) {
    return new Promise((resolve) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => resolve(true)).catch(() => resolve(false));
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try { document.execCommand('copy'); resolve(true); }
        catch (e) { resolve(false); }
        document.body.removeChild(textarea);
      }
    });
  }

  // ---------- 导出 ----------
  function exportJson() {
    if (!lastCard) return;
    const blob = new Blob([JSON.stringify(lastCard, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `战斗BGM属性卡_${(lastCard.song && lastCard.song.title) || '未知'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- 事件 ----------
  goBtn.addEventListener('click', handleAnalyze);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAnalyze(); });
  $('battleExportBtn').addEventListener('click', exportJson);
  $('battleReviewCopyBtn').addEventListener('click', copyBattleReview);
  $('battleReviewRegenBtn').addEventListener('click', regenerateBattleReview);
  $('boardRefreshBtn').addEventListener('click', loadBoard);
  candidatesCancelBtn.addEventListener('click', hideCandidates);
  $('boardDimension').addEventListener('change', loadBoard);

  // 初始化排行榜
  loadBoard();
})();