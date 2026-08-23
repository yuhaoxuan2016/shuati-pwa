<template>
  <div class="exam-create">
    <button class="back-btn" @click="$router.push('/exams')">← 返回考试列表</button>

    <!-- 模式切换 -->
    <div class="mode-tabs">
      <button class="mode-tab" :class="{ active: createMode === 'manual' }" @click="createMode = 'manual'">📝 手动创建</button>
      <button class="mode-tab" :class="{ active: createMode === 'template' }" @click="createMode = 'template'">📋 模板生成</button>
      <button class="mode-tab" :class="{ active: createMode === 'compose' }" @click="createMode = 'compose'">🎲 智能组卷</button>
    </div>

    <!-- ===== 手动创建 ===== -->
    <template v-if="createMode === 'manual'">
    <h2>创建考试</h2>
    <p class="sub">从题库抽题生成考试，创建后可复制链接分享给考生</p>

    <div class="form-card">
      <div class="field">
        <label>考试名称 *</label>
        <input v-model="title" placeholder="例如：期中模拟考试" />
      </div>
      <div class="field">
        <label>考试说明</label>
        <textarea v-model="description" placeholder="可选，例如：共 40 题，请认真作答" rows="2"></textarea>
      </div>
      <div class="field">
        <label>创建人（可选，显示在考试卡片上）</label>
        <input v-model="creatorName" placeholder="例如：rabbit" />
      </div>
      <div class="field">
        <label>考试时长（分钟）</label>
        <input type="number" v-model.number="durationMinutes" min="1" max="300" />
      </div>
      <div class="field">
        <label>可见范围</label>
        <div class="vis-options">
          <label class="vis-option" :class="{ active: visibility === 'public' }" @click="visibility = 'public'">
            <span class="vis-radio">🌍</span>
            <div>
              <div class="vis-name">公共考试</div>
              <div class="vis-desc">所有人可见，任何人可进入答题</div>
            </div>
          </label>
          <label class="vis-option" :class="{ active: visibility === 'private' }" @click="visibility = 'private'">
            <span class="vis-radio">🔒</span>
            <div>
              <div class="vis-name">自建考试</div>
              <div class="vis-desc">仅自己可见，适合内部测试</div>
            </div>
          </label>
        </div>
      </div>
      <div class="field">
        <label>答题选项</label>
        <div class="opt-options">
          <label class="opt-option" :class="{ active: shuffleOptions }" @click="shuffleOptions = true">
            <span class="opt-radio">🔀</span>
            <div>
              <div class="opt-name">选项乱序</div>
              <div class="opt-desc">选择题选项随机排列，防背答案顺序（判断题不受影响）</div>
            </div>
          </label>
          <label class="opt-option" :class="{ active: !shuffleOptions }" @click="shuffleOptions = false">
            <span class="opt-radio">📋</span>
            <div>
              <div class="opt-name">保持原顺序</div>
              <div class="opt-desc">选项按题目录入顺序展示</div>
            </div>
          </label>
        </div>
      </div>

      <div class="field">
        <label>截止时间（可选，到点后考生无法再答题）</label>
        <input type="datetime-local" v-model="deadline" />
        <p v-if="deadline" class="hint">⏰ {{ deadlineText }}</p>
      </div>

      <div class="field">
        <label>抽题来源（选择题库并设置每题抽几道）</label>
        <div class="bank-tabs">
          <button class="bank-tab" :class="{ active: bankTab === 'mine' }" @click="switchTab('mine')">我的题库</button>
          <button class="bank-tab" :class="{ active: bankTab === 'public' }" @click="switchTab('public')">🌍 公共题库</button>
        </div>

        <label class="type-mix-toggle">
          <input type="checkbox" v-model="useTypeMix" />
          <span>按题型配比抽题（每个题库分别设置）</span>
        </label>
        <p v-if="useTypeMix" class="hint">勾选题库后在下方为每个题库分别填写各题型数量</p>

        <div v-if="loadingBanks" class="hint">加载题库中...</div>
        <div v-else-if="!allBanks.length" class="hint warn">{{ bankTab === 'mine' ? '还没有题库，请先到首页创建并导入题目' : '暂无公共题库' }}</div>
        <div v-else class="pool-list">
          <div v-for="b in allBanks" :key="bankKey(b)" class="pool-item" :class="{ 'has-types': useTypeMix && poolIds.includes(bankKey(b)) }">
            <div class="pool-info" @click="togglePool(bankKey(b))">
              <span class="pool-check">{{ poolIds.includes(bankKey(b)) ? '☑' : '☐' }}</span>
              <div>
                <div class="pool-name">{{ b.name }}</div>
                <div class="pool-count">{{ b.question_count || b.count || 0 }} 道题<span v-if="b.creator_name"> · 👤 {{ b.creator_name }}</span></div>
              </div>
            </div>
            <div class="pool-config" v-if="!useTypeMix" @click.stop>
              <input type="number" class="count-input" :min="1" :max="b.question_count || b.count || 1"
                :value="poolCounts[bankKey(b)] ?? 0" :disabled="!poolIds.includes(bankKey(b))"
                @input="onCount(b, ($event.target as HTMLInputElement).value)" />
              <span class="count-max">/ {{ b.question_count || b.count || 0 }}</span>
            </div>
            <!-- 按题型配比：每个题库分别设置各题型数量 -->
            <div v-if="useTypeMix && poolIds.includes(bankKey(b))" class="pool-types" @click.stop>
              <div class="pt-field">
                <label>单选</label>
                <input type="number" v-model.number="bankTypesOf(bankKey(b)).single" min="0" max="500" class="pt-input" />
              </div>
              <div class="pt-field">
                <label>多选</label>
                <input type="number" v-model.number="bankTypesOf(bankKey(b)).multi" min="0" max="500" class="pt-input" />
              </div>
              <div class="pt-field">
                <label>判断</label>
                <input type="number" v-model.number="bankTypesOf(bankKey(b)).judge" min="0" max="500" class="pt-input" />
              </div>
              <span class="pt-subtotal">{{ bankTypeTotal(bankKey(b)) }} 题</span>
            </div>
          </div>
        </div>
        <p v-if="poolIds.length" class="pool-total">{{ useTypeMix ? '按题型共抽' : '共抽' }} <b>{{ totalCount }}</b> 题</p>
      </div>

      <div class="actions">
        <button class="submit-btn" :disabled="!canCreate" @click="create">
          🎯 创建考试
        </button>
      </div>
    </div>
    </template>

    <!-- ===== 模板生成 ===== -->
    <template v-else-if="createMode === 'template'">
    <h2>📋 模板生成考试</h2>
    <p class="sub">按智能组卷模板一键生成 220 题正式考试（5 等级 × 3 题型），创建后可复制链接/查询码分享给考生</p>

    <div class="form-card">
      <div class="field">
        <label>考试名称 *</label>
        <input v-model="title" placeholder="例如：2026年度综合考试" />
      </div>
      <div class="field">
        <label>考试说明</label>
        <textarea v-model="description" placeholder="可选，例如：共 220 题，请认真作答" rows="2"></textarea>
      </div>
      <div class="field">
        <label>创建人（可选，显示在考试卡片上）</label>
        <input v-model="creatorName" placeholder="例如：rabbit" />
      </div>
      <div class="field">
        <label>考试时长（分钟）</label>
        <input type="number" v-model.number="durationMinutes" min="1" max="300" />
      </div>
      <div class="field">
        <label>可见范围</label>
        <div class="vis-options">
          <label class="vis-option" :class="{ active: visibility === 'public' }" @click="visibility = 'public'">
            <span class="vis-radio">🌍</span>
            <div>
              <div class="vis-name">公共考试</div>
              <div class="vis-desc">所有人可见，任何人可进入答题</div>
            </div>
          </label>
          <label class="vis-option" :class="{ active: visibility === 'private' }" @click="visibility = 'private'">
            <span class="vis-radio">🔒</span>
            <div>
              <div class="vis-name">自建考试</div>
              <div class="vis-desc">仅自己可见，适合内部测试</div>
            </div>
          </label>
        </div>
      </div>
      <div class="field">
        <label>答题选项</label>
        <div class="opt-options">
          <label class="opt-option" :class="{ active: shuffleOptions }" @click="shuffleOptions = true">
            <span class="opt-radio">🔀</span>
            <div>
              <div class="opt-name">选项乱序</div>
              <div class="opt-desc">选择题选项随机排列，防背答案顺序（判断题不受影响）</div>
            </div>
          </label>
          <label class="opt-option" :class="{ active: !shuffleOptions }" @click="shuffleOptions = false">
            <span class="opt-radio">📋</span>
            <div>
              <div class="opt-name">保持原顺序</div>
              <div class="opt-desc">选项按题目录入顺序展示</div>
            </div>
          </label>
        </div>
      </div>
      <div class="field">
        <label>截止时间（可选，到点后考生无法再答题）</label>
        <input type="datetime-local" v-model="deadline" />
        <p v-if="deadline" class="hint">⏰ {{ deadlineText }}</p>
      </div>

      <!-- 配额表 -->
      <div class="quota-table">
        <div class="quota-row quota-head">
          <span>等级</span><span>单选</span><span>多选</span><span>判断</span><span>小计</span>
        </div>
        <div v-for="s in COMPOSE_SPEC" :key="s.level" class="quota-row">
          <span class="q-level">{{ s.level }}</span>
          <span>{{ s.single }}</span><span>{{ s.multi }}</span><span>{{ s.judge }}</span>
          <span class="q-subtotal">{{ s.single + s.multi + s.judge }}</span>
        </div>
        <div class="quota-row quota-total">
          <span>合计</span><span>80</span><span>40</span><span>100</span><span>220</span>
        </div>
      </div>

      <div class="actions">
        <button class="submit-btn" :disabled="!title.trim() || tplCreating" @click="createTemplateExam">
          {{ tplCreating ? '创建中…' : '🎯 一键创建考试（220 题）' }}
        </button>
      </div>
    </div>
    </template>

    <!-- ===== 智能组卷 ===== -->
    <ComposeExamView v-else />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBankStore } from '../stores/bank'
import { createExam, listPublicBanks, errMsg, COMPOSE_SPEC } from '../lib/exam'
import { toastError, toastSuccess } from '../utils/toast'
import ComposeExamView from './ComposeExamView.vue'

const router = useRouter()
const bankStore = useBankStore()
const banks = computed(() => bankStore.banks)
const publicBanks = ref<any[]>([])
const bankTab = ref<'mine' | 'public'>('mine')
const loadingBanks = ref(true)
const allBanks = computed(() => bankTab.value === 'mine' ? banks.value : publicBanks.value)

// 创建模式：手动创建 | 智能组卷
const createMode = ref<'manual' | 'template' | 'compose'>('manual')

const title = ref('')
const description = ref('')
const creatorName = ref('')
const durationMinutes = ref(60)
const deadline = ref('')
const visibility = ref<'public' | 'private'>('public')
const shuffleOptions = ref(true)   // 选项乱序开关（默认开）
const poolIds = ref<(number | string)[]>([])
const poolCounts = ref<Record<string, number>>({})
// 题库唯一标识：本地题库用数字 id，公共题库用云端 _id（字符串）
// ⚠️ 云端文档没有 id 字段（push 时被 delete），必须回退到 _id，
// 否则所有公共题库 key 相同 → 选一个全选、改一个全变
function bankKey(b: any): number | string {
  return b?.id ?? b?._id ?? b?.bank_ref ?? ''
}
// 题型配比模式：每个题库分别设置各题型数量
const useTypeMix = ref(false)
const bankTypeCounts = ref<Record<string, { single: number; multi: number; judge: number }>>({})
function bankTypesOf(key: number | string): { single: number; multi: number; judge: number } {
  const k = String(key)
  if (!bankTypeCounts.value[k]) {
    bankTypeCounts.value[k] = { single: 0, multi: 0, judge: 0 }
  }
  return bankTypeCounts.value[k]
}
function bankTypeTotal(key: number | string): number {
  const tc = bankTypeCounts.value[String(key)]
  if (!tc) return 0
  return tc.single + tc.multi + tc.judge
}

const deadlineText = computed(() => {
  if (!deadline.value) return ''
  const d = new Date(deadline.value)
  if (isNaN(d.getTime())) return ''
  return '截止 ' + d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
})

const typeTotal = computed(() => poolIds.value.reduce((s, id) => s + bankTypeTotal(id), 0))
// 配比模式：总数为各题库题型之和；自由模式：按题库数量之和
const totalCount = computed(() => useTypeMix.value
  ? typeTotal.value
  : poolIds.value.reduce((s, id) => s + (poolCounts.value[id] || 0), 0))
const canCreate = computed(() => title.value.trim().length > 0 && totalCount.value > 0)

onMounted(async () => {
  try { await bankStore.load() } catch (e) { toastError('加载题库失败') } finally { loadingBanks.value = false }
})

async function switchTab(tab: 'mine' | 'public') {
  bankTab.value = tab
  if (tab === 'public' && !publicBanks.value.length) {
    loadingBanks.value = true
    try {
      publicBanks.value = await listPublicBanks()
    } catch (e) {
      toastError('加载公共题库失败：' + errMsg(e))
    } finally {
      loadingBanks.value = false
    }
  }
}

function togglePool(id: number | string) {
  const idx = poolIds.value.indexOf(id)
  if (idx >= 0) {
    poolIds.value.splice(idx, 1)
  } else {
    poolIds.value.push(id)
    if (useTypeMix.value) {
      bankTypesOf(id) // 初始化该题库的题型计数
    } else {
      if (!poolCounts.value[id]) poolCounts.value[id] = allBanks.value.find(b => bankKey(b) === id)?.question_count || 0
    }
  }
}
function onCount(b: { id?: number | string; _id?: string; question_count?: number; count?: number }, val: string) {
  const max = b.question_count || b.count || 1
  const n = Math.max(1, Math.min(max, parseInt(val) || 0))
  poolCounts.value[bankKey(b)] = n
}

async function create() {
  if (!canCreate.value) return
  try {
    const exam = await createExam(
      title.value.trim(),
      description.value.trim(),
      durationMinutes.value,
      poolIds.value.map(id => {
        if (useTypeMix.value) {
          const tc = bankTypesOf(id)
          return { bank_id: id, counts: { single: tc.single, multi: tc.multi, judge: tc.judge } }
        }
        return { bank_id: id, count: poolCounts.value[id] || 0 }
      }),
      deadline.value ? new Date(deadline.value).toISOString() : null,
      visibility.value,
      creatorName.value || null,
      shuffleOptions.value,
    )
    toastSuccess('考试创建成功！')
    if (exam._id) {
      router.push(`/exam/${exam._id}/results`)
    } else {
      router.push('/exams')
    }
  } catch (e) {
    toastError('创建失败：' + errMsg(e))
  }
}

const tplCreating = ref(false)

async function createTemplateExam() {
  if (!title.value.trim()) return
  tplCreating.value = true
  try {
    const exam = await createExam(
      title.value.trim(),
      description.value.trim() || '智能组卷模板 · 5等级 × 3题型 = 220题',
      durationMinutes.value,
      COMPOSE_SPEC.map(s => ({
        bank_id: s.bank,
        counts: { single: s.single, multi: s.multi, judge: s.judge }
      })),
      deadline.value ? new Date(deadline.value).toISOString() : null,
      visibility.value,
      creatorName.value || null,
      shuffleOptions.value,
    )
    toastSuccess('考试创建成功！')
    if (exam._id) {
      router.push(`/exam/${exam._id}/results`)
    } else {
      router.push('/exams')
    }
  } catch (e) {
    toastError('创建失败：' + errMsg(e))
  } finally {
    tplCreating.value = false
  }
}
</script>

<style scoped>
.back-btn { padding: 6px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; margin-bottom: 16px; color: var(--color-text); }
.back-btn:hover { background: var(--color-border-light); }
.mode-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--color-border); }
.mode-tab { padding: 10px 20px; border: none; background: none; cursor: pointer; font-size: 14px; color: var(--color-text-tertiary); border-bottom: 2px solid transparent; transition: all 0.15s; font-weight: 500; }
.mode-tab:hover { color: var(--color-text-secondary); }
.mode-tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 600; }
h2 { margin: 0 0 4px 0; }
.sub { font-size: 13px; color: var(--color-text-secondary); margin: 0 0 20px 0; }
.form-card { max-width: 640px; display: flex; flex-direction: column; gap: 16px; padding: 24px; background: var(--color-card); border: 1px solid var(--color-border-light); border-radius: var(--radius-lg); }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 13px; font-weight: 600; color: var(--color-text-secondary); }
.field input, .field textarea { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-text); font-size: 14px; font-family: inherit; }
.field textarea { resize: vertical; }
.hint { font-size: 13px; color: var(--color-text-tertiary); }
.hint.warn { color: var(--color-warning); }
.bank-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
.bank-tab { padding: 5px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-card); cursor: pointer; font-size: 13px; color: var(--color-text-secondary); }
.bank-tab.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.type-mix-toggle { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 13px; font-weight: 500; color: var(--color-text); cursor: pointer; user-select: none; }
.type-mix-toggle input { accent-color: var(--color-primary); width: 15px; height: 15px; cursor: pointer; }
.type-inputs { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; background: var(--color-bg); border: 1px dashed var(--color-border); border-radius: var(--radius-md); margin-bottom: 8px; }
.type-field { display: flex; align-items: center; gap: 6px; }
.type-field label { font-size: 12px; color: var(--color-text-secondary); font-weight: 500; white-space: nowrap; }
.type-input { width: 58px; padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 13px; text-align: center; background: var(--color-card); color: var(--color-text); }
.type-total { flex-basis: 100%; font-size: 12px; color: var(--color-text-tertiary); margin-top: 2px; }
.type-total b { color: var(--color-primary); }
.pool-list { display: flex; flex-direction: column; gap: 8px; }
.pool-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.pool-item.has-types { flex-direction: column; align-items: stretch; gap: 10px; }
.pool-item:has(.pool-info:active) { border-color: var(--color-primary); }
.pool-info { display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1; }
.pool-check { font-size: 18px; color: var(--color-primary); }
.pool-name { font-size: 14px; font-weight: 500; }
.pool-count { font-size: 12px; color: var(--color-text-tertiary); }
.pool-config { display: flex; align-items: center; gap: 6px; }
.count-input { width: 60px; padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; text-align: center; background: var(--color-bg); color: var(--color-text); }
.count-input:disabled { opacity: 0.4; }
.count-max { font-size: 12px; color: var(--color-text-tertiary); }
.pool-total { font-size: 13px; color: var(--color-text-secondary); margin: 6px 0 0 0; }
.pool-total b { color: var(--color-primary); }
/* 按题型配比：每个题库的题型输入 */
.pool-types { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; background: var(--color-card); border: 1px dashed var(--color-border); border-radius: var(--radius-md); }
.pt-field { display: flex; align-items: center; gap: 5px; }
.pt-field label { font-size: 12px; color: var(--color-text-secondary); font-weight: 500; white-space: nowrap; }
.pt-input { width: 56px; padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 13px; text-align: center; background: var(--color-bg); color: var(--color-text); }
.pt-subtotal { font-size: 12px; color: var(--color-text-tertiary); margin-left: auto; font-weight: 500; }
.actions { display: flex; justify-content: flex-end; margin-top: 8px; }
.submit-btn { padding: 11px 30px; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark)); color: #fff; border: none; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; }
.submit-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4); }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.vis-options { display: flex; gap: 10px; }
.vis-option { flex: 1; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: var(--color-bg); transition: all 0.15s; }
.vis-option.active { border-color: var(--color-primary); background: var(--color-primary-light); }
.vis-radio { font-size: 20px; }
.vis-name { font-size: 14px; font-weight: 600; color: var(--color-text); }
.vis-desc { font-size: 12px; color: var(--color-text-tertiary); }
.opt-options { display: flex; gap: 10px; }
.opt-option { flex: 1; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: var(--color-bg); transition: all 0.15s; }
.opt-option.active { border-color: var(--color-primary); background: var(--color-primary-light); }
.opt-radio { font-size: 20px; }
.opt-name { font-size: 14px; font-weight: 600; color: var(--color-text); }
.opt-desc { font-size: 12px; color: var(--color-text-tertiary); }

/* 配额表（模板生成模式） */
.quota-table { border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; }
.quota-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr 1fr; padding: 10px 16px; font-size: 14px; border-bottom: 1px solid var(--color-border-light); }
.quota-row:last-child { border-bottom: none; }
.quota-head { background: var(--color-surface, #f7f8fa); font-weight: 600; font-size: 12px; color: var(--color-text-secondary); }
.q-level { font-weight: 600; }
.q-subtotal { font-weight: 600; color: var(--color-primary); }
.quota-total { background: #f0f4fa; font-weight: 600; }

/* 移动端适配 */
@media (max-width: 768px) {
  .form-card { padding: 16px; }
  .pool-item { flex-wrap: wrap; gap: 8px; }
  .pool-info { flex: 1 1 100%; }
  .pool-config { margin-left: 0; }
  .vis-options { flex-direction: column; }
  .opt-options { flex-direction: column; }
  .actions { justify-content: stretch; }
  .submit-btn { width: 100%; }
  .bank-tabs { overflow-x: auto; }
}
</style>
