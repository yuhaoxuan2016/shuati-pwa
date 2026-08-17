<template>
  <div class="mix-exam">
    <!-- ===== 配置阶段 ===== -->
    <div v-if="!started" class="config-wrap">
      <div class="config-header">
        <h2>🎲 综合抽题考试</h2>
        <p class="config-sub">从多个题库随机抽题，合成一张试卷。每道题仍归属原题库，练习记录/错题/收藏各自归位。</p>
      </div>

      <div class="config-toolbar">
        <label class="toggle-all">
          <input type="checkbox" :checked="selectedIds.length === banks.length" @change="toggleAll" />
          全选
        </label>
        <span class="toolbar-hint">已选 {{ selectedIds.length }} 个题库 · {{ totalCount }} 题</span>
      </div>

      <!-- 题型配比（可选） -->
      <div class="type-config">
        <label class="type-toggle">
          <input type="checkbox" v-model="useTypeMix" />
          按题型配比抽题
        </label>
        <p v-if="useTypeMix" class="type-hint">在下方填写各题型数量，将从所选题库中按题型分别抽足（不足的题型按实际数量）</p>
        <div v-if="useTypeMix" class="type-inputs">
          <div class="type-field">
            <label>单选</label>
            <input type="number" v-model.number="typeCounts.single" min="0" max="500" class="type-input" />
          </div>
          <div class="type-field">
            <label>多选</label>
            <input type="number" v-model.number="typeCounts.multi" min="0" max="500" class="type-input" />
          </div>
          <div class="type-field">
            <label>判断</label>
            <input type="number" v-model.number="typeCounts.judge" min="0" max="500" class="type-input" />
          </div>
          <div class="type-field">
            <label>填空/问答</label>
            <input type="number" v-model.number="typeCounts.blank" min="0" max="500" class="type-input" />
          </div>
        </div>
      </div>

      <div v-if="loading" class="loading">加载题库中...</div>
      <div v-else-if="banks.length === 0" class="empty">
        <p>还没有题库，先去首页创建吧</p>
        <button class="primary-btn" @click="$router.push('/')">返回首页</button>
      </div>
      <div v-else class="bank-list">
        <div
          v-for="b in banks"
          :key="b.id"
          class="bank-item"
          :class="{ selected: selectedIds.includes(b.id) }"
          @click="toggleBank(b.id)"
        >
          <div class="bank-info">
            <div class="bank-check">{{ selectedIds.includes(b.id) ? '☑' : '☐' }}</div>
            <div class="bank-main">
              <div class="bank-name">{{ b.name }}</div>
              <div class="bank-count">{{ b.question_count }} 道题</div>
            </div>
          </div>
          <div class="bank-config" @click.stop>
            <input
              type="number"
              class="count-input"
              :min="1"
              :max="b.question_count"
              :value="counts[b.id] ?? 0"
              :disabled="!selectedIds.includes(b.id)"
              @input="onCountInput(b, ($event.target as HTMLInputElement).value)"
            />
            <span class="count-max">/ {{ b.question_count }}</span>
          </div>
        </div>
      </div>

      <div class="config-footer">
        <div class="duration-field">
          <label>考试时长（分钟）</label>
          <input type="number" v-model.number="durationMinutes" min="1" max="300" class="duration-input" />
        </div>
        <button class="start-btn" :disabled="!canStart" @click="startExam">
          🚀 开始考试（{{ totalCount }} 题）
        </button>
      </div>
    </div>

    <!-- ===== 考试阶段 ===== -->
    <div v-else>
      <!-- 顶栏 -->
      <div class="exam-topbar">
        <div class="exam-info">
          <span class="exam-badge">综合考试</span>
          <span class="exam-timer" :class="{ 'time-up': examTimeUp }">⏱ {{ formatTime(examRemaining) }}</span>
        </div>
        <div class="exam-progress">
          <span class="progress-text">{{ current + 1 }} / {{ examQuestions.length }}</span>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: ((current + 1) / Math.max(examQuestions.length, 1) * 100) + '%' }"></div>
          </div>
        </div>
        <div class="exam-actions">
          <label class="auto-next-toggle">
            <input type="checkbox" v-model="autoNext" />
            自动下一题
          </label>
          <button class="submit-btn" :disabled="submitted" @click="submit">交卷</button>
        </div>
      </div>

      <!-- 结果页 -->
      <div v-if="submitted" class="result-panel">
        <h3>考试结束</h3>
        <div class="result-stats">
          <div class="stat-card"><div class="stat-num">{{ result.correct }}</div><div class="stat-label">答对</div></div>
          <div class="stat-card"><div class="stat-num">{{ result.wrong }}</div><div class="stat-label">答错</div></div>
          <div class="stat-card"><div class="stat-num">{{ result.unanswered }}</div><div class="stat-label">未答</div></div>
          <div class="stat-card highlight"><div class="stat-num">{{ result.score }}</div><div class="stat-label">得分</div></div>
        </div>
        <p class="result-hint">总分 100 · 正确率 {{ result.accuracy }}%</p>
        <div class="result-actions">
          <button @click="resetAll">再考一次</button>
          <button @click="goHome">返回首页</button>
        </div>
        <!-- 按题库统计 -->
        <div class="bank-breakdown" v-if="bankBreakdown.length">
          <h4>分题库成绩</h4>
          <div v-for="bb in bankBreakdown" :key="bb.bank_id" class="breakdown-row">
            <span class="bd-name">{{ bb.name }}</span>
            <span class="bd-stat">{{ bb.correct }}✓ / {{ bb.wrong }}✗ / {{ bb.unanswered }}○</span>
          </div>
        </div>
      </div>

      <!-- 答题区 -->
      <div v-else-if="examQuestions.length">
        <QuestionCard
          :key="`${currentQuestion.id}-${reloadKey}`"
          :question="currentQuestion"
          :index="current"
          :exam-mode="true"
          :auto-next="autoNext"
          :has-prev="current > 0"
          :saved-state="answerStates.get(currentQuestion.id) || null"
          @answered="onAnswered"
          @state-change="onStateChange"
          @next="next"
          @prev="prev"
          @toggle-favorite="onToggleFavorite"
          @question-updated="onQuestionUpdated"
        />
        <div class="bank-tag">📁 所属题库：{{ bankNameOf(currentQuestion.bank_id) }}</div>

        <!-- 题目导航 -->
        <div class="question-nav" v-if="examQuestions.length > 1">
          <div class="nav-dots">
            <button
              v-for="(q, i) in examQuestions"
              :key="q.id"
              class="nav-dot"
              :class="getDotClass(i, q.id)"
              @click="goTo(i)"
            >{{ i + 1 }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useBankStore } from '../stores/bank'
import { api, Question } from '../utils/api'
import { classifyQuestionType } from '../lib/exam'
import { toastError, toastSuccess } from '../utils/toast'
import QuestionCard, { type QuestionState } from '../components/QuestionCard.vue'

const router = useRouter()
const bankStore = useBankStore()
const banks = computed(() => bankStore.banks)
const loading = ref(false)

// 配置状态
const selectedIds = ref<number[]>([])
const counts = ref<Record<number, number>>({})
const durationMinutes = ref(60)
const started = ref(false)
// 题型配比
const useTypeMix = ref(false)
const typeCounts = ref<Record<'single' | 'multi' | 'judge' | 'blank', number>>({ single: 10, multi: 5, judge: 5, blank: 0 })

const typeTotal = computed(() => useTypeMix.value
  ? typeCounts.value.single + typeCounts.value.multi + typeCounts.value.judge + typeCounts.value.blank
  : 0)

// 可开始条件：自由模式要有题库+数量；配比模式要有题库+至少一种题型数量>0
const canStart = computed(() => {
  if (!selectedIds.value.length) return false
  if (useTypeMix.value) return typeTotal.value > 0
  return totalCount.value > 0
})

const totalCount = computed(() =>
  useTypeMix.value ? typeTotal.value
    : selectedIds.value.reduce((s, id) => s + (counts.value[id] || 0), 0)
)

// 考试状态
const examQuestions = ref<Question[]>([])
const current = ref(0)
const answerStates = ref<Map<number, QuestionState>>(new Map())
const submitted = ref(false)
const examTimeUp = ref(false)
const examRemaining = ref(0)
const result = ref({ correct: 0, wrong: 0, unanswered: 0, score: 0, accuracy: 0 })
const bankBreakdown = ref<{ bank_id: number; name: string; correct: number; wrong: number; unanswered: number }[]>([])
const reloadKey = ref(0)
const autoNext = ref(false)

let examStartMs: number | null = null
let timerId: number | null = null

function toggleBank(id: number) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1)
  } else {
    selectedIds.value.push(id)
    if (!counts.value[id]) counts.value[id] = banks.value.find(b => b.id === id)?.question_count || 0
  }
}
function toggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) {
    selectedIds.value = banks.value.map(b => b.id)
    for (const b of banks.value) if (!counts.value[b.id]) counts.value[b.id] = b.question_count
  } else {
    selectedIds.value = []
  }
}
function onCountInput(b: { id: number; question_count: number }, val: string) {
  const n = Math.max(1, Math.min(b.question_count, parseInt(val) || 0))
  counts.value[b.id] = n
}
function bankNameOf(id: number): string {
  return banks.value.find(b => b.id === id)?.name || ''
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const currentQuestion = computed(() => examQuestions.value[current.value] || null)

async function startExam() {
  try {
    loading.value = true
    const picked: Question[] = []

    if (useTypeMix.value) {
      // 按题型配比：从所有选中题库收集题目，按题型分别抽足
      const pool: Question[] = []
      for (const id of selectedIds.value) {
        const all = await api.listQuestions(id)
        pool.push(...all)
      }
      const want = { ...typeCounts.value }
      // 每个题型：从池中筛出该题型，随机抽足数量
      for (const t of ['single', 'multi', 'judge', 'blank'] as const) {
        const need = want[t]
        if (need <= 0) continue
        const candidates = pool.filter(q => classifyQuestionType(q) === t)
        const src = shuffle(candidates).slice(0, need)
        picked.push(...src)
      }
    } else {
      // 自由模式：从每个选中题库抽题（原逻辑）
      for (const id of selectedIds.value) {
        const all = await api.listQuestions(id)
        const count = Math.min(counts.value[id] || 0, all.length)
        const src = shuffle(all).slice(0, count)
        picked.push(...src)
      }
    }

    if (!picked.length) {
      toastError('没有可抽取的题目')
      return
    }
    // 按题型排序：单选 → 多选 → 判断 → 其他（不打乱，保持有序）
    const typeOrder: Record<string, number> = { single: 0, multi: 1, judge: 2 }
    examQuestions.value = [...picked].sort((a, b) =>
      (typeOrder[classifyQuestionType(a)] ?? 9) - (typeOrder[classifyQuestionType(b)] ?? 9)
    )
    current.value = 0
    answerStates.value = new Map()
    submitted.value = false
    examTimeUp.value = false
    started.value = true
    // 启动计时
    const secs = Math.max(1, durationMinutes.value || 1) * 60
    examRemaining.value = secs
    examStartMs = Date.now()
    stopTimer()
    timerId = window.setInterval(tick, 1000)
    toastSuccess(`已生成 ${examQuestions.value.length} 题的综合试卷`)
  } catch (e) {
    toastError('抽题失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    loading.value = false
  }
}

function tick() {
  if (examStartMs === null) return
  const elapsed = Math.floor((Date.now() - examStartMs) / 1000)
  const total = Math.max(1, durationMinutes.value || 1) * 60
  const remaining = total - elapsed
  examRemaining.value = remaining > 0 ? remaining : 0
  if (remaining <= 0) {
    examTimeUp.value = true
    submit()
  }
}
function stopTimer() {
  if (timerId) { window.clearInterval(timerId); timerId = null }
}

function submit() {
  if (submitted.value) return
  stopTimer()
  let correct = 0, wrong = 0, unanswered = 0
  const bd = new Map<number, { name: string; correct: number; wrong: number; unanswered: number }>()
  for (const q of examQuestions.value) {
    const state = answerStates.value.get(q.id)
    const b = bd.get(q.bank_id) || { name: bankNameOf(q.bank_id), correct: 0, wrong: 0, unanswered: 0 }
    if (!state || !state.submitted) { unanswered++; b.unanswered++ }
    else if (state.isCorrect) { correct++; b.correct++ }
    else { wrong++; b.wrong++ }
    bd.set(q.bank_id, b)
  }
  const total = examQuestions.value.length || 1
  const accuracy = Math.round((correct / total) * 100)
  const score = Math.round((correct / total) * 100)
  result.value = { correct, wrong, unanswered, score, accuracy }
  bankBreakdown.value = Array.from(bd.entries()).map(([bank_id, v]) => ({ bank_id, ...v }))
  submitted.value = true
}

function next() {
  if (current.value < examQuestions.value.length - 1) current.value++
}
function prev() {
  if (current.value > 0) current.value--
}
function goTo(i: number) { current.value = i }

function onStateChange(state: QuestionState) {
  const q = currentQuestion.value
  if (q) answerStates.value.set(q.id, state)
}
async function onAnswered(payload: { correct: boolean; answer: string; duration_ms: number | null }) {
  const q = currentQuestion.value
  if (!q) return
  try {
    await api.recordPractice({ bank_id: q.bank_id, question_id: q.id, user_answer: payload.answer, is_correct: payload.correct, duration_ms: payload.duration_ms })
    // 答错自动进错题本（api.recordPractice 内部处理）
  } catch (e) { console.error('记录练习失败：', e) }
}
function onToggleFavorite() {
  const q = currentQuestion.value
  if (!q) return
  api.toggleFavorite(q.bank_id, q.id).catch(e => console.error('收藏失败：', e))
}
function onQuestionUpdated(updated: Question) {
  const idx = examQuestions.value.findIndex(x => x.id === updated.id)
  if (idx >= 0) examQuestions.value[idx] = updated
  reloadKey.value++
}
function getDotClass(listIdx: number, qid: number): string {
  const classes: string[] = []
  if (qid === currentQuestion.value?.id) classes.push('current')
  const s = answerStates.value.get(qid)
  if (s?.submitted) {
    if (submitted.value) {
      // 交卷后才显示对错
      if (s.isCorrect === true) classes.push('correct')
      else if (s.isCorrect === false) classes.push('wrong')
    } else {
      // 交卷前只显示已答，不泄露对错
      classes.push('answered')
    }
  }
  return classes.join(' ')
}

function resetAll() {
  stopTimer()
  started.value = false
  submitted.value = false
  examQuestions.value = []
  answerStates.value = new Map()
  current.value = 0
}
function goHome() {
  stopTimer()
  router.push('/')
}

onMounted(async () => {
  try {
    loading.value = true
    await bankStore.load()
  } catch (e) {
    toastError('加载题库失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => stopTimer())
</script>

<style scoped>
.config-wrap { max-width: 760px; margin: 0 auto; }
.config-header { margin-bottom: 20px; }
.config-header h2 { margin: 0 0 6px 0; }
.config-sub { color: var(--color-text-secondary); font-size: 13px; margin: 0; }
.config-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding: 10px 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.toggle-all { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; color: var(--color-text); }
.toolbar-hint { font-size: 12px; color: var(--color-text-secondary); }
.bank-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.bank-item { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; transition: all 0.15s; }
.bank-item:hover { border-color: var(--color-primary); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.bank-item.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.bank-info { display: flex; align-items: center; gap: 12px; }
.bank-check { font-size: 20px; color: var(--color-primary); }
.bank-name { font-weight: 600; font-size: 15px; }
.bank-count { font-size: 12px; color: var(--color-text-secondary); margin-top: 2px; }
.bank-config { display: flex; align-items: center; gap: 6px; }
.count-input { width: 60px; padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; text-align: center; color: var(--color-text); background: var(--color-bg); }
.count-input:disabled { opacity: 0.4; }
.count-max { font-size: 12px; color: var(--color-text-tertiary); }
.config-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 16px; border-top: 1px solid var(--color-border-light); }
.duration-field { display: flex; align-items: center; gap: 8px; }
.duration-field label { font-size: 13px; color: var(--color-text-secondary); }
.duration-input { width: 70px; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; text-align: center; color: var(--color-text); background: var(--color-bg); }
.start-btn { padding: 11px 26px; background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.15s; box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3); }
.start-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4); }
.start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.exam-topbar { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 16px; flex-wrap: wrap; }
.exam-info { display: flex; align-items: center; gap: 10px; }
.exam-badge { padding: 3px 10px; background: #eef2ff; color: #4f46e5; border-radius: 12px; font-size: 12px; font-weight: 600; }
.exam-timer { font-family: monospace; font-size: 14px; font-weight: 600; padding: 4px 12px; background: var(--color-info-light); color: var(--color-info); border-radius: var(--radius-md); }
.exam-timer.time-up { background: var(--color-danger-light); color: var(--color-danger); animation: pulse 1s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
.exam-progress { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 140px; }
.progress-text { font-size: 12px; color: var(--color-text-secondary); font-family: monospace; white-space: nowrap; }
.progress-track { flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #4f46e5); border-radius: 3px; transition: width 0.3s; }
.submit-btn { padding: 8px 20px; background: var(--color-danger); color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; cursor: pointer; }
.submit-btn:hover:not(:disabled) { opacity: 0.9; }
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.auto-next-toggle { display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; color: var(--color-text-secondary); white-space: nowrap; }
.auto-next-toggle input { cursor: pointer; }

.bank-tag { margin-top: 10px; font-size: 12px; color: var(--color-text-tertiary); }
.question-nav { margin-top: 14px; padding: 12px 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.nav-dots { display: flex; flex-wrap: wrap; gap: 4px; max-height: 160px; overflow-y: auto; }
.nav-dot { min-width: 28px; height: 28px; padding: 0 4px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-card); color: var(--color-text-secondary); font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-weight: 500; }
.nav-dot:hover { border-color: var(--color-primary); color: var(--color-primary); }
.nav-dot.current { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.nav-dot.answered { background: #e0e7ff; color: #4f46e5; border-color: #c7d2fe; }
.nav-dot.correct { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
.nav-dot.wrong { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }

.result-panel { text-align: center; padding: 32px; }
.result-panel h3 { margin-bottom: 24px; }
.result-stats { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px; }
.stat-card { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px 24px; min-width: 100px; }
.stat-card.highlight { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #fff; border-color: transparent; }
.stat-num { font-size: 28px; font-weight: 600; }
.stat-label { font-size: 13px; opacity: 0.8; margin-top: 4px; }
.result-hint { color: var(--color-text-secondary); margin: 16px 0; }
.result-actions { margin-top: 20px; }
.result-actions button { margin: 8px; padding: 9px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; }
.result-actions button:first-child { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.bank-breakdown { margin-top: 28px; padding: 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); text-align: left; }
.bank-breakdown h4 { margin: 0 0 10px 0; font-size: 14px; }
.breakdown-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--color-border-light); font-size: 13px; }
.breakdown-row:last-child { border-bottom: none; }
.bd-name { font-weight: 500; }
.bd-stat { color: var(--color-text-secondary); font-family: monospace; }

.loading, .empty { text-align: center; padding: 48px; color: var(--color-text-tertiary); }
.primary-btn { padding: 9px 18px; background: var(--color-primary); color: #fff; border: none; border-radius: var(--radius-md); cursor: pointer; font-size: 14px; }

/* 题型配比 */
.type-config { margin-bottom: 16px; padding: 14px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.type-toggle { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; cursor: pointer; color: var(--color-text); }
.type-hint { font-size: 12px; color: var(--color-text-tertiary); margin: 8px 0 10px 0; }
.type-inputs { display: flex; gap: 14px; flex-wrap: wrap; }
.type-field { display: flex; align-items: center; gap: 8px; }
.type-field label { font-size: 13px; color: var(--color-text-secondary); white-space: nowrap; }
.type-input { width: 64px; padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; text-align: center; color: var(--color-text); background: var(--color-bg); }

/* 移动端适配 */
@media (max-width: 768px) {
  .bank-item { flex-wrap: wrap; gap: 8px; }
  .bank-info { flex: 1 1 100%; }
  .config-footer { flex-direction: column; align-items: stretch; }
  .duration-field { justify-content: space-between; }
  .start-btn { width: 100%; }
  .exam-progress { min-width: 100%; }
  .config-toolbar { flex-wrap: wrap; gap: 6px; }
  .result-panel { padding: 20px 12px; }
}
</style>
