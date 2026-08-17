// 轻量 IndexedDB 封装：替代 Tauri 后端的 SQLite
// 数据表：quiz_banks / questions / practice_records / wrong_questions / favorites / settings

interface DBSchema {
  quiz_banks: { keyPath: 'id'; indexes: { name: 'name' } }
  questions: { keyPath: 'id'; indexes: { bank_id: 'bank_id' } }
  practice_records: { keyPath: 'id'; indexes: { bank_id: 'bank_id'; question_id: 'question_id' } }
  wrong_questions: { keyPath: 'id'; indexes: { bank_id: 'bank_id' } }
  mastered_questions: { keyPath: 'id'; indexes: { bank_id: 'bank_id' } }
  favorites: { keyPath: 'id'; indexes: { bank_id: 'bank_id' } }
  settings: { keyPath: 'key' }
  compose_records: { keyPath: 'id'; indexes: { created_at: 'created_at' } }
}

const DB_NAME = 'shuati-bao-pwa'
const DB_VERSION = 3

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('quiz_banks')) {
        const store = db.createObjectStore('quiz_banks', { keyPath: 'id', autoIncrement: true })
        store.createIndex('name', 'name', { unique: false })
      }
      if (!db.objectStoreNames.contains('questions')) {
        const store = db.createObjectStore('questions', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('practice_records')) {
        const store = db.createObjectStore('practice_records', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
        store.createIndex('question_id', 'question_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('wrong_questions')) {
        const store = db.createObjectStore('wrong_questions', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
      }
      // v3：已掌握（mastered_questions）—— 与 wrong_questions 同构
      if (!db.objectStoreNames.contains('mastered_questions')) {
        const store = db.createObjectStore('mastered_questions', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('favorites')) {
        const store = db.createObjectStore('favorites', { keyPath: 'id', autoIncrement: true })
        store.createIndex('bank_id', 'bank_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }
      // v2：智能组卷历史记录
      if (!db.objectStoreNames.contains('compose_records')) {
        const store = db.createObjectStore('compose_records', { keyPath: 'id', autoIncrement: true })
        store.createIndex('created_at', 'created_at', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(storeName, mode)
    const store = t.objectStore(storeName)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => resolve(req.result)
    t.onerror = () => reject(t.error)
  }))
}

export const idb = {
  // === quiz_banks ===
  async listBanks(): Promise<any[]> {
    return tx('quiz_banks', 'readonly', s => s.getAll())
  },
  async createBank(data: any): Promise<any> {
    const id = await tx('quiz_banks', 'readwrite', s => s.add(data)) as unknown as number
    return { id, ...data }
  },
  async deleteBank(id: number): Promise<void> {
    await tx('quiz_banks', 'readwrite', s => s.delete(id))
    // 级联删除题目、练习记录、错题、收藏
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['questions', 'practice_records', 'wrong_questions', 'favorites'], 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const qs = t.objectStore('questions')
      const idx = qs.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(id))
      req.onsuccess = () => {
        const c = req.result
        if (c) { qs.delete(c.value.id); c.continue() }
      }
      for (const [name, storeName] of [['practice_records', 'practice_records'], ['wrong_questions', 'wrong_questions'], ['favorites', 'favorites']] as const) {
        const st = t.objectStore(storeName)
        const i = st.index('bank_id')
        const r = i.openCursor(IDBKeyRange.only(id))
        r.onsuccess = () => {
          const c = r.result
          if (c) { st.delete(c.value.id); c.continue() }
        }
      }
    })
  },
  // 云同步辅助：按 id 查单个题库 / 更新题库 / 全量练习记录 / 安全收藏
  async getBank(id: number): Promise<any | null> {
    const v = await tx('quiz_banks', 'readonly', s => s.get(id))
    return v ?? null
  },
  async updateBank(data: any): Promise<void> {
    await tx('quiz_banks', 'readwrite', s => s.put(data))
  },
  async listRecords(bankId: number): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('practice_records', 'readonly')
      const idx = t.objectStore('practice_records').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  },
  // 2026-08-16：云同步写前去重——判断同一次练习（同题库+同题+同时间）是否已存在，避免同步重复 add 导致正确率翻倍
  async findPracticeRecord(bankId: number, questionId: number, practicedAt: string | null | undefined): Promise<boolean> {
    const rows = await this.listRecords(bankId)
    return rows.some(r =>
      r.question_id === questionId && r.bank_id === bankId &&
      (practicedAt ? String(r.practiced_at) === String(practicedAt) : true)
    )
  },
  async toggleFavoriteSafe(bankId: number, questionId: number): Promise<boolean> {
    return this.toggleFavorite(bankId, questionId)
  },
  // === questions ===
  async listQuestions(bankId: number): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('questions', 'readonly')
      const idx = t.objectStore('questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.sort((a, b) => (a.source_index ?? 0) - (b.source_index ?? 0)))
      req.onerror = () => reject(req.error)
    })
  },
  async addQuestions(bankId: number, qs: any[]): Promise<number> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('questions', 'readwrite')
      t.oncomplete = () => resolve(qs.length)
      t.onerror = () => reject(t.error)
      const store = t.objectStore('questions')
      for (const q of qs) store.add({ ...q, bank_id: bankId })
    })
  },
  async clearBankQuestions(bankId: number): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c) { store.delete(c.value.id); c.continue() }
      }
    })
  },
  async updateQuestion(q: any): Promise<void> {
    await tx('questions', 'readwrite', s => s.put(q))
  },
  async getQuestion(id: number): Promise<any | null> {
    const v = await tx('questions', 'readonly', s => s.get(id))
    return v ?? null
  },
  async searchQuestions(bankId: number, query: string, limit = 50): Promise<any[]> {
    const all = await this.listQuestions(bankId)
    const q = query.trim().toLowerCase()
    if (!q) return []
    const results = all.filter(x => (x.stem || '').toLowerCase().includes(q) || (x.answer || '').toLowerCase().includes(q))
    return results.slice(0, limit)
  },
  // === practice_records ===
  async recordPractice(record: any): Promise<void> {
    await tx('practice_records', 'readwrite', s => s.add(record))
  },
  // === wrong_questions ===
  async listWrong(bankId: number): Promise<number[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readonly')
      const idx = t.objectStore('wrong_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.map(x => x.question_id))
      req.onerror = () => reject(req.error)
    })
  },
  async markWrong(bankId: number, questionId: number): Promise<void> {
    const db = await openDB()
    const exists = await new Promise<boolean>((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readonly')
      const idx = t.objectStore('wrong_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.some(x => x.question_id === questionId))
      req.onerror = () => reject(req.error)
    })
    if (!exists) {
      await tx('wrong_questions', 'readwrite', s => s.add({ bank_id: bankId, question_id: questionId, created_at: new Date().toISOString() }))
    }
    // 2026-08-16（方案 B）：做错自动取消「已掌握」——从 mastered_questions 移除该记录
    await this.removeMastered(bankId, questionId)
  },
  // 从错题本直接删除记录（不做标记掌握，彻底移除）
  async removeWrong(bankId: number, questionId: number): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('wrong_questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('wrong_questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c && c.value.question_id === questionId) store.delete(c.value.id)
        else if (c) c.continue()
      }
    })
  },
  // 从已掌握表直接删除记录
  async removeMastered(bankId: number, questionId: number): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('mastered_questions', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('mastered_questions')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c && c.value.question_id === questionId) store.delete(c.value.id)
        else if (c) c.continue()
      }
    })
  },
  async markWrongMastered(bankId: number, questionId: number): Promise<void> {
    // 语义：从错题表移除 + 加入已掌握表（2026-08-15 修复：此前只删错题，已掌握无存储）
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['wrong_questions', 'mastered_questions'], 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      // 删错题
      const wstore = t.objectStore('wrong_questions')
      const widx = wstore.index('bank_id')
      const wreq = widx.openCursor(IDBKeyRange.only(bankId))
      wreq.onsuccess = () => {
        const c = wreq.result
        if (c && c.value.question_id === questionId) wstore.delete(c.value.id)
        else if (c) c.continue()
      }
      // 加已掌握（去重）
      const mstore = t.objectStore('mastered_questions')
      const midx = mstore.index('bank_id')
      const mreq = midx.getAll(IDBKeyRange.only(bankId))
      mreq.onsuccess = () => {
        if (!mreq.result.some(x => x.question_id === questionId)) {
          mstore.add({ bank_id: bankId, question_id: questionId, created_at: new Date().toISOString() })
        }
      }
    })
  },
  async restoreWrongToPending(bankId: number, questionId: number): Promise<void> {
    // 语义：从已掌握表移除 + 加回错题表（2026-08-15 修复：此前只是重新 markWrong）
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['wrong_questions', 'mastered_questions'], 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      // 删已掌握
      const mstore = t.objectStore('mastered_questions')
      const midx = mstore.index('bank_id')
      const mreq = midx.openCursor(IDBKeyRange.only(bankId))
      mreq.onsuccess = () => {
        const c = mreq.result
        if (c && c.value.question_id === questionId) mstore.delete(c.value.id)
        else if (c) c.continue()
      }
      // 加回错题（去重）
      const wstore = t.objectStore('wrong_questions')
      const widx = wstore.index('bank_id')
      const wreq = widx.getAll(IDBKeyRange.only(bankId))
      wreq.onsuccess = () => {
        if (!wreq.result.some(x => x.question_id === questionId)) {
          wstore.add({ bank_id: bankId, question_id: questionId, created_at: new Date().toISOString() })
        }
      }
    })
  },
  // === mastered_questions ===
  async listMastered(bankId: number): Promise<number[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('mastered_questions', 'readonly')
      const idx = t.objectStore('mastered_questions').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.map(x => x.question_id))
      req.onerror = () => reject(req.error)
    })
  },
  // === favorites ===
  async toggleFavorite(bankId: number, questionId: number): Promise<boolean> {
    const db = await openDB()
    const exists = await new Promise<boolean>((resolve, reject) => {
      const t = db.transaction('favorites', 'readonly')
      const idx = t.objectStore('favorites').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.some(x => x.question_id === questionId))
      req.onerror = () => reject(req.error)
    })
    if (exists) {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction('favorites', 'readwrite')
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
        const store = t.objectStore('favorites')
        const idx = store.index('bank_id')
        const req = idx.openCursor(IDBKeyRange.only(bankId))
        req.onsuccess = () => {
          const c = req.result
          if (c && c.value.question_id === questionId) store.delete(c.value.id)
          else if (c) c.continue()
        }
      })
      return false
    } else {
      await tx('favorites', 'readwrite', s => s.add({ bank_id: bankId, question_id: questionId, created_at: new Date().toISOString() }))
      return true
    }
  },
  async listFavorites(bankId: number): Promise<number[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('favorites', 'readonly')
      const idx = t.objectStore('favorites').index('bank_id')
      const req = idx.getAll(IDBKeyRange.only(bankId))
      req.onsuccess = () => resolve(req.result.map(x => x.question_id))
      req.onerror = () => reject(req.error)
    })
  },
  async clearFavorites(bankId: number): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('favorites', 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore('favorites')
      const idx = store.index('bank_id')
      const req = idx.openCursor(IDBKeyRange.only(bankId))
      req.onsuccess = () => {
        const c = req.result
        if (c) { store.delete(c.value.id); c.continue() }
      }
    })
  },
  // === settings ===
  async getSetting(key: string): Promise<string | null> {
    const v = await tx('settings', 'readonly', s => s.get(key))
    return v ? v.value : null
  },
  async setSetting(key: string, value: string): Promise<void> {
    await tx('settings', 'readwrite', s => s.put({ key, value }))
  },
  async getAllSettings(): Promise<Record<string, string>> {
    const rows = await tx('settings', 'readonly', s => s.getAll()) as any[]
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return out
  },
  // === 备份/恢复底层辅助 ===
  async listAll(storeName: string): Promise<any[]> {
    return tx(storeName, 'readonly', s => s.getAll())
  },
  async clearStore(storeName: string): Promise<void> {
    await tx(storeName, 'readwrite', s => s.clear())
  },
  // bulkPut 保留对象自带的 key（含 autoIncrement 的 id），引用关系不丢失
  async bulkPut(storeName: string, rows: any[]): Promise<void> {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(storeName, 'readwrite')
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      const store = t.objectStore(storeName)
      for (const r of rows) store.put(r)
    })
  },
  // === compose_records（智能组卷历史记录） ===
  async addComposeRecord(record: any): Promise<number> {
    return tx('compose_records', 'readwrite', s => s.add(record)) as unknown as number
  },
  async listComposeRecords(): Promise<any[]> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const t = db.transaction('compose_records', 'readonly')
      const idx = t.objectStore('compose_records').index('created_at')
      const req = idx.getAll()
      req.onsuccess = () => resolve(req.result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))))
      req.onerror = () => reject(req.error)
    })
  },
  async getComposeRecord(id: number): Promise<any | null> {
    const v = await tx('compose_records', 'readonly', s => s.get(id))
    return v ?? null
  },
  async deleteComposeRecord(id: number): Promise<void> {
    await tx('compose_records', 'readwrite', s => s.delete(id))
  },
  // === 统计 ===
  async bankStats(bankId: number): Promise<{ total: number; practiced: number; correct: number; mastered: number }> {
    const qs = await this.listQuestions(bankId)
    const records = await new Promise<any[]>((resolve, reject) => {
      openDB().then(db => {
        const t = db.transaction('practice_records', 'readonly')
        const idx = t.objectStore('practice_records').index('bank_id')
        const req = idx.getAll(IDBKeyRange.only(bankId))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    })
    // 2026-08-16 修复：历史云同步可能重复写入同一次练习（同题+同时间）→ 统计前按 (question_id, practiced_at) 去重，
    // 避免 correct 按次数翻倍导致首页正确率 >100%
    const seen = new Set<string>()
    const uniq = records.filter(r => {
      const k = `${r.question_id}_${r.practiced_at ?? ''}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const practiced = new Set(uniq.map(r => r.question_id)).size
    const correct = uniq.filter(r => r.is_correct).length
    const mastered = (await this.listMastered(bankId)).length
    return { total: qs.length, practiced, correct, mastered }
  },
}
