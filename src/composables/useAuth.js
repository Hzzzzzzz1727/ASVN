// src/composables/useAuth.js
import { ref, computed } from 'vue'
import { getSupabase } from '@/lib/supabase'

const supabase = getSupabase()

// Singleton state — dùng chung toàn app
const currentUser    = ref(null)
const currentProfile = ref(null)
const isAuthLoading  = ref(true)
const lockMessage    = ref('')

export const useAuth = () => {

  // ── GETTERS ──────────────────────────────────────────────────
  const isLoggedIn  = computed(() => !!currentUser.value)
  const isAdmin     = computed(() => currentProfile.value?.role === 'admin')
  const isNhanVien  = computed(() => currentProfile.value?.role === 'nhanvien')
  const userName    = computed(() => currentProfile.value?.full_name || currentUser.value?.email || '')
  const userWarehouse = computed(() => currentProfile.value?.warehouse ?? null)

  // Quyền hạn
  const canDelete   = computed(() => isAdmin.value)
  const canExport   = computed(() => isAdmin.value)
  const canManageUsers = computed(() => isAdmin.value)

  // ── LOAD PROFILE ─────────────────────────────────────────────
  const loadProfile = async (userId) => {
    if (!userId) { currentProfile.value = null; return }
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    currentProfile.value = data ?? null
  }

  // ── INIT (gọi 1 lần trong App.vue onMounted) ─────────────────
  const initAuth = async () => {
    isAuthLoading.value = true
    const { data: { session } } = await supabase.auth.getSession()
    currentUser.value = session?.user ?? null
    if (currentUser.value) await loadProfile(currentUser.value.id)

    supabase.auth.onAuthStateChange(async (_event, session) => {
      // Nếu đang bị khóa → không xử lý state change (login() tự throw)
      if (lockMessage.value) return
      currentUser.value = session?.user ?? null
      if (currentUser.value) await loadProfile(currentUser.value.id)
      else currentProfile.value = null
    })
    isAuthLoading.value = false
  }

  // ── LOGIN ────────────────────────────────────────────────────
  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    // Kiểm tra bị khóa TRƯỚC khi để onAuthStateChange chạy
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', data.user.id).single()
    if (profile && !profile.is_active) {
      lockMessage.value = 'Tài khoản của bạn đã bị khóa, hãy liên hệ với MIH'
      await supabase.auth.signOut()
      await new Promise(r => setTimeout(r, 100))
      lockMessage.value = ''
      currentUser.value = null
      currentProfile.value = null
      throw new Error('Tài khoản của bạn đã bị khóa, hãy liên hệ với MIH')
    }
    currentUser.value = data.user
    currentProfile.value = profile
    return data
  }

  // ── LOGOUT ───────────────────────────────────────────────────
  const logout = async () => {
    await supabase.auth.signOut()
    currentUser.value    = null
    currentProfile.value = null
  }

  // ── ADMIN: Tạo tài khoản nhân viên ──────────────────────────
  // Dùng signUp thông thường — admin tạo user, user tự xác nhận email
  const createNhanVien = async ({ email, password, fullName, warehouse }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, role: 'nhanvien' }
      }
    })
    if (error) throw error

    // Chờ profile được tạo bởi trigger
    await new Promise(r => setTimeout(r, 800))

    // Cập nhật profile
    await supabase
      .from('profiles')
      .upsert({
        id: data.user.id,
        email,
        full_name: fullName,
        role: 'nhanvien',
        warehouse: warehouse || null,
        is_active: true
      })

    return data.user
  }

  // ── ADMIN: Danh sách tất cả users ───────────────────────────
  const getAllProfiles = async () => {
    const { data, error } = await supabase
      .from('profiles').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data
  }

  // ── ADMIN: Khóa / Mở tài khoản ──────────────────────────────
  const toggleUserActive = async (userId, isActive) => {
    const { error } = await supabase
      .from('profiles').update({ is_active: isActive }).eq('id', userId)
    if (error) throw error
  }

  // ── ADMIN: Xóa tài khoản ─────────────────────────────────────
  // Không xóa auth.users được từ browser → chỉ xóa profile + khóa
  const deleteUser = async (userId) => {
    // Xóa profile khỏi bảng profiles
    const { error } = await supabase
      .from('profiles').delete().eq('id', userId)
    if (error) throw error
    // Ghi chú: auth.users vẫn còn nhưng không có profile → không login được
  }

  // ── ADMIN: Cập nhật thông tin ────────────────────────────────
  const updateProfile = async (userId, updates) => {
    const { error } = await supabase
      .from('profiles').update(updates).eq('id', userId)
    if (error) throw error
  }

  return {
    // State
    currentUser, currentProfile, isAuthLoading, lockMessage,
    // Getters
    isLoggedIn, isAdmin, isNhanVien,
    userName, userWarehouse,
    canDelete, canExport, canManageUsers,
    // Methods
    initAuth, login, logout,
    createNhanVien, getAllProfiles,
    toggleUserActive, deleteUser, updateProfile,
  }
}