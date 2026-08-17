// 题目解析器：从 Rust structure.rs 移植的核心正则逻辑
// 支持：单选题/多选题/判断题/填空题/问答题 + 章节/小节 + 答案区 + 解析
// 修复：BUG-001 判断题被误判为填空（RE_BLANK 优先级过高 + 判断答案未归一化）

export type QType = 'single' | 'multi' | 'judge' | 'blank' | 'qa'

export interface ParsedQuestion {
  type: QType
  stem: string
  options: string[]
  answer: string | null
  analysis: string | null
  source_index: number
  confidence: number
  chapter?: number
  section?: number
}

// === 正则（与 Rust 版一致） ===
const RE_NUM_START = /^\s*[\(（]?(\d+)[\.、．)）]\s*(.+)/
const RE_NUM_STRIP = /^\s*[\(（]?\d+[\.、．)）]\s*(.+)/
// 选项识别：A-H（支持 5-8 选项多选，对齐真实题库 E/F/G/H 选项）
// 2026-08-15 增强：支持 A. / A、 / A．/ A) / A） / A: / A： 等分隔符
const RE_OPT = /^\s*([A-H])\s*[\.、．)）:：]\s*(.+)/
const RE_ANS = /^\s*(答案|正确答案|【答案】)\s*[:：]?\s*(.+)/i
const RE_ANA = /^\s*(解析|答案解析|【解析】)\s*[:：]?\s*(.+)/i
const RE_BLANK = /_{2,}|（\s*）|\(\s*\)|【\s*】/
const RE_ANS_HEADER = /^\s*(【\s*)?(参考答案|标准答案|正确答案|答案|answer)(\s*】)?[:：]?\s*$/i
const RE_OPT_MARK = /([A-H])[\.、．)）:：]\s*/
const RE_ANS_EXTRACT = /(\d+)[\.、．)]\s*\(?([A-Ha-h](?:[、,，]*[A-Ha-h]){0,7}|正确|错误|对|错|√|×|true|false)\)?/
const RE_PAREN_ANS = /[\(（]\s*([A-Ha-h](?:[、,，][A-Ha-h]){0,7})\s*[\)）]/
const RE_CHAPTER = /^\s*第([一二三四五六七八九十百千零\d]+)\s*章/
const RE_SECTION = /^\s*[一二三四五六七八九十]+\s*[、,，]\s*(单项选择|多项选择|单选|多选|判断)/
const RE_SECTION_SOLO = /^\s*(单项选择题|多项选择题|单选题|多选题|判断题)\s*$/
const RE_RANGE = /(\d+)\s*[-—–~～]+\s*(\d+)\s*[.、．:：]?/
const RE_JUDGE_WORD = /正确|错误|true|false|对|错|√|×|T|F/i
const RE_INTRO = /^\s*导论\s*$/

// === 判断题精确匹配（对齐 Rust is_judge_answer，避免子串误判如"FTP"含F） ===
const JUDGE_TRUE = new Set(['正确', '对', '√', 'T', 't', 'true', 'True', 'TRUE'])
const JUDGE_FALSE = new Set(['错误', '错', '×', 'F', 'f', 'false', 'False', 'FALSE'])

// 判断题选项行：A. 正确 / B. 错误（首选项匹配，用于选项式判断题）
const RE_JUDGE_OPT = /^\s*[A-D]\s*[\.、．)）:：]\s*(正确|错误|对|错|√|×|true|false)\s*$/i

export function isJudgeAnswer(ans: string | null | undefined): boolean {
  if (!ans) return false
  const v = ans.trim().toLowerCase()
  return JUDGE_TRUE.has(v) || JUDGE_FALSE.has(v)
}

// 归一化判断题答案（对齐 Rust normalize_answer：true/false）
export function normalizeJudgeAnswer(ans: string): string {
  const v = ans.trim().toLowerCase()
  if (JUDGE_TRUE.has(v)) return 'true'
  if (JUDGE_FALSE.has(v)) return 'false'
  return ans.trim()
}

// 归一化选择题答案：AC 紧凑格式（前端 parseAnswerLetters 兼容紧凑和 ["A","C"] 两种）
export function normalizeChoiceAnswer(ans: string): string {
  const letters = ans.split('').filter(c => /[A-H]/i.test(c)).map(c => c.toUpperCase())
  return letters.join('')
}

function parseChineseNum(s: string): number {
  const n = parseInt(s)
  if (!isNaN(n)) return n
  let total = 0, current = 0
  for (const c of s) {
    let v = 0
    switch (c) {
      case '零': v = 0; break
      case '一': v = 1; break
      case '二': v = 2; break
      case '三': v = 3; break
      case '四': v = 4; break
      case '五': v = 5; break
      case '六': v = 6; break
      case '七': v = 7; break
      case '八': v = 8; break
      case '九': v = 9; break
      case '十': v = current === 0 ? 10 : current * 10; break
      case '百': v = current * 100; break
      case '千': v = current * 1000; break
      default: v = 0
    }
    if (c === '十' || c === '百' || c === '千') {
      total += v
      current = 0
    } else {
      current = v
    }
  }
  return total + current
}

// HTML 转段落（移植 docx.rs parse_html）
export function htmlToParagraphs(html: string): { paragraphs: string[]; images: string[] } {
  const paragraphs: string[] = []
  const images: string[] = []
  if (!html.toLowerCase().includes('<p')) {
    const plain = stripTags(html)
    return {
      paragraphs: plain.split('\n').map(s => s.trim()).filter(s => s.length > 0),
      images: []
    }
  }
  let current = ''
  let inP = false
  let i = 0
  while (i < html.length) {
    if (html[i] === '<' && html[i + 1] === 'p') {
      const next = html[i + 2] || '>'
      if (next === '>' || next === ' ') {
        inP = true
        while (i < html.length && html[i] !== '>') i++
        i++
        continue
      }
    }
    if (html[i] === '<' && html[i + 1] === '/' && html[i + 2] === 'p' && html[i + 3] === '>') {
      inP = false
      const text = stripTags(current).trim()
      if (text) paragraphs.push(text)
      current = ''
      i += 4
      continue
    }
    if (html[i] === '<' && html[i + 1] === 'i' && html[i + 2] === 'm' && html[i + 3] === 'g') {
      let end = i
      while (end < html.length && html[end] !== '>') end++
      const imgTag = html.slice(i, end)
      const b64Idx = imgTag.indexOf('base64,')
      if (b64Idx >= 0) {
        const after = imgTag.slice(b64Idx + 7)
        const b64 = after.split(/["\s]/)[0]
        if (b64) {
          images.push(b64)
          current += `[IMG:${images.length - 1}]`
        }
      }
      i = end
      continue
    }
    if (inP) current += html[i]
    i++
  }
  if (paragraphs.length === 0 && current.trim()) {
    for (const line of stripTags(current).split('\n')) {
      const t = line.trim()
      if (t) paragraphs.push(t)
    }
  }
  return { paragraphs, images }
}

function stripTags(s: string): string {
  let out = ''
  let inTag = false
  for (const c of s) {
    if (c === '<') inTag = true
    else if (c === '>') inTag = false
    else if (!inTag) out += c
  }
  return out
}

// === 主解析（移植 structure.rs parse_questions） ===
// 支持：章节/小节跟踪 + 答案区识别 + 答案回填
export function parseQuestions(paragraphs: string[]): ParsedQuestion[] {
  const questions: ParsedQuestion[] = []
  // 题目元信息（chapter, section, original_num）与 questions 一一对应
  const questionsMeta: { chapter: number; section: number; num: number }[] = []
  let chapter = 0
  let section = 0
  let blocks: string[] = []
  let sourceIndex = 0
  let inAnswerSection = false
  // 答案表：key = "ch:sec:num"，避免多章节题号重复串扰
  const answerMap = new Map<string, string>()
  // 当前题的原始题号（题号行解析，可能每章重复）
  let currentNum = 0

  const pushQuestion = () => {
    const pq = buildQuestion(blocks, sourceIndex, chapter, section)
    if (pq) {
      // 题型完全由内容判定（对齐原版 structure.rs：build_question 用 detect_type 独立判定）
      // 小节标题只影响答案 key 的 section，不强制题型（原网页版强行强制导致跨小节误判）
      questions.push(pq)
      questionsMeta.push({ chapter, section, num: currentNum })
      sourceIndex++
    }
    blocks = []
  }

  const flush = () => {
    if (blocks.length > 0) pushQuestion()
  }

  for (const line of paragraphs) {
    const t = line.trim()
    if (!t) continue

    // 章节标题（题目区和答案区都要检测，答案区也按章节分组）
    const ch = t.match(RE_CHAPTER)
    if (ch && t.length < 50) {
      flush()
      chapter = parseChineseNum(ch[1])
      section = 0
      // 章节切换不影响 inAnswerSection（答案区可能跨章节）
      continue
    }
    // 导论
    if (RE_INTRO.test(t)) {
      flush()
      chapter = 0
      section = 0
      continue
    }
    // 小节标题（section 语义对齐 Rust：1=单选 2=多选 3=判断，0=未知）
    const sec = t.match(RE_SECTION)
    if (sec) {
      flush()
      if (sec[1].includes('判断')) section = 3
      else if (sec[1].includes('多选')) section = 2
      else section = 1
      continue
    }
    const secSolo = t.match(RE_SECTION_SOLO)
    if (secSolo) {
      flush()
      if (secSolo[1].includes('判断')) section = 3
      else if (secSolo[1].includes('多选')) section = 2
      else section = 1
      continue
    }

    // === 答案区识别（移植 structure.rs） ===
    if (!inAnswerSection) {
      // 答案区标题：行含"答案"关键词且非内联答案（"答案：A" 是内联，不进答案区）
      if (isAnswerHeader(t)) {
        flush()
        inAnswerSection = true
        continue
      }
      // 启发式：无标题但直接是答案行（如 "1-5 ABCCA" / "1.ABC"），≥2 个答案时进答案区
      const tmp = new Map<string, string>()
      if (extractAnswers(t, chapter, section, tmp)) {
        const count = tmp.size
        const hasChinese = /[\u4e00-\u9fff]/.test(t)
        if (count >= 2 || (count >= 1 && !hasChinese)) {
          flush()
          answerMap.clear()
          for (const [k, v] of tmp) answerMap.set(k, v)
          inAnswerSection = true
          continue
        }
      }
    } else {
      // === 答案区内 ===
      // 跨段落 range 合并：上一段是纯 range（如 "1-5"），当前段是纯答案（如 "CDBAC"）
      // —— 简化版：单段内能提取就提取，提取不到跳过
      if (extractAnswers(t, chapter, section, answerMap)) {
        continue
      }
      if (t === '.' || t === ',' || t === '、' || t === '．' || t === '：') continue
      // 非答案行：若为新题号则答案区结束，重新开始题目解析
      const numMatch = t.match(RE_NUM_START)
      if (numMatch) {
        inAnswerSection = false
        currentNum = parseInt(numMatch[1], 10)
        flush()
        blocks = [t]
        continue
      }
      // 其余行（如解析文字）忽略，留在答案区
      continue
    }

    // 新题开始（以数字开头）
    const numMatch = t.match(RE_NUM_START)
    if (numMatch) {
      flush()
      currentNum = parseInt(numMatch[1], 10)
      blocks = [t]
      continue
    }

    // 答案/解析/选项等归属当前题
    if (blocks.length > 0) {
      blocks.push(t)
    } else if (RE_ANS.test(t) || RE_ANA.test(t)) {
      // 游离答案/解析，开启新块
      blocks = [t]
    }
  }
  flush()

  // === 回填缺失答案（对齐 structure.rs：按 (chapter, section, num) 精确匹配） ===
  let filled = 0
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    if (q.answer) continue
    const meta = questionsMeta[i]
    // 精确匹配 (chapter, section, num)
    let ans = answerMap.get(`${meta.chapter}:${meta.section}:${meta.num}`)
    // 题目区 section 未被识别（section=0）时，跨 section 查找同 chapter 同 num
    if (!ans && meta.section === 0) {
      const candidates: { sec: number; ans: string }[] = []
      for (const [k, v] of answerMap) {
        const [c, s, n] = k.split(':').map(Number)
        if (c === meta.chapter && n === meta.num && s !== 0) candidates.push({ sec: s, ans: v })
      }
      if (candidates.length === 1) ans = candidates[0].ans
      else if (candidates.length > 1) {
        // 多候选：无选项 → sec=3（判断题）；有选项 → 单选(1) 优先，其次多选(2)
        const preferred = q.options.length === 0 ? 3 : 1
        const hit = candidates.find(c => c.sec === preferred) || candidates.find(c => c.sec === 2)
        if (hit) ans = hit.ans
      }
    }
    if (ans) {
      q.answer = normalizeAnswer(ans)
      // 回填后重判题型（判断题答案 true/false → judge，选择题答案多字母 → multi）
      const detected = detectType(q.stem, q.options, q.answer)
      if (detected !== q.type) q.type = detected
      filled++
    }
  }
  if (filled > 0) console.log(`[parser] 答案回填 ${filled}/${questions.length} 题`)

  return questions
}

// === 答案区工具（对齐 structure.rs） ===

// 答案区标题：行含"答案"关键词，且非内联答案（"答案：A" 不算）、非题号行
function isAnswerHeader(line: string): boolean {
  const lower = line.toLowerCase()
  const hasKw = lower.includes('参考答案') || lower.includes('标准答案')
    || lower.includes('正确答案') || lower.includes('试题答案')
    || lower.includes('答案') || lower.includes('answer')
  if (!hasKw) return false
  // 内联答案："答案：A"（after 含字母/判断词）→ 不算标题
  const ansMatch = line.match(RE_ANS)
  if (ansMatch) {
    const after = ansMatch[2].trim()
    if (/[A-Za-z0-9\u4e00-\u9fff]/.test(after) || RE_JUDGE_WORD.test(after)) return false
  }
  // 题号行："1. 答案是..." → 不算标题
  if (RE_NUM_START.test(line)) return false
  return true
}

// 从一行提取答案，写入 map（key = "ch:sec:num"）。支持 range 和逐题格式。
// 返回是否提取到任何答案。
function extractAnswers(line: string, chapter: number, section: number, map: Map<string, string>): boolean {
  const t = line.trim()
  if (!t) return false
  let found = false

  // range 格式：1-5 ABCCA / 1—5 对对对对对 / 1-5 ABCCA 6-10 BBDCC
  // RE_RANGE 非 global，matchAll 需要 global 正则，这里动态创建
  const reRangeGlobal = new RegExp(RE_RANGE.source, 'g')
  const rangeMatches = Array.from(t.matchAll(reRangeGlobal))
  for (let i = 0; i < rangeMatches.length; i++) {
    const m = rangeMatches[i]
    const startNum = parseInt(m[1], 10)
    const endNum = parseInt(m[2], 10)
    if (endNum < startNum || Number.isNaN(startNum) || Number.isNaN(endNum)) continue
    const expected = endNum - startNum + 1
    // 答案文本：从 range 结束到下一个 range 开始（或行尾）
    const ansStart = (m.index ?? 0) + m[0].length
    const ansEnd = i + 1 < rangeMatches.length ? (rangeMatches[i + 1].index ?? 0) : t.length
    const ansText = t.slice(ansStart, ansEnd).trim()
    // 按 section 类型分割答案
    let answers: string[]
    if (section === 3) {
      answers = ansText.match(/正确|错误|对|错|√|×|true|false/gi) || []
    } else if (section === 1 || section === 2) {
      answers = (ansText.match(/[A-Ha-h]/g) || []).map(c => c.toUpperCase())
    } else {
      // 未知 section：先试字母，数量够就截取；否则判断词
      const letters = (ansText.match(/[A-Ha-h]/g) || []).map(c => c.toUpperCase())
      answers = letters.length >= expected ? letters : (ansText.match(/正确|错误|对|错|√|×|true|false/gi) || [])
    }
    if (answers.length < expected) continue
    for (let k = 0; k < expected; k++) {
      map.set(`${chapter}:${section}:${startNum + k}`, answers[k])
    }
    found = true
  }

  // 逐题格式：1. A / 1.(A) / 2. AC / 3. 正确（跳过被 range 覆盖的题号）
  const coveredNums = new Set<number>()
  for (const m of t.matchAll(reRangeGlobal)) {
    const s = parseInt(m[1], 10), e = parseInt(m[2], 10)
    if (!Number.isNaN(s) && !Number.isNaN(e)) for (let n = s; n <= e; n++) coveredNums.add(n)
  }
  for (const m of t.matchAll(new RegExp(RE_ANS_EXTRACT.source, 'g'))) {
    const num = parseInt(m[1], 10)
    if (Number.isNaN(num) || coveredNums.has(num)) continue
    map.set(`${chapter}:${section}:${num}`, m[2].trim())
    found = true
  }
  return found
}

// 归一化答案（对齐 Rust normalize_answer）
export function normalizeAnswer(ans: string): string {
  const trimmed = ans.trim()
  // 判断题归一 true/false
  if (JUDGE_TRUE.has(trimmed) || JUDGE_FALSE.has(trimmed)) return normalizeJudgeAnswer(trimmed)
  // 多选答案 AC / A、C / A,C / ["A","C"] → 紧凑格式
  const letters = (trimmed.match(/[A-Ha-h]/g) || []).map(c => c.toUpperCase())
  if (letters.length > 1) return letters.join('')
  return trimmed
}

// 类型检测（对齐 Rust detect_type）
export function detectType(stem: string, options: string[], answer: string | null): QType {
  if (options.length === 0) {
    // 判断题：答案为 true/false → 一定是判断题（必须在填空检测之前）
    if (answer && (answer === 'true' || answer === 'false')) return 'judge'
    // 填空：题干含 ___ 或 （ ） 或 【 】
    if (RE_BLANK.test(stem)) return 'blank'
    // 判断题：答案为其他判断词
    if (answer && isJudgeAnswer(answer)) return 'judge'
    return 'qa'
  }
  // 选择题：按答案字母数区分单选/多选
  if (answer) {
    const letters = (answer.match(/[A-H]/gi) || []).map(c => c.toUpperCase())
    if (letters.length > 1) return 'multi'
  }
  return 'single'
}

// 构建单题（移植 structure.rs build_question）
function buildQuestion(blocks: string[], sourceIndex: number, chapter: number, section: number): ParsedQuestion | null {
  if (blocks.length === 0) return null
  let stem = ''
  const options: string[] = []
  let answer: string | null = null
  let analysis: string | null = null

  let i = 0
  // 处理题干（可能是多行）
  while (i < blocks.length) {
    const line = blocks[i]
    const optMatch = line.match(RE_OPT)
    if (optMatch) break
    const ansMatch = line.match(RE_ANS)
    if (ansMatch) break
    const anaMatch = line.match(RE_ANA)
    if (anaMatch) break
    // 题干（去掉题号前缀）
    const stripped = line.replace(RE_NUM_STRIP, '$1')
    stem = stem ? stem + stripped : stripped
    i++
  }

  // 选项
  let inOptions = false
  while (i < blocks.length) {
    const line = blocks[i]
    const optMatch = line.match(RE_OPT)
    if (optMatch) {
      inOptions = true
      options.push(`${optMatch[1]}. ${optMatch[2]}`)
      i++
      continue
    }
    const ansMatch = line.match(RE_ANS)
    if (ansMatch) {
      answer = ansMatch[2]
      i++
      continue
    }
    const anaMatch = line.match(RE_ANA)
    if (anaMatch) {
      analysis = anaMatch[2]
      i++
      continue
    }
    if (inOptions) {
      // 选项续行
      const lastIdx = options.length - 1
      if (lastIdx >= 0) options[lastIdx] += line
    }
    i++
  }

  if (!stem && options.length === 0) return null

  // === 类型识别（对齐 Rust structure.rs detect_type） ===
  // BUG-001 修复：原实现把 RE_BLANK 放第一位，判断题题干结尾的"（ ）"空括号
  // 直接命中 blank → 所有判断题被误判为填空。正确顺序：
  // 1) 无选项时：判断题答案(true/false) → 填空(题干空括号) → 判断题其他判断词 → 问答
  // 2) 有选项时：选择题按答案字母数区分单选/多选，不查题干空括号
  let qType: QType = 'single'
  // 判断题选项（A.正确 B.错误）先识别：选项式判断题不该被 blank 抢占
  if (options.length === 2 && options.every(o => RE_JUDGE_OPT.test(o))) {
    qType = 'judge'
    // 选项式判断题答案：从选项字母提取（A=正确, B=错误 → 转 true/false）
    if (answer && /^[A-B]$/i.test(answer.trim())) {
      answer = answer.trim() === 'A' || answer.trim() === 'a' ? 'true' : 'false'
    } else if (answer && isJudgeAnswer(answer)) {
      answer = normalizeJudgeAnswer(answer)
    }
  } else if (options.length === 0) {
    // 无选项：判断题答案优先（判断词精确匹配，对齐 Rust is_judge_answer）
    if (answer && isJudgeAnswer(answer)) {
      qType = 'judge'
      answer = normalizeJudgeAnswer(answer)
    }
    // 填空：题干含 ___ 或 （ ） 或 【 】（判断题题干也常带空括号，但判断题答案已在上面拦截）
    else if (RE_BLANK.test(stem)) qType = 'blank'
    // 其他判断词（尚未归一化的对/错/√/×）
    else if (answer && RE_JUDGE_WORD.test(answer)) qType = 'judge'
    else qType = 'qa'
  } else {
    // 选择题：从题干括号提取答案（如"（A）..."，仅当题干非空括号）
    if (!answer) {
      const paren = stem.match(RE_PAREN_ANS)
      if (paren) {
        answer = paren[1].toUpperCase()
        stem = stem.replace(RE_PAREN_ANS, '')
      }
    }
    // 多选判断：答案含 2+ 字母 → multi；否则 single
    if (answer) {
      const letters = answer.match(/[A-H]/gi)
      qType = letters && letters.length > 1 ? 'multi' : 'single'
    }
  }

  // 答案归一化（对齐 Rust normalize_answer）
  if (answer) {
    if (qType === 'judge') answer = normalizeJudgeAnswer(answer)
    else if (qType === 'multi' || qType === 'single') answer = normalizeChoiceAnswer(answer)
  }

  // 小节类型兜底（对齐原版"小节声明题型"语义，但只在内容无法判定时生效）：
  // 判断题小节内的题（如"三、判断题"下无空括号无判断词答案的陈述句）→ judge
  // 单选/多选小节内无选项无答案的题 → 对应类型
  if (qType === 'qa' && section >= 1 && section <= 3) {
    qType = section === 1 ? 'single' : section === 2 ? 'multi' : 'judge'
  }

  // 置信度
  let confidence = 0.9
  if (options.length === 0 && !answer) confidence = 0.6
  else if (qType === 'qa') confidence = 0.7

  return {
    type: qType,
    stem: stem.trim(),
    options,
    answer: answer?.trim() || null,
    analysis: analysis?.trim() || null,
    source_index: sourceIndex,
    confidence,
    chapter,
    section
  }
}

// 从 HTML 直接解析（pipeline.rs html_to_questions 的 JS 版）
export function parseHtml(html: string, bankId: number): any[] {
  const { paragraphs } = htmlToParagraphs(html)
  const parsed = parseQuestions(paragraphs)
  return parsed.map(pq => ({
    bank_id: bankId,
    type: pq.type,
    stem: pq.stem,
    options: pq.options.length > 0 ? JSON.stringify(pq.options) : null,
    answer: pq.answer,
    analysis: pq.analysis,
    source_index: pq.source_index,
    confidence: pq.confidence
  }))
}

// 纯文本导入（TXT/MD）：每行转 <p> 后复用解析
export function parseText(text: string, bankId: number): any[] {
  const html = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('\n')
  return parseHtml(html, bankId)
}
