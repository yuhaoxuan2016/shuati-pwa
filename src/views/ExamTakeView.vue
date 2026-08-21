<template>
  <div class="exam-take">
    <!-- 加载中 -->
    <div v-if="loading" class="center">加载考试中...</div>

    <!-- 成绩展示（须在 !exam 之前：交卷后 exam 置 null，但 finishedResult 有值应优先展示） -->
    <div v-else-if="finishedResult" class="center">
      <div class="result-card">
        <div class="result-icon">🎉</div>
        <h2>交卷成功！</h2>
        <p class="result-student">考生：{{ finishedResult.student_name }}</p>
        <div class="score-big">{{ finishedResult.score }}<span class="score-unit">分</span></div>
        <p class="result-accuracy">正确率 {{ finishedResult.accuracy }}%</p>
        <div class="result-stats">
          <div class="rs"><span class="rs-num good">{{ finishedResult.correct }}</span><span>答对</span></div>
          <div class="rs"><span class="rs-num bad">{{ finishedResult.wrong }}</span><span>答错</span></div>
          <div class="rs"><span class="rs-num neutral">{{ finishedResult.unanswered }}</span><span>未答</span></div>
        </div>

        <!-- 查询码 -->
        <div class="code-box" v-if="finishedCode">
          <div class="code-label">📋 你的查询码（保存好，可随时回看错题）</div>
          <div class="code-value" @click="copyCode">{{ finishedCode }} <span class="copy-tip">点击复制</span></div>
        </div>

        <div class="review-actions">
          <button class="review-btn" @click="showReview = true">🔍 查询码回看错题</button>
        </div>
        <p class="result-tip">感谢作答，可以关闭本页面了。</p>
      </div>
    </div>

    <!-- 考试不存在 -->
    <div v-else-if="!exam" class="center">
      <div class="empty-icon">🔍</div>
      <p>考试不存在或已删除</p>
    </div>

    <!-- 填姓名 -->
    <div v-else-if="!studentName" class="center">
      <div class="name-card">
        <h2>📝 {{ exam.title }}</h2>
        <p v-if="exam.description" class="exam-desc">{{ exam.description }}</p>
        <div class="exam-meta">
          <span>📚 {{ exam.questions.length }} 题</span>
          <span>⏱ {{ exam.duration_minutes }} 分钟</span>
          <span v-if="exam.deadline" :class="{ warn: deadlineReached }">⏰ {{ formatDeadline(exam.deadline) }}</span>
        </div>
        <div v-if="deadlineReached" class="deadline-warn">
          <p>🕐 {{ deadlineMsg }}</p>
          <p class="hint">本场考试已关闭，无法进入答题。</p>
        </div>
        <template v-else>
          <div class="name-field">
            <label>请输入你的姓名/昵称</label>
            <input v-model="nameInput" placeholder="例如：张三" @keyup.enter="startExam" />
          </div>
          <button class="start-btn" :disabled="!nameInput.trim()" @click="startExam">🚀 开始答题</button>
        </template>

        <!-- 已有查询码回看错题 -->
        <div class="review-entry" v-if="!deadlineReached">
          <div class="review-divider"><span>或</span></div>
          <p class="review-entry-hint">已经考过？凭查询码回看错题</p>
          <div class="code-input-row">
            <input v-model="codeInput" placeholder="查询码，例如 XXXX-XXXX" class="code-input" @keyup.enter="lookupByCode" />
            <button class="review-btn" @click="lookupByCode">🔍 回看</button>
          </div>
          <p v-if="codeError" class="code-error">{{ codeError }}</p>
        </div>
      </div>
    </div>

    <!-- 答题中 -->
    <div v-else>
      <!-- 顶栏 -->
      <div class="topbar">
        <div class="tb-left">
          <span class="tb-title">{{ exam.title }}</span>
          <span class="tb-student">👤 {{ studentName }}</span>
        </div>
        <div class="tb-timer" :class="{ 'time-up': timeUp }">⏱ {{ formatTime(remaining) }}</div>
        <button class="submit-exam" @click="submit">交卷</button>
      </div>

      <!-- 进度 -->
      <div class="progress-row">
        <span class="progress-text">{{ current + 1 }} / {{ exam.questions.length }}</span>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: ((current + 1) / exam.questions.length * 100) + '%' }"></div>
        </div>
      </div>

      <!-- 题目 -->
      <div class="question-card">
        <div class="q-stem">
          <span class="q-idx">{{ current + 1 }}.</span>
          <span class="q-type">{{ typeLabel(currentQuestion.type) }}</span>
          <span class="q-text">{{ currentQuestion.stem }}</span>
        </div>

        <!-- 选择题 -->
        <div v-if="isChoice" class="options">
          <button v-for="(opt, i) in displayOptions" :key="i" class="option"
            :class="{ selected: selectedDisplay.includes(i) }"
            @click="toggleOption(i)">
            <span class="letter">{{ String.fromCharCode(65 + i) }}</span> {{ opt }}
          </button>
        </div>

        <!-- 判断题 -->
        <div v-else-if="isJudgeQuestion()" class="options">
          <button class="option" :class="{ selected: currentAnswer.judge === true }" @click="currentAnswer.judge = true">√ 正确</button>
          <button class="option" :class="{ selected: currentAnswer.judge === false }" @click="currentAnswer.judge = false">× 错误</button>
        </div>

        <!-- 填空/问答 -->
        <div v-else class="blank">
          <textarea v-model="currentAnswer.blank" placeholder="输入你的答案" rows="4"></textarea>
        </div>

        <!-- 导航 -->
        <div class="nav-row">
          <button class="nav-btn" :disabled="current === 0" @click="current--">← 上一题</button>
          <button v-if="current < exam.questions.length - 1" class="nav-btn primary" @click="current++">下一题 →</button>
          <button v-else class="nav-btn success" @click="submit">交卷 ✓</button>
        </div>
      </div>

      <!-- 题号导航 -->
      <div class="dot-nav">
        <button v-for="(q, i) in exam.questions" :key="i" class="dot"
          :class="{ current: i === current, answered: isAnswered(q.id) }"
          @click="current = i">{{ i + 1 }}</button>
      </div>
    </div>

    <!-- 交卷确认弹窗 -->
    <Teleport to="body">
      <div v-if="showConfirm" class="modal-mask" @click.self="showConfirm = false">
        <div class="modal-body">
          <h3>确认交卷？</h3>
          <p>已答 {{ answeredCount }} / {{ exam.questions.length }} 题，{{ answeredCount < exam.questions.length ? '还有未答题目！' : '全部完成！' }}</p>
          <div class="modal-actions">
            <button @click="showConfirm = false">继续答题</button>
            <button class="danger" @click="confirmSubmit">确认交卷</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 查询码回看错题弹窗 -->
    <Teleport to="body">
      <div v-if="showReview" class="modal-mask" @click.self="closeReview">
        <div class="modal-body review-modal">
          <h3>🔍 回看错题</h3>

          <!-- 输入查询码 -->
          <template v-if="!reviewResult">
            <p class="hint">输入交卷时获得的查询码，查看你的错题（题干 + 选项 + 你的答案 + 正确答案 + 解析）</p>
            <div class="code-input-row">
              <input v-model="codeInput" placeholder="例如 XXXX-XXXX" class="code-input"
                @keyup.enter="lookupByCode" :disabled="reviewLoading" />
              <button class="review-btn" @click="lookupByCode" :disabled="reviewLoading || !codeInput.trim()">
                {{ reviewLoading ? '查询中...' : '查询' }}
              </button>
            </div>
            <p v-if="codeError" class="code-error">{{ codeError }}</p>
          </template>

          <!-- 错题列表 -->
          <template v-else>
            <p class="hint">考生：<b>{{ reviewResult.student_name }}</b> · 得分 <b>{{ reviewResult.score }}</b> 分 · 错 <b>{{ reviewWrongs.length }}</b> 题</p>
            <div v-if="reviewWrongs.length" class="wrong-list">
              <div v-for="(w, i) in reviewWrongs" :key="i" class="wrong-item">
                <div class="wrong-q">{{ i + 1 }}. {{ w.question.stem }}</div>
                <!-- 选项区：选择题渲染 ABCD，判断题渲染 √/×，高亮我的答案与正确答案 -->
                <div v-if="w.question.type === 'single' || w.question.type === 'multi'" class="wrong-options">
                  <div v-for="(opt, oi) in parseWrongOptions(w.question.options)" :key="oi" class="wrong-option"
                    :class="{ 'is-mine': rawHas(w.myRaw, oi), 'is-answer': rawHas(w.correctRaw, oi) }">
                    <span class="wrong-opt-letter">{{ String.fromCharCode(65 + oi) }}</span>
                    <span class="wrong-opt-text">{{ opt }}</span>
                    <span v-if="rawHas(w.myRaw, oi)" class="wrong-opt-tag mine">我的答案</span>
                    <span v-if="rawHas(w.correctRaw, oi)" class="wrong-opt-tag answer">正确答案</span>
                  </div>
                </div>
                <div v-else-if="w.question.type === 'judge'" class="wrong-options">
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
            <p v-else class="hint success-text">🎉 太棒了！没有错题，全部答对！</p>
            <div class="modal-actions">
              <button @click="closeReview">关闭</button>
              <button class="danger" @click="closeReview">确定</button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { getExam, submitExamResult, gradeExam, saveExamSnapshot, errMsg, type Exam, type ExamResult } from '../lib/exam'
import { toastError, toastSuccess } from '../utils/toast'
import { setPageMeta } from '../lib/share'

interface StudentAnswer { selected: number[]; blank: string; judge: boolean | null }

const route = useRoute()
const examId = String(route.params.examId)
const exam = ref<Exam | null>(null)
const loading = ref(true)

const nameInput = ref('')
const studentName = ref('')
const current = ref(0)
const answers = ref<Record<number, StudentAnswer>>({})
const remaining = ref(0)
const timeUp = ref(false)
const showConfirm = ref(false)
const submitting = ref(false)
const deadlineReached = ref(false)   // 截止时间已到
const deadlineMsg = ref('')          // 截止提示文案
const finishedCode = ref('')         // 交卷后的查询码
const showReview = ref(false)        // 是否展示错题回看（查询码模式）
const reviewWrongs = ref<{ question: any; myAnswer: string; correctAnswer: string; analysis: string | null }[]>([])
const reviewResult = ref<ExamResult | null>(null)
const codeInput = ref('')            // 查询码输入
const codeError = ref('')
const reviewLoading = ref(false)

// 选项乱序：默认开启（防背答案顺序）；创建考试时可配置关闭
// 旧考试无 shuffle_options 字段 → 默认乱序，行为不变
const shuffleOptions = ref(true)
watch(exam, (e) => {
  if (e) shuffleOptions.value = e.shuffle_options !== false
}, { immediate: true })
// 当前题目的展示映射：displayMap[displayIdx] = 原始下标；切题时重算（watch current）
const displayMap = ref<number[]>([])
function buildDisplayMap() {
  const q = currentQuestion.value
  const n = q?.options ? safeParseOptions(q.options).length : 0
  const idx = Array.from({ length: n }, (_, i) => i)
  if (shuffleOptions.value && n > 2 && !isJudgeQuestion()) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    if (idx.every((v, i) => v === i) && n > 1) {
      ;[idx[0], idx[1]] = [idx[1], idx[0]]
    }
  }
  displayMap.value = idx
}
function safeParseOptions(opts: string | null): string[] {
  if (!opts) return []
  try { return JSON.parse(opts) } catch { return [] }
}
// 判断题（type=judge，或选项恰为「正确/错误」的 single 存储形式）不做乱序
function isJudgeQuestion(): boolean {
  const q = currentQuestion.value
  if (!q) return false
  if (q.type === 'judge') return true
  const opts = safeParseOptions(q.options)
  if (opts.length === 2) {
    const t = opts.map(o => (o || '').replace(/^[A-H][.、:：)]?\s*/i, '').trim())
    return (t[0] === '正确' && t[1] === '错误') || (t[0] === '对' && t[1] === '错')
  }
  return false
}

let startMs: number | null = null
let timerId: number | null = null
let deadlineTimerId: number | null = null

const currentQuestion = computed(() => exam.value?.questions[current.value] || null)
// 切题时重算选项乱序映射（每题独立随机）
watch([current, shuffleOptions], () => buildDisplayMap())
const currentAnswer = computed<StudentAnswer>(() => {
  const q = currentQuestion.value
  if (!q) return { selected: [], blank: '', judge: null }
  if (!answers.value[q.id]) answers.value[q.id] = { selected: [], blank: '', judge: null }
  return answers.value[q.id]
})
const parsedOptions = computed<string[]>(() => {
  const q = currentQuestion.value
  if (!q?.options) return []
  try { return JSON.parse(q.options) } catch { return [] }
})
// 展示选项（乱序时按 displayMap 重排）
const displayOptions = computed<string[]>(() => {
  const opts = parsedOptions.value
  if (!shuffleOptions.value || !displayMap.value.length) return opts
  return displayMap.value.map(i => opts[i]).filter(Boolean)
})
// 当前选中项的展示下标（answers 存的是原始下标，反查展示下标用于高亮）
const selectedDisplay = computed<number[]>(() => {
  const raw = currentAnswer.value.selected
  if (!shuffleOptions.value || !displayMap.value.length) return raw
  return raw.map(r => displayMap.value.indexOf(r)).filter(i => i >= 0)
})
const isChoice = computed(() => !!currentQuestion.value && !isJudgeQuestion() && (currentQuestion.value?.type === 'single' || currentQuestion.value?.type === 'multi'))
const answeredCount = computed(() => Object.values(answers.value).filter(a => a.selected.length || a.blank || a.judge !== null).length)

function typeLabel(t: string) {
  // 判断题旧快照（type='single' + ["正确","错误"]）内容识别为判断
  if (isJudgeQuestion()) return '判断'
  return { single: '单选', multi: '多选', judge: '判断', blank: '填空', qa: '问答' }[t] || t
}
function isAnswered(qid: number) {
  const a = answers.value[qid]
  return !!(a && (a.selected.length || a.blank || a.judge !== null))
}
function toggleOption(i: number) {
  const q = currentQuestion.value
  if (!q) return
  const a = currentAnswer.value
  // i 是展示下标 → 转回原始下标存储（判分用原始答案字母）
  const raw = shuffleOptions.value ? (displayMap.value[i] ?? i) : i
  if (q.type === 'single') {
    a.selected = [raw]
  } else {
    const idx = a.selected.indexOf(raw)
    if (idx >= 0) a.selected.splice(idx, 1)
    else a.selected.push(raw)
  }
}
function formatTime(s: number) {
  const m = Math.floor(s / 60), sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
function formatDeadline(iso: string) {
  try {
    return '截止 ' + new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}
async function copyCode() {
  if (!finishedCode.value) return
  try {
    await navigator.clipboard.writeText(finishedCode.value)
    toastSuccess('查询码已复制')
  } catch {
    toastError('复制失败，请手动记录')
  }
}

function startExam() {
  if (!nameInput.value.trim()) return
  // 截止时间检查：已到截止时间则禁止进入
  if (checkDeadline()) return
  studentName.value = nameInput.value.trim()
  startMs = Date.now()
  remaining.value = exam.value!.duration_minutes * 60
  timerId = window.setInterval(tick, 1000)
  // 截止时间到点自动强制收卷
  if (exam.value!.deadline) {
    deadlineTimerId = window.setTimeout(() => {
      if (!submitting.value && !finishedResult.value) {
        deadlineReached.value = true
        forceSubmit('考试已截止，自动收卷')
      }
    }, Math.max(0, new Date(exam.value!.deadline).getTime() - Date.now() + 1000))
  }
}
// 检查截止时间；返回 true 表示已截止
function checkDeadline(): boolean {
  const dl = exam.value?.deadline
  if (!dl) return false
  if (Date.now() >= new Date(dl).getTime()) {
    deadlineReached.value = true
    deadlineMsg.value = '本场考试已于 ' + new Date(dl).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' 截止'
    return true
  }
  return false
}
function tick() {
  if (startMs === null) return
  const elapsed = Math.floor((Date.now() - startMs) / 1000)
  const total = exam.value!.duration_minutes * 60
  const rem = total - elapsed
  remaining.value = rem > 0 ? rem : 0
  if (rem <= 0) {
    timeUp.value = true
    showConfirm.value = true
  }
}

function forceSubmit(reason: string) {
  if (submitting.value) return
  showConfirm.value = false
  doSubmit(reason)
}

function submit() {
  if (submitting.value) return
  showConfirm.value = true
}
async function confirmSubmit() {
  if (submitting.value) return
  showConfirm.value = false
  await doSubmit('')
}
async function doSubmit(reason: string) {
  if (submitting.value) return
  submitting.value = true
  if (timerId) { clearInterval(timerId); timerId = null }
  if (deadlineTimerId) { clearTimeout(deadlineTimerId); deadlineTimerId = null }
  try {
    const qs = exam.value!.questions
    const grade = gradeExam(qs, answers.value)
    const result: ExamResult = {
      exam_id: examId,
      student_name: studentName.value,
      answers: answers.value,
      correct: grade.correct,
      wrong: grade.wrong,
      unanswered: grade.unanswered,
      score: grade.score,
      accuracy: grade.accuracy,
      duration_ms: startMs ? Date.now() - startMs : null,
      submitted_at: new Date().toISOString(),
    }
    await submitExamResult(result)
    // 保存展示数据后切到成绩视图
    finishedCode.value = result.query_code || ''
    finishedExam.value = exam.value
    finishedResult.value = result
    exam.value = null
    if (reason) toastSuccess(reason + '，得分 ' + grade.score + ' 分')
    else toastSuccess(`交卷成功！得分 ${grade.score} 分`)
  } catch (e) {
    toastError('交卷失败：' + errMsg(e))
  } finally {
    submitting.value = false
  }
}

// 查询码回看错题
async function lookupByCode() {
  const code = codeInput.value.trim()
  if (!code) { codeError.value = '请输入查询码'; return }
  codeError.value = ''
  reviewLoading.value = true
  try {
    const { findResultByCode, getWrongQuestions } = await import('../lib/exam')
    const found = await findResultByCode(examId, code)
    if (!found) {
      codeError.value = '未找到该查询码对应的答卷，请检查是否输错（注意大小写）'
      return
    }
    // 获取考试题目（优先用内存中的，否则重新拉取）
    let examData = finishedExam.value
    if (!examData) {
      try {
        examData = await getExam(examId)
      } catch (examErr) {
        console.error('加载考试数据失败：', examErr)
        codeError.value = '网络异常，无法加载考试数据，请检查网络后重试'
        return
      }
    }
    if (!examData) {
      codeError.value = '考试不存在或已被删除，请联系考试创建者'
      return
    }
    reviewResult.value = found
    reviewWrongs.value = getWrongQuestions(examData, found)
    showReview.value = true
  } catch (e) {
    const msg = errMsg(e)
    if (msg.includes('timeout') || msg.includes('超时')) {
      codeError.value = '查询超时，请稍后重试'
    } else if (msg.includes('network') || msg.includes('网络')) {
      codeError.value = '网络异常，请检查网络连接'
    } else {
      codeError.value = '查询失败：' + msg
    }
  } finally {
    reviewLoading.value = false
  }
}
function closeReview() {
  showReview.value = false
  reviewResult.value = null
  reviewWrongs.value = []
  codeInput.value = ''
}

// 错题回看选项渲染辅助
function parseWrongOptions(options: string | null): string[] {
  if (!options) return []
  try {
    const p = JSON.parse(options)
    return Array.isArray(p) ? p.map((o: any) => String(o)) : []
  } catch { return [] }
}
// raw（字母串如 "B"、"A、C"，或判断题 'true'/'false'）是否包含下标 oi 对应选项
function rawHas(raw: string | null, oi: number): boolean {
  if (!raw) return false
  return raw.split(/[、,，\s]/).includes(String.fromCharCode(65 + oi))
}

// 交卷后展示成绩
const finishedResult = ref<ExamResult | null>(null)
const finishedExam = ref<Exam | null>(null)

onMounted(async () => {
  try {
    exam.value = await getExam(examId)
    if (exam.value) {
      // 缓存考试快照：交卷后/后续重进时云端查不到也能正常展示（兜底"考完提交后考试不存在"）
      saveExamSnapshot(exam.value)
      // 动态设置分享卡片标题=考试名（服务系统分享面板 / 桌面浏览器）
      setPageMeta({ title: `【考试】${exam.value.title}`, desc: exam.value.description || '正在作答考试' })
      // 截止时间检查：未答题时已到截止时间 → 显示截止状态
      checkDeadline()
      buildDisplayMap()
    }
  } catch (e) {
    toastError('加载考试失败：' + errMsg(e))
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => {
  if (timerId) clearInterval(timerId)
  if (deadlineTimerId) clearTimeout(deadlineTimerId)
})
</script>

<style scoped>
.center { max-width: 460px; margin: 60px auto; text-align: center; color: var(--color-text-tertiary); }
.empty-icon { font-size: 56px; margin-bottom: 12px; opacity: 0.5; }
.name-card { padding: 32px 28px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); text-align: center; }
.name-card h2 { margin: 0 0 8px 0; }
.exam-desc { color: var(--color-text-secondary); font-size: 13px; margin: 0 0 12px 0; }
.exam-meta { display: flex; gap: 16px; justify-content: center; font-size: 13px; color: var(--color-text-tertiary); margin-bottom: 24px; }
.exam-meta .warn { color: var(--color-danger); font-weight: 600; }
.deadline-warn { padding: 12px; background: var(--color-danger-light); border: 1px solid var(--color-danger); border-radius: var(--radius-md); margin-bottom: 16px; }
.deadline-warn p { margin: 0 0 4px 0; color: var(--color-danger); font-weight: 600; }
.deadline-warn .hint { color: var(--color-text-secondary); font-weight: 400; font-size: 13px; }
.review-entry { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--color-border-light); text-align: center; }
.review-divider { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.review-divider::before, .review-divider::after { content: ''; flex: 1; height: 1px; background: var(--color-border-light); }
.review-divider span { font-size: 12px; color: var(--color-text-tertiary); }
.review-entry-hint { font-size: 12px; color: var(--color-text-tertiary); margin: 0 0 8px; }
.review-entry .code-input-row { justify-content: center; }
.name-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; text-align: left; }
.name-field label { font-size: 13px; color: var(--color-text-secondary); }
.name-field input { padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 15px; background: var(--color-bg); color: var(--color-text); text-align: center; }
.start-btn { padding: 11px 32px; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #fff; border: none; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; }
.start-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.topbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); margin-bottom: 10px; flex-wrap: wrap; }
.tb-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 150px; }
.tb-title { font-weight: 600; font-size: 15px; }
.tb-student { font-size: 12px; color: var(--color-text-secondary); background: var(--color-border-light); padding: 2px 8px; border-radius: 10px; }
.tb-timer { font-family: monospace; font-size: 15px; font-weight: 700; padding: 4px 12px; background: var(--color-info-light); color: var(--color-info); border-radius: var(--radius-md); }
.tb-timer.time-up { background: var(--color-danger-light); color: var(--color-danger); animation: pulse 1s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
.submit-exam { padding: 8px 18px; background: var(--color-danger); color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; cursor: pointer; }

.progress-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.progress-text { font-size: 12px; color: var(--color-text-secondary); font-family: monospace; white-space: nowrap; }
.progress-track { flex: 1; height: 6px; background: var(--color-border-light); border-radius: 3px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #4f46e5); border-radius: 3px; transition: width 0.3s; }

.question-card { padding: 24px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); margin-bottom: 14px; }
.q-stem { font-size: 16px; line-height: 1.6; margin-bottom: 18px; }
.q-idx { font-weight: bold; margin-right: 6px; }
.q-type { padding: 2px 8px; background: var(--color-border-light); border-radius: var(--radius-sm); font-size: 12px; margin-right: 8px; }
.options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.option { text-align: left; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; color: var(--color-text); }
.option.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.letter { font-weight: bold; margin-right: 8px; }
.blank { margin-bottom: 16px; }
.blank textarea { width: 100%; padding: 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; background: var(--color-card); color: var(--color-text); font-family: inherit; resize: vertical; }
.nav-row { display: flex; justify-content: space-between; gap: 10px; }
.nav-btn { padding: 8px 18px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text); }
.nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.nav-btn.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.nav-btn.success { background: #16a34a; color: #fff; border-color: #16a34a; }
.dot-nav { display: flex; flex-wrap: wrap; gap: 5px; padding: 14px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-md); }
.dot { min-width: 30px; height: 30px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-card); color: var(--color-text-secondary); font-size: 12px; cursor: pointer; }
.dot.answered { background: var(--color-primary-light); border-color: var(--color-primary); color: var(--color-primary); }
.dot.current { background: #4f46e5; color: #fff; border-color: #4f46e5; }

.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal-body { background: var(--color-card); padding: 24px; border-radius: var(--radius-lg); min-width: 320px; color: var(--color-text); text-align: center; }
.modal-body h3 { margin: 0 0 10px 0; }
.modal-body p { color: var(--color-text-secondary); font-size: 14px; }
.modal-actions { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }
.modal-actions button { padding: 8px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 14px; }
.modal-actions button.danger { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }

/* 成绩展示 */
.result-card { padding: 36px 32px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); text-align: center; }
.result-icon { font-size: 52px; margin-bottom: 8px; }
.result-card h2 { margin: 0 0 6px 0; }
.result-student { color: var(--color-text-secondary); font-size: 13px; margin: 0 0 16px 0; }
.score-big { font-size: 56px; font-weight: 700; color: #4f46e5; line-height: 1; }
.score-unit { font-size: 20px; color: var(--color-text-tertiary); margin-left: 4px; font-weight: 500; }
.result-accuracy { color: var(--color-text-secondary); font-size: 14px; margin: 8px 0 20px 0; }
.result-stats { display: flex; justify-content: center; gap: 32px; margin-bottom: 20px; }
.rs { display: flex; flex-direction: column; gap: 4px; }
.rs-num { font-size: 24px; font-weight: 700; }
.rs-num.good { color: #16a34a; }
.rs-num.bad { color: #dc2626; }
.rs-num.neutral { color: var(--color-text-tertiary); }
.rs span:last-child { font-size: 12px; color: var(--color-text-tertiary); }
.result-tip { font-size: 12px; color: var(--color-text-tertiary); margin: 0; }

/* 查询码 */
.code-box { margin: 16px 0 12px; padding: 14px; background: #f0fdf4; border: 1px dashed #16a34a; border-radius: var(--radius-md); }
.code-label { font-size: 12px; color: #15803d; margin-bottom: 8px; }
.code-value { font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #15803d; cursor: pointer; user-select: all; font-family: monospace; }
.code-value:hover .copy-tip { opacity: 1; }
.copy-tip { font-size: 11px; color: var(--color-text-tertiary); opacity: 0; transition: opacity 0.15s; }
.review-actions { margin: 8px 0 14px; }
.review-btn { padding: 8px 18px; background: #16a34a; color: #fff; border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 500; cursor: pointer; }
.review-btn:hover { background: #15803d; }
.review-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 错题回看弹窗 */
.review-modal { max-width: 560px; max-height: 80vh; overflow-y: auto; text-align: left; }
.review-modal h3 { text-align: center; }
.review-modal .hint { font-size: 13px; color: var(--color-text-secondary); margin: 4px 0 12px; }
.code-input-row { display: flex; gap: 8px; margin: 8px 0; }
.code-input { flex: 1; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 15px; font-family: monospace; letter-spacing: 1px; background: var(--color-bg); color: var(--color-text); text-transform: uppercase; }
.code-error { color: var(--color-danger); font-size: 13px; margin: 6px 0 0; }
.success-text { color: #15803d; font-weight: 600; }
.wrong-list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.wrong-item { padding: 12px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); background: var(--color-bg); }
.wrong-q { font-size: 14px; font-weight: 500; margin-bottom: 8px; line-height: 1.5; word-break: break-all; color: var(--color-text); }
.wrong-options { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.wrong-option { display: flex; align-items: flex-start; gap: 8px; padding: 5px 8px; border-radius: 4px; font-size: 13px; color: var(--color-text); line-height: 1.5; word-break: break-all; }
.wrong-option.is-mine { background: var(--color-danger-light); }
.wrong-option.is-answer { background: var(--color-success-light); }
.wrong-option.is-mine.is-answer { background: var(--color-success-light); }
.wrong-opt-letter { font-weight: 700; flex-shrink: 0; min-width: 16px; }
.wrong-opt-text { flex: 1; }
.wrong-opt-tag { flex-shrink: 0; font-size: 11px; padding: 0 6px; border-radius: 8px; font-weight: 600; }
.wrong-opt-tag.mine { background: var(--color-danger); color: #fff; }
.wrong-opt-tag.answer { background: var(--color-success); color: #fff; }
.wrong-row { font-size: 13px; color: var(--color-text-secondary); margin: 3px 0; line-height: 1.5; word-break: break-all; }
.wrong-label { font-weight: 600; }
.wrong-label.mine { color: var(--color-danger); }
.wrong-label.correct { color: #15803d; }
.wrong-analysis { margin-top: 6px; padding: 8px; background: #fffbeb; border-left: 3px solid #f59e0b; border-radius: 4px; font-size: 13px; color: #92400e; line-height: 1.5; word-break: break-all; }
.review-modal .modal-actions { margin-top: 16px; }

/* 移动端适配 */
@media (max-width: 768px) {
  .center { margin: 24px auto; }
  .name-card { padding: 24px 16px; }
  .question-card { padding: 16px; }
  .q-stem { font-size: 15px; }
  .tb-left { min-width: 0; flex: 1 1 100%; }
  .result-card { padding: 24px 16px; }
  .score-big { font-size: 44px; }
  .result-stats { gap: 20px; }
  .code-value { font-size: 20px; }
  .review-modal { max-width: 94vw; }
  .modal-body { min-width: 0; }
}
</style>
