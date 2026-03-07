<script setup>
import { ref, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'

const {
  getAllProfiles, createNhanVien,
  toggleUserActive, deleteUser, updateProfile,
  currentProfile
} = useAuth()

const profiles     = ref([])
const isLoading    = ref(false)
const showForm     = ref(false)
const editingId    = ref(null)   // id đang chỉnh kho
const newUser      = ref({ email: '', password: '', fullName: '', warehouse: '' })
const formError    = ref('')
const formLoading  = ref(false)

// ── Toast ──────────────────────────────────────────────────────
const toasts = ref([])
let tid = 0
const toast = (msg, type = 'success') => {
  const id = ++tid
  toasts.value.push({ id, msg, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3000)
}

// ── Load danh sách ─────────────────────────────────────────────
const load = async () => {
  isLoading.value = true
  try { profiles.value = await getAllProfiles() }
  catch (e) { toast('Lỗi tải danh sách: ' + e.message, 'error') }
  finally { isLoading.value = false }
}

// ── Tạo tài khoản ──────────────────────────────────────────────
const handleCreate = async () => {
  const { email, password, fullName } = newUser.value
  if (!email || !password || !fullName) { formError.value = 'Vui lòng nhập đủ thông tin!'; return }
  if (password.length < 6) { formError.value = 'Mật khẩu tối thiểu 6 ký tự!'; return }
  formLoading.value = true; formError.value = ''
  try {
    await createNhanVien({
      email, password, fullName,
      warehouse: newUser.value.warehouse || null
    })
    toast(`✅ Đã tạo tài khoản: ${fullName}`)
    newUser.value = { email: '', password: '', fullName: '', warehouse: '' }
    showForm.value = false
    await load()
  } catch (e) { formError.value = e.message }
  finally { formLoading.value = false }
}

// ── Khóa / Mở ──────────────────────────────────────────────────
const handleToggle = async (p) => {
  if (p.id === currentProfile.value?.id) { toast('Không thể khóa tài khoản đang dùng!', 'error'); return }
  try {
    await toggleUserActive(p.id, !p.is_active)
    p.is_active = !p.is_active
    toast(p.is_active ? '🔓 Đã mở tài khoản' : '🔒 Đã khóa tài khoản')
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// ── Lưu kho ────────────────────────────────────────────────────
const handleSaveWarehouse = async (p) => {
  try {
    await updateProfile(p.id, { warehouse: p.warehouse || null })
    toast('✅ Đã cập nhật kho!')
    editingId.value = null
  } catch (e) { toast('Lỗi: ' + e.message, 'error') }
}

// ── Xóa ────────────────────────────────────────────────────────
const handleDelete = async (p) => {
  if (p.id === currentProfile.value?.id) { toast('Không thể xóa tài khoản đang dùng!', 'error'); return }
  if (!confirm(`Xóa tài khoản "${p.full_name}" (${p.email})?`)) return
  try { await deleteUser(p.id); toast('Đã xóa!'); await load() }
  catch (e) { toast('Lỗi xóa: ' + e.message, 'error') }
}

const whLabel = (w) => w === 'TDP' ? '🏭 TDP' : w === 'NV' ? '🏭 NV' : '🔓 Cả 2 kho'

onMounted(load)
</script>

<template>
  <div class="ap">

    <!-- Toast -->
    <div class="toast-stack">
      <div v-for="t in toasts" :key="t.id" :class="['t-item', `t-${t.type}`]">{{ t.msg }}</div>
    </div>

    <!-- Header -->
    <div class="ap-header">
      <h3 class="ap-title">👥 Quản lý tài khoản</h3>
      <button class="btn-new" @click="showForm = true; formError = ''">+ Tạo tài khoản</button>
    </div>

    <!-- Danh sách -->
    <div v-if="isLoading" class="ap-loading">
      <div class="spinner-border text-primary"></div>
    </div>

    <div v-else class="ap-list">
      <div v-for="p in profiles" :key="p.id"
        :class="['ap-card', { 'ap-card--inactive': !p.is_active }]">

        <!-- Avatar + Info -->
        <div class="ap-info">
          <div class="ap-avatar">{{ (p.full_name?.[0] || p.email[0]).toUpperCase() }}</div>
          <div class="ap-detail">
            <div class="ap-name">
              {{ p.full_name || '(chưa đặt tên)' }}
              <span v-if="p.id === currentProfile?.id" class="chip chip-me">Bạn</span>
              <span v-if="!p.is_active" class="chip chip-locked">🔒 Bị khóa</span>
            </div>
            <div class="ap-email">{{ p.email }}</div>
            <div class="ap-meta">
              <!-- Role badge -->
              <span :class="['chip', p.role === 'admin' ? 'chip-admin' : 'chip-nv']">
                {{ p.role === 'admin' ? '👑 Admin' : '👷 Nhân viên' }}
              </span>
              <!-- Kho (chỉ nhân viên) -->
              <template v-if="p.role === 'nhanvien'">
                <span v-if="editingId !== p.id"
                  class="chip chip-wh" @click="editingId = p.id">
                  {{ whLabel(p.warehouse) }} ✏️
                </span>
                <span v-else class="wh-edit">
                  <select v-model="p.warehouse" class="wh-sel">
                    <option value="">Cả 2 kho</option>
                    <option value="TDP">Kho TDP</option>
                    <option value="NV">Kho NV</option>
                  </select>
                  <button class="btn-ok" @click="handleSaveWarehouse(p)">✓</button>
                  <button class="btn-cx" @click="editingId = null">✕</button>
                </span>
              </template>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="ap-actions">
          <button v-if="p.id !== currentProfile?.id"
            :class="['btn-toggle', p.is_active ? 'btn-toggle--lock' : 'btn-toggle--unlock']"
            @click="handleToggle(p)">
            {{ p.is_active ? '🔒 Khóa' : '🔓 Mở' }}
          </button>
          <button v-if="p.role !== 'admin'"
            class="btn-del" @click="handleDelete(p)" title="Xóa">🗑️</button>
        </div>
      </div>

      <div v-if="profiles.length === 0" class="ap-empty">Chưa có tài khoản nào</div>
    </div>

    <!-- MODAL TẠO TÀI KHOẢN -->
    <div v-if="showForm" class="modal-ov" @click.self="showForm = false">
      <div class="modal-box">
        <div class="modal-hd">
          <h5>Tạo tài khoản nhân viên</h5>
          <button @click="showForm = false" class="modal-x">✕</button>
        </div>
        <div class="modal-bd">
          <div class="fg">
            <label>Họ tên <span class="req">*</span></label>
            <input v-model="newUser.fullName" type="text" class="fi" placeholder="VD: Nguyễn Văn A">
          </div>
          <div class="fg">
            <label>Email <span class="req">*</span></label>
            <input v-model="newUser.email" type="email" class="fi" placeholder="nhanvien@email.com">
          </div>
          <div class="fg">
            <label>Mật khẩu <span class="req">*</span></label>
            <input v-model="newUser.password" type="password" class="fi" placeholder="Tối thiểu 6 ký tự">
          </div>
          <div class="fg">
            <label>Phân kho mặc định</label>
            <select v-model="newUser.warehouse" class="fi">
              <option value="">Xem cả 2 kho</option>
              <option value="TDP">Kho TDP</option>
              <option value="NV">Kho NV</option>
            </select>
            <small class="hint">Nhân viên vẫn xem được cả 2 kho, đây chỉ là kho mặc định khi login</small>
          </div>
          <div v-if="formError" class="form-err">⚠️ {{ formError }}</div>
        </div>
        <div class="modal-ft">
          <button @click="showForm = false" class="btn-sec">Hủy</button>
          <button @click="handleCreate" class="btn-pri" :disabled="formLoading">
            <span v-if="formLoading" class="spin-sm"></span>
            {{ formLoading ? 'Đang tạo...' : 'Tạo tài khoản' }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Mobile */
@media (max-width: 480px) {
  .ap-card { flex-wrap: wrap; padding: 0.75rem; }
  .ap-info { flex: 1 1 100%; }
  .ap-actions { flex: 1 1 100%; justify-content: flex-end; margin-top: 0.4rem; border-top: 1px solid #e2e8f0; padding-top: 0.4rem; }
  .ap-email { max-width: 180px; }
  .ap-avatar { width: 34px; height: 34px; font-size: 0.9rem; }
  .ap-name { font-size: 0.88rem; }
  .btn-toggle { font-size: 0.75rem; padding: 0.3rem 0.55rem; }
  .ap-title { font-size: 0.95rem; }
  .btn-new { font-size: 0.8rem; padding: 0.45rem 0.8rem; }
}

/* Toast */
.toast-stack { position: fixed; top: 5rem; right: 1rem; z-index: 9999; display: flex; flex-direction: column; gap: 0.4rem; }
.t-item { padding: 0.65rem 1rem; border-radius: 10px; font-weight: 600; font-size: 0.88rem; color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: tin .3s ease; }
.t-success { background: #10b981; }
.t-error   { background: #ef4444; }
@keyframes tin { from { opacity:0; transform:translateX(30px); } to { opacity:1; transform:none; } }

/* Panel */
.ap { padding: 0; }
.ap-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.1rem; }
.ap-title  { font-weight: 700; font-size: 1.05rem; color: #1e293b; margin: 0; }
.btn-new   { background: #3b82f6; color: #fff; border: none; border-radius: 10px; padding: 0.55rem 1rem; font-weight: 600; font-size: 0.88rem; cursor: pointer; transition: all .2s; }
.btn-new:hover { background: #2563eb; transform: translateY(-1px); }
.ap-loading { text-align: center; padding: 2rem; }
.ap-list  { display: flex; flex-direction: column; gap: 0.65rem; }
.ap-empty { text-align: center; color: #94a3b8; padding: 2rem; }

/* Card */
.ap-card {
  display: flex; justify-content: space-between; align-items: center;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px;
  padding: 0.9rem 1.1rem; gap: 0.75rem; transition: border-color .2s;
}
.ap-card:hover { border-color: #93c5fd; }
.ap-card--inactive { opacity: 0.55; background: #fef2f2; border-color: #fecaca; }

/* Info */
.ap-info   { display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0; }
.ap-avatar {
  width: 40px; height: 40px; flex-shrink: 0; border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 1.05rem;
}
.ap-detail { min-width: 0; }
.ap-name   { font-weight: 700; color: #1e293b; font-size: 0.93rem; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.ap-email  { color: #64748b; font-size: 0.8rem; margin: 0.1rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ap-meta   { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.25rem; }

/* Chips */
.chip        { padding: 0.18rem 0.55rem; border-radius: 7px; font-size: 0.75rem; font-weight: 600; }
.chip-admin  { background: #fef3c7; color: #92400e; }
.chip-nv     { background: #dbeafe; color: #1d4ed8; }
.chip-me     { background: #d1fae5; color: #065f46; }
.chip-locked { background: #fee2e2; color: #991b1b; }
.chip-wh     { background: #f0fdf4; color: #166534; border: 1px dashed #86efac; cursor: pointer; }
.chip-wh:hover { background: #dcfce7; }

/* Warehouse edit inline */
.wh-edit  { display: flex; align-items: center; gap: 0.25rem; }
.wh-sel   { font-size: 0.78rem; padding: 0.2rem 0.35rem; border-radius: 6px; border: 1px solid #d1d5db; }
.btn-ok   { background: #10b981; color: #fff; border: none; border-radius: 5px; padding: 0.2rem 0.45rem; cursor: pointer; font-size: 0.82rem; }
.btn-cx   { background: #6b7280; color: #fff; border: none; border-radius: 5px; padding: 0.2rem 0.45rem; cursor: pointer; font-size: 0.82rem; }

/* Actions */
.ap-actions { display: flex; gap: 0.4rem; align-items: center; flex-shrink: 0; }
.btn-toggle         { border: none; border-radius: 8px; padding: 0.38rem 0.7rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all .2s; }
.btn-toggle--lock   { background: #fee2e2; color: #991b1b; }
.btn-toggle--lock:hover   { background: #fca5a5; }
.btn-toggle--unlock { background: #d1fae5; color: #065f46; }
.btn-toggle--unlock:hover { background: #a7f3d0; }
.btn-del  { background: none; border: none; font-size: 1.05rem; cursor: pointer; opacity: 0.45; padding: 0.2rem; transition: opacity .2s; }
.btn-del:hover { opacity: 1; }

/* Modal */
.modal-ov  { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 1rem; }
.modal-box { background: #fff; border-radius: 20px; width: 100%; max-width: 450px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
.modal-hd  { display: flex; justify-content: space-between; align-items: center; padding: 1.1rem 1.4rem; border-bottom: 1px solid #e2e8f0; }
.modal-hd h5 { margin: 0; font-weight: 700; font-size: 0.98rem; }
.modal-x   { background: none; border: none; font-size: 1.05rem; cursor: pointer; color: #64748b; }
.modal-bd  { padding: 1.3rem 1.4rem; }
.modal-ft  { padding: 0.9rem 1.4rem; border-top: 1px solid #e2e8f0; display: flex; gap: 0.65rem; justify-content: flex-end; }

/* Form */
.fg    { margin-bottom: 0.95rem; }
.fg label { display: block; font-weight: 600; font-size: 0.85rem; color: #374151; margin-bottom: 0.35rem; }
.fi {
  width: 100%; padding: 0.65rem 0.9rem;
  border: 2px solid #e2e8f0; border-radius: 10px;
  font-size: 0.92rem; outline: none;
  transition: border-color .2s; box-sizing: border-box;
}
.fi:focus { border-color: #3b82f6; }
.hint     { color: #94a3b8; font-size: 0.76rem; margin-top: 0.25rem; display: block; }
.req      { color: #ef4444; }
.form-err { background: #fee2e2; border: 1px solid #fca5a5; color: #991b1b; padding: 0.6rem 0.85rem; border-radius: 8px; font-size: 0.85rem; margin-top: 0.5rem; }

/* Buttons */
.btn-pri { background: #3b82f6; color: #fff; border: none; border-radius: 10px; padding: 0.6rem 1.2rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.35rem; font-size: 0.9rem; }
.btn-pri:disabled { opacity: .7; cursor: not-allowed; }
.btn-sec { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.6rem 1.2rem; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
.spin-sm { width: 13px; height: 13px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>