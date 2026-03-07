<script setup>
import { ref, computed } from 'vue'
import { useAuth } from '@/composables/useAuth'

const { login, lockMessage } = useAuth()

const email       = ref('')
const password    = ref('')
const showPw      = ref(false)
const isLoading   = ref(false)
const _errorMsg   = ref('')

// Ưu tiên hiện lockMessage (tài khoản bị khóa) hơn errorMsg thường
const errorMsg = computed(() => lockMessage.value || _errorMsg.value)

const handleLogin = async () => {
  if (!email.value || !password.value) {
    _errorMsg.value = 'Vui lòng nhập đầy đủ email và mật khẩu!'
    return
  }
  isLoading.value = true
  _errorMsg.value  = ''
  try {
    await login(email.value.trim(), password.value)
  } catch (err) {
    _errorMsg.value =
      err.message === 'Invalid login credentials'
        ? 'Email hoặc mật khẩu không đúng!'
        : err.message
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">

      <div class="brand">
        <div class="brand-icon">📺</div>
        <h1 class="brand-title">TV Repair Manager</h1>
        <p class="brand-sub">Hệ thống quản lý ca sửa chữa</p>
      </div>

      <div class="form-group">
        <label>Email</label>
        <input v-model="email" type="email" class="form-input"
          placeholder="your@email.com"
          :disabled="isLoading"
          @keyup.enter="handleLogin" />
      </div>

      <div class="form-group">
        <label>Mật khẩu</label>
        <div class="pw-wrap">
          <input v-model="password" :type="showPw ? 'text' : 'password'"
            class="form-input" placeholder="••••••••"
            :disabled="isLoading"
            @keyup.enter="handleLogin" />
          <button class="eye-btn" type="button" @click="showPw = !showPw" tabindex="-1">
            {{ showPw ? '🙈' : '👁️' }}
          </button>
        </div>
      </div>

      <div v-if="errorMsg" class="error-box">⚠️ {{ errorMsg }}</div>

      <button class="login-btn" :disabled="isLoading" @click="handleLogin">
        <span v-if="isLoading" class="spin"></span>
        {{ isLoading ? 'Đang đăng nhập...' : 'Đăng nhập' }}
      </button>

      <p class="hint">Liên hệ admin để được cấp tài khoản</p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1e3a5f 0%, #0f2544 60%, #1a3a6b 100%);
  padding: 1rem;
  font-family: system-ui, -apple-system, sans-serif;
}
.login-card {
  background: #fff;
  border-radius: 24px;
  padding: 2.5rem 2rem;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 30px 70px rgba(0,0,0,0.45);
}
.brand { text-align: center; margin-bottom: 2rem; }
.brand-icon { font-size: 3.5rem; display: block; margin-bottom: 0.5rem; }
.brand-title { font-size: 1.6rem; font-weight: 800; color: #1e293b; margin: 0 0 0.25rem; letter-spacing: -0.03em; }
.brand-sub { color: #64748b; font-size: 0.9rem; margin: 0; }
.form-group { margin-bottom: 1.2rem; }
.form-group label { display: block; font-weight: 600; font-size: 0.88rem; color: #374151; margin-bottom: 0.4rem; }
.form-input {
  width: 100%; padding: 0.75rem 1rem;
  border: 2px solid #e2e8f0; border-radius: 12px;
  font-size: 1rem; color: #1e293b; outline: none;
  transition: border-color 0.2s; box-sizing: border-box;
}
.form-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
.form-input:disabled { background: #f8fafc; opacity: 0.7; }
.pw-wrap { position: relative; }
.pw-wrap .form-input { padding-right: 2.75rem; }
.eye-btn {
  position: absolute; right: 0.75rem; top: 50%;
  transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  font-size: 1.1rem; padding: 0; line-height: 1;
}
.error-box {
  background: #fee2e2; border: 1px solid #fca5a5;
  color: #991b1b; padding: 0.7rem 1rem; border-radius: 10px;
  font-size: 0.88rem; margin-bottom: 1rem; font-weight: 500;
}
.login-btn {
  width: 100%; padding: 0.875rem;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff; border: none; border-radius: 12px;
  font-size: 1rem; font-weight: 700; cursor: pointer;
  transition: all 0.2s; display: flex;
  align-items: center; justify-content: center; gap: 0.5rem;
  margin-bottom: 1rem;
}
.login-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(59,130,246,0.4); }
.login-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
.spin {
  width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%;
  animation: spin 0.7s linear infinite; display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
.hint { text-align: center; color: #94a3b8; font-size: 0.82rem; margin: 0; }
</style>