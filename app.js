(function () {
  'use strict';

  /* ---------- DOM 引用 ---------- */
  const $ = (id) => document.getElementById(id);
  const uidInput = $('uidInput');
  const fetchBtn = $('fetchPlaylistsBtn');
  const step1 = $('step1');
  const step2 = $('step2');
  const step3 = $('step3');
  const step1Error = $('step1Error');
  const playlistContainer = $('playlistContainer');
  const generateBtn = $('generateBtn');
  const selectAllBtn = $('selectAllBtn');
  const deselectAllBtn = $('deselectAllBtn');
  const resultContainer = $('resultContainer');
  const resultActions = $('resultActions');
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
  let rawPlaylists = [];         // 从 API 获取的原始歌单列表
  let allSongs = [];            // 合并后的所有歌曲 { name, artist }
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

  // 格式化歌曲为 "歌名 - 歌手"
  function formatSong(s) {
    return `${s.name} - ${s.artist}`;
  }

  // 安全的复制到剪切板
  async function copyToClipboard(text) {
    try {
      // 现代浏览器优先使用 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // 降级方案
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

  // 创建可复用的 fetch 请求
  async function apiFetch(path) {
    const url = `${API}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------- Step 1: 获取用户歌单 ---------- */
  async function fetchPlaylists(uid) {
    showLoading('正在获取歌单列表...');
    clearError();

    try {
      const data = await apiFetch(`/user/playlist?uid=${encodeURIComponent(uid)}`);
      if (data.code !== 200) {
        throw new Error(data.msg || `API 返回错误码: ${data.code}`);
      }

      // 过滤：用户自己创建 + 公开歌单
      const playlists = (data.playlist || []).filter((pl) => {
        return String(pl.userId) === String(uid) || 
               (pl.creator && String(pl.creator.userId) === String(uid));
      });

      if (playlists.length === 0) {
        throw new Error('未找到该用户的公开歌单，请检查 UID 是否正确');
      }

      currentUid = uid;
      rawPlaylists = playlists;
      renderPlaylists(playlists);
      step1.style.display = 'none';
      step2.style.display = 'block';
    } catch (err) {
      showError(err.message || '获取歌单失败，请检查 API 是否运行');
    } finally {
      hideLoading();
    }
  }

  /* ---------- Step 2: 渲染歌单列表 ---------- */
  function renderPlaylists(playlists) {
    playlistContainer.innerHTML = '';
    generateBtn.disabled = true;

    playlists.forEach((pl) => {
      const div = document.createElement('div');
      div.className = 'playlist-item';
      div.dataset.id = pl.id;

      const cover = pl.coverImgUrl || '';
      const trackCount = pl.trackCount || 0;
      const creatorName = (pl.creator && pl.creator.nickname) || '未知';
      const name = pl.name || '未命名歌单';

      div.innerHTML = `
        <input type="checkbox" class="pl-checkbox" />
        <img class="playlist-cover" src="${cover}?param=96y96" alt="${name}" 
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 48 48%22><rect width=%2248%22 height=%2248%22 fill=%22%23e8e8ed%22/><text x=%2224%22 y=%2232%22 text-anchor=%22middle%22 font-size=%2224%22>🎵</text></svg>'" />
        <div class="playlist-info">
          <div class="playlist-name">${escapeHtml(name)}</div>
          <div class="playlist-meta">${trackCount} 首歌曲</div>
          <div class="playlist-creator">by ${escapeHtml(creatorName)}</div>
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

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  function updateGenerateBtn() {
    const checked = document.querySelectorAll('.pl-checkbox:checked');
    generateBtn.disabled = checked.length === 0;
    generateBtn.textContent = checked.length > 0
      ? `生成提示词 (已选 ${checked.length} 个歌单)`
      : '生成提示词';
  }

  /* ---------- Step 2: 全选/取消 ---------- */
  function toggleAllSelect(checked) {
    document.querySelectorAll('.pl-checkbox').forEach((cb) => {
      cb.checked = checked;
      cb.closest('.playlist-item').classList.toggle('selected', checked);
    });
    updateGenerateBtn();
  }

  /* ---------- Step 2 → Step 3: 生成提示词 ---------- */
  async function generatePrompts() {
    const checked = document.querySelectorAll('.pl-checkbox:checked');
    if (checked.length === 0) return;

    // 收集选中的歌单ID
    const playlistIds = [];
    checked.forEach((cb) => {
      const item = cb.closest('.playlist-item');
      playlistIds.push(item.dataset.id);
    });

    showLoading('正在加载歌单歌曲...');

    try {
      // 并行获取所有选中歌单的歌曲
      const allSongPromises = playlistIds.map((id) =>
        fetchPlaylistTracks(id)
      );
      const songArrays = await Promise.all(allSongPromises);

      // 合并去重
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

      // 生成提示词片段
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

  /* ---------- 获取单个歌单的歌曲 ---------- */
  async function fetchPlaylistTracks(playlistId) {
    const data = await apiFetch(`/playlist/track/all?id=${encodeURIComponent(playlistId)}`);
    if (data.code !== 200 && data.code !== undefined && data.code !== 202) {
      // playlist/track/all 可能返回 { songs: [...] } 格式
      // 有些版本返回 { code: 200, songs: [...] } 或 { code: 202, songs: [...] }
    }

    const songs = data.songs || [];
    return songs.map((s) => ({
      id: s.id,
      name: s.name || '未知歌曲',
      artist: (s.ar || []).map((a) => a.name).join('/') || '未知歌手',
    }));
  }

  /* ---------- 构建提示词片段 ---------- */
  function buildChunks(songs) {
    const lines = songs.map(formatSong);
    const total = lines.length;

    if (total <= MAX_SONGS) {
      // 无需拆分
      const prompt = T.finalHead(total) + lines.join('\n') + T.tail;
      return [{ songs: prompt, isFinal: true, index: 1, total: 1 }];
    }

    // 需要拆分
    const chunks = [];
    const songsPerChunk = MAX_SONGS;

    for (let i = 0; i < total; i += songsPerChunk) {
      const chunkLines = lines.slice(i, i + songsPerChunk);
      const isLast = (i + songsPerChunk >= total);
      const chunkIndex = Math.floor(i / songsPerChunk) + 1;
      const totalChunks = Math.ceil(total / songsPerChunk);

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

  /* ---------- 渲染提示词片段（倒序） ---------- */
  function renderChunks(chunks) {
    resultContainer.innerHTML = '';

    // 倒序显示
    const reversed = [...chunks].reverse();

    reversed.forEach((chunk, idx) => {
      const card = document.createElement('div');
      card.className = 'chunk-card';

      const label = chunk.isFinal
        ? `完整提示词（共 ${chunk.total} 个片段，此为最后一个）`
        : `片段 ${chunk.index}/${chunk.total} - 注意顺序`;

      // 复制顺序提示
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

      // 绑定复制按钮
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

  /* ---------- 导出为 TXT ---------- */
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
  fetchBtn.addEventListener('click', () => {
    const uid = uidInput.value.trim();
    if (!uid) {
      showError('请输入用户 UID');
      return;
    }
    if (!/^\d+$/.test(uid)) {
      showError('UID 必须为数字');
      return;
    }
    fetchPlaylists(uid);
  });

  uidInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
  });

  selectAllBtn.addEventListener('click', () => toggleAllSelect(true));
  deselectAllBtn.addEventListener('click', () => toggleAllSelect(false));

  generateBtn.addEventListener('click', generatePrompts);

  exportTxtBtn.addEventListener('click', exportTxt);

  backBtn.addEventListener('click', () => {
    step3.style.display = 'none';
    step2.style.display = 'block';
  });

  // 回到 Step1 的逻辑：在所有 step 外部加一个返回按钮（通过双击标题）
  document.querySelector('header h1').addEventListener('dblclick', () => {
    step2.style.display = 'none';
    step3.style.display = 'none';
    step1.style.display = 'block';
    uidInput.value = '';
    showError('');
  });
})();