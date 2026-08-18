// PWA 版 API 层：替代 Tauri invoke，用 IndexedDB + 浏览器能力实现
import { idb } from '../lib/db'

// 云同步：数据改动后触发推送（未启用时自动跳过）
function scheduleCloudPush() {
  import('../lib/cloud').then(m => m.scheduleAutoPush()).catch(() => {})
}
// 删除类操作：记录云端删除标记（P1.2 修复，push 时按标记删云端旧文档）
function markCloudDeleted(coll: 'favorites' | 'wrong_questions' | 'mastered_questions', bankId: number, questionId: number) {
  import('../lib/cloud').then(m => m.markCloudDeleted(coll, bankId, questionId)).catch(() => {})
}

export interface QuizBank {
  id: number; name: string; description: string | null;
  visibility?: 'public' | 'private';   // 公共题库（所有人可用）/ 自建题库（仅自己）
  creator_name?: string | null;        // 创建人（用户可自定义填写）
  question_count: number; created_at: string; updated_at: string;
}
export interface Question {
  id: number; bank_id: number; type: string; stem: string;
  options: string | null; answer: string | null; analysis: string | null;
  source_index: number | null; confidence: number;
}
export interface NewBank { name: string; description: string | null; visibility?: 'public' | 'private'; creator_name?: string | null }

async function withCount(bank: any): Promise<QuizBank> {
  const qs = await idb.listQuestions(bank.id)
  return { ...bank, question_count: qs.length }
}

export const api = {
  // === 题库 ===
  async listBanks(): Promise<QuizBank[]> {
    const banks = await idb.listBanks()
    return Promise.all(banks.map(withCount))
  },
  async createBank(b: NewBank): Promise<QuizBank> {
    const now = new Date().toISOString()
    const created = await idb.createBank({ ...b, created_at: now, updated_at: now })
    scheduleCloudPush()
    return withCount(created)
  },
  async deleteBank(id: number): Promise<void> {
    await idb.deleteBank(id)
    scheduleCloudPush()
  },
  // === 题目 ===
  async listQuestions(bankId: number): Promise<Question[]> {
    return idb.listQuestions(bankId)
  },
  async clearBankQuestions(bankId: number): Promise<void> {
    await idb.clearBankQuestions(bankId)
    scheduleCloudPush()
  },
  // 批量写入题目（导入公共题库到本地、合并题目等场景）
  async addQuestions(bankId: number, qs: any[]): Promise<number> {
    const n = await idb.addQuestions(bankId, qs)
    scheduleCloudPush()
    return n
  },
  async updateQuestion(q: Question): Promise<void> {
    await idb.updateQuestion(q)
    scheduleCloudPush()
  },
  async searchQuestions(bankId: number, query: string, limit?: number): Promise<Question[]> {
    return idb.searchQuestions(bankId, query, limit)
  },
  // === 导入 ===
  // 浏览器端：直接解析后入库（规则引擎）
  async importFromHtml(bankId: number, html: string): Promise<number> {
    const { parseHtml } = await import('../lib/parser')
    const qs = parseHtml(html, bankId)
    await idb.clearBankQuestions(bankId)
    const n = await idb.addQuestions(bankId, qs)
    scheduleCloudPush()
    return n
  },
  // AI 引擎：分块调用百炼 API
  async importWithAi(bankId: number, text: string, onProgress?: (done: number, total: number) => void): Promise<{ count: number; expected: number }> {
    const { aiStructurize } = await import('../lib/ai')
    const qs = await aiStructurize(text, bankId, onProgress)
    await idb.clearBankQuestions(bankId)
    const count = await idb.addQuestions(bankId, qs)
    scheduleCloudPush()
    return { count, expected: count }
  },
  async importFromPdf(bankId: number, path: string): Promise<number> {
    throw new Error('PDF 导入在网页版暂不支持，请使用 TXT/MD/docx 格式')
  },
  async testAiConnection(): Promise<void> {
    const { testConnection } = await import('../lib/ai')
    return testConnection()
  },
  async cancelImport(): Promise<void> { /* 无操作 */ },
  async cancelPdfImport(): Promise<void> { /* 无操作 */ },
  // === 数据库信息（PWA 中显示浏览器存储说明） ===
  async getDbInfo(): Promise<{ path: string; size_bytes: number; backups_dir: string; backup_count: number }> {
    return { path: '浏览器 IndexedDB（本地存储）', size_bytes: 0, backups_dir: '—', backup_count: 0 }
  },
  async openDbFolder(): Promise<string> { throw new Error('网页版不支持打开文件夹') },
  async pickDatabaseFolder(): Promise<string | null> { return null },
  async changeDbPath(newDir: string): Promise<string> { throw new Error('网页版不支持修改数据库位置') },
  async restartApp(): Promise<void> { location.reload() },
  async quitApp(): Promise<void> { window.close() },
  // === 练习记录 ===
  // 返回 { autoMastered, streak }：autoMastered=true 表示本次答对触发「自动移入已掌握」；null 表示无错题本动作
  async recordPractice(r: { bank_id: number; question_id: number; user_answer: string | null; is_correct: boolean; duration_ms: number | null }): Promise<{ autoMastered: boolean; streak: number } | null> {
    await idb.recordPractice({ ...r, practiced_at: new Date().toISOString() })
    let signal: { autoMastered: boolean; streak: number } | null = null
    if (!r.is_correct) {
      // 答错自动加入错题本（连续答对计数清零）
      await idb.markWrong(r.bank_id, r.question_id, 0)
    } else {
      // 答对：若该题在错题本 → 连续答对 +1；达到阈值自动转「已掌握」（2026-08-19 新增）
      const rec = await idb.getWrongRecord(r.bank_id, r.question_id)
      if (rec) {
        const threshold = await api.getWrongMasterThreshold()
        const streak = (rec.correct_streak ?? 0) + 1
        if (threshold > 0 && streak >= threshold) {
          await api.markWrongMastered(r.bank_id, r.question_id)
          signal = { autoMastered: true, streak }
        } else {
          await idb.setWrongStreak(r.bank_id, r.question_id, streak)
          signal = { autoMastered: false, streak }
        }
      }
    }
    scheduleCloudPush()
    return signal
  },
  // 错题本自动掌握阈值：settings 'wrong_auto_master_threshold'（0=关闭，仅手动标记；默认 3 = 连续答对 3 次）
  async getWrongMasterThreshold(): Promise<number> {
    const v = await idb.getSetting('wrong_auto_master_threshold')
    if (v == null || v === '') return 3
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n >= 0 ? n : 3
  },
  async listWrong(bankId: number): Promise<number[]> { return idb.listWrong(bankId) },
  // 错题本完整记录（含 correct_streak，供「连对 n 次」展示）
  async listWrongRecords(bankId: number): Promise<any[]> { return idb.listWrongRecords(bankId) },
  async listMastered(bankId: number): Promise<number[]> { return idb.listMastered(bankId) },
  async markWrongMastered(bankId: number, questionId: number): Promise<void> {
    // 从错题表移除 → 记录云端删除标记（P1.2）
    markCloudDeleted('wrong_questions', bankId, questionId)
    await idb.markWrongMastered(bankId, questionId)
    scheduleCloudPush()
  },
  async restoreWrongToPending(bankId: number, questionId: number): Promise<void> {
    // 从已掌握表移除 → 记录云端删除标记（P1.2）
    markCloudDeleted('mastered_questions', bankId, questionId)
    await idb.restoreWrongToPending(bankId, questionId)
    scheduleCloudPush()
  },
  // 2026-08-16：从错题本直接删除记录（不做标记掌握）
  async removeWrongRecord(bankId: number, questionId: number): Promise<void> {
    markCloudDeleted('wrong_questions', bankId, questionId)
    await idb.removeWrong(bankId, questionId)
    scheduleCloudPush()
  },
  // 2026-08-16：从已掌握表直接删除记录
  async removeMasteredRecord(bankId: number, questionId: number): Promise<void> {
    markCloudDeleted('mastered_questions', bankId, questionId)
    await idb.removeMastered(bankId, questionId)
    scheduleCloudPush()
  },
  async bankStats(bankId: number): Promise<{ total: number; practiced: number; correct: number; mastered: number }> { return idb.bankStats(bankId) },
  // === 设置 ===
  async getSetting(key: string): Promise<string | null> { return idb.getSetting(key) },
  async setSetting(key: string, value: string): Promise<void> { await idb.setSetting(key, value); scheduleCloudPush() },
  // === 收藏 ===
  async toggleFavorite(bankId: number, questionId: number): Promise<boolean> {
    const r = await idb.toggleFavorite(bankId, questionId)
    // 取消收藏 → 记录云端删除标记（P1.2）
    if (!r) markCloudDeleted('favorites', bankId, questionId)
    scheduleCloudPush()
    return r
  },
  async listFavorites(bankId: number): Promise<number[]> { return idb.listFavorites(bankId) },
  async isFavorite(bankId: number, questionId: number): Promise<boolean> {
    const favs = await idb.listFavorites(bankId)
    return favs.includes(questionId)
  },
  async clearFavorites(bankId: number): Promise<void> {
    // 清空收藏 → 全量记录云端删除标记（P1.2）
    const favs = await idb.listFavorites(bankId)
    for (const qid of favs) markCloudDeleted('favorites', bankId, qid)
    await idb.clearFavorites(bankId)
    scheduleCloudPush()
  },
  // === 备份/导出 ===
  async backupDatabase(): Promise<string> {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `刷题宝备份_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    return '已下载备份文件'
  },
  async restoreBackup(data: any, onProgress?: (msg: string) => void): Promise<void> {
    return restoreBackup(data, onProgress)
  },
  async exportBank(bankId: number): Promise<string> {
    const banks = await idb.listBanks()
    const bank = banks.find(x => x.id === bankId)
    const qs = await idb.listQuestions(bankId)
    return JSON.stringify({ bank, questions: qs }, null, 2)
  },
  async analyzeQuestion(q: Question): Promise<string> {
    const { analyzeQuestion } = await import('../lib/ai')
    return analyzeQuestion(q)
  },
}

// 导出全部数据（用于备份/迁移）：题库 + 题目 + 错题 + 收藏 + 练习记录 + 设置
export async function exportAll() {
  const db = await import('../lib/db')
  const m = (db as any).idb
  return {
    app: 'shuati-bao-pwa',
    version: 2,
    exported_at: new Date().toISOString(),
    banks: await m.listBanks(),
    questions: await m.listAll('questions'),
    wrong_questions: await m.listAll('wrong_questions'),
    favorites: await m.listAll('favorites'),
    practice_records: await m.listAll('practice_records'),
    settings: await m.getAllSettings(),
  }
}

// 从备份文件恢复数据（覆盖式：清空后按原 id 写回，引用关系保持）
export async function restoreBackup(data: any, onProgress?: (msg: string) => void): Promise<void> {
  if (!data || typeof data !== 'object') throw new Error('备份文件格式无效')
  const db = await import('../lib/db')
  const m = (db as any).idb
  const storeMap: Record<string, string> = {
    banks: 'quiz_banks',
    questions: 'questions',
    wrong_questions: 'wrong_questions',
    favorites: 'favorites',
    practice_records: 'practice_records',
    settings: 'settings',
  }
  const keys = Object.keys(storeMap).filter(k => Array.isArray(data[k]))
  if (keys.length === 0) throw new Error('备份文件未包含任何可恢复的数据（题库/题目等）')
  for (const key of keys) {
    const store = storeMap[key]
    const rows = data[key] as any[]
    onProgress?.(`正在恢复 ${key}（${rows.length} 条）...`)
    await m.clearStore(store)
    if (rows.length) await m.bulkPut(store, rows)
  }
  onProgress?.('恢复完成')
}
