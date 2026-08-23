<template>
  <div class="app">
    <!-- 移动端顶部导航条 -->
    <header class="mobile-header">
      <button class="hamburger" @click="sidebarOpen = true" aria-label="打开菜单">☰</button>
      <div class="mobile-logo">
        <img :src="currentLogoV" class="mobile-logo-img" alt="刷题宝" />
        <span>刷题宝</span>
      </div>
      <div class="mobile-header-actions">
        <RouterLink to="/" class="mobile-nav-link" :class="{ active: route.path === '/' }"><span>📖</span></RouterLink>
        <RouterLink to="/settings" class="mobile-nav-link" :class="{ active: route.path === '/settings' }"><span>⚙️</span></RouterLink>
        <button class="mobile-nav-btn" @click="handleShare" aria-label="分享页面">📤</button>
        <button class="mobile-nav-btn" @click="handleRestart" aria-label="刷新页面">🔄</button>
      </div>
    </header>

    <!-- 移动端抽屉遮罩 -->
    <div v-if="sidebarOpen" class="drawer-mask" @click="sidebarOpen = false"></div>

    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="logo">
        <img :src="currentLogoV" class="logo-img" alt="刷题宝" />
        <span>刷题宝</span>
      </div>

      <div class="nav-group">
        <div class="nav-group-title">全局</div>
        <nav>
          <RouterLink to="/" @click="sidebarOpen = false"><span class="nav-icon">📖</span><span>题库</span></RouterLink>
          <RouterLink to="/settings" @click="sidebarOpen = false"><span class="nav-icon">⚙️</span><span>设置</span></RouterLink>
        </nav>
      </div>

      <div v-if="currentBank" class="nav-group">
        <div class="nav-group-title">当前题库</div>
        <div class="bank-name">{{ currentBank.name }}</div>
        <nav>
          <RouterLink :to="`/practice/${currentBank.id}`" @click="sidebarOpen = false"><span class="nav-icon">✏️</span><span>练习</span></RouterLink>
          <RouterLink :to="`/wrong/${currentBank.id}`" @click="sidebarOpen = false"><span class="nav-icon">❌</span><span>错题本</span></RouterLink>
          <RouterLink :to="`/favorites/${currentBank.id}`" @click="sidebarOpen = false"><span class="nav-icon">⭐</span><span>收藏</span></RouterLink>
          <RouterLink :to="`/stats/${currentBank.id}`" @click="sidebarOpen = false"><span class="nav-icon">📊</span><span>统计</span></RouterLink>
        </nav>
      </div>

      <div class="sidebar-footer">
        <div class="contact-me" @click="showContact = true">
          <img src="/contact-avatar.png?v=0.2.0" class="contact-avatar" alt="联系我" />
          <span class="contact-text">联系我</span>
        </div>
        <div class="app-actions">
          <button class="app-action-btn share-btn" @click="handleShare">
            <span class="share-icon">📤</span>
            <span class="share-label">分享</span>
          </button>
          <button class="app-action-btn restart-btn" @click="handleRestart">
            <span class="restart-icon">🔄</span>
            <span class="restart-label">刷新</span>
          </button>
        </div>
        <p class="restart-tip">加载不全或卡顿，点此刷新</p>
      </div>
    </aside>
    <main class="content"><RouterView :key="route.fullPath" /></main>

    <Toast />

    <!-- 联系我二维码弹窗 -->
    <div v-if="showContact" class="contact-modal" @click="showContact = false">
      <div class="contact-modal-content" @click.stop>
        <button class="contact-modal-close" @click="showContact = false">✕</button>
        <h3>扫码添加微信</h3>
        <div class="qr-placeholder">
          <img src="/wechat-qr.png?v=0.2.0" class="qr-avatar" alt="微信二维码" />
          <p>扫码添加 rabbit 微信</p>
          <span>内蒙古 包头</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { useBankStore } from './stores/bank'
import { autoCheckOnStartup } from './utils/updater'
import { sharePage } from './lib/share'
import { toastSuccess, toastError } from './utils/toast'
import Toast from './components/Toast.vue'

const route = useRoute()
const bankStore = useBankStore()
const currentBank = ref<{ id: number; name: string } | null>(null)
const sidebarOpen = ref(false)
const showContact = ref(false)

// logo 随主题色切换（2026-08-23）：读取 documentElement 的 data-theme-color 选对应主题色版动画 GIF
const themeColor = ref('green')
const logoList: Record<string, string> = {
  green: '/icons/logo-green.gif',
  blue: '/icons/logo-blue.gif',
  purple: '/icons/logo-purple.gif',
  pink: '/icons/logo-pink.gif',
  orange: '/icons/logo-orange.gif',
  teal: '/icons/logo-teal.gif',
  tech: '/icons/logo-tech.gif',
  forest: '/icons/logo-forest.gif',
  space: '/icons/logo-space.gif',
  cloud: '/icons/logo-cloud.gif',
}
const currentLogo = computed(() => logoList[themeColor.value] || logoList.green)
const currentLogoV = computed(() => `${currentLogo.value}?v=0.2.0`)

function syncThemeColor() {
  themeColor.value = (document.documentElement.getAttribute('data-theme-color') || 'green')
}
// 监听 data-theme-color 变化，logo 即时切换
let themeObserver: MutationObserver | null = null
onMounted(() => {
  syncThemeColor()
  themeObserver = new MutationObserver(syncThemeColor)
  themeObserver.observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme-color'],
  })
})
onBeforeUnmount(() => { themeObserver?.disconnect() })

// 路由变化自动关闭抽屉（移动端点击导航后）
watch(() => route.fullPath, () => { sidebarOpen.value = false })

async function refreshBankNav() {
  const bankId = Number(route.params.bankId)
  if (!bankId) {
    currentBank.value = null
    return
  }
  // 确保题库列表已加载
  if (!bankStore.banks.length) {
    try { await bankStore.load() } catch (e) { /* ignore */ }
  }
  const bank = bankStore.banks.find(b => b.id === bankId)
  currentBank.value = bank ? { id: bank.id, name: bank.name } : null
}

watch(() => route.params.bankId, refreshBankNav, { immediate: true })

// 启动 3 秒后后台检查更新
onMounted(() => {
  autoCheckOnStartup().catch(e => console.error('启动检查更新失败：', e))
})

// 全局分享：读当前页面动态标题（考试页会覆盖为考试名），手机端调系统面板、桌面端复制链接
async function handleShare() {
  const url = location.href
  const title = document.title || '刷题宝'
  const res = await sharePage({ title, text: '导题 刷题 考试，就用刷题宝', url })
  if (res === 'copied') toastSuccess('链接已复制，去粘贴分享吧~')
  else if (res === 'failed') toastError('分享失败，请手动复制地址栏链接')
}

// @ts-ignore
async function handleRestart() {
  if (!confirm('确认重启应用吗？（将强制刷新并清除缓存）')) return
  try {
    // 强刷：清 Service Worker 缓存 → 硬刷新，确保拿到最新版本
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
      if (window.caches && typeof caches.keys === 'function') {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
    }
    location.reload()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg) {
      const div = document.createElement('div')
      div.style.cssText = 'position:fixed;top:24px;right:24px;padding:10px 16px;background:#fee2e2;color:#b91c1c;border-radius:6px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-width:340px;'
      div.textContent = '重启失败：' + msg + '。请手动关闭并重新打开应用。'
      document.body.appendChild(div)
      setTimeout(() => div.remove(), 5000)
    }
  }
}
</script>

<style>
.app { display: flex; height: 100vh; }
.sidebar { width: 200px; background: var(--color-sidebar-bg); padding: 16px; border-right: 1px solid var(--color-border); overflow-y: auto; display: flex; flex-direction: column; }
.logo { display: flex; align-items: center; gap: 8px; font-size: 18px; margin: 0 0 20px 0; color: var(--color-primary); padding: 4px 12px; font-weight: 700; letter-spacing: 0.5px; }
.logo-img { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1); }
.logo-icon { font-size: 22px; }
.nav-icon { display: inline-block; width: 18px; text-align: center; margin-right: 4px; font-size: 14px; }

.nav-group { margin-bottom: 20px; }
.nav-group-title { font-size: 11px; color: var(--color-text-tertiary); margin-bottom: 6px; padding: 0 12px; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; }
.bank-name { font-size: 13px; color: var(--color-text-secondary); margin-bottom: 6px; padding: 0 12px; word-break: break-all; font-weight: 500; }

.sidebar nav { display: flex; flex-direction: column; gap: 2px; }
.sidebar nav a { text-decoration: none; color: var(--color-text); padding: 7px 12px; border-radius: var(--radius-md); font-size: 14px; transition: background 0.12s; }
.sidebar nav a:hover { background: var(--color-border-light); }
.sidebar nav a.router-link-active { background: var(--color-primary); color: #fff; }

.content { flex: 1; overflow: auto; padding: 24px; }

.sidebar-footer {
  margin-top: auto;
  padding: 12px 12px 4px;
  border-top: 1px solid var(--color-border-light);
}
.app-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.app-action-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid var(--color-border-light);
  background: var(--color-card);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-secondary);
  transition: all 0.15s;
}
.app-action-btn:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.share-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.share-icon { font-size: 16px; }
.share-label { font-size: 14px; font-weight: 600; }
.restart-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.restart-icon { font-size: 16px; }
.restart-label { font-size: 14px; font-weight: 600; }
.restart-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
  text-align: center;
}

/* 联系我 */
.contact-me {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s;
  color: var(--color-text-secondary);
}
.contact-me:hover {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.contact-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--color-primary);
  background: #fff;
}
.contact-text {
  font-size: 14px;
  font-weight: 600;
}

/* 联系我弹窗 */
.contact-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 20px;
}
.contact-modal-content {
  position: relative;
  background: var(--color-card, #fff);
  border-radius: var(--radius-lg, 12px);
  padding: 28px 24px;
  width: 320px;
  max-width: 90vw;
  text-align: center;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.contact-modal-content h3 {
  margin: 0 0 16px 0;
  font-size: 18px;
  color: var(--color-text);
}
.contact-modal-close {
  position: absolute;
  top: 10px;
  right: 12px;
  background: none;
  border: none;
  font-size: 18px;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}
.contact-modal-close:hover {
  color: var(--color-text);
}
.qr-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg, #f8f9fa);
}
.qr-avatar {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid var(--color-primary);
}
.qr-placeholder p {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}
.qr-placeholder span {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

/* ============ 移动端适配（≤768px） ============ */
.mobile-header { display: none; }
.drawer-mask { display: none; }

@media (max-width: 768px) {
  .mobile-header {
    display: flex;
    align-items: center;
    gap: 10px;
    position: sticky;
    top: 0;
    z-index: 60;
    height: 52px;
    padding: 0 12px;
    background: var(--color-sidebar-bg);
    border-bottom: 1px solid var(--color-border);
  }
  .hamburger {
    font-size: 20px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 8px;
    color: var(--color-text);
    border-radius: var(--radius-sm);
  }
  .hamburger:active { background: var(--color-border-light); }
  .mobile-logo { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 700; color: var(--color-primary); flex: 1; }
  .mobile-logo-img { width: 26px; height: 26px; border-radius: 5px; }
  .mobile-header-actions { display: flex; gap: 4px; }
  .mobile-nav-link {
    text-decoration: none;
    font-size: 18px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
  }
  .mobile-nav-link.active { background: var(--color-primary-light); }
  .mobile-nav-btn {
    font-size: 18px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-secondary);
    line-height: 1;
  }
  .mobile-nav-btn:active { background: var(--color-border-light); }

  .app { flex-direction: column; height: 100vh; }
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 70;
    width: 240px;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.12);
  }
  .sidebar.open { transform: translateX(0); }
  .drawer-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 65;
  }
  .content { padding: 14px; }
  .content { overflow-y: auto; -webkit-overflow-scrolling: touch; }
}
</style>
