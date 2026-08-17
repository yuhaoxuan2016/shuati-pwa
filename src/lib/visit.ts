// 访问统计模块（累计访问 / 今日访问）
// 设计要点：
// 1. 独立集合 visit_stats，不依赖用户云同步配置。无配置时照抄 exam.ts 的 ensureCloud
//    回退逻辑，用默认 envId 匿名登录 —— 任何打开链接的人都能贡献计数。
// 2. 写：db.command.inc 原子自增；读：where({key}) 兼容 ACL（doc(id).get() 在 ACL 下被拒）。
// 3. 本设备按天 localStorage 去重（刷新不重复计）。换浏览器/清缓存视为新设备，属预期。
// 4. 云端集合 visit_stats 的 ACL 必须设为「所有用户可读写」，否则非创建者写入会被 ACL 拒绝
//    （功能降级为仅创建者本人可计数）。读取/写入失败均静默，绝不影响首页渲染。

// 默认云端环境 ID（构建时由 .env 的 VITE_DEFAULT_CLOUD_ENV_ID 注入，不进 git 仓库）
// 为空 = 未配置且无默认环境，访问统计静默跳过
const DEFAULT_CLOUD_ENV_ID = (import.meta.env.VITE_DEFAULT_CLOUD_ENV_ID as string) || ''
const VISIT_COLLECTION = 'visit_stats'
const VISIT_LS_KEY = 'visit_last_day'

let app: any = null
let db: any = null
let ready = false

async function ensureCloud(): Promise<boolean> {
  if (ready) return true
  try {
    const cfgRaw = localStorage.getItem('cloudbase_config')
    let envId: string | null = null
    if (cfgRaw) {
      try {
        const cfg = JSON.parse(cfgRaw)
        if (cfg.envId && cfg.enabled) envId = cfg.envId
      } catch { /* 配置损坏则回退默认 */ }
    }
    // 未配置或配置关闭 → 用默认 envId（不写入 localStorage、不触发云同步）
    if (!envId) envId = DEFAULT_CLOUD_ENV_ID
    if (!envId) return false  // 无默认环境且未配置 → 跳过统计（静默降级）
    const mod = await import('@cloudbase/js-sdk')
    const tcb = mod.default
    app = tcb.init({ env: envId })
    // 必须先匿名登录，否则 ACL（auth != null）会拒绝所有读写
    const auth = app.auth({ persistence: 'local' })
    let state: any = null
    try { state = await auth.getLoginState() } catch { state = null }
    if (!state) {
      await auth.anonymousAuthProvider().signIn()
      try { state = await auth.getLoginState() } catch { state = null }
    }
    db = app.database()
    ready = true
    return true
  } catch (e) {
    console.warn('访问统计 CloudBase 初始化失败：', e)
    return false
  }
}

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 原子自增某字段；文档不存在时降级为创建（并发下可能少计 1，统计场景可接受）
// 注意：CloudBase Web SDK 中 doc(id).update() 对「不存在的文档」返回 updated:0 且不抛错，
// 所以光靠 catch 兜底不够——必须显式检查 updated===0 再 set 创建，否则计数永远写不进去。
async function incField(id: string, field: string, by = 1): Promise<void> {
  const _ = db.command
  try {
    const upd: any = await db.collection(VISIT_COLLECTION).doc(id).update({ [field]: _.inc(by) })
    if (upd && upd.updated === 0) {
      await db.collection(VISIT_COLLECTION).doc(id).set({ key: id, [field]: by })
    }
  } catch (e: any) {
    // update 抛「文档不存在」等异常时，降级为创建
    try {
      await db.collection(VISIT_COLLECTION).doc(id).set({ key: id, [field]: by })
    } catch { /* 静默：统计失败不影响首页 */ }
  }
}

async function getField(id: string): Promise<any | null> {
  const res = await db.collection(VISIT_COLLECTION).where({ key: id }).limit(1).get()
  return (res.data && res.data[0]) || null
}

// 记录一次访问（本设备按天去重，先标记再写入，避免重复计）
export async function recordVisit(): Promise<void> {
  if (!(await ensureCloud())) return
  const today = localDate()
  const lastDay = localStorage.getItem(VISIT_LS_KEY)
  if (lastDay === today) return
  localStorage.setItem(VISIT_LS_KEY, today)
  try {
    await incField('global', 'total', 1)
    await incField(today, 'today', 1)
  } catch (e) {
    console.warn('访问计数写入失败：', e)
  }
}

// 读取当前统计；失败返回 null（调用方降级不显示）
export async function getVisitStats(): Promise<{ total: number; today: number } | null> {
  if (!(await ensureCloud())) return null
  const today = localDate()
  try {
    const [g, t] = await Promise.all([getField('global'), getField(today)])
    return {
      total: g && typeof g.total === 'number' ? g.total : 0,
      today: t && typeof t.today === 'number' ? t.today : 0,
    }
  } catch (e) {
    console.warn('访问计数读取失败：', e)
    return null
  }
}
