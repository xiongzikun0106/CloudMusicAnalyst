/* ========================================
   云音乐趣味工坊 - 全局：Tab 切换 + 深色主题
   ======================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------- 主题 ----------
  const themeToggleBtn = $('themeToggleBtn');
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
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
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

  // ---------- Tab 切换 ----------
  const tabs = {
    battle: { tab: $('tabBattle'), panel: $('panelBattle') },
    review: { tab: $('tabReview'), panel: $('panelReview') },
  };

  function switchTab(name) {
    Object.entries(tabs).forEach(([key, { tab, panel }]) => {
      const active = key === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      panel.classList.toggle('active', active);
    });
  }

  tabs.battle.tab.addEventListener('click', () => switchTab('battle'));
  tabs.review.tab.addEventListener('click', () => switchTab('review'));
})();