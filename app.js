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
  const step1Error = $('step1Error');
  const userSelectContainer = $('userSelectContainer');
  const confirmUserBtn = $('confirmUserBtn');
  const backToStep1Btn = $('backToStep1Btn');
  const selectedUserInfo = $('selectedUserInfo');
  const playlistContainer = $('playlistContainer');
  const generateBtn = $('generateBtn');
  const selectAllBtn = $('selectAllBtn');
  const deselectAllBtn = $('deselectAllBtn');
  const resultContainer = $('resultContainer');
  const exportTxtBtn = $('exportTxtBtn');
  const backBtn = $('backBtn');
  const songCount = $('songCount');
  const loading = $('loading');
  const loadingText = $('loadingText');

  const API = CONFIG.API_BASE_URL;
  const MAX_SONGS = CONFIG.MAX_SONGS_PER_CHUNK;
  const T = CONFIG.PROMPT_TEMPLATES;

  /* ---------- 全局状态 ---------- */
  let currentUid = '';
  let currentNickname = '';
  let rawPlaylists = [];
  let allSongs = [];
  let totalSongCount = 0;

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
      console.error('复制失败:', e);
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

  /* ---------- 入口：处理输入 ---------- */
  async function handleSearch() {
    const input = uidInput.value.trim();
    if (!input) {
      showError('请输入用户昵称或UID');
      return;
    }

    clearError();

    // 判断是 UID（纯数字）还是昵称
    if (/^\d+$/.test(input)) {
      // 直接按 UID 查询
      currentUid = input;
      currentNickname = '';
      await fetchPlaylistsByUid(currentUid);
    } else {
      // 按昵称搜索
      await searchByNickname(input);
    }
  }

  /* ---------- 按昵称搜索用户 ---------- */
  async function searchByNickname(nickname) {
    showLoading(`正在搜索用户"${nickname}"...`);

    try {
      const data = await apiFetch(`/user/get_userids?nicknames=${encodeURIComponent(nickname)}`);
      if (data.code !== 200) {
        throw new Error(data.msg || `API 返回错误码: ${data.code}`);
      }

      // 解析返回结果
      // 返回格式: { code: 200, body: { code: 200, userIds: [...] } }
      const userIds = data.body?.userIds || [];

      if (userIds.length === 0) {
        throw new Error(`未找到昵称为"${nickname}"的用户`);
      }

      if (userIds.length === 1) {
        // 唯一用户，直接跳转
        const user = userIds[0];
        currentUid = String(user.userId);
        currentNickname = user.nickname || nickname;
        await fetchPlaylistsByUid(currentUid);
      } else {
        // 多个同名用户，展示选择界面
        currentNickname = nickname;
        showUserSelection(userIds);
      }
    } catch (err) {
      showError(err.message || '搜索用户失败');
    } finally {
      hideLoading();
    }
  }

  /* ---------- 展示用户选择（重名时） ---------- */
  function showUserSelection(users) {
    userSelectContainer.innerHTML = '';
    confirmUserBtn.disabled = true;

    const title = document.querySelector('#userSelectStep h2');
    title.textContent = `找到 ${users.length} 个"${escapeHtml(currentNickname)}"，请选择`;

    users.forEach((user) => {
      const div = document.createElement('div');
      div.className = 'user-select-item';
      div.dataset.uid = user.userId;
      div.dataset.nickname = user.nickname || currentNickname;

      const avatarUrl = user.avatarUrl || '';
      const defaultAvatar = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect width=%2248%22 height=%2248%22 fill=%22%23e8e8ed%22/><text x=%2224%22 y=%2232%22 text-anchor=%22middle%22 font-size=%2224%22>👤</text></svg>';

      div.innerHTML = `
        <input type="radio" name="userSelect" class="user-select-radio" />
        <img class="user-select-avatar" src="${avatarUrl}" alt="${escapeHtml(user.nickname || '')}"
             onerror="this.src='${defaultAvatar}'" />
        <div class="user-select-info">
          <div class="user-select-name">${escapeHtml(user.nickname || '匿名用户')}</div>
          <div class="user-select-meta">UID: ${user.userId}</div>
        </div>
      `;

      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const radio = div.querySelector('.user-select-radio');
        radio.checked = true;
        document.querySelectorAll('.user-select-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        confirmUserBtn.disabled = false;
      });

      const radio = div.querySelector('.user-select-radio');
      radio.addEventListener('change', () => {
        document.querySelectorAll('.user-select-item').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        confirmUserBtn.disabled = false;
      });

      userSelectContainer.appendChild(div);
    });

    // 切换界面
    step1.style.display = 'none';
    userSelectStep.style.display = 'block';
  }

  /* ---------- 确认选择的用户 ---------- */
  function confirmSelectedUser() {
    const selected = document.querySelector('.user-select-item.selected');
    if (!selected) return;

    currentUid = selected.dataset.uid;
    currentNickname = selected.dataset.nickname;
    userSelectStep.style.display = 'none';
    fetchPlaylistsByUid(currentUid);
  }

  /* ---------- 根据 UID 获取歌单 ---------- */
  async function fetchPlaylistsByUid(uid) {
    showLoading('正在获取歌单列表...');

    try {
      const data = await apiFetch(`/user/playlist?uid=${encodeURIComponent(uid)}`);
      if (data.code !== 200) {
        throw new Error(data.msg || `API 返回错误码: ${data.code}`);
      }

      const playlists = (data.playlist || []).filter((pl) => {
        return String(pl.userId) === String(uid) || 
               (pl.creator && String(pl.creator.userId) === String(uid));
      });

      if (playlists.length === 0) {
        throw new Error('未找到该用户的公开歌单，请检查 UID 是否正确');
      }

      rawPlaylists = playlists;
      renderPlaylists(playlists);
      renderUserInfo(uid, playlists);
      step1.style.display = 'none';
      step2.style.display = 'block';
    } catch (err) {
      showError(err.message || '获取歌单失败，请检查 API 是否运行');
    } finally {
      hideLoading();
    }
  }

  /* ---------- 显示用户信息栏 ---------- */
  function renderUserInfo(uid, playlists) {
    const firstPlaylist = playlists[0];
    const creatorName = (firstPlaylist.creator && firstPlaylist.creator.nickname) 
      || currentNickname || '未知';
    const creatorAvatar = (firstPlaylist.creator && firstPlaylist.creator.avatarUrl) || '';
    const playlistCount = playlists.length;
    const totalTracks = playlists.reduce((sum, pl) => sum + (pl.trackCount || 0), 0);

    const defaultAvatar = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 36 36%22><rect width=%2236%22 height=%2236%22 fill=%22%23e8e8ed%22/><text x=%2218%22 y=%2224%22 text-anchor=%22middle%22 font-size=%2218%22>👤</text></svg>';

    selectedUserInfo.innerHTML = `
      <img class="user-avatar" src="${creatorAvatar}" alt="${escapeHtml(creatorName)}"
           onerror="this.src='${defaultAvatar}'" />
      <div class="user-detail">
        <div class="user-name">${escapeHtml(creatorName)}</div>
        <div class="user-uid">UID: ${uid} · ${playlistCount} 个公开歌单 · ${totalTracks} 首歌曲</div>
      </div>
    `;
  }

  /* ---------- 渲染歌单列表 ---------- */
  function renderPlaylists(playlists) {
    playlistContainer.innerHTML = '';
    generateBtn.disabled = true;

    playlists.forEach((pl) => {
      const div = document.createElement('div');
      div.className = 'playlist-item';
      div.dataset.id = pl.id;

      const cover = pl.coverImgUrl || '';
      const trackCount = pl.trackCount || 0;
      const name = pl.name || '未命名歌单';

      div.innerHTML = `
        <input type="checkbox" class="pl-checkbox" />
        <img class="playlist-cover" src="${cover}?param=96y96" alt="${escapeHtml(name)}" 
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect width=%2248%22 height=%2248%22 fill=%22%23e8e8ed%22/><text x=%2224%22 y=%2232%22 text-anchor=%22middle%22 font-size=%2224%22>🎵</text></svg>'" />
        <div class="playlist-info">
          <div class="playlist-name">${escapeHtml(name)}</div>
          <div class="playlist-meta">${trackCount} 首歌曲</div>
        </div>
      `;

      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const cb = div.querySelector('.pl-checkbox');
        cb.checked = !cb.checked;
        div.classList.toggle('selected', cb.checked);
        updateGenerateBtn();
      });

      const cb = div.querySelector('.pl-checkbox');
      cb.addEventListener('change', () => {
        div.classList.toggle('selected', cb.checked);
        updateGenerateBtn();
      });

      playlistContainer.appendChild(div);
    });
  }

  function updateGenerateBtn() {
    const checked = document.querySelectorAll('.pl-checkbox:checked');
    generateBtn.disabled = checked.length === 0;
    generateBtn.textContent = checked.length > 0
      ? `生成提示词 (已选 ${checked.length} 个歌单)`
      : '生成提示词';
  }

  function toggleAllSelect(checked) {
    document.querySelectorAll('.pl-checkbox').forEach((cb) => {
      cb.checked = checked;
      cb.closest('.playlist-item').classList.toggle('selected', checked);
    });
    updateGenerateBtn();
  }

  /* ---------- 生成提示词 ---------- */
  async function generatePrompts() {
    const checked = document.querySelectorAll('.pl-checkbox:checked');
    if (checked.length === 0) return;

    const playlistIds = [];
    checked.forEach((cb) => {
      const item = cb.closest('.playlist-item');
      playlistIds.push(item.dataset.id);
    });

    showLoading('正在加载歌单歌曲...');

    try {
      const allSongPromises = playlistIds.map((id) =>
        fetchPlaylistTracks(id)
      );
      const songArrays = await Promise.all(allSongPromises);

      const seen = new Set();
      allSongs = [];
      songArrays.forEach((songs) => {
        songs.forEach((s) => {
          const key = s.id || `${s.name}|${s.artist}`;
          if (!seen.has(key)) {
            seen.add(key);
            allSongs.push(s);
          }
        });
      });

      totalSongCount = allSongs.length;

      if (totalSongCount === 0) {
        throw new Error('所选歌单中无有效歌曲');
      }

      const chunks = buildChunks(allSongs);
      renderChunks(chunks);

      step2.style.display = 'none';
      step3.style.display = 'block';
      songCount.textContent = `共 ${totalSongCount} 首`;
    } catch (err) {
      alert('获取歌曲失败：' + (err.message || '未知错误'));
    } finally {
      hideLoading();
    }
  }

  async function fetchPlaylistTracks(playlistId) {
    const data = await apiFetch(`/playlist/track/all?id=${encodeURIComponent(playlistId)}`);
    const songs = data.songs || [];
    return songs.map((s) => ({
      id: s.id,
      name: s.name || '未知歌曲',
      artist: (s.ar || []).map((a) => a.name).join('/') || '未知歌手',
    }));
  }

  function buildChunks(songs) {
    const lines = songs.map(formatSong);
    const total = lines.length;

    if (total <= MAX_SONGS) {
      const prompt = T.finalHead(total) + lines.join('\n') + T.tail;
      return [{ songs: prompt, isFinal: true, index: 1, total: 1 }];
    }

    const chunks = [];
    for (let i = 0; i < total; i += MAX_SONGS) {
      const chunkLines = lines.slice(i, i + MAX_SONGS);
      const isLast = (i + MAX_SONGS >= total);
      const chunkIndex = Math.floor(i / MAX_SONGS) + 1;
      const totalChunks = Math.ceil(total / MAX_SONGS);

      let prompt;
      if (isLast) {
        prompt = T.finalHead(total) + chunkLines.join('\n') + T.tail;
      } else {
        prompt = T.partialHead(chunkIndex, totalChunks) + chunkLines.join('\n') + T.tail;
      }

      chunks.push({
        songs: prompt,
        isFinal: isLast,
        index: chunkIndex,
        total: totalChunks,
      });
    }

    return chunks;
  }

  function renderChunks(chunks) {
    resultContainer.innerHTML = '';

    const reversed = [...chunks].reverse();

    reversed.forEach((chunk, idx) => {
      const card = document.createElement('div');
      card.className = 'chunk-card';

      const label = chunk.isFinal
        ? `完整提示词（共 ${chunk.total} 个片段，此为最后一个）`
        : `片段 ${chunk.index}/${chunk.total} - 注意顺序`;

      const orderHint = reversed.length > 1
        ? `⬆ 请按从上到下的顺序依次复制粘贴到 AI`
        : '';

      card.innerHTML = `
        <div class="chunk-header">
          <span class="chunk-label">${label}</span>
          <button class="btn copy-btn" data-text="${encodeURIComponent(chunk.songs)}">📋 复制片段 ${idx + 1}</button>
        </div>
        <div class="chunk-text">${escapeHtml(chunk.songs)}</div>
        ${idx === 0 && orderHint ? `<div style="margin-top:8px;font-size:12px;color:#ff9500;font-weight:500">${orderHint}</div>` : ''}
      `;

      resultContainer.appendChild(card);

      const copyBtn = card.querySelector('.copy-btn');
      copyBtn.addEventListener('click', async () => {
        const text = decodeURIComponent(copyBtn.dataset.text);
        const ok = await copyToClipboard(text);
        if (ok) {
          copyBtn.textContent = '✅ 已复制';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = `📋 复制片段 ${idx + 1}`;
            copyBtn.classList.remove('copied');
          }, 2000);
        } else {
          alert('复制失败，请手动选择文本复制');
        }
      });
    });
  }

  /* ---------- 导出 TXT ---------- */
  function exportTxt() {
    if (allSongs.length === 0) return;

    const lines = allSongs.map(formatSong);
    const text = T.finalHead(totalSongCount) + lines.join('\n') + T.tail;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `歌单品味锐评_${currentUid}_${totalSongCount}首.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------- 事件绑定 ---------- */
  fetchBtn.addEventListener('click', handleSearch);

  uidInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
  });

  confirmUserBtn.addEventListener('click', confirmSelectedUser);

  backToStep1Btn.addEventListener('click', () => {
    userSelectStep.style.display = 'none';
    step1.style.display = 'block';
  });

  selectAllBtn.addEventListener('click', () => toggleAllSelect(true));
  deselectAllBtn.addEventListener('click', () => toggleAllSelect(false));
  generateBtn.addEventListener('click', generatePrompts);
  exportTxtBtn.addEventListener('click', exportTxt);

  backBtn.addEventListener('click', () => {
    step3.style.display = 'none';
    step2.style.display = 'block';
  });

  // 双击标题返回首页
  document.querySelector('header h1').addEventListener('dblclick', () => {
    userSelectStep.style.display = 'none';
    step2.style.display = 'none';
    step3.style.display = 'none';
    step1.style.display = 'block';
    uidInput.value = '';
    showError('');
  });
})();