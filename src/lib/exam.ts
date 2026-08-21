// 多人考试模块：创建考试 / 答题 / 成绩管理（基于 CloudBase 云数据库）
// 数据模型：
//   exams        考试配置（题目清单/时长/创建者/状态）
//   exam_results 考生答卷（exam_id/姓名/答案/成绩/时间）
//
// 未配置 CloudBase 时自动降级为"本地演示模式"（仅本机可用，方便开发测试）

import { idb } from './db'

// 统一错误格式化：CloudBase 常抛普通对象（非 Error 实例），直接 String() 会得到 "[object Object]"
export function errMsg(e: any): string {
  if (e == null) return '未知错误'
  if (e instanceof Error) return e.message
  if (typeof e === 'object') {
    try {
      return (e as any).message || (e as any).errMsg || (e as any).error || JSON.stringify(e)
    } catch {
      return String(e)
    }
  }
  return String(e)
}

// ===== 题型识别（统一 content-based） =====
// 关键：云端判断题实际存储为 type:'single' + options["正确","错误"] + answer "A"/"B"，
// 直接按 q.type 过滤会把判断题当单选、且永远抽不到 type:'judge'。这里按内容判定。
const JUDGE_TRUE_WORDS = new Set(['正确', '对', '√', 'true', 'TRUE', 'True', 't', 'T'])
const JUDGE_FALSE_WORDS = new Set(['错误', '错', '×', 'false', 'FALSE', 'False', 'f', 'F'])
const JUDGE_WORDS = new Set([...JUDGE_TRUE_WORDS, ...JUDGE_FALSE_WORDS])

export function classifyQuestionType(q: { type?: string | null; options?: string | null; answer?: string | null }): 'single' | 'multi' | 'judge' | 'blank' | 'qa' {
  let opts: string[] | null = null
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p)) opts = p.map((o: any) => String(o).trim())
  } catch { opts = null }
  // 判断题：选项恰为「正确/错误」类二元组，或答案本身是判断词
  if (opts && opts.length === 2 && opts.every(o => JUDGE_WORDS.has(o))) return 'judge'
  const ans = String(q.answer ?? '').trim()
  if (JUDGE_WORDS.has(ans)) return 'judge'
  const t = String(q.type ?? '').toLowerCase()
  if (t.includes('multi') || t === '多选') return 'multi'
  const letters = (ans.match(/[A-Ha-h]/g) || []).map(c => c.toUpperCase())
  if (letters.length > 1) return 'multi'
  if (t.includes('judge') || t === '判断') return 'judge'
  // 2026-08-15 修复：qa 独立于 blank（此前合并为 blank，问答题显示成填空）
  if (t.includes('blank') || t === '填空') return 'blank'
  if (t.includes('qa') || t === '问答' || t === '简答') return 'qa'
  return 'single'
}

// 判断题答案统一为 'true'/'false'（A=首个选项对应的真值，兼容 answer 直接存判断词）
export function judgeAnswerBool(ans: string | null, options: string[] | null): string {
  const trueFirst = !!options && options.length >= 1 && JUDGE_TRUE_WORDS.has(String(options[0]).trim())
  const v = String(ans ?? '').trim().toUpperCase()
  if (v === 'A') return trueFirst ? 'true' : 'false'
  if (v === 'B') return trueFirst ? 'false' : 'true'
  if (JUDGE_TRUE_WORDS.has(String(ans ?? '').trim())) return 'true'
  if (JUDGE_FALSE_WORDS.has(String(ans ?? '').trim())) return 'false'
  return 'true'
}

// 智能组卷配额模板：5 个等级 × 3 种题型 = 220 题（从公共题库抽题）
export const COMPOSE_SPEC = [
  { level: '初级', bank: 'lquiz_banks_8', single: 11, multi: 5, judge: 14 },
  { level: '中级', bank: 'lquiz_banks_9', single: 11, multi: 5, judge: 14 },
  { level: '高级', bank: 'lquiz_banks_10', single: 29, multi: 15, judge: 36 },
  { level: '技师', bank: 'lquiz_banks_11', single: 18, multi: 10, judge: 22 },
  { level: '安规', bank: 'lquiz_banks_12', single: 11, multi: 5, judge: 14 },
]

export interface ExamQuestion {
  id: number          // 题目 id（本地题目库中的 id）
  bank_id: number
  stem: string
  type: string
  options: string | null
  answer: string | null
  analysis: string | null
  source_index?: number | null
}

export interface Exam {
  _id?: string
  title: string
  description: string
  duration_minutes: number
  questions: ExamQuestion[]   // 考试题目的完整快照（含答案，供判分）
  status: 'draft' | 'published' | 'closed'
  visibility?: 'public' | 'private'   // 公共考试（所有人可考）/ 自建考试（仅自己可见）
  deadline?: string | null     // 截止时间 ISO 字符串；为空表示不限时
  shuffle_options?: boolean    // 答题时是否乱序选项（默认 true；false = 按原顺序展示）
  created_at: string
  creator_name?: string        // 创建人（用户可自定义填写）
  _openid?: string             // 云数据库创建者标识（服务端自动写入）
}

export interface ExamResult {
  _id?: string
  exam_id: string
  student_name: string
  answers: Record<string, { selected: number[]; blank: string; judge: boolean | null }>
  correct: number
  wrong: number
  unanswered: number
  score: number
  accuracy: number
  duration_ms: number | null
  submitted_at: string
  query_code?: string | null   // 查询码：交卷后生成，凭码回看错题
}

// ===== 本地演示模式（未配置云） =====

const LOCAL_EXAMS_KEY = 'local_exams'
const LOCAL_RESULTS_KEY = 'local_exam_results'
const LOCAL_EXAM_SNAPSHOTS_KEY = 'local_exam_snapshots'   // 创建/作答过的考试快照（云端兜底）

function getLocalExams(): Exam[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_EXAMS_KEY) || '[]') } catch { return [] }
}
function saveLocalExams(exams: Exam[]) {
  localStorage.setItem(LOCAL_EXAMS_KEY, JSON.stringify(exams))
}
function getLocalResults(): ExamResult[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_RESULTS_KEY) || '[]') } catch { return [] }
}
function saveLocalResults(results: ExamResult[]) {
  localStorage.setItem(LOCAL_RESULTS_KEY, JSON.stringify(results))
}
// 保存考试快照（用于云端查询失败/网络异常时兜底展示，避免误报"考试不存在"）
export function saveExamSnapshot(exam: Exam): void {
  if (!exam?._id) return
  try {
    const snapshots = getExamSnapshots()
    snapshots[exam._id] = { ...exam, _snapshot_at: new Date().toISOString() }
    // 最多保留 50 场，防止无限膨胀
    const ids = Object.keys(snapshots)
    if (ids.length > 50) {
      const sorted = ids.sort((a, b) => String(snapshots[b]._snapshot_at || '').localeCompare(String(snapshots[a]._snapshot_at || '')))
      for (const old of sorted.slice(50)) delete snapshots[old]
    }
    localStorage.setItem(LOCAL_EXAM_SNAPSHOTS_KEY, JSON.stringify(snapshots))
  } catch (e) { console.warn('保存考试快照失败：', errMsg(e)) }
}
function getExamSnapshots(): Record<string, Exam> {
  try { return JSON.parse(localStorage.getItem(LOCAL_EXAM_SNAPSHOTS_KEY) || '{}') } catch { return {} }
}
// 本设备是否创建/作答过该考试（用于 isMine 兜底：云端 _openid 跨设备不匹配时仍可管理）
export function hasLocalSnapshot(id: string): boolean {
  return !!getExamSnapshots()[id]
}
function getExamSnapshot(id: string): Exam | null {
  return getExamSnapshots()[id] || null
}
function removeExamSnapshot(id: string): void {
  try {
    const snapshots = getExamSnapshots()
    if (snapshots[id]) { delete snapshots[id]; localStorage.setItem(LOCAL_EXAM_SNAPSHOTS_KEY, JSON.stringify(snapshots)) }
  } catch { /* ignore */ }
}

// ===== CloudBase 访问（懒加载） =====

let cloudApp: any = null
let cloudDb: any = null
let cloudReady = false
let cachedUid: string | null = null

// 默认云端环境 ID：网页版访客未配置云同步时，用此 envId 只读访问公共题库/公共考试
// 来源：构建时由 .env 的 VITE_DEFAULT_CLOUD_ENV_ID 注入（该文件不进 git 仓库）。
// 为空 = 纯本地模式（无默认云端环境，用户需在设置页自行填写 envId 才能用公共数据）
const DEFAULT_CLOUD_ENV_ID = (import.meta.env.VITE_DEFAULT_CLOUD_ENV_ID as string) || ''

async function ensureCloud(): Promise<boolean> {
  if (cloudReady) return true
  try {
    const cfgRaw = localStorage.getItem('cloudbase_config')
    let envId: string | null = null
    if (cfgRaw) {
      try {
        const cfg = JSON.parse(cfgRaw)
        if (cfg.envId && cfg.enabled) envId = cfg.envId
      } catch { /* 配置损坏则回退默认 */ }
    }
    // 未配置或配置关闭 → 用默认 envId 只读访问公共数据（不写入 localStorage）
    if (!envId) envId = DEFAULT_CLOUD_ENV_ID
    if (!envId) return false  // 无默认环境且用户未配置 → 纯本地模式（不连云端）
    const mod = await import('@cloudbase/js-sdk')
    const tcb = mod.default
    cloudApp = tcb.init({ env: envId })
    // 必须先匿名登录，否则 ACL（auth != null）会拒绝所有读写
    const auth = cloudApp.auth({ persistence: 'local' })
    let state = null
    try { state = await auth.getLoginState() } catch { state = null }
    if (!state) {
      await auth.anonymousAuthProvider().signIn()
      // signIn() 返回可能不带 uid，重新取登录态
      try { state = await auth.getLoginState() } catch { state = null }
    }
    cloudDb = cloudApp.database()
    cachedUid = state?.user?.uid || state?.uid || null
    cloudReady = true
    return true
  } catch (e) {
    console.warn('考试模块 CloudBase 初始化失败：', e)
    return false
  }
}

function isCloud(): boolean { return cloudReady && !!cloudDb }

// 超时保护：CloudBase 请求异常挂起时避免页面永远卡在"加载中"
function withTimeout<T>(p: Promise<T>, ms = 15000, label = '请求'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms / 1000}s），请检查网络后重试`)), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// ===== 题目数据自愈（2026-08-16） =====
// 背景：公共题库历史导入 bug——多选题第 5 个及以后的选项被错误拼进题干（stem 尾带 "E. xxx"/"F. xxx"），
// 而 answer 仍含越界字母（如 ["A","B","C","D","E"]），导致选项区只有 A-D、怎么选都判错。
// 自愈：从题干尾部提取 E/F 选项块补回 options，题干回归干净。幂等，仅内存级（不写云端）。
export function healQuestion(q: ExamQuestion): ExamQuestion {
  let optsRaw: string[] | null = null
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p)) optsRaw = p.map((o: any) => String(o))
  } catch { optsRaw = null }
  if (!optsRaw || !optsRaw.length) return q
  // 判断题跳过：answer 为 true/false 会被字母解析误判成 E，且判断题无选项残留问题
  const judgeLike = q.type === 'judge' || (optsRaw.length === 2 && ((optsRaw[0] === '正确' && optsRaw[1] === '错误') || (optsRaw[0] === '对' && optsRaw[1] === '错')))
  if (judgeLike) return q
  // 去掉选项误带的编号前缀（如 "E.防止误分" → "防止误分"）
  const opts = optsRaw.map(o => o.replace(/^[A-Ha-h][.、．:：]\s*/, '').trim())
  if (opts.some(o => !o)) return q
  const letters = parseAnswerLetters(q.answer)
  const maxIdx = letters.length ? Math.max(...letters) : -1
  const stem = q.stem || ''
  const m = stem.match(/（[^（）]*）[\s\S]*?([EＥFＦGＧHＨ][.、．:：][\s\S]*)$/)
  const tail = m ? m[1] : null
  const broken = maxIdx >= opts.length
  if (!broken && !tail) return q
  let newOpts: string[] = []
  if (tail) {
    for (const b of tail.split(/(?=[EＥFＦGＧHＨ][.、．:：])/)) {
      const t = b.replace(/^[EＥFＦGＧHＨ][.、．:：]\s*/, '').trim()
      if (t) newOpts.push(t)
    }
  }
  if (broken) {
    // 必须提取足够选项补齐越界字母，否则不动（避免拆错题干）
    const need = maxIdx - opts.length + 1
    if (newOpts.length < need) return q
  }
  if (!newOpts.length) return q
  return {
    ...q,
    stem: stem.slice(0, (m?.index ?? 0) + ((m?.[0].length ?? 0) - (tail?.length ?? 0))).replace(/[\s，,。]+$/, ''),
    options: JSON.stringify([...opts, ...newOpts]),
  }
}
function healExam(exam: Exam | null): Exam | null {
  if (!exam?.questions?.length) return exam
  return { ...exam, questions: exam.questions.map(healQuestion) }
}

// ===== 创建考试 =====

// 抽题池配置：按题库抽固定数量，或按题型配比抽题
export interface ExamPoolItem {
  bank_id: number | string
  count?: number                    // 自由模式：该题库抽几道
  counts?: Partial<Record<'single' | 'multi' | 'judge' | 'blank' | 'qa', number>>  // 题型配比模式
}

export async function createExam(
  title: string,
  description: string,
  durationMinutes: number,
  questionPool: ExamPoolItem[],
  deadline?: string | null,
  visibility?: 'public' | 'private',
  creatorName?: string | null,
  shuffleOptions?: boolean,
): Promise<Exam> {
  // 从题库抽题（支持本地题库数字 id 与云端公共题库字符串 id 混合）
  const questions: ExamQuestion[] = []
  for (const pool of questionPool) {
    // 读题库全部题目
    let all: any[] = []
    if (typeof pool.bank_id === 'string') {
      // 云端公共题库：直接读云端题目
      all = await listPublicBankQuestions(pool.bank_id)
    } else {
      all = await idb.listQuestions(pool.bank_id)
    }
    let picked: any[] = []
    if (pool.counts && Object.values(pool.counts).some(n => (n || 0) > 0)) {
      // 题型配比模式：按题型分别抽足（不足按实际数量）
      // 注意：用 classifyQuestionType 内容识别（云端判断题是 type:'single' + ["正确","错误"]，
      // 直接按 q.type 过滤会抽 0 道判断）
      const want = { single: 0, multi: 0, judge: 0, blank: 0, qa: 0, ...pool.counts }
      for (const t of ['single', 'multi', 'judge', 'blank', 'qa'] as const) {
        const bucket = all.filter(q => classifyQuestionType(q) === t)
        const n = Math.min(want[t] || 0, bucket.length)
        picked.push(...shuffle(bucket).slice(0, n))
      }
    } else {
      // 自由模式：随机抽 count 道
      picked = shuffle(all).slice(0, Math.min(pool.count || 0, all.length))
    }
    for (const q of picked) {
      const t = classifyQuestionType(q)
      if (t === 'judge') {
        // 判断题规范化：统一 type/options/answer（云端判断题存为 single + ["正确","错误"]）
        let opts: string[] = []
        try { const p = JSON.parse(q.options || '[]'); if (Array.isArray(p)) opts = p.map((o: any) => String(o)) } catch { /* ignore */ }
        questions.push({
          id: q.id,
          bank_id: typeof pool.bank_id === 'number' ? pool.bank_id : (q.bank_id ?? 0),
          stem: q.stem,
          type: 'judge',
          options: JSON.stringify(['正确', '错误']),
          answer: judgeAnswerBool(q.answer, opts.length ? opts : null),
          analysis: q.analysis,
          source_index: q.source_index ?? null,
        })
      } else {
        questions.push({
          id: q.id,
          bank_id: typeof pool.bank_id === 'number' ? pool.bank_id : (q.bank_id ?? 0),
          stem: q.stem,
          type: t,
          options: q.options,
          answer: q.answer,
          analysis: q.analysis,
          source_index: q.source_index ?? null,
        })
      }
    }
  }
  // 数据自愈：私人题库/历史数据可能带 E/F 选项残留，出题时统一修复（幂等）
  for (let i = 0; i < questions.length; i++) questions[i] = healQuestion(questions[i])
  // 按题型排序：单选 → 多选 → 判断 → 其他（不打乱，保持有序）
  const typeOrder: Record<string, number> = { single: 0, multi: 1, judge: 2 }
  questions.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9))

  const exam: Exam = {
    title,
    description,
    duration_minutes: Math.max(1, durationMinutes),
    questions,
    status: 'published',
    visibility: visibility || 'public',
    deadline: deadline || null,
    shuffle_options: shuffleOptions !== false, // 默认开启乱序；仅显式传 false 时关闭
    created_at: new Date().toISOString(),
    creator_name: creatorName?.trim() || null,
  }

  if (await ensureCloud() && isCloud()) {
    const res = await cloudDb.collection('exams').add(exam)
    exam._id = res.id
  } else {
    // 本地演示
    const exams = getLocalExams()
    exam._id = 'local_' + Date.now().toString(36)
    exams.unshift(exam)
    saveLocalExams(exams)
  }
  // 保存快照：云端考试创建后立即缓存，供后续 getExam 兜底（网络抖动/ACL 异常时仍可作答）
  saveExamSnapshot(exam)
  return exam
}

export async function listExams(): Promise<Exam[]> {
  if (await ensureCloud() && isCloud()) {
    // ACL 已保证：非创建者只能读到 public 考试；创建者可读到自己的（含 private）
    // 注意：CloudBase ACL 下「无条件查询」返回空（实测），必须带 where 条件！
    // 因此分两次查：本人（含 private）+ 公共，合并去重
    const uid = await getCurrentUid()
    const all: any[] = []
    const seen = new Set<string>()
    if (uid) {
      // 注意：uid 为 null 时 where({_openid:null}) 会返回 undefined data（实测），必须跳过
      try {
        const mine = await cloudDb.collection('exams')
          .where({ _openid: uid })
          .orderBy('created_at', 'desc')
          .limit(500)
          .get()
        const rows = Array.isArray(mine.data) ? mine.data : []
        for (const r of rows) {
          const k = String(r._id ?? r.id)
          if (!seen.has(k)) { seen.add(k); all.push(r) }
        }
      } catch (e) { console.warn('listExams 查询本人考试失败：', errMsg(e)) }
    }
    try {
      const pub = await cloudDb.collection('exams')
        .where({ visibility: 'public' })
        .orderBy('created_at', 'desc')
        .limit(500)
        .get()
      const rows = Array.isArray(pub.data) ? pub.data : []
      for (const r of rows) {
        const k = String(r._id ?? r.id)
        if (!seen.has(k)) { seen.add(k); all.push(r) }
      }
    } catch (e) { console.warn('listExams 查询公共考试失败：', errMsg(e)) }
    // 补充本地快照：云端查询失败时也能看到自己创建过的考试（用快照合并）
    const snapshots = getExamSnapshots()
    for (const s of Object.values(snapshots)) {
      const k = String(s._id)
      if (!seen.has(k)) { seen.add(k); all.push(s) }
    }
    return all
  }
  return getLocalExams()
}

export async function getExam(id: string): Promise<Exam | null> {
  if (await ensureCloud() && isCloud()) {
    // doc(id).get() 在 ACL 下会被拒绝（实测 DATABASE_PERMISSION_DENIED）；
    // where({_id}) 也查不到（_id 是保留字段）。正确做法：查询列表后内存匹配。
    const uid = await getCurrentUid()
    if (uid) {
      // uid 为 null 时 where({_openid:null}) 返回 undefined（实测），必须跳过本人查询
      try {
        const mine = await cloudDb.collection('exams')
          .where({ _openid: uid })
          .limit(500)
          .get()
        const mineRows = Array.isArray(mine.data) ? mine.data : []
        const found = mineRows.find((r: any) => String(r._id ?? r.id) === id)
        if (found) { saveExamSnapshot(found); return healExam(found) }
      } catch (e) { console.warn('getExam 查询本人考试失败：', errMsg(e)) }
    }
    try {
      const pub = await cloudDb.collection('exams')
        .where({ visibility: 'public' })
        .limit(500)
        .get()
      const pubRows = Array.isArray(pub.data) ? pub.data : []
      const found = pubRows.find((r: any) => String(r._id ?? r.id) === id)
      if (found) { saveExamSnapshot(found); return healExam(found) }
    } catch (e) { console.warn('getExam 查询公共考试失败：', errMsg(e)) }
    // 兜底：云端查不到时用本地快照（创建过/作答过该考试则一定有快照）
    const snapshot = getExamSnapshot(id)
    if (snapshot) return healExam(snapshot)
    return null
  }
  return healExam(getLocalExams().find(e => e._id === id) || null)
}

// 获取当前登录用户 openid（用于区分「我的考试/我的题库」）
let uidPromise: Promise<string | null> | null = null
export async function getCurrentUid(): Promise<string | null> {
  if (cachedUid) return cachedUid
  if (!(await ensureCloud()) || !isCloud()) return null
  // 并发调用只查一次
  if (!uidPromise) {
    uidPromise = (async () => {
      try {
        const auth = cloudApp.auth({ persistence: 'local' })
        let state = await auth.getLoginState()
        if (!state) {
          // 登录态丢失（如 local 持久化被清）→ 重新匿名登录
          await auth.anonymousAuthProvider().signIn()
          state = await auth.getLoginState()
        }
        const uid = state?.user?.uid || state?.uid || null
        cachedUid = uid
        return uid
      } catch (e) {
        console.warn('获取当前 uid 失败：', errMsg(e))
        return null
      } finally {
        uidPromise = null
      }
    })()
  }
  return uidPromise
}

// 读取云端公共题库（用于出卷/刷题；不写入本地"我的题库"）
export async function listPublicBanks(): Promise<any[]> {
  if (await ensureCloud() && isCloud()) {
    try {
      const res = await withTimeout<any>(cloudDb.collection('quiz_banks')
        .where({ visibility: 'public' })
        .orderBy('created_at', 'desc')
        .limit(100)
        .get(), 15000, '读取公共题库')
      const banks = res.data || []
      // 补充题目数量（并发查询题目集合计数）
      await Promise.all(banks.map(async (b: any) => {
        try {
          const cnt = await withTimeout<any>(cloudDb.collection('questions')
            .where({ visibility: 'public', bank_ref: b._id })
            .count(), 15000, '统计题目数')
          b.question_count = cnt.total
        } catch { b.question_count = 0 }
      }))
      return banks
    } catch (e) {
      console.warn('读取公共题库失败：', errMsg(e))
      return []
    }
  }
  return []
}

// 读取云端公共题库的题目（用于抽题出卷；按题库云端 _id / bank_ref 关联）
// 注意：云端题目可能超过 500 道（如合集 2951 题），必须分页拉全量，不能 limit(500) 截断
export async function listPublicBankQuestions(bankId: string | number): Promise<ExamQuestion[]> {
  if (await ensureCloud() && isCloud()) {
    try {
      const all: any[] = []
      const pageSize = 200
      let skip = 0
      for (;;) {
        const res = await withTimeout<any>(cloudDb.collection('questions')
          .where({ visibility: 'public', bank_ref: String(bankId) })
          .skip(skip)
          .limit(pageSize)
          .get(), 20000, '读取公共题库题目')
        const rows = Array.isArray(res.data) ? res.data : []
        all.push(...rows)
        if (rows.length < pageSize) break
        skip += pageSize
        if (skip >= 4000) break // 安全上限（单题库超过 4000 题再议）
      }
      return all.map((q: any) => ({
        id: q._local_id ?? q.id,
        bank_id: q._local_bank_id ?? q.bank_id ?? 0,
        stem: q.stem,
        type: q.type,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        source_index: q.source_index ?? null,
      }))
    } catch (e) {
      console.warn('读取公共题库题目失败：', errMsg(e))
      return []
    }
  }
  return []
}

export async function updateExamStatus(id: string, status: Exam['status']): Promise<void> {
  if (await ensureCloud() && isCloud()) {
    await cloudDb.collection('exams').doc(id).update({ status })
    return
  }
  const exams = getLocalExams()
  const e = exams.find(x => x._id === id)
  if (e) { e.status = status; saveLocalExams(exams) }
}

export async function deleteExam(id: string): Promise<void> {
  if (await ensureCloud() && isCloud()) {
    await cloudDb.collection('exams').doc(id).remove()
    removeExamSnapshot(id)
    return
  }
  saveLocalExams(getLocalExams().filter(e => e._id !== id))
  removeExamSnapshot(id)
}

// ===== 成绩 =====

export async function submitExamResult(result: ExamResult): Promise<void> {
  // 生成查询码（若没有）：考试ID后4位 + 4位随机字符，大写字母数字
  if (!result.query_code) {
    const seed = (result.exam_id || 'XXXX').slice(-4).toUpperCase()
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let rand = ''
    for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)]
    result.query_code = seed + '-' + rand
  }
  if (await ensureCloud() && isCloud()) {
    // 同一个人（同一 openid）同一考试重复交卷时覆盖
    // 查询带当前用户 openid，避免误覆盖同名考生答卷
    const uid = await getCurrentUid()
    if (uid) {
      // 仅当能拿到 uid 时才做"查重后覆盖"；uid 为 null 时直接新增，避免命中他人答卷导致 update 报错
      const existing = await cloudDb.collection('exam_results')
        .where({
          exam_id: result.exam_id,
          student_name: result.student_name,
          _openid: uid,
        })
        .get()
      if (existing.data?.length) {
        await cloudDb.collection('exam_results').doc(existing.data[0]._id).update({
          answers: result.answers,
          correct: result.correct,
          wrong: result.wrong,
          unanswered: result.unanswered,
          score: result.score,
          accuracy: result.accuracy,
          duration_ms: result.duration_ms,
          submitted_at: result.submitted_at,
          query_code: result.query_code,
        })
        return
      }
    }
    // 新答卷：直接新增（服务端会自动记录 _openid 归属）
    await cloudDb.collection('exam_results').add(result)
    return
  }
  const results = getLocalResults()
  const idx = results.findIndex(r => r.exam_id === result.exam_id && r.student_name === result.student_name)
  if (idx >= 0) results[idx] = result
  else results.push(result)
  saveLocalResults(results)
}

// 按查询码查找答卷（用于错题回看）
export async function findResultByCode(examId: string, code: string): Promise<ExamResult | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null
  if (await ensureCloud() && isCloud()) {
    const res = await cloudDb.collection('exam_results')
      .where({ exam_id: examId, query_code: normalized })
      .limit(1)
      .get()
    return res.data?.[0] || null
  }
  return getLocalResults().find(r => r.exam_id === examId && (r.query_code || '').toUpperCase() === normalized) || null
}

// 获取答卷中的错题明细（题干 + 选项 + 我的答案 + 正确答案 + 解析）
// myRaw/correctRaw：选择题=字母字符串（如 "B"/"A、C"），判断题='true'/'false'，填空=文本；供前端渲染选项高亮
export function getWrongQuestions(
  exam: Exam,
  result: ExamResult,
): { question: ExamQuestion; myAnswer: string; correctAnswer: string; analysis: string | null; myRaw: string | null; correctRaw: string | null }[] {
  const wrongs: { question: ExamQuestion; myAnswer: string; correctAnswer: string; analysis: string | null; myRaw: string | null; correctRaw: string | null }[] = []
  for (const q of exam.questions) {
    const a = result.answers[q.id]
    if (!a || (a.selected.length === 0 && !a.blank && a.judge === null)) continue // 未答不算错题
    const isCorrect = checkAnswer(q, a)
    if (isCorrect) continue
    const correctAnswerShape = { selected: parseAnswerLetters(q.answer), blank: q.answer || '', judge: q.type === 'judge' ? (judgeAnswerBool(q.answer, judgeOptionsOf(q)) === 'true') : null }
    wrongs.push({
      question: q,
      myAnswer: formatAnswer(q, a),
      correctAnswer: formatAnswer(q, correctAnswerShape),
      analysis: q.analysis || null,
      myRaw: formatAnswerRaw(q, a),
      correctRaw: formatAnswerRaw(q, correctAnswerShape),
    })
  }
  return wrongs
}

// 判断题选项数组（用于 A/B ↔ true/false 换算；云端判断题 options 为 ["正确","错误"]）
function judgeOptionsOf(q: ExamQuestion): string[] | null {
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p)) return p.map((o: any) => String(o))
  } catch { /* ignore */ }
  return null
}

// 把答案格式化为可读文本（选择题转字母，判断题转对/错）
function formatAnswer(q: ExamQuestion, a: { selected: number[]; blank: string; judge: boolean | null }): string {
  if (isJudgeLike(q)) {
    if (a.judge === null) {
      // 旧快照曾被当选择题答（selected 下标 0=正确 1=错误）
      if (a.selected.length) return a.selected[0] === 0 ? '√ 正确' : '× 错误'
      return '（未答）'
    }
    return a.judge ? '√ 正确' : '× 错误'
  }
  if (q.type === 'single' || q.type === 'multi') {
    if (!a.selected.length) return '（未选）'
    return a.selected.map(i => String.fromCharCode(65 + i)).join('、')
  }
  return a.blank || '（未答）'
}

// 机器可读的答案（选择题=字母；判断题='true'/'false'；填空=文本）
function formatAnswerRaw(q: ExamQuestion, a: { selected: number[]; blank: string; judge: boolean | null }): string | null {
  if (isJudgeLike(q)) {
    if (a.judge !== null) return a.judge ? 'true' : 'false'
    if (a.selected.length) return a.selected[0] === 0 ? 'true' : 'false'
    return null
  }
  if (q.type === 'single' || q.type === 'multi') {
    if (!a.selected.length) return null
    return a.selected.map(i => String.fromCharCode(65 + i)).join('、')
  }
  return a.blank || null
}

export async function listExamResults(examId: string): Promise<ExamResult[]> {
  if (await ensureCloud() && isCloud()) {
    const res = await cloudDb.collection('exam_results')
      .where({ exam_id: examId })
      .orderBy('score', 'desc')
      .limit(500)
      .get()
    return res.data || []
  }
  return getLocalResults().filter(r => r.exam_id === examId).sort((a, b) => b.score - a.score)
}

// ===== 工具 =====

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 判分：根据考生答案计算成绩
export function gradeExam(
  questions: ExamQuestion[],
  answers: ExamResult['answers'],
): { correct: number; wrong: number; unanswered: number; score: number; accuracy: number } {
  let correct = 0, wrong = 0, unanswered = 0
  for (const q of questions) {
    const a = answers[q.id]
    if (!a || (a.selected.length === 0 && !a.blank && a.judge === null)) {
      unanswered++
      continue
    }
    const isCorrect = checkAnswer(q, a)
    if (isCorrect) correct++
    else wrong++
  }
  const total = questions.length || 1
  const accuracy = Math.round((correct / total) * 100)
  const score = Math.round((correct / total) * 100)
  return { correct, wrong, unanswered, score, accuracy }
}

// 判断题内容识别：type='judge'，或选项恰为「正确/错误」二元组的 single/multi 旧快照
export function isJudgeLike(q: { type?: string; options?: string | null }): boolean {
  if (q.type === 'judge') return true
  try {
    const p = JSON.parse(q.options || '[]')
    if (Array.isArray(p) && p.length === 2) {
      const t = p.map((o: any) => String(o).replace(/^[A-H][.、:：)]?\s*/i, '').trim())
      return (t[0] === '正确' && t[1] === '错误') || (t[0] === '对' && t[1] === '错')
    }
  } catch { /* ignore */ }
  return false
}

function checkAnswer(q: ExamQuestion, a: { selected: number[]; blank: string; judge: boolean | null }): boolean {
  if (isJudgeLike(q)) {
    if (!q.answer) return false
    // 兼容新旧判断题 answer：新快照 'true'/'false'；旧快照 'A'/'B'（options=["正确","错误"]）
    const ans = judgeAnswerBool(q.answer, judgeOptionsOf(q)) === 'true'
    // 新答题存 judge；旧快照曾被当选择题答（存 selected 下标 0=正确 1=错误）
    const picked = a.judge ?? (a.selected.length ? (a.selected[0] === 0) : null)
    if (picked === null) return false
    return picked === ans
  }
  if (q.type === 'single' || q.type === 'multi') {
    const correctLetters = parseAnswerLetters(q.answer)
    const picked = [...a.selected].sort((x, y) => x - y)
    return JSON.stringify(picked) === JSON.stringify(correctLetters)
  }
  // 填空/问答：粗略匹配（去空白 + 大小写不敏感）
  if (!q.answer) return false
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')
  return norm(a.blank) === norm(q.answer)
}

// 2026-08-20：考试模式「交卷统一判分」——基于 QuestionCard 的暂存状态（deferSubmit 模式）
// st.selected 为原始下标（QuestionCard emitState 已转回），与 ExamResult.answers 判分口径一致
export function gradeByState(
  q: ExamQuestion,
  st: { selected: number[]; judgeSelected: boolean | null; blankAnswer?: string | null },
): boolean {
  if (isJudgeLike(q)) {
    if (st.judgeSelected == null) return false
    const ans = judgeAnswerBool(q.answer, judgeOptionsOf(q)) === 'true'
    return st.judgeSelected === ans
  }
  if (q.type === 'single' || q.type === 'multi') {
    if (!st.selected.length) return false
    const picked = [...st.selected].sort((x, y) => x - y)
    return JSON.stringify(picked) === JSON.stringify(parseAnswerLetters(q.answer))
  }
  // 填空/问答
  if (!q.answer) return false
  const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, '')
  return norm(st.blankAnswer || '') === norm(q.answer)
}

function parseAnswerLetters(answer: string | null): number[] {
  if (!answer) return []
  try {
    const arr = JSON.parse(answer) as string[]
    return arr.map(s => s.trim().toUpperCase().charCodeAt(0) - 65)
  } catch {
    return answer.split('').filter(c => /[A-Ha-h]/.test(c)).map(c => c.toUpperCase().charCodeAt(0) - 65)
  }
}

// 分享链接（带 exam id 的 hash 路由）
export function examShareUrl(examId: string): string {
  const base = location.origin + location.pathname
  return `${base}#/exam/${examId}`
}
