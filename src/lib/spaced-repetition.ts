// 间隔重复算法（简化版 SM-2）
// 用于智能学习计划，根据答题质量安排复习时间

export interface ReviewRecord {
  questionId: number
  lastReview: Date
  quality: number      // 0-5，答题质量（0-2:错误，3-5:正确）
  repetitions: number  // 连续正确次数
  easeFactor: number   // 难度因子（1.3-2.5）
  interval: number     // 复习间隔（天）
}

export interface StudyPlan {
  id: number
  name: string
  bankIds: number[]
  dailyGoal: number
  examDate?: string
  createdAt: string
}

export interface DailyTask {
  date: string
  reviewQuestions: number[]  // 需要复习的题目ID
  newQuestions: number[]     // 新题目ID
  totalGoal: number
}

/**
 * 计算下次复习日期
 * @param lastReview 上次复习时间
 * @param quality 答题质量（0-5）
 * @param repetitions 连续正确次数
 * @param easeFactor 难度因子
 * @param previousInterval 上次复习间隔（天）——2026-08-22 修复：此前函数内部 interval 未初始化，
 *        连续答对第 3 次起 interval*EF 得 NaN，复习日期变 Invalid Date
 * @returns 下次复习日期和更新后的参数
 */
export function calculateNextReview(
  lastReview: Date,
  quality: number,
  repetitions: number,
  easeFactor: number,
  previousInterval = 0
): { nextReview: Date; newRepetitions: number; newEaseFactor: number; newInterval: number } {
  let interval: number
  let newRepetitions = repetitions
  let newEaseFactor = easeFactor

  if (quality < 3) {
    // 答错，重新开始
    newRepetitions = 0
    interval = 1
  } else {
    // 答对
    newRepetitions = repetitions + 1

    if (newRepetitions === 1) {
      interval = 1
    } else if (newRepetitions === 2) {
      interval = 3
    } else {
      // SM-2：间隔 = 上次间隔 × 难度因子（首答对后第一次用 EF 时以 3 天为基准）
      const base = previousInterval > 0 ? previousInterval : 3
      interval = Math.round(base * easeFactor)
    }
  }

  // 更新难度因子
  newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  newEaseFactor = Math.max(1.3, newEaseFactor)

  const nextReview = new Date(lastReview)
  nextReview.setDate(nextReview.getDate() + interval)

  return {
    nextReview,
    newRepetitions,
    newEaseFactor,
    newInterval: interval
  }
}

/**
 * 计算每日学习任务
 * @param plan 学习计划
 * @param reviewRecords 复习记录
 * @param allQuestions 所有题目
 * @returns 每日任务
 */
export function calculateDailyTask(
  plan: StudyPlan,
  reviewRecords: ReviewRecord[],
  allQuestions: { id: number; bankId: number }[]
): DailyTask {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = formatDate(today)

  // 获取需要复习的题目（今天或之前需要复习的）
  const reviewQuestions: number[] = []
  const newQuestions: number[] = []

  // 筛选计划中的题库题目
  const planQuestions = allQuestions.filter(q => plan.bankIds.includes(q.bankId))

  for (const question of planQuestions) {
    const record = reviewRecords.find(r => r.question_id === question.id)

    if (record) {
      // 2026-08-23 修复：①字段命名统一 snake_case——此前用 record.questionId/lastReview 驼峰，
      // 与 store 实际存储（question_id/last_review）不匹配 → find 永远不命中 → 所有题被当"新题"，
      // 复习永远不触发（学习计划只涨新题、复习为空）。
      // ②到期判断统一以 next_review 为准——此前用 lastReview+interval；
      // 但写入方曾把 last_review 存成"下次复习时间"，语义错位导致复习期被再推后出错。
      let due: Date
      if (record.next_review) {
        due = new Date(record.next_review)
      } else {
        due = new Date(record.last_review)
        due.setDate(due.getDate() + (record.interval ?? 0))
      }
      due.setHours(0, 0, 0, 0)
      if (due <= today) {
        reviewQuestions.push(question.id)
      }
    } else {
      // 新题目
      newQuestions.push(question.id)
    }
  }

  // 限制每日新题目数量
  const maxNewQuestions = plan.dailyGoal - reviewQuestions.length
  const limitedNewQuestions = newQuestions.slice(0, Math.max(0, maxNewQuestions))

  return {
    date: todayStr,
    reviewQuestions,
    newQuestions: limitedNewQuestions,
    totalGoal: plan.dailyGoal
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 计算学习进度
 */
export function calculateProgress(
  task: DailyTask,
  completedQuestions: number[]
): { completed: number; total: number; percentage: number } {
  const total = task.reviewQuestions.length + task.newQuestions.length
  const completed = completedQuestions.filter(id => 
    task.reviewQuestions.includes(id) || task.newQuestions.includes(id)
  ).length
  
  return {
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0
  }
}

// ============================================================
// 2026-08-23 新增：记忆复习功能（自动评估 + 记忆强度 + 标签）
// 从「智能学习计划」的 SM-2 算法扩展为全局能力，任何练习模式都可积累记忆数据
// ============================================================

/**
 * 根据「对/错 + 答题耗时」自动推断 SM-2 答题质量（quality 0-5）
 * 用于不打断刷题节奏的自动记忆评估；用户可手动覆盖
 *
 * 映射表：
 *  答对 + 秒答 (<5s)     → 5  认识（熟练掌握，间隔拉最长）
 *  答对 + 想了一会儿     → 4  一般
 *  答对 + 想很久 (>15s)  → 3  模糊（勉强答对，容易忘）
 *  答错 + 秒选 (<5s)     → 1  不认识（完全不会）
 *  答错 + 思考过         → 2  模糊（接近但没答对）
 *
 * @param isCorrect 是否答对
 * @param durationMs 答题耗时（毫秒），null/undefined 时退化为对/错二元 → 5 或 1
 */
export function calculateAutoQuality(isCorrect: boolean, durationMs: number | null | undefined): number {
  const ms = typeof durationMs === 'number' && !Number.isNaN(durationMs) ? durationMs : null
  if (isCorrect) {
    if (ms === null) return 5
    if (ms < 5000) return 5
    if (ms < 15000) return 4
    return 3
  } else {
    if (ms === null) return 1
    if (ms < 5000) return 1
    return 2
  }
}

/**
 * 计算记忆强度（0-100），供 UI 概览/卡片展示
 * 综合「难度因子 EF」和「复习间隔」两个维度：
 *  - EF 越高，说明题目越容易被记住（长期稳定）
 *  - 间隔越长，说明已进入长时记忆通道
 * 无记录（新题）不应调用此函数，由调用方按「未学习」处理。
 *
 * @param easeFactor 难度因子（1.3 - 2.5）
 * @param interval 当前复习间隔（天）
 */
export function getMemoryStrength(easeFactor: number, interval: number): number {
  const ef = Math.max(1.3, Math.min(2.5, easeFactor || 2.5))
  const intv = Math.max(0, interval || 0)
  // EF 归一化到 0-1：1.3 → 0，2.5 → 1
  const efScore = (ef - 1.3) / (2.5 - 1.3)
  // 间隔归一化到 0-1：30 天以上视为满分
  const intScore = Math.min(1, intv / 30)
  const score = Math.round((efScore * 0.5 + intScore * 0.5) * 100)
  return Math.max(0, Math.min(100, score))
}

/**
 * 记忆强度分档（按 getMemoryStrength 计算出的 0-100）
 */
export function strengthLevel(score: number): '强' | '中' | '弱' {
  if (score >= 70) return '强'
  if (score >= 40) return '中'
  return '弱'
}

/**
 * SM-2 quality → 中文记忆标签（用于答案区展示 + 手动覆盖按钮）
 * 注意：quality 3、4 都属「答对但记忆一般」，标签按认知强度归类
 */
export function qualityLabel(q: number): '认识' | '一般' | '模糊' | '不认识' {
  if (q >= 5) return '认识'
  if (q === 4) return '一般'
  if (q === 3) return '模糊'
  if (q === 2) return '模糊'
  return '不认识'
}

/**
 * 中文记忆标签 → 对应的 SM-2 quality（手动覆盖时用）
 */
export function labelToQuality(label: '认识' | '一般' | '模糊' | '不认识'): number {
  switch (label) {
    case '认识': return 5
    case '一般': return 4
    case '模糊': return 3
    case '不认识': return 1
    default: return 3
  }
}

// ============================================================
// 2026-08-23 新增：防堆积机制（每日复习配额 + 逾期重学）
// 解决「墨墨背单词式」长时间不练 → 一次性涌出大量到期题的问题
// ============================================================

/**
 * 每日复习配额基准（默认值）：没有学习计划时每天最多复习这么多题
 */
export const DEFAULT_DAILY_REVIEW_CAP = 50

/**
 * 计算每日复习配额（防堆积）
 * 规则：
 *  - 若设置了一个或多个学习计划 → 取「计划每日目标」中的最大值（保证不少干计划要求）
 *  - 否则 → 用默认 50 题/天
 * 最终配额 = max(计划目标, 默认 50)，既联动计划又不低于保底。
 *
 * @param plans 学习计划数组（StudyPlan[]，可为空）
 * @returns 每日复习配额
 */
export function calculateDailyReviewCap(plans: { dailyGoal: number }[]): number {
  let cap = DEFAULT_DAILY_REVIEW_CAP
  if (plans && plans.length > 0) {
    const maxGoal = Math.max(...plans.map(p => p.dailyGoal || 0))
    cap = Math.max(maxGoal, DEFAULT_DAILY_REVIEW_CAP)
  }
  return cap
}

/**
 * 判断某题是否已「逾期过久，需要重新学习」
 * 超过 staleDays 天没复习 → 视为生疏，重新从短间隔开始（不留痛苦长尾）
 *
 * @param lastReview 上次复习时间（ISO string 或 null）
 * @param staleDays 逾期天数阈值（默认 30）
 */
export function isStaleReview(lastReview: string | null | undefined, staleDays = 30): boolean {
  if (!lastReview) return false
  const t = new Date(lastReview).getTime()
  if (Number.isNaN(t)) return false
  const elapsedDays = (Date.now() - t) / 86400000
  return elapsedDays > staleDays
}

// ============================================================
// 2026-08-23 新增：按题库规模联动每日复习配额（大题库多练、小题库保底）
// 解决「全局固定 50」对 4000 题大库太保守的问题
// ============================================================

/** 配额 = clamp(题库题数 × 比例%, 保底, 上限) */
export const BANK_CAP_RATIO = 0.08        // 大库每天消化 8%
export const BANK_CAP_MIN = 25            // 保底
export const BANK_CAP_MAX = 200           // 上限

/**
 * 按单个题库的题目数计算该库每日复习配额
 *  4000 题 → 8% = 320，但被上限 200 截断 → 200
 *  1000 题 → 8% = 80
 *  100 题  → 8% = 8，被保底 25 抬到 25
 *
 * @param bankQuestionCount 该题库题目数
 * @returns 每日复习配额
 */
export function calculateBankReviewCap(bankQuestionCount: number): number {
  const n = Math.max(0, bankQuestionCount || 0)
  return Math.round(Math.max(BANK_CAP_MIN, Math.min(BANK_CAP_MAX, n * BANK_CAP_RATIO)))
}