(function () {
  'use strict';

  /* ---------- DOM 引用 ---------- */
  const $ = (id) => document.getElementById(id);
  const uidInput = $('uidInput');
  const fetchBtn = $('fetchPlaylistsBtn');
  const step1 = $('step1');
  const userSelectStep = $('userSelectStep');
  const step2 = $('step2');
  const step3 = $('step3');
  const step4a = $('step4a');
  const step4b = $('step4b');
  const step1Error = $('step1Error');
  const userSelectContainer = $('userSelectContainer');
  const confirmUserBtn = $('confirmUserBtn');
  const backToStep1Btn = $('backToStep1Btn');
  const selectedUserInfo = $('selectedUserInfo');
  const playlistContainer = $('playlistContainer');
  const generateBtn = $('generateBtn');
  const chooseAiBtn = $('chooseAiBtn');
  const chooseExportBtn = $('chooseExportBtn');
  const backFromStep3Btn = $('backFromStep3Btn');
  const step3SongCount = $('step3SongCount');
  const step3PlaylistName = $('step3PlaylistName');
  // AI page
  const aiSongCount = $('aiSongCount');
  const aiPlaylistName = $('aiPlaylistName');
  const aiGoBtn = $('aiGoBtn');
  const aiResultContainer = $('aiResultContainer');
  const aiReviewContent = $('aiReviewContent');
  const copyReviewBtn = $('copyReviewBtn');
  const backFromAiBtn = $('backFromAiBtn');
  // Export page
  const exportSongCount = $('exportSongCount');
  const exportPlaylistName = $('exportPlaylistName');
  const copyPromptBtn = $('copyPromptBtn');
  const copyHint = $('copyHint');
  const promptText = $('promptText');
  const exportTxtBtn = $('exportTxtBtn');
  const backFromExportBtn = $('backFromExportBtn');
  // Loading
  const loading = $('loading');
  const loadingText = $('loadingText');
  const themeToggleBtn = $('themeToggleBtn');

  const API = CONFIG.API_BASE_URL;
  const MAX_SONGS = CONFIG.MAX_SONGS_PER_CHUNK;
  const T = CONFIG.PROMPT_TEMPLATES;
  const LLM = CONFIG.LLM_CONFIG;

  /* ---------- 全局状态 ---------- */
  let currentUid = '';
  let currentNickname = '';
  let rawPlaylists = [];
  let allSongs = [];
  let totalSongCount = 0;
  let currentPlaylistName = '';
  let currentFullPrompt = '';
  let aiInProgress = false;

  /* ---------- 深色模式 ---------- */
  function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeToggleBtn.textContent = '☀️';
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeToggleBtn.textContent = '🌙';
    }
  }

  function toggleTheme() {
    const hasDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (hasDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
      themeToggleBtn.textContent = '🌙';
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      themeToggleBtn.textContent = '☀️';
    }
  }

  themeToggleBtn.addEventListener('click', toggleTheme);
  initTheme();

  /* ---------- 工具函数 ---------- */
  function showLoading(text) {
    loadingText.textContent = text || '加载中...';
    loading.style.display = 'flex';
  }
  function hideLoading() {
    loading.style.display = 'none';
  }

  function showError(msg) {
    step1Error.textContent = msg;
  }
  function clearError() {
    step1Error.textContent = '';
  }

  function formatSong(s) {
    return `${s.name} - ${s.artist}`;
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function apiFetch(path) {
    const url = `${API}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function showOnly(showEl) {
    const all = [step1, userSelectStep, step2, step3, step4a, step4b];
    all.forEach((el) => { el.style.display = el === showEl ? 'block' : 'none'; });
  }

  /* ---------- Step 1: 搜索用户 ---------- */
  async function handleSearch() {
    const input = uidInput.value.trim();
    if (!input) { showError('请输入用户昵称或UID'); return; }
    clearError();
    if (/^\d+$/.test(input)) {
      currentUid = input;
      currentNickname = '';
      await fetchPlaylistsByUid(currentUid);
    } else {
      await searchByNickname(input);
    }
  }

  async function searchByNickname(nickname) {
    showLoading(`正在搜索用户"${nickname}"...`);
    try {
      const data = await apiFetch(`/get/userids?nicknames=${encodeURIComponent(nickname)}`);
      if (data.code !== 200) throw new Error(data.msg || `API 错误码: ${data.code}`);
      const nicknames = data.nicknames || {};
      const entries = Object.entries(nicknames);
      if (entries.length === 0) throw new Error(`未找到昵称为"${nickname}"的用户`);
      const matched = entries.filter(([n]) => n.toLowerCase().includes(nickname.toLowerCase()));
      if (matched.length === 0) throw new Error(`未找到昵称为"${nickname}"的用户`);
      if (matched.length === 1) {
        currentUid = String(matched[0][1]);
        currentNickname = matched[0][0];
        await fetchPlaylistsByUid(currentUid);
      } else {
        currentNickname = nickname;
        showUserSelection(matched);
      }
    } catch (err) {
      showError(err.message || '搜索用户失败');
    } finally { hideLoading(); }
  }

  function showUserSelection(users) {
    userSelectContainer.innerHTML = '';
    confirmUserBtn.disabled = true;
    document.querySelector('#userSelectStep h2').textContent = `找到 ${users.length} 个，请选择`;
    users.forEach(([name, uid]) => {
      const div = document.createElement('div');
      div.className = 'user-select-item';
      div.dataset.uid = uid;
      div.dataset.nickname = name;
      const defaultAvatar = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect width=%2248%22 height=%2248%22 fill=%22%23e8e8ed%22/><text x=%2224%22 y=%2232%22 text-anchor=%22middle%22 font-size=%2224%22>👤</text></svg>';
      div.innerHTML = `<input type="radio" name="userSelect" class="user-select-radio" />
        <img class="user-select-avatar" src="${defaultAvatar}" />
        <div class="user-select-info"><div class="user-select-name">${escapeHtml(name)}</div><div class="user-select-meta">UID: ${uid}</div></div>`;
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        div.querySelector('.user-select-radio').checked = true;
        document.querySelectorAll('.user-select-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        confirmUserBtn.disabled = false;
      });
      div.querySelector('.user-select-radio').addEventListener('change', () => {
        document.querySelectorAll('.user-select-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        confirmUserBtn.disabled = false;
      });
      userSelectContainer.appendChild(div);
    });
    showOnly(userSelectStep);
  }

  function confirmSelectedUser() {
    const selected = document.querySelector('.user-select-item.selected');
    if (!selected) return;
    currentUid = selected.dataset.uid;
    currentNickname = selected.dataset.nickname;
    showOnly(step1);
    fetchPlaylistsByUid(currentUid);
  }

  /* ---------- Step 2: 获取歌单 ---------- */
  async function fetchPlaylistsByUid(uid) {
    showLoading('正在获取歌单列表...');
    try {
      const data = await apiFetch(`/user/playlist?uid=${encodeURIComponent(uid)}`);
      if (data.code !== 200) throw new Error(data.msg || `API 错误码: ${data.code}`);
      const playlists = (data.playlist || []).filter((pl) =>
        String(pl.userId) === String(uid) || (pl.creator && String(pl.creator.userId) === String(uid))
      );
      if (playlists.length === 0) throw new Error('未找到该用户的公开歌单');
      rawPlaylists = playlists;
      renderPlaylists(playlists);
      renderUserInfo(uid, playlists);
      showOnly(step2);
    } catch (err) {
      showError(err.message || '获取歌单失败');
    } finally { hideLoading(); }
  }

  function renderUserInfo(uid, playlists) {
    const fp = playlists[0];
    const name = (fp.creator && fp.creator.nickname) || currentNickname || '未知';
    const avatar = (fp.creator && fp.creator.avatarUrl) || '';
    const count = playlists.length;
    const total = playlists.reduce((s, p) => s + (p.trackCount || 0), 0);
    const def = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 36 36%22><rect width=%2236%22 height=%2236%22 fill=%22%23e8e8ed%22/><text x=%2218%22 y=%2224%22 text-anchor=%22middle%22 font-size=%2218%22>👤</text></svg>';
    selectedUserInfo.innerHTML = `<img class="user-avatar" src="${avatar}" onerror="this.src='${def}'" /><div class="user-detail"><div class="user-name">${escapeHtml(name)}</div><div class="user-uid">UID: ${uid} · ${count} 个歌单 · ${total} 首</div></div>`;
  }

  function renderPlaylists(playlists) {
    playlistContainer.innerHTML = '';
    generateBtn.disabled = true;
    playlists.forEach((pl) => {
      const div = document.createElement('div');
      div.className = 'playlist-item';
      div.dataset.id = pl.id;
      div.dataset.name = pl.name || '未命名';
      const cover = pl.coverImgUrl || '';
      const tc = pl.trackCount || 0;
      const name = pl.name || '未命名';
      div.innerHTML = `<input type="radio" name="pl" class="pl-radio" />
        <img class="playlist-cover" src="${cover}?param=96y96" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect width=%2248%22 height=%2248%22 fill=%22%23e8e8ed%22/><text x=%2224%22 y=%2232%22 text-anchor=%22middle%22 font-size=%2224%22>🎵</text></svg>'" />
        <div class="playlist-info"><div class="playlist-name">${escapeHtml(name)}</div><div class="playlist-meta">${tc} 首</div></div>`;
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        div.querySelector('.pl-radio').checked = true;
        document.querySelectorAll('.playlist-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        generateBtn.disabled = false;
      });
      div.querySelector('.pl-radio').addEventListener('change', () => {
        document.querySelectorAll('.playlist-item').forEach((el) => el.classList.remove('selected'));
        if (div.querySelector('.pl-radio').checked) {
          div.classList.add('selected');
          generateBtn.disabled = false;
        }
      });
      playlistContainer.appendChild(div);
    });
  }

  /* ---------- 生成提示词 → Step 3 ---------- */
  async function generatePrompts() {
    const selected = document.querySelector('.playlist-item.selected');
    if (!selected) return;
    const playlistId = selected.dataset.id;
    currentPlaylistName = selected.dataset.name;

    showLoading('正在加载歌单歌曲...');
    try {
      const data = await apiFetch(`/playlist/track/all?id=${encodeURIComponent(playlistId)}`);
      const songs = (data.songs || []).map((s) => ({
        id: s.id,
        name: s.name || '未知',
        artist: (s.ar || []).map((a) => a.name).join('/') || '未知',
      }));
      if (songs.length === 0) throw new Error('该歌单无有效歌曲');
      allSongs = songs;
      totalSongCount = songs.length;
      currentFullPrompt = T.finalHead(totalSongCount) + songs.map(formatSong).join('\n') + T.tail;

      // 进入 Step 3：选择操作方式
      step3SongCount.textContent = `共 ${totalSongCount} 首`;
      step3PlaylistName.textContent = currentPlaylistName;
      showOnly(step3);
    } catch (err) {
      alert('获取歌曲失败：' + (err.message || '未知错误'));
    } finally { hideLoading(); }
  }

  /* ---------- Step 3 → 选择 ---------- */
  function goToAiPage() {
    aiSongCount.textContent = `共 ${totalSongCount} 首`;
    aiPlaylistName.textContent = currentPlaylistName;
    // 重置 AI 区域
    aiResultContainer.style.display = 'none';
    aiInProgress = false;
    aiGoBtn.disabled = false;
    aiGoBtn.textContent = '🚀 开始分析';
    showOnly(step4a);
  }

  function goToExportPage() {
    exportSongCount.textContent = `共 ${totalSongCount} 首`;
    exportPlaylistName.textContent = currentPlaylistName;
    promptText.textContent = currentFullPrompt;
    if (totalSongCount <= MAX_SONGS) {
      copyPromptBtn.disabled = false;
      copyHint.textContent = `≤ ${MAX_SONGS} 首，可直接复制或下载 TXT`;
    } else {
      copyPromptBtn.disabled = true;
      copyHint.textContent = `超过 ${MAX_SONGS} 首，请使用下载 TXT`;
    }
    showOnly(step4b);
  }

  /* ---------- Step 4a: AI 分析 ---------- */
  async function handleAiReview() {
    if (aiInProgress) return;
    if (!LLM.ENABLED) {
      alert('AI 锐评功能未启用，请在 config.js 中设置 LLM_CONFIG.ENABLED = true');
      return;
    }
    aiInProgress = true;
    aiGoBtn.disabled = true;
    aiGoBtn.textContent = '⏳ 分析中...';
    aiResultContainer.style.display = 'block';
    aiReviewContent.innerHTML = `<div class="ai-loading"><div class="spinner small"></div><span>AI 正在锐评中，请稍候...</span></div>`;
    copyReviewBtn.style.display = 'none';

    try {
      const blob = new Blob([currentFullPrompt], { type: 'text/plain;charset=utf-8' });
      const formData = new FormData();
      formData.append('file', blob, 'prompt.txt');
      formData.append('model', LLM.MODEL);
      formData.append('disable_thinking', String(LLM.DISABLE_THINKING));

      const workerBase = CONFIG.WORKER_API_BASE || API;
      const endpoint = `${workerBase}${LLM.API_ENDPOINT}`;
      const res = await fetch(endpoint, { method: 'POST', body: formData });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const reply = data.reply || data.result || data.response || JSON.stringify(data);
      // 使用 marked 渲染 Markdown
      if (typeof marked !== 'undefined') {
        aiReviewContent.innerHTML = marked.parse(reply);
        aiReviewContent.classList.add('markdown-body');
      } else {
        aiReviewContent.textContent = reply;
      }
      copyReviewBtn.style.display = 'inline-block';
    } catch (err) {
      aiReviewContent.innerHTML = `<div style="color:var(--danger);"><strong>❌ 失败：</strong>${escapeHtml(err.message)}</div>`;
      copyReviewBtn.style.display = 'none';
    } finally {
      aiInProgress = false;
      aiGoBtn.disabled = false;
      aiGoBtn.textContent = '🚀 重新分析';
    }
  }

  async function handleCopyReview() {
    const text = aiReviewContent.textContent || '';
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      copyReviewBtn.textContent = '✅ 已复制';
      setTimeout(() => { copyReviewBtn.textContent = '📋 复制'; }, 2000);
    }
  }

  /* ---------- Step 4b: 复制/导出 ---------- */
  async function handleCopyPrompt() {
    if (totalSongCount > MAX_SONGS) {
      copyHint.textContent = `⚠️ 超过 ${MAX_SONGS} 首，请使用下载 TXT`;
      return;
    }
    const ok = await copyToClipboard(currentFullPrompt);
    if (ok) {
      copyPromptBtn.textContent = '✅ 已复制';
      copyHint.textContent = '已复制到剪贴板！';
      setTimeout(() => {
        copyPromptBtn.textContent = '📋 复制';
        copyHint.textContent = `≤ ${MAX_SONGS} 首，可直接复制或下载 TXT`;
      }, 2000);
    } else {
      copyHint.textContent = '❌ 复制失败，请手动复制或下载 TXT';
    }
  }

  function exportTxt() {
    if (!currentFullPrompt) return;
    const blob = new Blob([currentFullPrompt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `歌单品味锐评_${currentPlaylistName || currentUid}_${totalSongCount}首.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------- 导航 ---------- */
  function backToStep2() { showOnly(step2); }
  function backToStep3() { showOnly(step3); }
  function goHome() {
    showOnly(step1);
    uidInput.value = '';
    showError('');
  }

  /* ---------- 事件绑定 ---------- */
  fetchBtn.addEventListener('click', handleSearch);
  uidInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchBtn.click(); });
  confirmUserBtn.addEventListener('click', confirmSelectedUser);
  backToStep1Btn.addEventListener('click', goHome);
  generateBtn.addEventListener('click', generatePrompts);

  // Step 3
  chooseAiBtn.addEventListener('click', goToAiPage);
  chooseExportBtn.addEventListener('click', goToExportPage);
  backFromStep3Btn.addEventListener('click', backToStep2);

  // Step 4a
  aiGoBtn.addEventListener('click', handleAiReview);
  copyReviewBtn.addEventListener('click', handleCopyReview);
  backFromAiBtn.addEventListener('click', backToStep3);

  // Step 4b
  copyPromptBtn.addEventListener('click', handleCopyPrompt);
  exportTxtBtn.addEventListener('click', exportTxt);
  backFromExportBtn.addEventListener('click', backToStep3);

  // 双击标题回首页
  document.querySelector('header h1').addEventListener('dblclick', goHome);
})();