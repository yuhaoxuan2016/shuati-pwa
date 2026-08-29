<template>
  <div class="compose-exam">
    <!-- ===== 配置阶段 ===== -->
    <div v-if="!started" class="config-wrap">
      <div class="config-header">
        <h2>🎲 智能组卷 · 综合大考</h2>
        <p class="config-sub">按「等级 × 题型」配额，从公共题库随机抽题合成 220 题综合卷。每次开始都会重新组卷，每场卷子都不同。</p>
        <button class="history-btn" @click="openHistory">📜 历史记录（{{ historyCount }}）</button>
      </div>

      <!-- 配额表 -->
      <div class="quota-table">
        <div class="quota-row quota-head">
          <span>等级</span><span>单选</span><span>多选</span><span>判断</span><span>小计</span>
        </div>
        <div v-for="s in SPEC" :key="s.level" class="quota-row">
          <span class="q-level">{{ s.level }}</span>
          <span>{{ s.single }}</span><span>{{ s.multi }}</span><span>{{ s.judge }}</span>
          <span class="q-subtotal">{{ s.single + s.multi + s.judge }}</span>
        </div>
        <div class="quota-row quota-total">
          <span>合计</span><span>80</span><span>40</span><span>100</span><span>220</span>
        </div>
      </div>

      <div class="config-footer">
        <div class="duration-field">
          <label>考试时长（分钟）</label>
          <input type="number" v-model.number="durationMinutes" min="1" max="300" class="duration-input" />
        </div>
        <button class="start-btn" :disabled="loading" @click="startExam">
          {{ loading ? '组卷中…' : '🚀 开始组卷考试（220 题）' }}
        </button>
      </div>
      <div v-if="loading" class="loading">{{ progressText }}</div>
      <p v-else class="retake-tip">💡 考完可以「再考一次」换一套新卷子</p>
    </div>

    <!-- ===== 考试阶段 ===== -->
    <div v-else>
      <!-- 顶栏 -->
      <div class="exam-topbar">
        <div class="exam-info">
          <span class="exam-badge">综合大考</span>
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
        <!-- 记录码 + 错题回看（2026-08-15 新增） -->
        <div v-if="lastRecordCode" class="record-box">
          <div class="record-label">📋 本场记录码（保存好，可在历史记录中回看错题）</div>
          <div class="record-value" @click="copyRecordCode">{{ lastRecordCode }} <span class="copy-tip">点击复制</span></div>
        </div>
        <div class="result-actions">
          <button class="review-btn" @click="openWrongReview">🔍 查看错题（{{ wrongCount }}）</button>
          <button class="add-wrong-btn" :disabled="addingWrong" @click="addWrongToBook">
            {{ addingWrong ? '添加中...' : '📥 错题加入错题本' }}
          </button>
          <button @click="resetAll">🎲 再考一次（换新卷）</button>
          <button @click="goHome">返回首页</button>
        </div>
        <p v-if="addWrongMsg" class="add-wrong-msg" :class="{ warn: addWrongErr }">{{ addWrongMsg }}</p>
        <!-- 分等级成绩 -->
        <div class="level-breakdown" v-if="levelBreakdown.length">
          <h4>分等级成绩</h4>
          <div v-for="bb in levelBreakdown" :key="bb.level" class="breakdown-row">
            <span class="bd-name">{{ bb.level }}</span>
            <span class="bd-stat">{{ bb.correct }}✓ / {{ bb.wrong }}✗ / {{ bb.unanswered }}○</span>
          </div>
        </div>
      </div>

      <!-- 2026-08-20：交卷后答题回顾（可逐题翻阅，红=错 绿=对） -->
      <div v-if="submitted && examQuestions.length" class="review-section">
        <h3 class="review-title">📋 答题回顾 <span class="review-sub">点击题号查看详情</span></h3>
        <QuestionCard
          :key="`${currentQuestion.id}-review-${reloadKey}`"
          :question="currentQuestion"
          :index="current"
          :has-prev="current > 0"
          :saved-state="answerStates.get(currentQuestion.id) || null"
          :read-only="true"
          @next="next"
          @prev="prev"
        />
        <div class="level-tag">📁 所属等级：{{ levelNameOf(currentQuestion.id) }}</div>
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

      <!-- 答题区 -->
      <div v-if="!submitted && examQuestions.length">
        <QuestionCard
          :key="`${currentQuestion.id}-${reloadKey}`"
          :question="currentQuestion"
          :index="current"
          :exam-mode="true"
          :auto-next="autoNext"
          :has-prev="current > 0"
          :saved-state="answerStates.get(currentQuestion.id) || null"
          :defer-submit="true"
          @answered="onAnswered"
          @state-change="onStateChange"
          @next="next"
          @prev="prev"
          @toggle-favorite="onToggleFavorite"
          @question-updated="onQuestionUpdated"
        />
        <div class="level-tag">📁 所属等级：{{ levelNameOf(currentQuestion.id) }}</div>

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

    <!-- 错题回看弹窗 -->
    <Teleport to="body">
      <div v-if="showWrongReview" class="modal-mask" @click.self="showWrongReview = false">
        <div class="modal-body review-modal">
          <h3>🔍 本场错题（{{ reviewWrongs.length }} 题）</h3>
          <div v-if="reviewWrongs.length" class="wrong-list">
            <div v-for="(w, i) in reviewWrongs" :key="i" class="wrong-item">
              <div class="wrong-q">{{ i + 1 }}. {{ w.stem }}</div>
              <div v-if="w.type === 'single' || w.type === 'multi'" class="wrong-options">
                <div v-for="(opt, oi) in parseWrongOptions(w.options)" :key="oi" class="wrong-option"
                  :class="{ 'is-mine': rawHas(w.myRaw, oi), 'is-answer': rawHas(w.correctRaw, oi) }">
                  <span class="wrong-opt-letter">{{ String.fromCharCode(65 + oi) }}</span>
                  <span class="wrong-opt-text">{{ opt }}</span>
                  <span v-if="rawHas(w.myRaw, oi)" class="wrong-opt-tag mine">我的答案</span>
                  <span v-if="rawHas(w.correctRaw, oi)" class="wrong-opt-tag answer">正确答案</span>
                </div>
              </div>
              <div v-else-if="w.type === 'judge'" class="wrong-options">
                <div class="wrong-option" :class="{ 'is-mine': w.myRaw === 'true', 'is-answer': w.correctRaw === 'true' }">
                  <span class="wrong-opt-letter">√</span><span class="wrong-opt-text">正确</span>
                  <span v-if="w.myRaw === 'true'" class="wrong-opt-tag mine">我的答案</span>
                  <span v-if="w.correctRaw === 'true'" class="wrong-opt-tag answer">正确答案</span>
                </div>
                <div class="wrong-option" :class="{ 'is-mine': w.myRaw === 'false', 'is-answer': w.correctRaw === 'false' }">
                  <span class="wrong-opt-letter">×</span><span class="wrong-opt-text">错误</span>
                  <span v-if="w.myRaw === 'false'" class="wrong-opt-tag mine">我的答案</span>
                  <span v-if="w.correctRaw === 'false'" class="wrong-opt-tag answer">正确答案</span>
                </div>
              </div>
              <div class="wrong-row"><span class="wrong-label mine">你的答案：</span>{{ w.myAnswer }}</div>
              <div class="wrong-row"><span class="wrong-label correct">正确答案：</span>{{ w.correctAnswer }}</div>
              <div v-if="w.analysis" class="wrong-analysis">💡 {{ w.analysis }}</div>
            </div>
          </div>
          <p v-else class="hint">本场没有错题，太棒了！🎉</p>
          <div class="modal-actions">
            <button @click="showWrongReview = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 历史记录弹窗 -->
    <Teleport to="body">
      <div v-if="showHistory" class="modal-mask" @click.self="showHistory = false">
        <div class="modal-body history-modal">
          <h3>📜 组卷历史记录</h3>
          <p v-if="!historyRecords.length" class="hint">还没有历史记录，考一场试试~</p>
          <div v-else class="history-list">
            <div v-for="r in historyRecords" :key="r.id" class="history-item" @click="viewHistoryRecord(r)">
              <div class="hi-main">
                <span class="hi-score">{{ r.score }}<small>分</small></span>
                <div class="hi-meta">
                  <div class="hi-title">正确率 {{ r.accuracy }}% · 答对 {{ r.correct }} / 答错 {{ r.wrong }} / 未答 {{ r.unanswered }}</div>
                  <div class="hi-sub">{{ formatHistoryTime(r.created_at) }} · 记录码 {{ r.query_code }}</div>
                </div>
              </div>
              <button class="hi-del" title="删除该记录" @click.stop="deleteHistoryRecord(r.id)">🗑</button>
            </div>
          </div>
          <div class="modal-actions">
            <button @click="showHistory = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { listPublicBankQuestions, classifyQuestionType, judgeAnswerBool, gradeByState, COMPOSE_SPEC as SPEC } from '../lib/exam'
import { idb } from '../lib/db'
import { toastError, toastSuccess } from '../utils/toast'
import QuestionCard, { type QuestionState } from '../components/QuestionCard.vue'

const router = useRouter()

// 配置状态
const loading = ref(false)
const progressText = ref('')
const durationMinutes = ref(180)
const started = ref(false)

// 考试状态
const examQuestions = ref<any[]>([])
const current = ref(0)
const answerStates = ref<Map<number, QuestionState>>(new Map())
const submitted = ref(false)
const examTimeUp = ref(false)
const examRemaining = ref(0)
const result = ref({ correct: 0, wrong: 0, unanswered: 0, score: 0, accuracy: 0 })
const levelBreakdown = ref<{ level: string; correct: number; wrong: number; unanswered: number }[]>([])
const levelOfMap = ref<Map<number, string>>(new Map())
const reloadKey = ref(0)
const autoNext = ref(false)

// === 记录查询（2026-08-15 新增） ===
const historyCount = ref(0)
const showHistory = ref(false)
const historyRecords = ref<any[]>([])
const showWrongReview = ref(false)
const reviewWrongs = ref<any[]>([])
const lastRecordCode = ref('')

let examStartMs: number | null = null
let timerId: number | null = null

onMounted(async () => { try { historyCount.value = (await idb.listComposeRecords()).length } catch { /* ignore */ } })

const currentQuestion = computed(() => examQuestions.value[current.value] || null)
const wrongCount = computed(() => result.value.wrong)

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

// 云端题目无本地 id，统一分配序号；判断题归一为 type:'judge' + answer 'true'/'false'
function normalizeQuestion(q: any, id: number, t: 'single' | 'multi' | 'judge'): any {
  if (t === 'judge') {
    let opts: string[] = []
    try { const p = JSON.parse(q.options || '[]'); if (Array.isArray(p)) opts = p.map((o: any) => String(o)) } catch { /* ignore */ }
    return {
      id, bank_id: 0, stem: q.stem, type: 'judge',
      options: JSON.stringify(['正确', '错误']),
      answer: judgeAnswerBool(q.answer, opts.length ? opts : null),
      analysis: q.analysis, source_index: q.source_index ?? null,
    }
  }
  return { id, bank_id: 0, stem: q.stem, type: t, options: q.options, answer: q.answer, analysis: q.analysis, source_index: q.source_index ?? null }
}

async function drawQuestions(): Promise<{ picked: any[]; levelOf: Map<number, string> }> {
  const picked: any[] = []
  const levelOf = new Map<number, string>()
  let seq = 0
  for (let i = 0; i < SPEC.length; i++) {
    const s = SPEC[i]
    progressText.value = `正在拉取「${s.level}」题库…（${i + 1}/${SPEC.length}）`
    let all: any[] = []
    try { all = await listPublicBankQuestions(s.bank) } catch { all = [] }
    if (!all.length) { progressText.value = `⚠️ 「${s.level}」题库拉取失败/为空，跳过`; continue }
    const bucket: Record<'single' | 'multi' | 'judge', any[]> = { single: [], multi: [], judge: [] }
    for (const q of all) {
      const t = classifyQuestionType(q)
      if (t === 'single' || t === 'multi' || t === 'judge') bucket[t].push(q)
    }
    progressText.value = `正在从「${s.level}」随机抽题…`
    for (const t of ['single', 'multi', 'judge'] as const) {
      const n = Math.min(s[t], bucket[t].length)
      for (const q of shuffle(bucket[t]).slice(0, n)) {
        seq++
        picked.push(normalizeQuestion(q, seq, t))
        levelOf.set(seq, s.level)
      }
    }
    progressText.value = `「${s.level}」完成：${all.length} 题 → 抽 ${s.single + s.multi + s.judge} 题`
  }
  return { picked, levelOf }
}

async function startExam() {
  try {
    loading.value = true
    progressText.value = '准备中…'
    const { picked, levelOf } = await drawQuestions()
    if (!picked.length) { toastError('没有可抽取的题目，请检查网络后重试'); return }
    levelOfMap.value = levelOf
    // 按题型排序：单选 → 多选 → 判断，不打乱
    const typeOrder: Record<string, number> = { single: 0, multi: 1, judge: 2 }
    examQuestions.value = [...picked].sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9))
    current.value = 0
    answerStates.value = new Map()
    submitted.value = false
    examTimeUp.value = false
    started.value = true
    const secs = Math.max(1, durationMinutes.value || 1) * 60
    examRemaining.value = secs
    examStartMs = Date.now()
    stopTimer()
    timerId = window.setInterval(tick, 1000)
    toastSuccess(`已生成 ${examQuestions.value.length} 题综合卷`)
  } catch (e) {
    toastError('组卷失败：' + (e instanceof Error ? e.message : String(e)))
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

async function submit() {
  if (submitted.value) return
  stopTimer()
  let correct = 0, wrong = 0, unanswered = 0
  const bd = new Map<string, { correct: number; wrong: number; unanswered: number }>()
  // 2026-08-20：交卷统一判分（考试模式 deferSubmit 不锁定，交卷时才判定并补写状态供回顾）
  for (const q of examQuestions.value) {
    const raw = answerStates.value.get(q.id)
    const lv = levelOfMap.value.get(q.id) || '未知'
    const b = bd.get(lv) || { correct: 0, wrong: 0, unanswered: 0 }
    let st: QuestionState | null = null
    if (raw) {
      const isCorrect = gradeByState(q, raw)
      st = { ...raw, submitted: true, isCorrect }
      answerStates.value.set(q.id, st)
    }
    if (!st) { unanswered++; b.unanswered++ }
    else if (st.isCorrect) { correct++; b.correct++ }
    else { wrong++; b.wrong++ }
    bd.set(lv, b)
  }
  const total = examQuestions.value.length || 1
  const accuracy = Math.round((correct / total) * 100)
  const score = Math.round((correct / total) * 100)
  result.value = { correct, wrong, unanswered, score, accuracy }
  levelBreakdown.value = Array.from(bd.entries()).map(([level, v]) => ({ level, ...v }))
  submitted.value = true
  // 保存历史记录 + 生成记录码（2026-08-15 新增）
  try {
    const code = genRecordCode()
    await saveRecord(code)
    lastRecordCode.value = code
    historyCount.value++
  } catch (e) {
    console.warn('保存组卷记录失败：', e)
  }
}

// 2026-08-20 修复：当场考试的错题明细此前从未构建（只有历史记录回看才有），点「查看错题」永远显示 0
function openWrongReview() {
  reviewWrongs.value = buildWrongs(examQuestions.value, Object.fromEntries(answerStates.value))
  showWrongReview.value = true
}

// 生成记录码：随机 4 位大写字母数字（带 Z 前缀区分组卷记录）
function genRecordCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let rand = ''
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)]
  return 'Z' + rand
}

// 保存本次记录到本地 IndexedDB（全部 JSON 深拷贝：规避 Vue 响应式 Proxy 无法 structured clone 的 DataCloneError）
async function saveRecord(code: string) {
  const answers: Record<number, any> = {}
  for (const [qid, st] of answerStates.value) {
    answers[Number(qid)] = JSON.parse(JSON.stringify(st))
  }
  await idb.addComposeRecord(JSON.parse(JSON.stringify({
    query_code: code,
    created_at: new Date().toISOString(),
    duration_ms: examStartMs ? Date.now() - examStartMs : null,
    score: result.value.score,
    accuracy: result.value.accuracy,
    correct: result.value.correct,
    wrong: result.value.wrong,
    unanswered: result.value.unanswered,
    questions: examQuestions.value,
    answers,
  })))
}

// 从记录构建错题明细（题干/选项/我的答案/正确答案/解析）
function buildWrongs(questions: any[], answers: Record<string, any>): any[] {
  const out: any[] = []
  for (const q of questions) {
    const st = answers[String(q.id)]
    if (!st || !st.submitted || st.isCorrect) continue
    out.push({
      stem: q.stem,
      type: q.type,
      options: q.options,
      analysis: q.analysis || null,
      myAnswer: formatMyAnswer(q, st),
      correctAnswer: formatCorrectAnswer(q),
      myRaw: rawOf(q, st),
      correctRaw: rawCorrectOf(q),
    })
  }
  return out
}
function rawOf(q: any, st: QuestionState): string | null {
  if (q.type === 'judge') return st.judgeSelected == null ? null : String(st.judgeSelected)
  if (q.type === 'single' || q.type === 'multi') {
    if (!st.selected.length) return null
    return st.selected.map(i => String.fromCharCode(65 + i)).join('、')
  }
  return st.blankAnswer || null
}
function rawCorrectOf(q: any): string | null {
  if (q.type === 'judge') {
    const v = String(q.answer ?? '').trim().toLowerCase()
    if (v === 'true' || v === '对' || v === '√' || v === 'a' || v === 't') return 'true'
    if (v === 'false' || v === '错' || v === '×' || v === 'b' || v === 'f') return 'false'
    return null
  }
  if (q.type === 'single' || q.type === 'multi') return String(q.answer ?? '')
  return null
}
function formatMyAnswer(q: any, st: QuestionState): string {
  if (q.type === 'judge') return st.judgeSelected == null ? '（未答）' : (st.judgeSelected ? '√ 正确' : '× 错误')
  if (q.type === 'single' || q.type === 'multi') {
    if (!st.selected.length) return '（未选）'
    return st.selected.map(i => String.fromCharCode(65 + i)).join('、')
  }
  return st.blankAnswer || '（未答）'
}
function formatCorrectAnswer(q: any): string {
  if (q.type === 'judge') {
    const v = String(q.answer ?? '').trim().toLowerCase()
    if (v === 'true' || v === '对' || v === '√' || v === 'a' || v === 't') return '√ 正确'
    if (v === 'false' || v === '错' || v === '×' || v === 'b' || v === 'f') return '× 错误'
    return String(q.answer ?? '')
  }
  return String(q.answer ?? '（未识别）')
}

// 错题选项渲染辅助
function parseWrongOptions(options: string | null): string[] {
  if (!options) return []
  try {
    const p = JSON.parse(options)
    return Array.isArray(p) ? p.map((o: any) => String(o)) : []
  } catch { return [] }
}
function rawHas(raw: string | null, oi: number): boolean {
  if (!raw) return false
  return raw.split(/[、,，\s]/).includes(String.fromCharCode(65 + oi))
}

// 历史记录
async function openHistory() {
  try {
    historyRecords.value = await idb.listComposeRecords()
    showHistory.value = true
  } catch (e) {
    toastError('加载历史记录失败：' + (e instanceof Error ? e.message : String(e)))
  }
}
function viewHistoryRecord(r: any) {
  showHistory.value = false
  reviewWrongs.value = buildWrongs(r.questions || [], r.answers || {})
  showWrongReview.value = true
}
async function deleteHistoryRecord(id: number) {
  if (!confirm('删除该条记录？不可恢复。')) return
  try {
    await idb.deleteComposeRecord(id)
    historyRecords.value = await idb.listComposeRecords()
    historyCount.value = historyRecords.value.length
  } catch (e) {
    toastError('删除失败：' + (e instanceof Error ? e.message : String(e)))
  }
}
function formatHistoryTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}
async function copyRecordCode() {
  if (!lastRecordCode.value) return
  try {
    await navigator.clipboard.writeText(lastRecordCode.value)
    toastSuccess('记录码已复制')
  } catch {
    toastError('复制失败，请手动记录')
  }
}

function next() {
  if (current.value < examQuestions.value.length - 1) current.value++
}
function prev() {
  if (current.value > 0) current.value--
}
function goTo(i: number) { current.value = i }

function levelNameOf(id: number): string {
  return levelOfMap.value.get(id) || ''
}

function onStateChange(state: QuestionState) {
  const q = currentQuestion.value
  if (q) answerStates.value.set(q.id, state)
}
function onAnswered() {
  // 综合大考为自测模式：不写练习记录/错题本，交卷后看成绩与分等级明细
}

// 错题加入错题本
const addingWrong = ref(false)
const addWrongMsg = ref('')
const addWrongErr = ref(false)

async function addWrongToBook() {
  if (addingWrong.value) return
  addingWrong.value = true
  addWrongMsg.value = ''
  addWrongErr.value = false
  try {
    let added = 0, skipped = 0
    for (const q of examQuestions.value) {
      const st = answerStates.value.get(q.id)
      if (!st || !st.submitted || st.isCorrect) continue
      if (!q.bank_id || q.bank_id <= 0) { skipped++; continue }
      await idb.markWrong(q.bank_id, q.id)
      added++
    }
    if (added > 0 && skipped > 0) {
      addWrongMsg.value = `已添加 ${added} 道错题到错题本（${skipped} 题无本地题库已跳过）`
    } else if (added > 0) {
      addWrongMsg.value = `已添加 ${added} 道错题到错题本`
    } else if (skipped > 0) {
      addWrongMsg.value = `综合大考题目来自云端公共题库，暂无本地题库关联，请先导入题库后再添加`
      addWrongErr.value = true
    } else {
      addWrongMsg.value = '本次考试没有错题，无需添加'
    }
  } catch (e) {
    addWrongMsg.value = '添加失败：' + (e instanceof Error ? e.message : String(e))
    addWrongErr.value = true
  } finally {
    addingWrong.value = false
  }
}
function onToggleFavorite() {
  // 云端题不在本地收藏体系内，静默
}
function onQuestionUpdated(updated: any) {
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
  levelOfMap.value = new Map()
  current.value = 0
}
function goHome() {
  stopTimer()
  router.push('/')
}

onBeforeUnmount(() => stopTimer())
</script>

<style scoped>
.config-wrap { max-width: 760px; margin: 0 auto; }

/* ===== 历史记录入口 ===== */
.history-btn { margin-top: 10px; padding: 7px 16px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); color: var(--color-primary); cursor: pointer; font-size: 13px; font-weight: 500; }
.history-btn:hover { background: var(--color-primary); color: #fff; }

/* ===== 记录码 ===== */
.record-box { margin: 14px 0 10px; padding: 12px 14px; background: var(--color-success-light); border: 1px dashed var(--color-success-strong); border-radius: var(--radius-md); }
.record-label { font-size: 12px; color: var(--color-success-deep); margin-bottom: 6px; }
.record-value { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: var(--color-success-deep); cursor: pointer; user-select: all; font-family: monospace; }
.record-value:hover .copy-tip { opacity: 1; }
.copy-tip { font-size: 11px; color: var(--color-text-tertiary); opacity: 0; transition: opacity 0.15s; }
.review-btn { padding: 8px 16px; background: var(--color-success-strong); color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 500; cursor: pointer; }
.review-btn:hover { background: var(--color-success-deep); }
.review-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ===== 弹窗 ===== */
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal-body { background: var(--color-card); padding: 24px; border-radius: var(--radius-lg); min-width: 320px; color: var(--color-text); text-align: center; max-width: 560px; max-height: 80vh; overflow-y: auto; }
.modal-body h3 { margin: 0 0 10px 0; }
.modal-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }
.modal-actions button { padding: 8px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; color: var(--color-text); }
.hint { font-size: 13px; color: var(--color-text-tertiary); margin: 4px 0 12px; }

/* ===== 错题回看 ===== */
.review-modal { text-align: left; }
.wrong-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.wrong-item { padding: 12px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); background: var(--color-bg); }
.wrong-q { font-size: 14px; font-weight: 500; margin-bottom: 8px; line-height: 1.5; word-break: break-all; color: var(--color-text); }
.wrong-options { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.wrong-option { display: flex; align-items: flex-start; gap: 8px; padding: 5px 8px; border-radius: 4px; font-size: 13px; color: var(--color-text); line-height: 1.5; word-break: break-all; }
.wrong-option.is-mine { background: var(--color-danger-light); }
.wrong-option.is-answer { background: var(--color-success-light); }
.wrong-opt-letter { font-weight: 700; flex-shrink: 0; min-width: 16px; }
.wrong-opt-text { flex: 1; }
.wrong-opt-tag { flex-shrink: 0; font-size: 11px; padding: 0 6px; border-radius: 8px; font-weight: 600; }
.wrong-opt-tag.mine { background: var(--color-danger); color: #fff; }
.wrong-opt-tag.answer { background: var(--color-success); color: #fff; }
.wrong-row { font-size: 13px; color: var(--color-text-secondary); margin: 3px 0; line-height: 1.5; word-break: break-all; }
.wrong-label { font-weight: 600; }
.wrong-label.mine { color: var(--color-danger); }
.wrong-label.correct { color: var(--color-success-deep); }
.wrong-analysis { margin-top: 6px; padding: 8px; background: var(--color-warning-light); border-left: 3px solid var(--color-warning-strong); border-radius: 4px; font-size: 13px; color: var(--color-warning-deep); line-height: 1.5; word-break: break-all; }

/* ===== 历史记录列表 ===== */
.history-modal { text-align: left; }
.history-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.history-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); cursor: pointer; }
.history-item:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.hi-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.hi-score { font-size: 24px; font-weight: 700; color: var(--color-primary); flex-shrink: 0; }
.hi-score small { font-size: 12px; color: var(--color-text-tertiary); }
.hi-meta { min-width: 0; }
.hi-title { font-size: 13px; font-weight: 600; color: var(--color-text); }
.hi-sub { font-size: 12px; color: var(--color-text-tertiary); margin-top: 2px; }
.hi-del { padding: 4px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: none; cursor: pointer; flex-shrink: 0; }

/* 移动端适配 */
@media (max-width: 768px) {
  .modal-body { min-width: 0; max-width: 94vw; }
  .record-value { font-size: 18px; }
}
.config-header { margin-bottom: 20px; }
.config-header h2 { margin: 0 0 6px 0; }
.config-sub { color: var(--color-text-secondary); font-size: 13px; margin: 0; line-height: 1.6; }

/* 配额表 */
.quota-table { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; margin-bottom: 18px; }
.quota-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr 1fr; padding: 10px 16px; font-size: 14px; border-bottom: 1px solid var(--color-border-light); }
.quota-row:last-child { border-bottom: none; }
.quota-head { background: var(--color-surface, #f7f8fa); font-weight: 600; font-size: 12px; color: var(--color-text-secondary); }
.q-level { font-weight: 600; }
.q-subtotal { font-weight: 600; color: var(--color-primary); }
.quota-total { background: var(--color-surface); font-weight: 600; }

.config-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 16px; border-top: 1px solid var(--color-border-light); }
.duration-field { display: flex; align-items: center; gap: 8px; }
.duration-field label { font-size: 13px; color: var(--color-text-secondary); }
.duration-input { width: 70px; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; text-align: center; color: var(--color-text); background: var(--color-bg); }
.start-btn { padding: 11px 26px; background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%); color: #fff; border: none; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.15s; box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3); }
.start-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4); }
.start-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.loading { text-align: center; padding: 24px; color: var(--color-text-secondary); font-size: 13px; }
.retake-tip { text-align: center; color: var(--color-text-tertiary); font-size: 12px; margin-top: 14px; }

/* ===== 考试阶段（与综合抽题一致的样式） ===== */
.exam-topbar { display: flex; align-items: center; gap: 16px; padding: 12px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 16px; flex-wrap: wrap; }
.exam-info { display: flex; align-items: center; gap: 10px; }
.exam-badge { padding: 3px 10px; background: var(--tc-light); color: var(--color-primary); border-radius: 12px; font-size: 12px; font-weight: 600; }
.exam-timer { font-family: monospace; font-size: 14px; font-weight: 600; padding: 4px 12px; background: var(--color-info-light); color: var(--color-info); border-radius: var(--radius-md); }
.exam-timer.time-up { background: var(--color-danger-light); color: var(--color-danger); animation: pulse 1s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
.exam-progress { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 140px; }
.progress-text { font-size: 12px; color: var(--color-text-secondary); font-family: monospace; white-space: nowrap; }
.progress-track { flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-dark)); border-radius: 3px; transition: width 0.3s; }
.submit-btn { padding: 8px 20px; background: var(--color-danger); color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; cursor: pointer; }
.submit-btn:hover:not(:disabled) { opacity: 0.9; }
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.auto-next-toggle { display: flex; align-items: center; gap: 4px; font-size: 13px; cursor: pointer; color: var(--color-text-secondary); white-space: nowrap; }
.auto-next-toggle input { cursor: pointer; }

.level-tag { margin-top: 10px; font-size: 12px; color: var(--color-text-tertiary); }
.question-nav { margin-top: 14px; padding: 12px 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.nav-dots { display: flex; flex-wrap: wrap; gap: 4px; max-height: 160px; overflow-y: auto; }
.nav-dot { min-width: 28px; height: 28px; padding: 0 4px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-card); color: var(--color-text-secondary); font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-weight: 500; }
.nav-dot:hover { border-color: var(--color-primary); color: var(--color-primary); }
.nav-dot.current { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.nav-dot.answered { background: var(--tc-light); color: var(--color-primary); border-color: var(--color-info-strong); }
.nav-dot.correct { background: var(--color-success-bg); color: var(--color-success-deep); border-color: var(--color-success-bg); }
.nav-dot.wrong { background: var(--color-danger-bg); color: var(--color-danger-deep); border-color: var(--color-danger-bg); }

.result-panel { text-align: center; padding: 32px; }
.result-panel h3 { margin-bottom: 24px; }

/* 2026-08-20：交卷后答题回顾区 */
.review-section { margin-top: 24px; }
.review-title { text-align: center; margin-bottom: 14px; font-size: 17px; }
.review-sub { font-size: 12px; color: var(--color-text-tertiary); font-weight: 400; margin-left: 8px; }
.result-stats { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px; }
.stat-card { background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); padding: 16px 24px; min-width: 100px; }
.stat-card.highlight { background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); color: #fff; border-color: transparent; }
.stat-num { font-size: 28px; font-weight: 600; }
.stat-label { font-size: 13px; opacity: 0.8; margin-top: 4px; }
.result-hint { color: var(--color-text-secondary); margin: 16px 0; }
.result-actions { margin-top: 20px; }
.result-actions button { margin: 8px; padding: 9px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; }
.result-actions button:first-child { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.add-wrong-btn { background: var(--color-primary) !important; color: #fff !important; border-color: var(--color-primary) !important; }
.add-wrong-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.add-wrong-msg { font-size: 13px; color: var(--color-success-deep); margin: 4px 0 0; text-align: center; }
.add-wrong-msg.warn { color: var(--color-danger); }
.level-breakdown { margin-top: 28px; padding: 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); text-align: left; }
.level-breakdown h4 { margin: 0 0 10px 0; font-size: 14px; }
.breakdown-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--color-border-light); font-size: 13px; }
.breakdown-row:last-child { border-bottom: none; }
.bd-name { font-weight: 500; }
.bd-stat { color: var(--color-text-secondary); font-family: monospace; }

@media (max-width: 768px) {
  .config-footer { flex-direction: column; align-items: stretch; }
  .duration-field { justify-content: space-between; }
  .start-btn { width: 100%; }
  .exam-progress { min-width: 100%; }
  .result-panel { padding: 20px 12px; }
}
</style>
