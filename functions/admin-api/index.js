// admin-api 云函数：管理员操作入口（部署于 CloudBase 云函数，管理密钥天然在服务端）
// 前端调用方式：app.callFunction({ name: 'admin-api', data: { password, action, payload } })
//
// 支持的操作（action）：
//   list-exams          列出所有考试（含 private）
//   delete-exam         删除指定考试 { examId }
//   delete-all-exams    删除全部考试（可指定 visibility 过滤）
//   list-banks          列出所有题库（含 private）
//   delete-bank         删除题库（及其题目）{ bankId, bankRef }
//   delete-all-banks    删除全部题库
//   delete-user-data    删除指定用户全部数据（该用户创建的题库/考试/题目）{ uid }
//   clear-personal      清理所有非公共数据（private 题库/考试/题目）
//   reset-exams-acl     恢复 exams 集合 ACL 为正式规则
//
// 管理员密码：必须通过环境变量 ADMIN_PASSWORD 设置（部署时在控制台配置）。
// 安全铁律：未配置环境变量时服务直接禁用，绝不回退到默认密码。
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const _ = db.command

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

exports.main = async (event = {}) => {
  const { password, action, payload = {} } = event
  if (!ADMIN_PASSWORD) {
    return { ok: false, code: 'NO_PASSWORD', message: '未配置 ADMIN_PASSWORD 环境变量，服务已禁用' }
  }
  if (password !== ADMIN_PASSWORD) {
    return { ok: false, code: 'BAD_PASSWORD', message: '管理员密码错误' }
  }

  try {
    switch (action) {
      case 'list-exams': return await listExams()
      case 'delete-exam': return await deleteExam(payload.examId)
      case 'delete-all-exams': return await deleteAllExams(payload.visibility)
      case 'list-banks': return await listBanks()
      case 'delete-bank': return await deleteBank(payload.bankId, payload.bankRef)
      case 'delete-all-banks': return await deleteAllBanks()
      case 'delete-user-data': return await deleteUserData(payload.uid)
      case 'clear-personal': return await clearPersonal()
      case 'reset-exams-acl': return await resetExamsAcl()
      default:
        return { ok: false, code: 'UNKNOWN_ACTION', message: `未知操作: ${action}` }
    }
  } catch (e) {
    return { ok: false, code: 'ERROR', message: e?.message || String(e) }
  }
}

// ===== 实现 =====

async function listExams() {
  const all = []
  const pageSize = 100
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const res = await db.collection('exams').skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return { ok: true, total: all.length, exams: all.map(e => ({
    _id: e._id, title: e.title, visibility: e.visibility, question_count: e.questions?.length || 0,
    created_at: e.created_at, creator_name: e.creator_name, _openid: e._openid,
  })) }
}

async function deleteExam(examId) {
  if (!examId) return { ok: false, message: '缺少 examId' }
  await db.collection('exams').doc(examId).remove()
  // 级联删除答卷
  const results = await db.collection('exam_results').where({ exam_id: examId }).limit(500).get()
  for (const r of (results.data || [])) {
    await db.collection('exam_results').doc(r._id).remove()
  }
  return { ok: true, message: `已删除考试 ${examId} 及 ${results.data?.length || 0} 份答卷` }
}

async function deleteAllExams(visibility) {
  const all = []
  const pageSize = 100
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const q = visibility ? db.collection('exams').where({ visibility }) : db.collection('exams')
    const res = await q.skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  let n = 0
  for (const e of all) {
    try { await db.collection('exams').doc(e._id).remove(); n++ } catch { /* ignore */ }
  }
  return { ok: true, message: `已删除 ${n} 个考试`, deleted: n }
}

async function listBanks() {
  const all = []
  const pageSize = 100
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const res = await db.collection('quiz_banks').skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  // 附加题目数
  const banks = await Promise.all(all.map(async b => {
    try {
      const cnt = await db.collection('questions').where({ bank_ref: b._id }).count()
      return { _id: b._id, name: b.name, visibility: b.visibility, question_count: cnt.total, creator_name: b.creator_name, _openid: b._openid }
    } catch { return { _id: b._id, name: b.name, visibility: b.visibility, question_count: 0, creator_name: b.creator_name, _openid: b._openid } }
  }))
  return { ok: true, total: banks.length, banks }
}

async function deleteBank(bankId, bankRef) {
  if (!bankId) return { ok: false, message: '缺少 bankId' }
  // 删除题库
  await db.collection('quiz_banks').doc(bankId).remove()
  // 级联删除题目（按 bank_ref 匹配）
  let deleted = 0
  const pageSize = 100
  for (let skip = 0; skip < 5000; skip += pageSize) {
    const q = db.collection('questions').where({ bank_ref: bankId })
    const res = await q.skip(skip).limit(pageSize).get()
    const rows = res.data || []
    for (const qd of rows) {
      try { await db.collection('questions').doc(qd._id).remove(); deleted++ } catch { /* ignore */ }
    }
    if (rows.length < pageSize) break
  }
  return { ok: true, message: `已删除题库 ${bankId} 及 ${deleted} 道题目` }
}

async function deleteAllBanks() {
  const all = []
  const pageSize = 100
  for (let skip = 0; skip < 1000; skip += pageSize) {
    const res = await db.collection('quiz_banks').skip(skip).limit(pageSize).get()
    const rows = res.data || []
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  let n = 0
  for (const b of all) {
    try {
      await deleteBank(b._id, b._id)
      n++
    } catch { /* ignore */ }
  }
  return { ok: true, message: `已删除 ${n} 个题库及其题目`, deleted: n }
}

async function deleteUserData(uid) {
  if (!uid) return { ok: false, message: '缺少 uid' }
  let total = 0
  // 该用户创建的题库
  const banks = await db.collection('quiz_banks').where({ _openid: uid }).limit(500).get()
  for (const b of (banks.data || [])) {
    await deleteBank(b._id, b._id)
    total++
  }
  // 该用户创建的考试
  const exams = await db.collection('exams').where({ _openid: uid }).limit(500).get()
  for (const e of (exams.data || [])) {
    await db.collection('exams').doc(e._id).remove()
    total++
  }
  return { ok: true, message: `已清理用户 ${uid} 的 ${total} 个数据项（题库+考试）` }
}

async function clearPersonal() {
  let n = 0
  // 删除所有 private 题库及其题目
  const banks = await db.collection('quiz_banks').where({ visibility: 'private' }).limit(500).get()
  for (const b of (banks.data || [])) {
    await deleteBank(b._id, b._id)
    n++
  }
  // 删除所有 private 考试
  const exams = await db.collection('exams').where({ visibility: 'private' }).limit(500).get()
  for (const e of (exams.data || [])) {
    await db.collection('exams').doc(e._id).remove()
    n++
  }
  return { ok: true, message: `已清理 ${n} 个私人数据项（题库+考试）` }
}

async function resetExamsAcl() {
  // 通过管理端恢复 exams 集合安全规则（ModifySafeRule）
  // 注：云函数环境内用 node-sdk 无法直接改 ACL，此操作通过 TCB 管理 API 外部执行
  return { ok: true, message: 'ACL 恢复请使用管理脚本 scripts/manage-acl.cjs restore' }
}

exports._test = { ADMIN_PASSWORD, db, _ }
