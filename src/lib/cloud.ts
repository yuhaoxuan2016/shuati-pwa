// 腾讯云 CloudBase 云同步模块
// 核心职责：
// 1. 匿名登录（每个设备独立身份）
// 2. 云数据库读写（6 个集合与本地 IndexedDB 对应）
// 3. 双向同步（启动拉取 + 改动推送，按 updated_at 解决冲突）
// 未配置时自动降级为纯本地模式，不抛错。

import { idb } from './db'

// 集合名与本地 store 一一对应
export const CLOUD_COLLECTIONS = [
  'quiz_banks',
  'questions',
  'practice_records',
  'wrong_questions',
  'mastered_questions',
  'favorites',
  'settings',
] as const
export type CloudCollection = (typeof CLOUD_COLLECTIONS)[number]

// 云同步配置（存 localStorage，避免进 IndexedDB 造成循环依赖）
const CFG_KEY = 'cloudbase_config'
interface CloudConfig {
  envId: string
  enabled: boolean
}

let app: any = null
let db: any = null
let auth: any = null
let authedUid: string | null = null
let syncChain: Promise<void> = Promise.resolve()

export const cloudState = {
  enabled: false,
  authed: false,
  syncing: false,
  lastSyncAt: null as string | null,
  error: null as string | null,
}

function getConfig(): CloudConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as CloudConfig
    if (!cfg.envId || !cfg.enabled) return null
    return cfg
  } catch { return null }
}

// 保存配置（由设置页调用）
export function setCloudConfig(envId: string, enabled: boolean): void {
  const cfg: CloudConfig = { envId, enabled }
  if (enabled && !envId) return
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg))
  cloudState.enabled = enabled
  if (!enabled) {
    app = null; db = null; auth = null; authedUid = null
    cloudState.authed = false
    cloudState.syncing = false
    cloudState.error = null
  }
}

export function isCloudEnabled(): boolean {
  const cfg = getConfig()
  return !!cfg
}

// 动态加载 SDK（保持主包轻量，未配置时不加载）
async function ensureApp(): Promise<boolean> {
  if (app) return true
  const cfg = getConfig()
  if (!cfg) return false
  try {
    const mod = await import('@cloudbase/js-sdk')
    const tcb = mod.default
    app = tcb.init({ env: cfg.envId })
    auth = app.auth({ persistence: 'local' })
    db = app.database()
    // 匿名登录
    try {
      const state = await auth.getLoginState()
      if (state) {
        // uid 在 state.user.uid（新 SDK），兼容 state.uid
        authedUid = state.user?.uid || state.uid || null
      } else {
        // signIn() 可能返回 undefined（登录态存 SDK 内部），需重新 getLoginState 取 uid
        await auth.anonymousAuthProvider().signIn()
        const st2 = await auth.getLoginState()
        authedUid = st2?.user?.uid || st2?.uid || null
      }
      cloudState.authed = !!authedUid
      return !!authedUid
    } catch (e: any) {
      // 环境未开通匿名登录时降级
      console.warn('CloudBase 匿名登录失败：', e?.message || e)
      cloudState.error = '匿名登录失败：' + (e?.message || String(e))
      return false
    }
  } catch (e: any) {
    console.warn('CloudBase 初始化失败：', e?.message || e)
    cloudState.error = '初始化失败：' + (e?.message || String(e))
    return false
  }
}

function isAuthed(): boolean {
  return !!app && !!db && !!authedUid
}

// 服务端时间（用于 updated_at）
function now(): string { return new Date().toISOString() }

// ===== 集合级操作 =====

// 同步昵称（跨设备身份）：设置页可自定义，默认随机生成；存 localStorage
const SYNC_KEY_CFG = 'sync_nickname'
export function getSyncKey(): string {
  try {
    const v = localStorage.getItem(SYNC_KEY_CFG)
    if (v) return v
  } catch { /* ignore */ }
  const gen = '兔子_' + Math.random().toString(36).slice(2, 6).toUpperCase()
  try { localStorage.setItem(SYNC_KEY_CFG, gen) } catch { /* ignore */ }
  return gen
}
export function setSyncKey(name: string): void {
  try { localStorage.setItem(SYNC_KEY_CFG, name.trim() || getSyncKey()) } catch { /* ignore */ }
}

// ===== 删除同步标记（2026-08-15，P1.2 修复）=====
// 问题：取消收藏/标记掌握/放回错题等「删除类」操作只删本地，云端旧文档残留，
//       pull 时会「复活」。方案：删除操作时把 {bank_id, question_id} 记入本地删除标记，
//       下次 push 时先按标记删除云端对应文档，成功后清空标记。
// 删除标记存储：localStorage 'sync_deleted' = { [coll]: [{bank_id, question_id}] }
const SYNC_DELETED_KEY = 'sync_deleted'

type DeletedMark = { bank_id: number; question_id: number }

function getDeletedMarks(): Record<string, DeletedMark[]> {
  try {
    const raw = localStorage.getItem(SYNC_DELETED_KEY)
    if (raw) {
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') return obj
    }
  } catch { /* ignore */ }
  return {}
}
function saveDeletedMarks(obj: Record<string, DeletedMark[]>): void {
  try { localStorage.setItem(SYNC_DELETED_KEY, JSON.stringify(obj)) } catch { /* ignore */ }
}
// 记录一条删除标记（供 api 层在删除类操作时调用）
export function markCloudDeleted(collection: CloudCollection, bankId: number, questionId: number): void {
  const marks = getDeletedMarks()
  const list = marks[collection] || (marks[collection] = [])
  if (!list.some(m => m.bank_id === bankId && m.question_id === questionId)) {
    list.push({ bank_id: bankId, question_id: questionId })
    saveDeletedMarks(marks)
  }
}
// 推送前：按删除标记清理云端旧文档（删除幂等——云端没有该记录时 where 返回空即可；尝试后清除标记）
async function applyDeletedMarks(): Promise<void> {
  if (!isAuthed()) return
  const marks = getDeletedMarks()
  let changed = false
  for (const coll of ['favorites', 'wrong_questions', 'mastered_questions'] as CloudCollection[]) {
    const list = marks[coll]
    if (!list || !list.length) continue
    for (const m of list) {
      try {
        // 云端记录 push 时带 _local_bank_id（本地题库 id）+ question_id → where 精确查删
        const res = await withTimeout(db.collection(coll).where({ _local_bank_id: m.bank_id, question_id: m.question_id }).limit(50).get(), 20000, '删除同步')
        const rows = Array.isArray(res.data) ? res.data : []
        for (const r of rows) {
          try { await withTimeout(db.collection(coll).doc(r._id).remove(), 20000, '删除同步') } catch { /* 单条失败继续 */ }
        }
      } catch (e) {
        console.warn(`清理云端 ${coll} 删除标记失败：`, e?.message || e)
      }
    }
    delete marks[coll]
    changed = true
  }
  if (changed) saveDeletedMarks(marks)
}

// 当前用户 _id 前缀（同设备稳定；配合 cloud_id 保持跨设备同昵称下身份一致）
function uidPrefix(): string {
  return (authedUid || 'anon').slice(0, 8)
}

// 超时保护：CloudBase 请求异常挂起时避免页面永远卡在"同步中"（2026-08-16 手机端反馈：
// 无超时 → syncAll 挂起 → cloudSyncing 永远 true → 设置页两个按钮禁用，点啥都没反应）
function withTimeout<T>(p: Promise<T>, ms = 20000, label = '同步请求'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms / 1000}s），请检查网络后重试`)), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// 推送单条文档（2026-08-15 实测确定的可靠写法）：
// - doc(id).get() 在 ACL 下永远返回空 → 无法判断存在
// - doc(id).set()/update() 在 write 规则为 doc._openid==auth.openid 时「假成功」（不写入）；
//   规则改为 write: auth != null 后 update 生效（实测）
// - add 带 _id：首次创建 ✓，重复静默忽略（不更新）
// → 双写：先 add（保证首次创建），再 update 不带 _id（保证最新内容覆盖）
// 2026-08-21 修复：此前 .catch(() => {}) 吞掉所有错误（含网络错误/超时），网络断时同步显示成功但实际 0 写入（假成功）。
// 现在按错误类型区分：重复 _id（add）/ 文档不存在（update）属正常路径静默；其余错误（网络、权限）上抛，
// 由 pushToCloud 捕获并提示「推送失败」，用户可感知。
function isIgnorableSyncError(e: any): boolean {
  const msg = String(e?.message || e)
  return /duplicate|already\s*exists|已存在|not\s*exist|不存在/i.test(msg)
}
async function pushDoc(collection: CloudCollection, doc: any): Promise<string | null> {
  if (!isAuthed()) return null
  const coll = db.collection(collection)
  const id = doc._id || doc.cloud_id
  try {
    if (id) {
      await withTimeout(coll.add({ ...doc, _id: id, updated_at: now() }).catch((e: any) => { if (!isIgnorableSyncError(e)) throw e }), 20000, '推送')
      const { _id, ...upd } = doc // _id 为系统字段，update 时剥掉
      await withTimeout(coll.doc(id).update({ ...upd, updated_at: now() }).catch((e: any) => { if (!isIgnorableSyncError(e)) throw e }), 20000, '更新')
      return String(id)
    } else {
      const res = await withTimeout(coll.add({ ...doc, updated_at: now() }), 20000, '新增')
      return res.id
    }
  } catch (e: any) {
    console.warn(`CloudBase 推送 ${collection} 失败：`, e?.message || e)
    throw e
  }
}

// 分页拉取一个查询的全部结果
async function pullAll(coll: any, query: any): Promise<any[]> {
  const all: any[] = []
  const pageSize = 100
  let skip = 0
  for (;;) {
    const res = await withTimeout(query.skip(skip).limit(pageSize).get(), 20000, '拉取')
    const rows = Array.isArray(res.data) ? res.data : []
    all.push(...rows)
    if (rows.length < pageSize) break
    skip += pageSize
    if (skip > 8000) break // 安全上限（公共题现有 7049 道；4000 会截断，2026-08-16 调大）
  }
  return all
}

async function pullCollection(collection: CloudCollection, localIds: Set<string>): Promise<any[]> {
  if (!isAuthed()) return []
  const coll = db.collection(collection)
  const all: any[] = []
  // CloudBase ACL：不带 where 条件的查询会被 ACL 拒绝返回空（实测）
  // 因此必须带条件查询：本人数据 = _openid == 当前 uid（同设备稳定）；换设备用 sync_key 昵称
  // 2026-08-16 对齐「只同步私人数据」约定：不再拉取公共题库/公共题（visibility public）。
  // 此前拉公共数据会把公共题 _local_id 当本地 id put 覆盖「添加到我的题库」的 private 副本，导致副本题目丢失。
  // 公共题库刷题走云端直读（listPublicBanks / listPublicBankQuestions），无需本地缓存。
  const seen = new Set<string>()
  const syncKey = getSyncKey()

  // 拉取本人数据（优先按 sync_key 昵称，失败/空则按 _openid；ACL 放开前昵称查询返回空）
  const mineQueries: any[] = []
  if (syncKey) {
    try {
      const byKey = await pullAll(coll, coll.where({ sync_key: syncKey }).orderBy('updated_at', 'desc'))
      if (byKey.length) mineQueries.push(byKey)
    } catch (e: any) { console.warn(`拉取 ${collection} sync_key 数据失败：`, e?.message || e) }
  }
  try {
    const byUid = await pullAll(coll, coll.where({ _openid: authedUid }).orderBy('updated_at', 'desc'))
    if (byUid.length) mineQueries.push(byUid)
  } catch (e: any) { console.warn(`拉取 ${collection} 本人数据失败：`, e?.message || e) }
  for (const rows of mineQueries) {
    for (const d of rows) {
      const key = String(d._id ?? d.id)
      if (!seen.has(key)) { seen.add(key); all.push(d) }
    }
  }
  return all
}

// ===== 同步 =====

// 全量同步：云端 → 本地（合并，updated_at 新的赢）
export async function syncFromCloud(): Promise<{ pulled: number }> {
  if (!(await ensureApp())) return { pulled: 0 }
  if (!isAuthed()) return { pulled: 0 }
  cloudState.syncing = true
  cloudState.error = null
  try {
    let pulled = 0
    qCloudIdx = null // 每次同步重建 cloud_id 索引（防缓存过期）
    for (const coll of CLOUD_COLLECTIONS) {
      const cloudDocs = await pullCollection(coll, new Set())
      if (!cloudDocs.length) continue
      // 本地对应的记录（按 id 映射）
      const localMap: Map<string, any> = new Map()
      const localRows = await listLocalAll(coll)
      for (const r of localRows) {
        localMap.set(String(r.id ?? r._id), r)
        if (r.cloud_id) localMap.set('cid:' + r.cloud_id, r)
      }

      for (const cd of cloudDocs) {
        // 2026-08-16 修复：云端文档 push 时 id 被删、只留 _id + _local_id（数字），
        // 原逻辑 String(cd.id ?? cd._id) 永远匹配不上本地数字 id → 每次全量重写且 updated_at 冲突比较失效。
        // 优先用 _local_id 匹配本地，其次 cloud_id，最后回退 _id。
        const localId = String(cd._local_id ?? cd.id ?? cd._id)
        const local = localMap.get(localId) || (cd._id ? localMap.get('cid:' + cd._id) : undefined)
        if (!local || (cd.updated_at || '') > (local.updated_at || '')) {
          // 云端较新（或本地没有）→ 写入本地
          await writeLocal(coll, cd)
          pulled++
        }
      }
    }
    cloudState.lastSyncAt = now()
    return { pulled }
  } catch (e: any) {
    cloudState.error = '同步失败：' + (e?.message || String(e))
    console.warn('syncFromCloud 失败：', e)
    return { pulled: 0 }
  } finally {
    cloudState.syncing = false
  }
}

// 本地 → 云端（推送本设备私人数据；公共数据人人可读无需同步，rabbit 2026-08-15 明确）
export async function pushToCloud(): Promise<{ pushed: number }> {
  if (!(await ensureApp())) return { pushed: 0 }
  if (!isAuthed()) return { pushed: 0 }
  cloudState.syncing = true
  cloudState.error = null
  const syncKey = getSyncKey()
  try {
    let pushed = 0
    // 先处理删除标记：取消收藏/标记掌握/放回等删除类操作同步到云端（P1.2 修复）
    await applyDeletedMarks()
    for (const coll of CLOUD_COLLECTIONS) {
      const localRows = await listLocalAll(coll)
      for (const r of localRows) {
        // 跳过从云端共享来的公共题库及其题目/记录（避免覆盖原作者数据）
        if (coll === 'quiz_banks' && r.cloud_shared) continue
        if (coll === 'questions' && r.cloud_shared) continue
        // 只推私人数据：公共题库（所有人可读）不需要同步到云端
        if (coll === 'quiz_banks' && r.visibility === 'public') continue
        if (coll === 'questions' && r._bank_visibility === 'public') continue
        const doc = { ...r, sync_key: syncKey }
        if (typeof doc.id === 'number') {
          // 有 cloud_id 则沿用云端身份（同昵称换设备不重复创建）；否则用 uid 前缀防撞
          doc._id = doc.cloud_id || ('l' + coll + '_' + uidPrefix() + '_' + doc.id)
          doc._local_id = doc.id
          delete doc.id
        }
        if (coll === 'questions' && typeof doc._bank_id === 'number') {
          doc._local_bank_id = doc._bank_id
          // 题目继承所属题库的可见性（ACL 用 doc.visibility 判断公共/私有）
          const bank = await idb.getBank?.(doc._bank_id).catch?.(() => null)
          doc.visibility = bank?.visibility || doc.visibility || 'public'
          // 记录题库的云端 _id（若该题库已同步过），供公共题库跨用户关联题目
          if (bank?.cloud_id) doc.bank_ref = bank.cloud_id
          delete doc._bank_id
        }
        if ((coll === 'practice_records' || coll === 'wrong_questions' || coll === 'mastered_questions' || coll === 'favorites') && typeof doc.bank_id === 'number') {
          doc._local_bank_id = doc.bank_id
          // 保留 bank_id 供云端统计；拉取时用 _local_bank_id 回映
        }
        await pushDoc(coll, doc)
        // 题库/题目推送后回写云端 _id（供题目 bank_ref 关联 / 同昵称换设备保持身份）
        if ((coll === 'quiz_banks' || coll === 'questions') && typeof r.id === 'number' && doc._id) {
          if (coll === 'quiz_banks') {
            const bank = await idb.getBank?.(r.id)
            if (bank && !bank.cloud_id) {
              await idb.updateBank?.({ ...bank, cloud_id: doc._id })
            }
          } else {
            const q = await idb.getQuestion?.(r.id)
            if (q && !q.cloud_id) {
              await idb.updateQuestion?.({ ...q, cloud_id: doc._id })
            }
          }
        }
        pushed++
      }
    }
    cloudState.lastSyncAt = now()
    return { pushed }
  } catch (e: any) {
    cloudState.error = '推送失败：' + (e?.message || String(e))
    console.warn('pushToCloud 失败：', e)
    return { pushed: 0 }
  } finally {
    cloudState.syncing = false
  }
}

// 全量双向同步（设置页按钮调用）
export async function syncAll(): Promise<{ pulled: number; pushed: number }> {
  const pushed = (await pushToCloud()).pushed
  const pulled = (await syncFromCloud()).pulled
  return { pulled, pushed }
}

// 改动后自动推送（轻量防抖）
// ⚠️ 2026-08-09：因推送全量数据导致刷题卡顿，默认关闭自动同步。
// 保留函数签名兼容旧调用，但不再自动执行；用户可在设置页手动同步。
export function scheduleAutoPush(): void {
  return // 自动同步已关闭（手动同步见设置页）
}

// ===== 本地辅助 =====

async function listLocalAll(coll: CloudCollection): Promise<any[]> {
  switch (coll) {
    case 'quiz_banks': return idb.listBanks()
    case 'questions': return listAllQuestions()
    case 'practice_records': return listAllRecords()
    case 'wrong_questions': return listAllWrong()
    case 'mastered_questions': return listAllMastered()
    case 'favorites': return listAllFavorites()
    case 'settings': return listAllSettings()
  }
}

// questions 的 cloud_id 索引缓存（同一次同步内复用，避免 7049 道公共题逐条全量 listQuestions 造成 O(n²) 卡死）
let qCloudIdx: { bankId: number; map: Map<string, any> } | null = null

async function writeLocal(coll: CloudCollection, doc: any): Promise<void> {
  switch (coll) {
    case 'quiz_banks': {
      // 云端文档：本地 id 存在 _local_id 字段（push 时 doc.id 被转成 _local_id）
      // 优先按 cloud_id（云端 _id）匹配已存在的本地题库（同昵称换设备不重复创建）
      const banks = await idb.listBanks()
      const byCloudId = doc._id ? banks.find(b => b.cloud_id === doc._id) : null
      const localId = byCloudId?.id ?? doc._local_id ?? doc.id
      if (typeof localId === 'number') {
        const exists = byCloudId ?? (await idb.getBank?.(localId))
        if (exists) {
          // 本地已有同 id 的自建题库则不覆盖（保留用户数据）
          if (!exists.cloud_shared && !byCloudId) {
            // 2026-08-16 修复：id 被用户自建题库占用时，公共题库改用新 id 创建（此前 break 会导致公共题库永远拉不下来）
            const maxId = banks.reduce((m, b) => Math.max(m, typeof b.id === 'number' ? b.id : 0), 0)
            await idb.createBank({
              id: maxId + 1,
              name: doc.name,
              description: doc.description,
              visibility: doc.visibility || 'public',
              cloud_shared: true,
              cloud_id: doc._id ?? null,
              created_at: doc.created_at,
              updated_at: doc.updated_at,
            })
            break
          }
          await idb.updateBank?.({ ...doc, id: localId, cloud_id: doc._id ?? exists.cloud_id, visibility: doc.visibility || 'public', cloud_shared: true })
        } else {
          await idb.createBank({
            id: localId,
            name: doc.name,
            description: doc.description,
            visibility: doc.visibility || 'public',
            cloud_shared: true,
            cloud_id: doc._id ?? null, // 云端 _id，供题目 bank_ref 关联
            created_at: doc.created_at,
            updated_at: doc.updated_at,
          })
        }
      } else if (doc._id && !byCloudId) {
        // 云端题库无 _local_id（如安规 lquiz_banks_12）：分配新本地 id 创建，记 cloud_id
        const maxId = banks.reduce((m, b) => Math.max(m, typeof b.id === 'number' ? b.id : 0), 0)
        await idb.createBank({
          id: maxId + 1,
          name: doc.name,
          description: doc.description,
          visibility: doc.visibility || 'public',
          cloud_shared: true,
          cloud_id: doc._id,
          created_at: doc.created_at,
          updated_at: doc.updated_at,
        })
      }
      break
    }
    case 'questions': {
      // 云端题目：bank_ref 是可靠关联（题库云端 _id）；_local_bank_id 是旧设备 id（可能与题库 _local_id 错位）
      // 2026-08-16 严重修复：此前 q.id = _local_id 后 put 覆盖——questions store 是全局自增 id，
      // 公共题 _local_id(1~6229) 会覆盖本地其他题库（如「添加到我的题库」的私人副本）同 id 题目，
      // 造成副本题目丢失无法恢复。正确做法：优先按 cloud_id 匹配本地已有记录（保留本地自增 id）；
      // 无匹配则 add 分配新 id。绝不使用云端 _local_id 作为本地 id。
      const q = { ...doc }
      const cloudBankId = q.bank_ref ?? q._local_bank_id ?? q.bank_id
      const bankId = await mapCloudBankToLocal(cloudBankId)
      if (bankId != null) {
        const cloudId = doc._id ?? q.cloud_id ?? null
        let localQ: any = null
        if (cloudId) {
          if (!qCloudIdx || qCloudIdx.bankId !== bankId) {
            const all = await idb.listQuestions(bankId)
            qCloudIdx = { bankId, map: new Map(all.map((x: any) => [x.cloud_id, x])) }
          }
          localQ = qCloudIdx.map.get(cloudId) ?? null
        }
        if (localQ) {
          // 已同步过：保留本地 id，按最新内容更新
          const { _id, _local_id, ...rest } = q
          await idb.updateQuestion({ ...localQ, ...rest, id: localQ.id, bank_id: bankId, cloud_id: cloudId ?? localQ.cloud_id })
        } else {
          // 首次拉取：剥离云端 id/_local_id，add 让 IndexedDB 分配新 id（避免覆盖其他题库）
          const { _id, _local_id, id, ...rest } = q
          await idb.addQuestions(bankId, [{ ...rest, cloud_id: cloudId }])
        }
      }
      break
    }
    case 'practice_records':
    case 'wrong_questions':
    case 'mastered_questions':
    case 'favorites': {
      const r = { ...doc }
      const bankId = await mapCloudBankToLocal(r._local_bank_id ?? r.bank_id)
      if (bankId != null) {
        r.bank_id = bankId
        if (coll === 'practice_records') {
          // 2026-08-16 修复：本地记录无 updated_at → 合并比较永远"云端较新" → 每次同步重复 add 同一条记录，
          // 导致 correct（按次数统计）翻倍、首页正确率爆表（如 200%）。写前按 (bank_id, question_id, practiced_at) 去重。
          const dup = await idb.findPracticeRecord?.(bankId, r.question_id, r.practiced_at) ?? false
          if (!dup) await idb.recordPractice(r)
        }
        else if (coll === 'wrong_questions') {
          // 2026-08-19：保留云端 correct_streak（连续答对计数）；云端旧记录无该字段时保留本地计数
          await idb.markWrong(bankId, r.question_id, typeof r.correct_streak === 'number' ? r.correct_streak : undefined)
        }
        else if (coll === 'mastered_questions') await idb.markWrongMastered(bankId, r.question_id)
        else await idb.toggleFavoriteSafe?.(bankId, r.question_id)
      }
      break
    }
    case 'settings': {
      // 敏感设置（ai_api_key）不参与云同步，云端残留也忽略
      if (doc.key === 'ai_api_key') break
      await idb.setSetting(doc.key, doc.value)
      break
    }
  }
}

// 云端 bank_id → 本地 bank_id
// 云端文档带 bank_ref（题库云端 _id）时优先按本地题库 cloud_id 匹配（可靠关联）；
// 其次按 _local_bank_id（同设备/多设备同 id 兼容）或名字匹配
async function mapCloudBankToLocal(cloudBankId: number | string | null | undefined): Promise<number | null> {
  const banks = await idb.listBanks()
  if (typeof cloudBankId === 'string') {
    const byCloud = banks.find(b => b.cloud_id === cloudBankId)
    if (byCloud) return byCloud.id
  }
  if (typeof cloudBankId === 'number') {
    const direct = banks.find(b => b.id === cloudBankId)
    if (direct) return direct.id
    const cloudIdMatch = banks.find(b => b.cloud_id === cloudBankId)
    if (cloudIdMatch) return cloudIdMatch.id
  }
  return null
}

// 以下辅助函数补齐 idb 缺的方法（在 db.ts 里没暴露的）
async function listAllQuestions(): Promise<any[]> {
  const banks = await idb.listBanks()
  const all: any[] = []
  for (const b of banks) {
    const qs = await idb.listQuestions(b.id)
    for (const q of qs) all.push({ ...q, _bank_id: b.id, _bank_visibility: b.visibility, cloud_shared: !!b.cloud_shared })
  }
  return all
}
async function listAllRecords(): Promise<any[]> {
  const banks = await idb.listBanks()
  const all: any[] = []
  for (const b of banks) {
    const recs = await idb.listRecords?.(b.id) || []
    all.push(...recs)
  }
  return all
}
async function listAllWrong(): Promise<any[]> {
  const banks = await idb.listBanks()
  const all: any[] = []
  for (const b of banks) {
    const ids = await idb.listWrong(b.id)
    for (const qid of ids) all.push({ bank_id: b.id, question_id: qid })
  }
  return all
}
async function listAllMastered(): Promise<any[]> {
  const banks = await idb.listBanks()
  const all: any[] = []
  for (const b of banks) {
    const ids = await idb.listMastered(b.id)
    for (const qid of ids) all.push({ bank_id: b.id, question_id: qid })
  }
  return all
}
async function listAllFavorites(): Promise<any[]> {
  const banks = await idb.listBanks()
  const all: any[] = []
  for (const b of banks) {
    const ids = await idb.listFavorites(b.id)
    for (const qid of ids) all.push({ bank_id: b.id, question_id: qid })
  }
  return all
}
async function listAllSettings(): Promise<any[]> {
  // 读取已知 key（从设置页用到的）
  // 注意：ai_api_key（AI 密钥）不参与云同步，仅保存在本地浏览器，避免泄露到云端
  // 2026-08-21 修复：此前无 _id → pushDoc 走 add 不带 _id 分支 → 每次手动同步都新增 5 条重复文档，
  // settings 集合无限膨胀。现在带稳定 _id（uid 前缀 + key），pushDoc 双写变成 upsert 语义。
  const keys = ['ai_base_url', 'ai_model', 'daily_records', 'last_practice', 'practice_progress']
  const out: any[] = []
  for (const k of keys) {
    const v = await idb.getSetting(k)
    if (v != null) out.push({ _id: 'lsettings_' + uidPrefix() + '_' + k, key: k, value: v })
  }
  return out
}

// 导出给设置页用的状态
export function getCloudStatus() {
  return { ...cloudState }
}
