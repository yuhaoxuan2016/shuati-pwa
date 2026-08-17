<template>
  <div class="home">
    <div class="header">
      <div>
        <h2>我的题库</h2>
        <div class="header-sub">
          共 <b>{{ bankStore.banks.length }}</b> 个题库 ·
          <b>{{ totalQuestions }}</b> 道题 ·
          已掌握 <b>{{ totalMastered }}</b> 道
        </div>
      </div>
      <div class="header-btns">
        <button class="exam-btn" @click="$router.push('/exams')"><img class="btn-icon" src="/icons/exam.gif" alt="考试" /> 考试</button>
        <button class="mix-exam-btn" @click="$router.push('/mix-exam')"><img class="btn-icon" src="/icons/mix.gif" alt="综合抽题" /> 综合抽题</button>
        <button class="new-bank-btn" @click="showNew = true">+ 新建题库</button>
      </div>
    </div>

    <!-- 访问统计 -->
    <div v-if="visitStats" class="visit-bar">
      👁 累计访问 <b>{{ visitStats.total }}</b> 次 · 今日 <b>{{ visitStats.today }}</b> 次
    </div>

    <!-- 每日一诗 -->
    <div v-if="dailyPoem" class="poem-card">
      <div class="poem-head">📜 每日一诗 · {{ todayText }}</div>
      <div class="poem-content">{{ dailyPoem.content }}</div>
      <div class="poem-meta">—— {{ dailyPoem.dynasty }}·{{ dailyPoem.author }}《{{ dailyPoem.title }}》</div>
    </div>

    <!-- 每日学习卡片（学习类 App 常见激励） -->
    <div v-if="todayStats.total > 0" class="daily-card">
      <div class="daily-left">
        <img class="daily-icon" src="/icons/flame.gif" alt="🔥" />
        <div>
          <div class="daily-title">今天已刷 <b>{{ todayStats.total }}</b> 题</div>
          <div class="daily-sub">正确率 {{ todayStats.accuracy }}% · 连续刷题 <b>{{ streakDays }}</b> 天</div>
        </div>
      </div>
      <div class="daily-progress">
        <div class="daily-progress-bar">
          <div class="daily-progress-fill" :style="{ width: todayStats.accuracy + '%' }"></div>
        </div>
        <div class="daily-progress-label">今日正确率</div>
      </div>
    </div>

    <div v-if="lastPractice" class="resume-card" @click="resumePractice">
      <div class="resume-info">
        <div class="resume-label">继续刷题</div>
        <div class="resume-title">{{ lastPractice.bank_name }}</div>
        <div class="resume-meta">第 {{ lastPractice.position }} / {{ lastPractice.total }} 题 · {{ formatTime(lastPractice.saved_at) }}</div>
      </div>
      <div class="resume-arrow">›</div>
    </div>

    <!-- 公共考试入口（新用户开箱即用） -->
    <div v-if="publicExams.length" class="public-exam-banner" @click="$router.push('/exams')">
      <div class="pe-left">
        <img class="pe-icon" src="/icons/exam.gif" alt="📝" />
        <div>
          <div class="pe-title">公共考试</div>
          <div class="pe-sub">{{ publicExams.length }} 场考试，点此直接开考</div>
        </div>
      </div>
      <div class="pe-arrow">›</div>
    </div>

    <!-- 公共题库区块（云端直读，无需同步/导入） -->
    <div v-if="publicBanks.length" class="public-section">
      <div class="section-header">
        <h3>🌍 公共题库</h3>
        <span class="section-sub">云端官方题库 · 此处仅供展示，练习数据不保存，点「添加到我的题库」导入本地后享进度/收藏/错题</span>
      </div>
      <div class="grid public-grid">
        <div v-for="b in publicBanks" :key="b._id" class="card public-card">
          <div class="card-header">
            <h3>
              {{ b.name }}
              <span class="vis-badge public">🌍</span>
            </h3>
          </div>
          <div class="card-meta">
            <span v-if="b.creator_name" class="creator-pill">👤 {{ b.creator_name }}</span>
            <span class="count-pill">📝 {{ b.question_count || 0 }} 题</span>
          </div>
          <div class="actions">
            <button class="primary-btn" @click="$router.push(`/public-practice/${b._id}/${encodeURIComponent(b.name)}`)">开始刷题</button>
            <div v-if="isImported(b.name)" class="imported-tag">✓ 已添加到我的题库</div>
            <button class="import-btn" :disabled="importingId === b._id" @click="importPublicBank(b)">
              <span v-if="importingId === b._id">导入中… {{ importProgress?.done }}/{{ importProgress?.total }}</span>
              <span v-else>＋ 添加到我的题库</span>
            </button>
            <div v-if="importingId === b._id && importProgress && importProgress.total" class="import-progress">
              <div class="import-bar"><div class="import-fill" :style="{ width: (importProgress.done / importProgress.total * 100) + '%' }"></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="bankStore.loading" class="skeleton-grid">
      <div v-for="i in 3" :key="i" class="skeleton-card"></div>
    </div>
    <div v-else-if="bankStore.banks.length === 0" class="empty">
      <img class="empty-icon" src="/icons/study.gif" alt="📚" />
      <p class="empty-title">还没有题库</p>
      <p class="empty-tip">点击右上角"新建题库"开始你的刷题之旅</p>
      <button class="empty-action" @click="showNew = true">+ 新建第一个题库</button>
    </div>
    <div v-else class="grid">
      <div v-for="b in bankStore.banks" :key="b.id" class="card" :class="{ 'has-progress': statsFor(b.id)?.practiced, 'open': openMenuId === b.id }">
        <div class="card-header">
          <h3>
            {{ b.name }}
            <span class="vis-badge" :class="b.visibility === 'private' ? 'private' : 'public'">
              {{ b.visibility === 'private' ? '🔒' : '🌍' }}
            </span>
          </h3>
          <button class="more-btn" @click.stop="toggleMenu(b.id)">⋯</button>
        </div>
        <div class="card-meta">
          <span v-if="b.creator_name" class="creator-pill">👤 {{ b.creator_name }}</span>
          <span class="count-pill">📝 {{ b.question_count }} 题</span>
          <span v-if="statsFor(b.id)" class="accuracy-pill" :class="accuracyClass(statsFor(b.id)!.accuracy)">
            ✓ {{ statsFor(b.id)!.accuracy }}%
          </span>
        </div>

        <!-- 进度条 -->
        <div v-if="statsFor(b.id)?.practiced" class="progress-row">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPct(b.id) + '%' }"></div>
          </div>
          <div class="progress-text">{{ statsFor(b.id)!.practiced }} / {{ b.question_count }}</div>
        </div>

        <div class="actions">
          <button class="primary-btn" @click="$router.push(`/practice/${b.id}`)">开始刷题</button>
        </div>

        <div v-if="openMenuId === b.id" class="dropdown-menu" @click.stop>
          <button @click="$router.push(`/wrong/${b.id}`)">📕 错题本</button>
          <button @click="$router.push(`/favorites/${b.id}`)">⭐ 收藏夹</button>
          <button @click="$router.push(`/import/${b.id}`)">📥 导入题目</button>
          <button @click="exportBank(b)">📤 导出题库</button>
          <button class="danger" @click="del(b.id)">🗑 删除题库</button>
        </div>
      </div>
    </div>

    <div v-if="showNew" class="modal" @click.self="showNew = false">
      <div class="modal-body">
        <h3>新建题库</h3>
        <input v-model="newName" placeholder="题库名称" @keyup.enter="create" />
        <input v-model="newCreator" placeholder="创建人（可选，显示在卡片上）" />
        <textarea v-model="newDesc" placeholder="描述（可选）"></textarea>
        <div class="vis-options">
          <label class="vis-option" :class="{ active: newVisibility === 'public' }" @click="newVisibility = 'public'">
            <span>🌍</span>
            <div>
              <div class="vis-name">公共题库</div>
              <div class="vis-desc">所有人可见，可基于它出卷/刷题</div>
            </div>
          </label>
          <label class="vis-option" :class="{ active: newVisibility === 'private' }" @click="newVisibility = 'private'">
            <span>🔒</span>
            <div>
              <div class="vis-name">自建题库</div>
              <div class="vis-desc">仅自己可见，私人题库</div>
            </div>
          </label>
        </div>
        <div class="modal-actions">
          <button @click="create">确定</button>
          <button @click="showNew = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useBankStore } from '../stores/bank'
import { api } from '../utils/api'
import { listPublicBanks, listExams, listPublicBankQuestions, classifyQuestionType, judgeAnswerBool, type Exam } from '../lib/exam'
import { toastSuccess, toastError } from '../utils/toast'
import { recordVisit, getVisitStats } from '../lib/visit'
import { poemOfTheDay, todayLabel, type Poem } from '../lib/poems'

interface LastPractice {
  bank_id: number
  bank_name: string
  position: number
  total: number
  saved_at: string
}
interface Stats { total: number; practiced: number; correct: number; mastered: number; accuracy: number }
interface TodayStats { total: number; correct: number; accuracy: number }
interface DailyRecord { date: string; total: number; correct: number }

const router = useRouter()
const bankStore = useBankStore()
const showNew = ref(false)
const newName = ref('')
const newDesc = ref('')
const newCreator = ref('')
const newVisibility = ref<'public' | 'private'>('public')
const lastPractice = ref<LastPractice | null>(null)
const openMenuId = ref<number | null>(null)
const bankStatsMap = ref<Map<number, Stats>>(new Map())
const todayStats = ref<TodayStats>({ total: 0, correct: 0, accuracy: 0 })
const streakDays = ref(0)
const publicBanks = ref<any[]>([])
const publicExams = ref<Exam[]>([])
const importingId = ref<string | null>(null)
const importProgress = ref<{ done: number; total: number } | null>(null)
const visitStats = ref<{ total: number; today: number } | null>(null)
const dailyPoem = ref<Poem | null>(null)
const todayText = ref('')

const totalQuestions = computed(() => bankStore.banks.reduce((s, b) => s + b.question_count, 0))
// 已掌握 = 错题本里标记「已掌握」的真实数量（2026-08-15 修复：此前用已练习数近似）
const totalMastered = computed(() => {
  let m = 0
  for (const s of bankStatsMap.value.values()) m += s.mastered || 0
  return m
})

function toggleMenu(id: number) {
  openMenuId.value = openMenuId.value === id ? null : id
}
function closeMenu() { openMenuId.value = null }

function statsFor(id: number): Stats | undefined {
  return bankStatsMap.value.get(id)
}

// 是否已导入到本地（按题库名匹配；公共题库与本地题库同名即视为已导入）
function isImported(name: string): boolean {
  return bankStore.banks.some(x => x.name === name)
}

function progressPct(id: number): number {
  const b = bankStore.banks.find(x => x.id === id)
  const s = bankStatsMap.value.get(id)
  if (!b || !s || b.question_count === 0) return 0
  return Math.min(100, Math.round((s.practiced / b.question_count) * 100))
}

function accuracyClass(accuracy: number): string {
  if (accuracy >= 80) return 'high'
  if (accuracy >= 60) return 'mid'
  return 'low'
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

onMounted(async () => {
  // 手机端 click 事件可能不冒泡到 document（尤其微信内置浏览器），加 touchstart 兼容
  // 2026-08-16 修复：touchstart 无差别 closeMenu 会在手机端吞掉菜单按钮的 click——
  // touchstart 先冒泡关菜单 → v-if 卸载菜单 DOM → 按钮 click 不再触发 → 删除/导出/跳转全没反应。
  // 现在点击目标在菜单 / ⋮ 按钮内部时不关闭。
  const inMenu = (e: Event): boolean => {
    const t = e.target as HTMLElement | null
    return !!t && !!t.closest && !!t.closest('.dropdown-menu, .more-btn')
  }
  document.addEventListener('click', (e) => { if (!inMenu(e)) closeMenu() })
  document.addEventListener('touchstart', (e) => { if (!inMenu(e)) closeMenu() }, { passive: true })
  // 并行加载：本地题库 + 云端公共数据（公共部分失败不影响本地使用）
  await Promise.allSettled([
    loadPublicData(),
    bankStore.load().then(async () => {
      // 加载每个题库统计
      await Promise.all(bankStore.banks.map(async b => {
        try {
          const s = await api.bankStats(b.id)
          bankStatsMap.value.set(b.id, { ...s, accuracy: s.practiced > 0 ? Math.min(100, Math.round((s.correct / s.practiced) * 100)) : 0 })
        } catch { /* ignore */ }
      }))
    }),
  ])
  // 计算今日统计 & 连续天数
  try {
    const raw = await api.getSetting('daily_records')
    const records: DailyRecord[] = raw ? JSON.parse(raw) : []
    const today = todayISO()
    const todayRec = records.find(r => r.date === today)
    if (todayRec) {
      todayStats.value = {
        total: todayRec.total,
        correct: todayRec.correct,
        accuracy: todayRec.total > 0 ? Math.round((todayRec.correct / todayRec.total) * 100) : 0,
      }
    }
    // 连续天数：从今天往回数，每天都有记录
    let streak = 0
    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date))
    let cursor = new Date()
    for (const r of sorted) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      if (r.date === iso && r.total > 0) {
        streak++
        cursor.setDate(cursor.getDate() - 1)
      } else if (r.date < iso) {
        break
      }
    }
    streakDays.value = streak
  } catch (e) { console.error('加载每日统计失败：', e) }
  // 加载最近练习记录
  try {
    const raw = await api.getSetting('last_practice')
    if (raw) {
      const parsed = JSON.parse(raw) as LastPractice
      if (parsed && typeof parsed.bank_id === 'number' && bankStore.banks.some(b => b.id === parsed.bank_id)) {
        lastPractice.value = parsed
      }
    }
  } catch (e) { console.error('加载最近练习记录失败：', e) }
  // 访问统计（累计/今日）；失败静默，不影响首页
  try {
    await recordVisit()
    const s = await getVisitStats()
    if (s) visitStats.value = s
  } catch { /* 统计失败不影响首页 */ }
  // 每日一诗（按日期确定性取一首，当天稳定）
  try { dailyPoem.value = poemOfTheDay(); todayText.value = todayLabel() } catch { /* 不影响首页 */ }
})

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

// 加载云端公共数据（公共题库 + 公共考试）；任何失败都静默，不影响首页
async function loadPublicData() {
  try {
    const [banks, exams] = await Promise.allSettled([listPublicBanks(), listExams()])
    if (banks.status === 'fulfilled') {
      // 按题目数降序，过滤 0 题题库
      publicBanks.value = (banks.value || [])
        .filter(b => (b.question_count || 0) > 0)
        .sort((a, b) => (b.question_count || 0) - (a.question_count || 0))
    }
    if (exams.status === 'fulfilled') {
      publicExams.value = (exams.value || []).filter(e => e.visibility !== 'private' && (e.questions?.length || 0) > 0)
    }
  } catch { /* 公共数据加载失败不影响首页 */ }
}

function resumePractice() {
  if (lastPractice.value) router.push(`/practice/${lastPractice.value.bank_id}`)
}

// 将云端公共题库完整导入到本地「我的题库」，导入后自动获得进度/收藏/错题功能
async function importPublicBank(b: any) {
  if (importingId.value) return
  const total = b.question_count || 0
  if (!confirm(`将「${b.name}」导入到我的题库？\n共 ${total} 题，导入后可享进度 / 收藏 / 错题功能。`)) return
  importingId.value = b._id
  importProgress.value = { done: 0, total }
  try {
    const qs = await listPublicBankQuestions(b._id)
    if (!qs.length) {
      toastError('该公共题库暂无可导入的题目')
      importingId.value = null
      importProgress.value = null
      return
    }
    importProgress.value = { done: 0, total: qs.length }
    // 建本地私人副本（private 避免被云同步当成公开题库重复发布）
    const created = await bankStore.create(b.name, b.description || `来自公共题库：${b.name}`, 'private', b.creator_name || null)
    if (!created?.id) throw new Error('创建本地题库失败')
    // 剥离公共 id/bank_id，分批写入（大题库避免单事务过大 + 实时进度）
    // 判断题归一：云端存为 type:'single' + ["正确","错误"]，导入时统一为 type:'judge' + answer true/false（2026-08-15 修复）
    const clean = qs.map(q => {
      const t = classifyQuestionType(q)
      if (t === 'judge') {
        let opts: string[] = []
        try { const p = JSON.parse(q.options || '[]'); if (Array.isArray(p)) opts = p.map((o: any) => String(o)) } catch { /* ignore */ }
        return {
          type: 'judge',
          stem: q.stem,
          options: JSON.stringify(['正确', '错误']),
          answer: judgeAnswerBool(q.answer, opts.length ? opts : null),
          analysis: q.analysis,
          source_index: q.source_index ?? null,
        }
      }
      return {
        type: t,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        source_index: q.source_index ?? null,
      }
    })
    const CHUNK = 250
    for (let i = 0; i < clean.length; i += CHUNK) {
      const slice = clean.slice(i, i + CHUNK)
      await api.addQuestions(created.id, slice)
      importProgress.value = { done: Math.min(i + CHUNK, clean.length), total: clean.length }
    }
    const s = await api.bankStats(created.id)
    bankStatsMap.value.set(created.id, { ...s, accuracy: 0 })
    toastSuccess(`已导入「${b.name}」${clean.length} 题到我的题库`)
  } catch (e) {
    toastError('导入失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    setTimeout(() => { importingId.value = null; importProgress.value = null }, 500)
  }
}

async function create() {
  if (!newName.value.trim()) return
  try {
    const created = await bankStore.create(newName.value.trim(), newDesc.value || null, newVisibility.value, newCreator.value.trim() || null)
    showNew.value = false
    newName.value = ''
    newDesc.value = ''
    newCreator.value = ''
    newVisibility.value = 'public'
    if (created && created.id) {
      if (confirm('题库创建成功！是否立即导入题目？\n（点"取消"稍后从题库卡片 ⋯ 菜单里导入）')) {
        router.push(`/import/${created.id}`)
      }
    }
  } catch (e) {
    toastError('创建题库失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function del(id: number) {
  if (!confirm('确认删除该题库？此操作不可恢复。')) return
  try {
    await bankStore.remove(id)
    openMenuId.value = null
    bankStatsMap.value.delete(id)
    if (lastPractice.value && lastPractice.value.bank_id === id) {
      lastPractice.value = null
      try { await api.setSetting('last_practice', '') } catch {}
    }
    toastSuccess('题库已删除')
  } catch (e) {
    toastError('删除题库失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function exportBank(b: { id: number; name: string }) {
  openMenuId.value = null
  try {
    const jsonStr = await api.exportBank(b.id)
    const defaultName = `${b.name}_导出_${new Date().toISOString().slice(0, 10)}.json`
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    a.click()
    URL.revokeObjectURL(url)
    toastSuccess('导出成功')
  } catch (e) {
    toastError('导出失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

onBeforeUnmount(() => { document.removeEventListener('click', closeMenu); document.removeEventListener('touchstart', closeMenu) })
</script>

<style scoped>
.header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; gap: 16px; }
.header h2 { margin: 0 0 4px 0; font-size: 24px; }
.header-sub { font-size: 13px; color: var(--color-text-secondary); }
.header-sub b { color: var(--color-primary); font-weight: 600; }

/* 访问统计条 */
.visit-bar { margin-bottom: 16px; font-size: 13px; color: var(--color-text-secondary); padding: 8px 14px; background: var(--color-surface, #f7f8fa); border: 1px solid var(--color-border, #eee); border-radius: var(--radius-md); }
.visit-bar b { color: var(--color-primary); font-weight: 600; }

/* 每日一诗卡 */
.poem-card { margin-bottom: 16px; padding: 14px 16px; background: linear-gradient(135deg, #f7f9fc 0%, #f0f4fa 100%); border: 1px solid var(--color-border, #eee); border-left: 3px solid var(--color-primary); border-radius: var(--radius-md); }
.poem-head { font-size: 12px; color: var(--color-primary); font-weight: 600; margin-bottom: 8px; letter-spacing: 0.5px; }
.poem-content { font-size: 15px; line-height: 1.8; color: var(--color-text); white-space: pre-line; letter-spacing: 0.5px; }
.poem-meta { margin-top: 8px; font-size: 12px; color: var(--color-text-secondary); text-align: right; }

.new-bank-btn { padding: 9px 18px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; }
.new-bank-btn:hover { background: var(--color-primary-dark); transform: translateY(-1px); }
.header-btns { display: flex; gap: 8px; align-items: center; }
.btn-icon { width: 18px; height: 18px; vertical-align: -3px; margin-right: 4px; }
.exam-btn, .mix-exam-btn { display: inline-flex; align-items: center; justify-content: center; }
.exam-btn { padding: 9px 18px; background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.3); }
.exam-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4); }
.mix-exam-btn { padding: 9px 18px; background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; transition: background 0.15s, transform 0.1s; white-space: nowrap; box-shadow: 0 2px 6px rgba(79, 70, 229, 0.3); }
.mix-exam-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4); }

/* 每日激励卡 */
.daily-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%);
  border: 1px solid #fde68a;
  border-radius: var(--radius-lg);
  box-shadow: 0 2px 6px rgba(245, 158, 11, 0.08);
}
.daily-left { display: flex; align-items: center; gap: 14px; }
.daily-icon { width: 40px; height: 40px; }
.daily-title { font-size: 16px; color: #92400e; font-weight: 600; }
.daily-title b { color: #c2410c; font-size: 18px; }
.daily-sub { font-size: 13px; color: #b45309; margin-top: 4px; }
.daily-sub b { color: #c2410c; }
.daily-progress { min-width: 160px; }
.daily-progress-bar { height: 6px; background: rgba(146, 64, 14, 0.15); border-radius: 3px; overflow: hidden; }
.daily-progress-fill { height: 100%; background: linear-gradient(90deg, #f59e0b, #f97316); border-radius: 3px; transition: width 0.4s; }
.daily-progress-label { font-size: 11px; color: #b45309; margin-top: 4px; text-align: right; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
.card { position: relative; border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 18px; background: var(--color-card); transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s; cursor: default; display: flex; flex-direction: column; }
.card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); border-color: var(--color-primary-light); }
.card.has-progress { border-left: 3px solid var(--color-primary); }
.card.open { z-index: 60; }
.card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
.card-header h3 { margin: 0; flex: 1; font-size: 16px; line-height: 1.4; word-break: break-all; }
.more-btn { padding: 4px 8px; border: none; background: none; cursor: pointer; color: var(--color-text-secondary); font-size: 20px; line-height: 1; border-radius: var(--radius-sm); transition: background 0.12s; }
.more-btn:hover { background: var(--color-border-light); }
.card-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.count-pill, .accuracy-pill, .creator-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 10px; border-radius: 12px;
  font-size: 12px; font-weight: 500;
}
.count-pill { background: var(--color-primary-light); color: var(--color-primary); }
.accuracy-pill { background: #dcfce7; color: #15803d; }
.creator-pill { background: #f3e8ff; color: #7c3aed; }
.accuracy-pill.mid { background: #fef3c7; color: #b45309; }
.accuracy-pill.low { background: #fee2e2; color: #b91c1c; }

.progress-row { margin-bottom: 14px; }
.progress-bar { height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.4s; }
.progress-text { font-size: 11px; color: var(--color-text-tertiary); margin-top: 4px; text-align: right; }

.actions { margin-top: auto; }
.primary-btn { width: 100%; padding: 10px 12px; border: none; border-radius: var(--radius-md); background: var(--color-primary); color: #fff; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.15s, transform 0.1s; }
.primary-btn:hover { background: var(--color-primary-dark); transform: translateY(-1px); }

.dropdown-menu { position: absolute; top: 50px; right: 12px; min-width: 160px; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 4px; z-index: 80; }
.dropdown-menu button { display: flex; align-items: center; width: 100%; text-align: left; padding: 8px 12px; border: none; background: none; cursor: pointer; color: var(--color-text); font-size: 13px; border-radius: var(--radius-sm); gap: 8px; }
.dropdown-menu button:hover { background: var(--color-border-light); }
.dropdown-menu button.danger { color: var(--color-danger); }
.dropdown-menu button.danger:hover { background: var(--color-danger-light); }

.modal { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; animation: fadeIn 0.15s; }
.modal-body { background: var(--color-card); padding: 24px; border-radius: var(--radius-lg); min-width: 340px; display: flex; flex-direction: column; gap: 10px; color: var(--color-text); box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal-body h3 { margin: 0 0 4px 0; }
.modal-body input, .modal-body textarea { padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-text); font-family: inherit; font-size: 14px; }
.modal-body textarea { min-height: 60px; resize: vertical; }
.modal-body input:focus, .modal-body textarea:focus { outline: none; border-color: var(--color-primary); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.modal-actions button { padding: 7px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; }
.modal-actions button:first-child { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.modal-actions button:first-child:hover { background: var(--color-primary-dark); }
.vis-options { display: flex; gap: 8px; }
.vis-option { flex: 1; display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: var(--color-bg); }
.vis-option.active { border-color: var(--color-primary); background: var(--color-primary-light); }
.vis-option > span { font-size: 18px; }
.vis-name { font-size: 13px; font-weight: 600; color: var(--color-text); }
.vis-desc { font-size: 11px; color: var(--color-text-tertiary); }
.vis-badge { font-size: 11px; margin-left: 6px; }
.vis-badge.public { color: #1d4ed8; }
.vis-badge.private { color: #b45309; }

.empty { text-align: center; padding: 80px 24px; color: var(--color-text-tertiary); }
.empty-icon { width: 88px; height: 88px; margin-bottom: 16px; opacity: 0.75; }
.empty-title { font-size: 18px; color: var(--color-text-secondary); margin: 0 0 8px 0; }
.empty-tip { font-size: 14px; margin: 0 0 20px 0; }
.empty-action { padding: 10px 24px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; font-weight: 500; }
.empty-action:hover { background: var(--color-primary-dark); }

/* 公共考试入口 banner */
.public-exam-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  margin-bottom: 18px;
  background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
  color: #fff;
  border-radius: var(--radius-lg);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
  transition: transform 0.15s, box-shadow 0.15s;
}
.public-exam-banner:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(245, 158, 11, 0.4); }
.pe-left { display: flex; align-items: center; gap: 14px; }
.pe-icon { width: 36px; height: 36px; }
.pe-title { font-size: 16px; font-weight: 700; }
.pe-sub { font-size: 12px; opacity: 0.9; margin-top: 2px; }
.pe-arrow { font-size: 30px; opacity: 0.8; line-height: 1; }

/* 公共题库区块 */
.public-section { margin-bottom: 24px; }
.section-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.section-header h3 { margin: 0; font-size: 17px; }
.section-sub { font-size: 12px; color: var(--color-text-tertiary); }
.public-grid { margin-top: 0; }
.public-card { border-color: var(--color-primary-light); background: linear-gradient(180deg, var(--color-card) 0%, rgba(124, 58, 237, 0.03) 100%); }
.public-card:hover { border-color: var(--color-primary); }

/* 添加到我的题库 */
.import-btn { width: 100%; margin-top: 8px; padding: 8px 12px; border: 1px dashed var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); color: var(--color-primary); cursor: pointer; font-size: 13px; font-weight: 500; transition: background 0.15s, transform 0.1s; }
.import-btn:hover:not(:disabled) { background: var(--color-primary); color: #fff; transform: translateY(-1px); }
.import-btn:disabled { cursor: default; opacity: 0.7; }
.imported-tag { margin-top: 8px; font-size: 12px; color: #15803d; background: #dcfce7; padding: 4px 10px; border-radius: 12px; text-align: center; }
.import-progress { margin-top: 8px; }
.import-bar { height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.import-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.2s; }

/* 移动端适配 */
@media (max-width: 768px) {
  .header { flex-direction: column; align-items: stretch; gap: 12px; }
  .header-btns { flex-wrap: wrap; }
  .header-btns button { flex: 1; min-width: 100px; padding: 9px 10px; font-size: 13px; }
  .new-bank-btn { flex: 1 1 100% !important; }
  .grid { grid-template-columns: 1fr; }
  .daily-card { flex-direction: column; align-items: stretch; gap: 10px; }
  .daily-progress { min-width: 0; }
  .dropdown-menu { right: 8px; }
  .resume-card { padding: 14px 16px; }
  .modal-body { min-width: 0; }
}

.resume-card { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; margin-bottom: 16px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border-radius: var(--radius-xl); cursor: pointer; box-shadow: 0 4px 12px rgba(66, 184, 131, 0.3); transition: transform 0.15s, box-shadow 0.15s; }
.resume-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(66, 184, 131, 0.4); }
.resume-label { font-size: 12px; opacity: 0.9; margin-bottom: 4px; letter-spacing: 1px; }
.resume-title { font-size: 18px; font-weight: bold; }
.resume-meta { font-size: 13px; opacity: 0.9; margin-top: 4px; }
.resume-arrow { font-size: 32px; line-height: 1; opacity: 0.8; }

/* 加载骨架 */
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
.skeleton-card { height: 160px; background: linear-gradient(90deg, var(--color-border-light) 0%, var(--color-card) 50%, var(--color-border-light) 100%); background-size: 200% 100%; border-radius: var(--radius-lg); animation: shimmer 1.4s infinite; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
