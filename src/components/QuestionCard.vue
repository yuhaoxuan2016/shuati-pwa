<template>
  <div class="qcard">
    <div class="stem" :class="{ 'no-toolbar': examMode }">
      <span class="idx">{{ index + 1 }}.</span>
      <span class="type-tag">{{ typeLabel }}</span>
      <span v-if="elapsedSecs !== null" class="timer" title="本题用时">{{ formatTime(elapsedSecs) }}</span>
      <span class="stem-text">{{ question.stem }}</span>
      <!-- 右上角操作按钮组（考试模式/回顾模式下隐藏，防作弊） -->
      <div v-if="!examMode && !readOnly" class="card-toolbar">
        <button class="tool-btn" :class="{ active: favorited }" :title="favorited ? '取消收藏' : '收藏本题'" @click="$emit('toggle-favorite')">
          {{ favorited ? '★' : '☆' }}
        </button>
        <button class="tool-btn" title="编辑本题" @click="showEdit = true">✎</button>
        <button class="tool-btn ai" :disabled="analyzing" :title="analyzing ? 'AI 解析中…' : 'AI 详细解析'" @click="analyze">🤖</button>
      </div>
    </div>

    <!-- 选择题 -->
    <div v-if="isChoice" class="options">
      <button
        v-for="(opt, i) in options"
        :key="i"
        class="option"
        :class="optionClass(i)"
        :disabled="submitted"
        @click="toggle(i)"
      >
        <span class="letter">{{ letter(i) }}</span> {{ opt }}
      </button>
    </div>

    <!-- 判断题 -->
    <div v-else-if="isJudgeQuestion()" class="options">
      <button class="option" :class="judgeClass(true)" :disabled="submitted" @click="answerJudge(true)">√ 正确</button>
      <button class="option" :class="judgeClass(false)" :disabled="submitted" @click="answerJudge(false)">× 错误</button>
    </div>

    <!-- 填空/问答 -->
    <div v-else class="blank">
      <textarea v-model="blankAnswer" :disabled="submitted" placeholder="输入你的答案"></textarea>
    </div>

    <div class="actions">
      <button v-if="hasPrev && !readOnly" class="act-btn ghost" @click="manualPrev">← 上一题</button>
      <!-- 2026-08-20：deferSubmit 考试模式交卷前不锁定，点选后手动下一题；交卷统一判分 -->
      <button v-if="!submitted && !deferSubmit" class="act-btn primary" @click="submit">确认答案</button>
      <button v-if="!submitted && deferSubmit" class="act-btn primary" @click="manualNext">下一题 →</button>
      <button v-if="submitted && (!isSelfEval || selfEvalDone) && !readOnly" class="act-btn primary" @click="manualNext">下一题 →</button>
      <button v-if="submitted && !isChoice && !isJudgeQuestion() && !readOnly" class="act-btn success" @click="selfEval(true)">✓ 答对</button>
      <button v-if="submitted && !isChoice && !isJudgeQuestion() && !readOnly" class="act-btn danger" @click="selfEval(false)">✗ 答错</button>
    </div>

    <QuestionEditDialog :visible="showEdit" :question="question" @close="showEdit = false" @saved="onQuestionSaved" />

    <div class="hint" v-if="!submitted">快捷键：{{ keyHint }}</div>

    <div v-if="submitted" class="feedback" :class="{ correct: isCorrect, exam: examMode }">
      <template v-if="examMode">
        <p>✓ 已作答（考试模式不立即显示对错）</p>
      </template>
      <template v-else>
        <p v-if="isSelfEval && !selfEvalDone">请对照参考答案自评</p>
        <p v-else-if="!question.answer && isJudgeQuestion()">⚠ 参考答案缺失，无法判定对错</p>
        <p v-else>{{ isCorrect ? '✓ 回答正确' : '✗ 回答错误' }}</p>
        <p>正确答案：{{ displayAnswer }}</p>
        <div v-if="question.analysis" class="analysis">
          <strong>解析：</strong>{{ question.analysis }}
        </div>
      </template>
    </div>

    <div v-if="aiAnalysis" class="ai-analysis">
      <!-- 标题区 -->
      <div class="ai-header">
        <span class="ai-header-icon">🤖</span>
        <span>AI 详细解析</span>
        <span class="ai-header-badge">由 AI 生成，仅供参考</span>
      </div>

      <!-- 知识点 -->
      <div v-if="aiAnalysis.knowledge_point" class="ai-section knowledge">
        <div class="ai-section-title">
          <span class="icon">📌</span>
          <span>考查的知识点</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.knowledge_point }}</div>
      </div>

      <!-- 背景知识 -->
      <div v-if="aiAnalysis.background" class="ai-section background">
        <div class="ai-section-title">
          <span class="icon">📚</span>
          <span>相关背景</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.background }}</div>
      </div>

      <!-- 选项解析 -->
      <div v-if="aiAnalysis.option_analysis && aiAnalysis.option_analysis.length" class="ai-section">
        <div class="ai-section-title">
          <span class="icon">📋</span>
          <span>逐项分析</span>
          <span class="ai-section-count">共 {{ aiAnalysis.option_analysis.length }} 项</span>
        </div>
        <div class="ai-options">
          <div v-for="(oa, i) in aiAnalysis.option_analysis" :key="i" class="ai-option-row" :class="isOptCorrect(oa.verdict) ? 'is-correct' : 'is-wrong'">
            <div class="ai-option-head">
              <span class="ai-option-letter">{{ oa.letter }}</span>
              <span class="ai-option-verdict">
                <span v-if="isOptCorrect(oa.verdict)">✓ 正确</span>
                <span v-else>✗ 错误</span>
              </span>
            </div>
            <div class="ai-option-reason">{{ oa.reason }}</div>
          </div>
        </div>
      </div>

      <!-- 参考答案 -->
      <div v-if="aiAnalysis.reference_explanation" class="ai-section reference">
        <div class="ai-section-title">
          <span class="icon">✅</span>
          <span>参考答案解析</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.reference_explanation }}</div>
      </div>

      <!-- 常见错误 -->
      <div v-if="aiAnalysis.common_mistakes" class="ai-section warning">
        <div class="ai-section-title">
          <span class="icon">⚠️</span>
          <span>常见错误</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.common_mistakes }}</div>
      </div>

      <!-- 解题技巧 -->
      <div v-if="aiAnalysis.solving_skill" class="ai-section tip">
        <div class="ai-section-title">
          <span class="icon">💡</span>
          <span>解题技巧 / 记忆口诀</span>
        </div>
        <div class="ai-section-body">{{ aiAnalysis.solving_skill }}</div>
      </div>
    </div>
    <div v-if="aiError" class="ai-error">{{ aiError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { api, Question } from '../utils/api'
import QuestionEditDialog from './QuestionEditDialog.vue'

export interface QuestionState {
  selected: number[]
  blankAnswer: string
  submitted: boolean
  isCorrect: boolean
  selfEvalDone: boolean
  judgeSelected: boolean | null
  elapsedSecs: number | null
}

const props = defineProps<{
  question: Question
  index: number
  autoNext?: boolean
  hasPrev?: boolean
  savedState?: QuestionState | null
  favorited?: boolean
  examMode?: boolean
  shuffleOptions?: boolean   // 选项乱序：打乱选项展示顺序，判分/答案高亮随映射自动对齐
  deferSubmit?: boolean      // 2026-08-20：考试模式交卷前不锁定答案（点选只高亮，交卷统一判分，可随时修改）
  readOnly?: boolean         // 2026-08-20：只读回顾（交卷后回看，隐藏工具栏与操作按钮）
}>()
const emit = defineEmits<{
  (e: 'answered', payload: { correct: boolean; answer: string; duration_ms: number | null }): void
  (e: 'state-change', state: QuestionState): void
  (e: 'next'): void
  (e: 'prev'): void
  (e: 'toggle-favorite'): void
  (e: 'question-updated', q: Question): void
}>()

// 从保存的状态恢复（返回上一题时能看到之前的答案）
const saved = props.savedState

// 原始选项（按题目存储顺序）——必须先于 displayMap 定义，
// 否则 displayMap 的 IIFE 在顶层立即执行时会触发 TDZ 错误（Cannot access 'rawOptions' before initialization），
// 导致整个 QuestionCard setup 崩溃、题目卡消失（题号导航在父组件不受影响）。
const rawOptions = computed<string[]>(() => {
  if (!props.question.options) return []
  try {
    return JSON.parse(props.question.options)
  } catch {
    return []
  }
})

// 判断题（type=judge，或选项恰为「正确/错误」「对/错」的 single 存储形式）不做乱序，保持固定顺序
function isJudgeQuestion(): boolean {
  if (props.question.type === 'judge') return true
  const opts = rawOptions.value
  if (opts.length === 2) {
    const t = opts.map(o => (o || '').replace(/^[A-H][.、:：)]?\s*/i, '').trim())
    return (t[0] === '正确' && t[1] === '错误') || (t[0] === '对' && t[1] === '错')
  }
  return false
}

// 选项乱序映射：组件挂载时一次性固定，避免做题中途开关切换导致下标错位。
// displayMap[displayIdx] = 原始下标；乱序关闭时即恒等映射 [0,1,2,...]。
const displayMap = (() => {
  const n = rawOptions.value.length
  const idx = Array.from({ length: n }, (_, i) => i)
  if (props.shuffleOptions && n > 2 && !isJudgeQuestion()) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    // 保证至少一个选项位置变化（避免偶发"恰好没乱"）
    if (idx.every((v, i) => v === i) && n > 1) {
      ;[idx[0], idx[1]] = [idx[1], idx[0]]
    }
  }
  return idx
})()
const options = computed<string[]>(() => displayMap.map(i => rawOptions.value[i]))
// saved.selected 是原始下标 → 转成展示下标
const selected = ref<number[]>(saved?.selected ? saved.selected.map(raw => displayMap.indexOf(raw)).filter(i => i >= 0) : [])
const blankAnswer = ref(saved?.blankAnswer ?? '')
const submitted = ref(saved?.submitted ?? false)
const isCorrect = ref(saved?.isCorrect ?? false)
const selfEvalDone = ref(saved?.selfEvalDone ?? false)
const judgeSelected = ref<boolean | null>(saved?.judgeSelected ?? null)

// 单题计时（spec §5.2）
const startTime = ref<number | null>(null)
const elapsedSecs = ref<number | null>(saved?.elapsedSecs ?? null)
let timerId: number | null = null

function startTimer() {
  if (timerId) return
  startTime.value = Date.now()
  const baseSecs = elapsedSecs.value ?? 0
  timerId = window.setInterval(() => {
    if (startTime.value) {
      elapsedSecs.value = baseSecs + Math.floor((Date.now() - startTime.value) / 1000)
    }
  }, 1000)
}
function stopTimer() {
  if (timerId) {
    window.clearInterval(timerId)
    timerId = null
  }
}
function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

onMounted(() => {
  // 已提交的题不重启计时
  if (!submitted.value) startTimer()
})
onBeforeUnmount(() => stopTimer())

// AI 解析相关
const analyzing = ref(false)
interface OptionAnalysis { letter: string; verdict: string; reason: string }
interface AiAnalysisData {
  knowledge_point?: string
  background?: string
  option_analysis?: OptionAnalysis[]
  reference_explanation?: string
  common_mistakes?: string
  solving_skill?: string
}
const aiAnalysis = ref<AiAnalysisData | null>(null)
const aiError = ref('')

function isOptCorrect(verdict: string): boolean {
  const v = verdict.trim()
  return v === '正确' || v === '对' || v === '✓' || v === '√'
}

// 题目编辑
const showEdit = ref(false)
function onQuestionSaved(updated: Question) {
  showEdit.value = false
  // 通知父组件题目已更新（父组件需要更新 questions 数组）
  emit('question-updated', updated)
}

// 判断题答案统一转布尔（兼容新快照 'true'/'false' 与旧快照 'A'/'B'、判断词 √×对错）
function judgeAnswerBool(ans: string | null | undefined): boolean {
  const opts = rawOptions.value.map(o => (o || '').replace(/^[A-H][.、:：)]?\s*/i, '').trim())
  const trueFirst = opts.length >= 1 && ['正确', '对', '√', 'true', 'TRUE', 'True', 't', 'T'].includes(opts[0])
  const v = String(ans ?? '').trim().toUpperCase()
  if (v === 'A') return trueFirst
  if (v === 'B') return !trueFirst
  // 2026-08-16 修复：此前用原值匹配 ['TRUE','T']，answer='true'（小写）匹配不上 → 永远判"错误"
  // → 正确答案为"正确"的题选正确也被判错。改用已大写的 v 匹配。
  return ['正确', '对', '√', 'TRUE', 'T'].includes(v)
}

// 展示顺序：乱序开启时打乱，否则原序；displayMap[i] = 原始下标（展示第 i 个对应原第 displayMap[i] 个）
// 判断题（内容识别）不算选择题，走 √× 渲染分支
const isChoice = computed(() => !isJudgeQuestion() && ['single', 'multi'].includes(props.question.type))
const isSelfEval = computed(() => !isChoice.value && !isJudgeQuestion())
const typeLabel = computed(() => {
  if (isJudgeQuestion()) return '判断'
  return ({ single: '单选', multi: '多选', judge: '判断', blank: '填空', qa: '问答' }[props.question.type] || props.question.type)
})
const displayAnswer = computed(() => {
  if (!props.question.answer) return '（未识别到答案）'
  if (isJudgeQuestion()) return judgeAnswerBool(props.question.answer) ? '正确' : '错误'
  return props.question.answer
})
const keyHint = computed(() => {
  const suffix = props.examMode ? '' : '，F 收藏'
  // 考试模式 + 自动下一题：提示点击即跳（deferSubmit 只选中不锁定）
  if (props.examMode && props.autoNext) {
    if (isJudgeQuestion()) return '点击选项自动进入下一题' + suffix
    if (props.question.type === 'single') return '点击选项自动进入下一题' + suffix
    return props.deferSubmit ? '选完点「下一题」继续（可随时修改）' + suffix : '选完按 Enter 确认自动下一题' + suffix
  }
  if (isChoice.value) return '1-4 选选项，Enter 确认，← → 翻页' + suffix
  if (isJudgeQuestion()) return '1 正确 / 2 错误，← → 翻页' + suffix
  return '输入答案后 Enter 确认，← → 翻页' + suffix
})

function emitState() {
  emit('state-change', {
    // selected 转回原始下标存储（兼容存档与跨设备）
    selected: selected.value.map(toRawIndex),
    blankAnswer: blankAnswer.value,
    submitted: submitted.value,
    isCorrect: isCorrect.value,
    selfEvalDone: selfEvalDone.value,
    judgeSelected: judgeSelected.value,
    elapsedSecs: elapsedSecs.value,
  })
}

// 监听状态变化，及时同步给父组件保存
watch([selected, blankAnswer, submitted, isCorrect, selfEvalDone, judgeSelected, elapsedSecs], emitState, { deep: true })

function letter(i: number) { return String.fromCharCode(65 + i) }
function toggle(i: number) {
  if (props.question.type === 'single') {
    selected.value = [i]
    // 2026-08-20：考试模式 + deferSubmit → 只选中不锁定，交卷统一判分；自动下一题仍跳转
    if (props.examMode && props.deferSubmit) {
      if (props.autoNext) window.setTimeout(() => emit('next'), 300)
      return
    }
    // 考试模式 + 自动下一题：单选选完直接提交，无需点确认
    if (props.examMode && props.autoNext) {
      submit()
    }
  } else {
    const idx = selected.value.indexOf(i)
    if (idx >= 0) selected.value.splice(idx, 1)
    else selected.value.push(i)
  }
}
function optionClass(i: number) {
  if (!submitted.value) return { selected: selected.value.includes(i) }
  // 考试模式：提交后只标记选中，不泄露对错（交卷后才看成绩）
  if (props.examMode) return { selected: selected.value.includes(i) }
  const correctLetters = correctDisplayIndices()
  const isAns = correctLetters.includes(i)
  const isPicked = selected.value.includes(i)
  return { correct: isAns, wrong: isPicked && !isAns }
}
function judgeClass(val: boolean) {
  if (!submitted.value) return { selected: judgeSelected.value === val }
  // 考试模式：提交后只标记选中，不泄露对错（交卷后才看成绩）
  if (props.examMode) return { selected: judgeSelected.value === val }
  // 答案缺失时只高亮用户选择，不标绿/红
  if (!props.question.answer) return { selected: judgeSelected.value === val }
  const ans = judgeAnswerBool(props.question.answer)
  const isCorrectOption = (val === ans)
  // 答对时：只标绿正确选项，不标红错误选项；答错时：错项标红，正确项标绿
  if (isCorrect.value) {
    return { correct: isCorrectOption }  // 答对了，只显示正确答案为绿色，错误选项不高亮
  }
  // 答错了：用户选的标红，正确答案标绿
  return { correct: isCorrectOption, wrong: !isCorrectOption && judgeSelected.value === val }
}
function parseAnswerLetters(): number[] {
  if (!props.question.answer) return []
  try {
    const arr = JSON.parse(props.question.answer) as string[]
    return arr.map(s => s.charCodeAt(0) - 65)
  } catch {
    return props.question.answer.split('').filter(c => /[A-H]/i.test(c)).map(c => c.toUpperCase().charCodeAt(0) - 65)
  }
}
// 正确答案的展示下标（原始下标 → 展示下标映射；displayMap[displayIdx] = rawIdx，所以反查 rawIdx → displayIdx）
function correctDisplayIndices(): number[] {
  const rawCorrect = parseAnswerLetters()
  if (!props.shuffleOptions) return rawCorrect
  return rawCorrect.map(raw => displayMap.indexOf(raw)).filter(i => i >= 0)
}
// 展示下标 → 原始下标（存档/上报时用原始下标，兼容旧数据）
function toRawIndex(displayIdx: number): number {
  if (!props.shuffleOptions) return displayIdx
  return displayMap[displayIdx] ?? displayIdx
}
function getDurationMs(): number | null {
  if (elapsedSecs.value === null) return null
  return elapsedSecs.value * 1000
}
function answerJudge(val: boolean) {
  judgeSelected.value = val
  // 2026-08-20：考试模式 + deferSubmit → 只切换不锁定，交卷统一判分（可反悔）；自动下一题仍跳转
  if (props.examMode && props.deferSubmit) {
    if (props.autoNext) window.setTimeout(() => emit('next'), 300)
    return
  }
  submitted.value = true
  // 答案缺失时无法判定对错，记为错误但不影响错题本判定逻辑
  isCorrect.value = props.question.answer ? (val === judgeAnswerBool(props.question.answer)) : false
  stopTimer()
  emit('answered', { correct: isCorrect.value, answer: String(val), duration_ms: getDurationMs() })
  maybeAutoNext()
}
function submit() {
  submitted.value = true
  stopTimer()
  if (isChoice.value) {
    // selected 是展示下标 → 转原始下标后判分（与答案字母一致）
    const picked = [...selected.value].map(toRawIndex).sort().map(i => String.fromCharCode(65 + i))
    const correct = parseAnswerLetters().sort().map(i => String.fromCharCode(65 + i))
    isCorrect.value = JSON.stringify(picked) === JSON.stringify(correct)
    emit('answered', { correct: isCorrect.value, answer: JSON.stringify(picked), duration_ms: getDurationMs() })
    maybeAutoNext()
  } else if (isJudgeQuestion()) {
    // 判断题通过 answerJudge 处理，不会走到这里
  } else {
    // 填空/问答：展示参考答案，等自评，不设置 isCorrect
    isCorrect.value = false
  }
}
function selfEval(correct: boolean) {
  isCorrect.value = correct
  selfEvalDone.value = true
  emit('answered', { correct, answer: blankAnswer.value, duration_ms: getDurationMs() })
  maybeAutoNext()
}
// 自动下一题定时器（手动翻页时取消，避免跳两题）
let autoNextTimer: number | null = null
function maybeAutoNext() {
  if (!props.autoNext) return
  if (props.examMode) {
    // 考试模式：答完即自动跳下一题（不区分对错，因为考试模式不显示对错）
    autoNextTimer = window.setTimeout(() => { autoNextTimer = null; emit('next') }, 300)
  } else if (isCorrect.value) {
    // 练习模式：答对自动下一题，答错停留
    autoNextTimer = window.setTimeout(() => { autoNextTimer = null; emit('next') }, 1500)
  }
}
function cancelAutoNext() {
  if (autoNextTimer) {
    window.clearTimeout(autoNextTimer)
    autoNextTimer = null
  }
}
// 手动翻页：取消挂起的自动跳题，再触发翻页
function manualNext() { cancelAutoNext(); emit('next') }
function manualPrev() { cancelAutoNext(); emit('prev') }

// P1-9: 快捷键支持
function handleKeydown(e: KeyboardEvent) {
  // 忽略输入框中的按键（避免影响填空答题）
  const target = e.target as HTMLElement
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
    if (e.key === 'Enter' && !e.shiftKey && !submitted.value && !props.deferSubmit) {
      e.preventDefault()
      submit()
    }
    return
  }
  // 已提交时：← → 翻页，Enter 下一题，F 收藏
  if (submitted.value && (!isSelfEval.value || selfEvalDone.value)) {
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      manualNext()
      return
    }
  }
  // 考试模式：提交后也可以 Enter 进入下一题
  if (submitted.value && props.examMode) {
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      manualNext()
      return
    }
  }
  if (e.key === 'ArrowLeft' && props.hasPrev) {
    e.preventDefault()
    manualPrev()
    return
  }
  if (!props.examMode && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    emit('toggle-favorite')
    return
  }
  // 未提交时：1-4 选 ABCD（选择题），1/2 选正确/错误（判断题），Enter 确认
  if (!submitted.value) {
    if (isChoice.value) {
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= options.value.length) {
        e.preventDefault()
        toggle(n - 1)
        return
      }
    } else if (isJudgeQuestion()) {
      if (e.key === '1') { e.preventDefault(); answerJudge(true); return }
      if (e.key === '2') { e.preventDefault(); answerJudge(false); return }
    }
    if (e.key === 'Enter' && isChoice.value && !props.deferSubmit) {
      e.preventDefault()
      submit()
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  cancelAutoNext()
})

async function analyze() {
  if (analyzing.value) return
  analyzing.value = true
  aiError.value = ''
  aiAnalysis.value = null
  try {
    const raw = await api.analyzeQuestion(props.question)
    // 解析 AI 返回的 JSON（兼容 markdown 代码块包裹）
    let s = raw.trim()
    s = s.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim()
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) {
      s = s.slice(start, end + 1)
    }
    try {
      aiAnalysis.value = JSON.parse(s) as AiAnalysisData
    } catch (parseErr) {
      // 解析失败：原始文本回退显示
      aiAnalysis.value = {
        knowledge_point: '⚠ AI 返回格式异常，原始内容：',
        option_analysis: [],
        reference_explanation: raw,
        solving_skill: '',
      }
    }
  } catch (e) {
    aiError.value = '解析失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    analyzing.value = false
  }
}
</script>

<style scoped>
.qcard { background: var(--color-card); border-radius: var(--radius-lg); padding: 24px; border: 1px solid var(--color-border-light); }
.stem { font-size: 16px; line-height: 1.6; margin-bottom: 16px; position: relative; padding-right: 130px; }
.stem.no-toolbar { padding-right: 0; }
.idx { font-weight: bold; margin-right: 8px; }
.type-tag { background: var(--color-border-light); padding: 2px 8px; border-radius: var(--radius-sm); font-size: 12px; margin-right: 8px; }
.timer { color: var(--color-text-tertiary); font-size: 12px; margin-right: 8px; font-family: monospace; background: var(--color-border-light); padding: 2px 6px; border-radius: var(--radius-sm); }

/* 右上角工具栏 */
.card-toolbar { position: absolute; top: -4px; right: 0; display: flex; gap: 6px; }
.tool-btn { width: 32px; height: 32px; border: 1px solid var(--color-border); border-radius: 50%; background: var(--color-card); cursor: pointer; font-size: 15px; line-height: 1; color: var(--color-text-secondary); display: flex; align-items: center; justify-content: center; transition: all 0.15s; padding: 0; }
.tool-btn:hover { background: var(--color-primary-light); color: var(--color-primary); border-color: var(--color-primary); transform: translateY(-1px); }
.tool-btn.active { background: #fef3c7; color: #d97706; border-color: #fde68a; }
.tool-btn.ai:hover { background: #eef2ff; color: #4f46e5; border-color: #a5b4fc; }
.tool-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.options { display: flex; flex-direction: column; gap: 8px; }
.option { text-align: left; padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; color: var(--color-text); }
.option.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.option.correct { border-color: var(--color-success); background: var(--color-success-light); }
.option.wrong { border-color: var(--color-danger); background: var(--color-danger-light); }
.letter { font-weight: bold; margin-right: 8px; }
.actions { margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.act-btn { padding: 9px 18px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; color: var(--color-text); font-size: 14px; font-weight: 500; transition: all 0.15s; }
.act-btn:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.act-btn.primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); margin-left: auto; }
.act-btn.primary:hover { background: var(--color-primary-dark); }
.act-btn.ghost { background: transparent; }
.act-btn.success { background: #16a34a; color: #fff; border-color: #16a34a; margin-left: auto; }
.act-btn.success:hover { background: #15803d; }
.act-btn.danger { background: #dc2626; color: #fff; border-color: #dc2626; }
.act-btn.danger:hover { background: #b91c1c; }
.hint { margin-top: 8px; font-size: 12px; color: var(--color-text-tertiary); }
.feedback { margin-top: 16px; padding: 12px; border-radius: var(--radius-md); background: var(--color-danger-light); }
.feedback.correct { background: var(--color-success-light); }
.feedback.exam { background: var(--color-info-light); color: var(--color-info); }
.analysis { margin-top: 8px; color: var(--color-text-secondary); }
textarea { width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); color: var(--color-text); }
.ai-analysis {
  margin-top: 20px;
  padding: 20px 24px;
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid #cbd5e1;
  font-size: 14px;
  line-height: 1.75;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.ai-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 700;
  color: #1e40af;
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 2px solid #c7d8f5;
}
.ai-header-icon { font-size: 22px; }
.ai-header-badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  background: #fff;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}
.ai-section {
  margin-bottom: 16px;
  padding: 12px 14px 12px 16px;
  border-radius: var(--radius-md);
  background: #fff;
  border-left: 4px solid #cbd5e1;
  position: relative;
}
.ai-section:last-child { margin-bottom: 0; }
.ai-section.knowledge { border-left-color: #f59e0b; background: linear-gradient(90deg, #fffbeb 0%, #fff 30%); }
.ai-section.background { border-left-color: #6366f1; background: linear-gradient(90deg, #eef2ff 0%, #fff 30%); }
.ai-section.reference { border-left-color: #16a34a; background: linear-gradient(90deg, #f0fdf4 0%, #fff 30%); }
.ai-section.warning { border-left-color: #ef4444; background: linear-gradient(90deg, #fef2f2 0%, #fff 30%); }
.ai-section.tip { border-left-color: #0ea5e9; background: linear-gradient(90deg, #f0f9ff 0%, #fff 30%); }
.ai-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: #1e293b;
  font-size: 15px;
  margin-bottom: 8px;
}
.ai-section-title .icon { font-size: 17px; }
.ai-section-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 1px 8px;
  border-radius: 10px;
}
.ai-section-body {
  color: #334155;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: justify;
  font-size: 14px;
}
.ai-options { display: flex; flex-direction: column; gap: 10px; }
.ai-option-row {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: #fafafa;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #cbd5e1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s;
}
.ai-option-row:hover { transform: translateX(2px); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05); }
.ai-option-row.is-correct {
  border-left-color: #16a34a;
  background: linear-gradient(90deg, #dcfce7 0%, #fff 60%);
  border-color: #bbf7d0;
}
.ai-option-row.is-wrong {
  border-left-color: #dc2626;
  background: linear-gradient(90deg, #fee2e2 0%, #fff 60%);
  border-color: #fecaca;
}
.ai-option-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ai-option-letter {
  font-weight: 800;
  font-size: 16px;
  color: #475569;
  width: 24px;
  text-align: center;
  background: #fff;
  border-radius: 50%;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #cbd5e1;
}
.ai-option-row.is-correct .ai-option-letter { color: #15803d; border-color: #16a34a; }
.ai-option-row.is-wrong .ai-option-letter { color: #b91c1c; border-color: #dc2626; }
.ai-option-verdict {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 12px;
  background: #e2e8f0;
  color: #475569;
  letter-spacing: 0.5px;
}
.ai-option-row.is-correct .ai-option-verdict { background: #16a34a; color: #fff; }
.ai-option-row.is-wrong .ai-option-verdict { background: #dc2626; color: #fff; }
.ai-option-reason {
  color: #475569;
  font-size: 13.5px;
  line-height: 1.7;
  padding-left: 34px;
  text-align: justify;
}
.ai-error { margin-top: 12px; padding: 8px 12px; border-radius: var(--radius-md); background: var(--color-danger-light); color: var(--color-danger); }

/* 移动端适配 */
@media (max-width: 768px) {
  .qcard { padding: 16px; }
  .stem { padding-right: 0; padding-bottom: 38px; }
  .stem.no-toolbar { padding-bottom: 0; }
  /* 2026-08-16 修复：此前工具栏仍 absolute 右上角（right:0;top:0），而题干已取消右 padding
     → 三个按钮直接压在题干文字上。改为挂到题干下方（padding-bottom:38px 已让位） */
  .card-toolbar { top: auto; bottom: 0; right: 0; }
  .act-btn { flex: 1; min-width: 88px; justify-content: center; text-align: center; padding: 9px 8px; font-size: 13px; }
  .act-btn.primary, .act-btn.success { margin-left: 0; }
  /* 2026-08-16：手机端隐藏键盘快捷键提示（无键盘，纯桌面功能） */
  .hint { display: none; }
  .ai-analysis { padding: 14px 14px; }
  .ai-option-reason { padding-left: 0; }
}
</style>
