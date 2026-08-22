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
 * @returns 下次复习日期和更新后的参数
 */
export function calculateNextReview(
  lastReview: Date,
  quality: number,
  repetitions: number,
  easeFactor: number
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
      interval = Math.round(interval * easeFactor)
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
    const record = reviewRecords.find(r => r.questionId === question.id)
    
    if (record) {
      // 已有记录，检查是否需要复习
      const nextReview = new Date(record.lastReview)
      nextReview.setDate(nextReview.getDate() + record.interval)
      
      if (nextReview <= today) {
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