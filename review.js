/* ========================================
   歌单品味锐评 - 前端交互（对接 FastAPI /api/review/*）
   ======================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // 状态
  let currentUid = '';
  let currentNickname = '';
  let currentPlaylistName = '';
  let currentPrompt = '';
  let currentSongCount = 0;
  let currentPlaylists = [];

  const MAX_SONGS_PER_CHUNK = 100;

  // ---------- 工具 ----------
  function showError(msg) { $('reviewError').textContent = msg; }
  function clearError() { $('reviewError').textContent = ''; }

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

  // 仅允许 http/https 图片 URL，并拒绝含引号/尖括号/反斜杠的输入（防属性注入）
  function safeImageUrl(url) {
    if (!url) return '';
    if (typeof url !== 'string' || url.length > 2048) return '';
    if (/["'<>\\]/.test(url)) return '';
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return url;
    } catch (e) { return ''; }
  }

  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
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
    } catch (e) { return false; }
  }

  function showOnly(showEl) {
    const all = ['reviewStep1', 'reviewUserSelectStep', 'reviewStep2', 'reviewStep3', 'reviewStep4a', 'reviewStep4b'];
    all.forEach((id) => { $(id).style.display = id === showEl ? 'block' : 'none'; });
  }

  // ---------- Step 1: 搜索用户 ----------
  async function handleSearch() {
    const input = $('reviewInput').value.trim();
    if (!input) { showError('请输入用户昵称或UID'); return; }
    clearError();
    showLoading('正在搜索...');
    try {
      if (/^\d+$/.test(input)) {
        currentUid = input;
        currentNickname = '';
        await fetchPlaylists(currentUid);
      } else {
        const data = await apiPost('/api/review/search_users', { nickname: input });
        const users = data.users || [];
        if (users.length === 0) throw new Error('未找到该昵称的用户');
        if (users.length === 1) {
          currentUid = users[0].uid;
          currentNickname = users[0].nickname;
          await fetchPlaylists(currentUid);
        } else {
          currentNickname = input;
          showUserSelection(users);
        }
      }
    } catch (err) {
      showError(err.message || '搜索用户失败');
    } finally { hideLoading(); }
  }

  function showUserSelection(users) {
    const container = $('reviewUserSelectContainer');
    const titleEl = $('reviewUserSelectTitle');
    container.innerHTML = '';
    $('reviewConfirmUserBtn').disabled = true;
    titleEl.textContent = `找到 ${users.length} 个，请选择`;
    const def = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect width=%2248%22 height=%2248%22 fill=%22%23e8e8ed%22/><text x=%2224%22 y=%2232%22 text-anchor=%22middle%22 font-size=%2224%22>👤</text></svg>';
    users.forEach((u) => {
      const div = document.createElement('div');
      div.className = 'user-select-item';
      div.dataset.uid = u.uid;
      div.dataset.nickname = u.nickname;
      div.innerHTML = `<input type="radio" name="reviewUserSelect" class="user-select-radio" />
        <img class="user-select-avatar" src="${def}" />
        <div class="user-select-info"><div class="user-select-name">${escapeHtml(u.nickname)}</div><div class="user-select-meta">UID: ${u.uid}</div></div>`;
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        div.querySelector('.user-select-radio').checked = true;
        document.querySelectorAll('#reviewUserSelectContainer .user-select-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        $('reviewConfirmUserBtn').disabled = false;
      });
      div.querySelector('.user-select-radio').addEventListener('change', () => {
        document.querySelectorAll('#reviewUserSelectContainer .user-select-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        $('reviewConfirmUserBtn').disabled = false;
      });
      container.appendChild(div);
    });
    showOnly('reviewUserSelectStep');
  }

  function confirmSelectedUser() {
    const selected = document.querySelector('#reviewUserSelectContainer .user-select-item.selected');
    if (!selected) return;
    currentUid = selected.dataset.uid;
    currentNickname = selected.dataset.nickname;
    fetchPlaylists(currentUid);
  }

  // ---------- Step 2: 歌单列表 ----------
  async function fetchPlaylists(uid) {
    showLoading('正在获取歌单列表...');
    try {
      const data = await apiPost('/api/review/user_playlists', { uid });
      const playlists = data.playlists || [];
      if (playlists.length === 0) throw new Error('未找到该用户的公开歌单');
      currentPlaylists = playlists;
      renderUserInfo(uid, playlists);
      renderPlaylists(playlists);
      showOnly('reviewStep2');
    } catch (err) {
      showError(err.message || '获取歌单失败');
    } finally { hideLoading(); }
  }

  function renderUserInfo(uid, playlists) {
    const count = playlists.length;
    const total = playlists.reduce((s, p) => s + (p.trackCount || 0), 0);
    const name = currentNickname || (playlists[0] && playlists[0].creator) || '未知';
    const def = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 36 36%22><rect width=%2236%22 height=%2236%22 fill=%22%23e8e8ed%22/><text x=%2218%22 y=%2224%22 text-anchor=%22middle%22 font-size=%2218%22>👤</text></svg>';
    const avatar = safeImageUrl(playlists[0] && playlists[0].avatarUrl);
    $('reviewSelectedUserInfo').innerHTML = `<img class="user-avatar" src="${avatar}" onerror="this.src='${def}'" />
      <div class="user-detail"><div class="user-name">${escapeHtml(name)}</div><div class="user-uid">UID: ${uid} · ${count} 个歌单 · ${total} 首</div></div>`;
  }

  function renderPlaylists(playlists) {
    const container = $('reviewPlaylistContainer');
    container.innerHTML = '';
    $('reviewGenerateBtn').disabled = true;
    const def = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect width=%2248%22 height=%2248%22 fill=%22%23e8e8ed%22/><text x=%2224%22 y=%2232%22 text-anchor=%22middle%22 font-size=%2224%22>🎵</text></svg>';
    playlists.forEach((pl) => {
      const div = document.createElement('div');
      div.className = 'playlist-item';
      div.dataset.id = pl.id;
      div.dataset.name = pl.name || '未命名';
      const cover = safeImageUrl(pl.coverImgUrl) || '';
      div.innerHTML = `<input type="radio" name="reviewPl" class="pl-radio" />
        <img class="playlist-cover" src="${cover}?param=96y96" onerror="this.src='${def}'" />
        <div class="playlist-info"><div class="playlist-name">${escapeHtml(pl.name || '未命名')}</div><div class="playlist-meta">${pl.trackCount || 0} 首</div></div>`;
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        div.querySelector('.pl-radio').checked = true;
        document.querySelectorAll('#reviewPlaylistContainer .playlist-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        $('reviewGenerateBtn').disabled = false;
      });
      div.querySelector('.pl-radio').addEventListener('change', () => {
        document.querySelectorAll('#reviewPlaylistContainer .playlist-item').forEach((el) => el.classList.remove('selected'));
        if (div.querySelector('.pl-radio').checked) {
          div.classList.add('selected');
          $('reviewGenerateBtn').disabled = false;
        }
      });
      container.appendChild(div);
    });
  }

  // ---------- 生成提示词 ----------
  async function generatePromptForPlaylist() {
    const selected = document.querySelector('#reviewPlaylistContainer .playlist-item.selected');
    if (!selected) return;
    const playlistId = selected.dataset.id;
    currentPlaylistName = selected.dataset.name;
    showLoading('正在加载歌单歌曲...');
    try {
      const data = await apiPost('/api/review/playlist_tracks', { playlist_id: playlistId });
      const songs = data.songs || [];
      if (songs.length === 0) throw new Error('该歌单无有效歌曲');
      currentSongCount = songs.length;
      const prompt = `【请锐评以下歌单的品味】\n歌单名称：${currentPlaylistName}\n歌曲数量：${songs.length}\n数据格式：JSON 数组 [{name:"歌曲名", artist:"歌手"}, ...]\n\n请从音乐品味、风格偏好、年代分布等角度进行毒舌但有趣的评价：\n\n${JSON.stringify(songs)}`;
      currentPrompt = prompt;
      enterStep3();
    } catch (err) {
      alert('获取歌曲失败：' + (err.message || '未知错误'));
    } finally { hideLoading(); }
  }

  async function handleFullReview() {
    if (!currentUid) return;
    showLoading('正在拉取歌单列表...');
    try {
      const data = await apiPost('/api/review/generate_prompt', { uid: currentUid });
      currentSongCount = 0;
      currentPlaylistName = `全员锐评（${data.playlistCount} 个歌单）`;
      currentPrompt = data.prompt;
      enterStep3();
    } catch (err) {
      alert('获取失败：' + (err.message || '未知错误'));
    } finally { hideLoading(); }
  }

  function enterStep3() {
    $('reviewSongCount').textContent = currentSongCount > 0 ? `共 ${currentSongCount} 首` : '🎯 全员锐评';
    $('reviewPlaylistName').textContent = currentPlaylistName;
    showOnly('reviewStep3');
  }

  // ---------- Step 4a: AI 锐评 ----------
  let aiInProgress = false;
  function goToAi() {
    $('reviewAiSongCount').textContent = currentSongCount > 0 ? `共 ${currentSongCount} 首` : '全员锐评';
    $('reviewAiPlaylistName').textContent = currentPlaylistName;
    $('reviewAiResult').style.display = 'none';
    aiInProgress = false;
    $('reviewAiGoBtn').disabled = false;
    $('reviewAiGoBtn').textContent = '🚀 开始分析';
    showOnly('reviewStep4a');
  }

  async function handleAiReview() {
    if (aiInProgress) return;
    aiInProgress = true;
    $('reviewAiGoBtn').disabled = true;
    $('reviewAiGoBtn').textContent = '⏳ 分析中...';
    $('reviewAiResult').style.display = 'block';
    $('reviewAiContent').innerHTML = '<div class="ai-loading"><div class="spinner small"></div><span>AI 正在锐评中...（约 30-60 秒）</span></div>';
    $('reviewCopyAiBtn').style.display = 'none';
    try {
      const data = await apiPost('/api/review/ai_review', { text: currentPrompt });
      $('reviewAiContent').textContent = data.reply || '（无回复）';
      $('reviewCopyAiBtn').style.display = 'inline-block';
    } catch (err) {
      $('reviewAiContent').innerHTML = `<div style="color:var(--danger);"><strong>❌ 失败：</strong>${escapeHtml(err.message)}</div>`;
      $('reviewCopyAiBtn').style.display = 'none';
    } finally {
      aiInProgress = false;
      $('reviewAiGoBtn').disabled = false;
      $('reviewAiGoBtn').textContent = '🚀 重新分析';
    }
  }

  async function handleCopyAi() {
    const text = $('reviewAiContent').textContent || '';
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      $('reviewCopyAiBtn').textContent = '✅ 已复制';
      setTimeout(() => { $('reviewCopyAiBtn').textContent = '📋 复制'; }, 2000);
    }
  }

  // ---------- Step 4b: 导出 ----------
  function goToExport() {
    $('reviewExportCount').textContent = currentSongCount > 0 ? `共 ${currentSongCount} 首` : '全员锐评';
    $('reviewExportName').textContent = currentPlaylistName;
    $('reviewPromptText').textContent = currentPrompt;
    if (currentSongCount <= MAX_SONGS_PER_CHUNK) {
      $('reviewCopyPromptBtn').disabled = false;
      $('reviewCopyHint').textContent = `≤ ${MAX_SONGS_PER_CHUNK} 首，可直接复制或下载 TXT`;
    } else {
      $('reviewCopyPromptBtn').disabled = true;
      $('reviewCopyHint').textContent = `超过 ${MAX_SONGS_PER_CHUNK} 首，请使用下载 TXT`;
    }
    showOnly('reviewStep4b');
  }

  async function handleCopyPrompt() {
    if (currentSongCount > MAX_SONGS_PER_CHUNK) {
      $('reviewCopyHint').textContent = `⚠️ 超过 ${MAX_SONGS_PER_CHUNK} 首，请使用下载 TXT`;
      return;
    }
    const ok = await copyToClipboard(currentPrompt);
    if (ok) {
      $('reviewCopyPromptBtn').textContent = '✅ 已复制';
      $('reviewCopyHint').textContent = '已复制到剪贴板！';
      setTimeout(() => {
        $('reviewCopyPromptBtn').textContent = '📋 复制';
        $('reviewCopyHint').textContent = `≤ ${MAX_SONGS_PER_CHUNK} 首，可直接复制或下载 TXT`;
      }, 2000);
    } else {
      $('reviewCopyHint').textContent = '❌ 复制失败，请手动复制或下载 TXT';
    }
  }

  function exportTxt() {
    if (!currentPrompt) return;
    const blob = new Blob([currentPrompt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `歌单品味锐评_${currentPlaylistName || currentUid || 'unknown'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- 事件 ----------
  $('reviewSearchBtn').addEventListener('click', handleSearch);
  $('reviewInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(); });
  $('reviewConfirmUserBtn').addEventListener('click', confirmSelectedUser);
  $('reviewBackToInputBtn').addEventListener('click', () => {
    showOnly('reviewStep1');
    $('reviewInput').value = '';
    clearError();
  });
  $('reviewGenerateBtn').addEventListener('click', generatePromptForPlaylist);
  $('reviewFullBtn').addEventListener('click', handleFullReview);
  $('reviewBackToPlaylists').addEventListener('click', () => showOnly('reviewStep2'));
  $('reviewChooseAi').addEventListener('click', goToAi);
  $('reviewChooseExport').addEventListener('click', goToExport);
  $('reviewBackFromAi').addEventListener('click', () => showOnly('reviewStep3'));
  $('reviewBackFromExport').addEventListener('click', () => showOnly('reviewStep3'));
  $('reviewAiGoBtn').addEventListener('click', handleAiReview);
  $('reviewCopyAiBtn').addEventListener('click', handleCopyAi);
  $('reviewCopyPromptBtn').addEventListener('click', handleCopyPrompt);
  $('reviewExportTxtBtn').addEventListener('click', exportTxt);

  // 双击标题回第一步
  document.querySelector('header h1').addEventListener('dblclick', () => {
    showOnly('reviewStep1');
    $('reviewInput').value = '';
    clearError();
  });
})();