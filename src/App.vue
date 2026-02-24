<script setup>
import { ref, onMounted, computed } from 'vue'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { getSupabase } from './lib/supabase'


// === CHỨC NĂNG TÍNH TOÁN HÀNH TRÌNH ===
const currentLocation = ref('')
const currentCoords = ref(null)
const showRouteModal = ref(false)
const routeCustomers = ref([])
const isLoadingRoute = ref(false)

const openRouteModal = () => {
  showRouteModal.value = true
  currentLocation.value = ''
  currentCoords.value = null
  routeCustomers.value = []
  isLoadingRoute.value = false
}

const closeRouteModal = () => {
  showRouteModal.value = false
}

const geocodeAddress = async (address) => {
  if (!address || !address.trim()) return null

  const photonBase = 'https://photon.komoot.io/api/?limit=1&lang=vi&q='
  const nominatimBase = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q='

  // normalize some common variants
  const variants = [
    address,
    `${address}, Da Nang, Vietnam`,
    `${address}, Đà Nẵng, Việt Nam`,
    address.replace('(Cũ)', '').replace('(cũ)', '').trim() + ', Da Nang, Vietnam',
    address.replace('TP Đà Nẵng', 'Da Nang').trim() + ', Vietnam',
    address.replace(/quận/i, 'Quận').replace(/phường/i, 'Phường').trim() + ', Da Nang',
    address.split(',')[0].trim() + ', Da Nang, Vietnam'
  ]

  for (const variant of variants) {
    try {
      // 1) Try Photon first (often better for local addresses/hẻm)
      try {
        const pRes = await fetch(`${photonBase}${encodeURIComponent(variant)}`)
        const pJson = await pRes.json()
        if (pJson && pJson.features && pJson.features.length) {
          const f = pJson.features[0]
          const [lon, lat] = f.geometry.coordinates
          console.log('[✅ Photon Geocode]', variant, '→', f.properties.name || f.properties.city || f.properties.street || f.properties.label)
          return { lat: parseFloat(lat), lng: parseFloat(lon), displayName: f.properties.name || f.properties.label || `${lat}, ${lon}` }
        } else {
          console.log('[⚠️ Photon No Result]', variant)
        }
      } catch (pe) {
        console.warn('[Photon Error]', variant, pe.message)
      }

      // 2) Fallback to Nominatim
      try {
        const nRes = await fetch(`${nominatimBase}${encodeURIComponent(variant)}`)
        const nJson = await nRes.json()
        if (nJson && nJson.length > 0) {
          console.log('[✅ Nominatim Geocode]', variant, '→', nJson[0].display_name)
          return { lat: parseFloat(nJson[0].lat), lng: parseFloat(nJson[0].lon), displayName: nJson[0].display_name }
        } else {
          console.log('[⚠️ Nominatim No Result]', variant)
        }
      } catch (ne) {
        console.warn('[Nominatim Error]', variant, ne.message)
      }
    } catch (err) {
      console.error('[Geocode Outer Error]', variant, err.message)
    }
  }

  console.warn('[🔴 Geocode Fail ALL] địa chỉ:', address)
  return null
}

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371 // km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// New: use OSRM public router for route distance (meters). For production consider GraphHopper/Valhalla or self-hosted OSRM.
const getRouteDistanceMeters = async (from, to) => {
  if (!from || !to) return null
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`
    const res = await fetch(url)
    const json = await res.json()
    if (json && json.code === 'Ok' && json.routes && json.routes.length) {
      return json.routes[0].distance // meters
    } else {
      console.warn('[OSRM No Route]', json && json.code)
    }
  } catch (e) {
    console.warn('[OSRM Error]', e.message)
  }
  return null
}

// Modify calculateRoute's distance calculation to call OSRM first, fallback to Haversine
const calculateRoute = async () => {
  if (!currentLocation.value.trim()) {
    return alert('Vui lòng nhập địa chỉ hiện tại của bạn')
  }

  isLoadingRoute.value = true

  let coords = await geocodeAddress(currentLocation.value)
  if (!coords) coords = await geocodeAddress(currentLocation.value + ', Đà Nẵng, Việt Nam')

  if (!coords) {
    alert('Không tìm thấy tọa độ cho địa chỉ hiện tại. Hãy nhập chi tiết hơn (số nhà, đường, phường, quận).')
    isLoadingRoute.value = false
    return
  }

  currentCoords.value = coords

  const customersToRoute = dangLam.value
  const customersWithDistance = []

  for (let i = 0; i < customersToRoute.length; i++) {
    const customer = customersToRoute[i]

    // respect rate limits
    if (i > 0) await new Promise(r => setTimeout(r, 1200))

    let distance = 'N/A'
    let customerCoords = null
    let displayAddress = customer.address || 'Không có địa chỉ'
    let status = 'OK'

    if (customer.address && customer.address.trim()) {
      customerCoords = await geocodeAddress(customer.address)

      if (customerCoords) {
        // try OSRM routing (distance theo đường), fallback về Haversine
        const meters = await getRouteDistanceMeters(coords, customerCoords)
        if (meters != null) {
          distance = (meters / 1000).toFixed(2)
        } else {
          distance = calculateDistance(coords.lat, coords.lng, customerCoords.lat, customerCoords.lng).toFixed(2)
        }
        displayAddress = customerCoords.displayName || customer.address
      } else {
        status = 'Không tìm được tọa độ'
      }
    } else {
      status = 'Không có địa chỉ'
    }

    customersWithDistance.push({
      ...customer,
      distance,
      status,
      coords: customerCoords,
      displayAddress
    })
  }

  routeCustomers.value = customersWithDistance.sort((a, b) => {
    if (a.distance === 'N/A') return 1
    if (b.distance === 'N/A') return -1
    return parseFloat(a.distance) - parseFloat(b.distance)
  })

  isLoadingRoute.value = false
}

// --- KẾT NỐI SUPABASE ---
const supabase = getSupabase()

const rawInput = ref('')
const searchQuery = ref('')
const historySearchQuery = ref('')
const customers = ref([])
const showTab = ref('danglam')
const isEditingLink = ref({})
const tempFolderLink = ref({})

// Modal media
const showModal = ref(false)
const modalMedia = ref(null)

const openMediaModal = (media) => {
  modalMedia.value = media
  showModal.value = true
  document.body.style.overflow = 'hidden'
}

const closeMediaModal = () => {
  showModal.value = false
  modalMedia.value = null
  document.body.style.overflow = ''
}

// Modal chi tiết ca hoàn thành
const showDetailModal = ref(false)
const selectedCustomer = ref(null)

const openDetailModal = (customer) => {
  selectedCustomer.value = { ...customer }
  showDetailModal.value = true
  document.body.style.overflow = 'hidden'
}

const closeDetailModal = () => {
  showDetailModal.value = false
  selectedCustomer.value = null
  document.body.style.overflow = ''
}

// Modal chọn linh kiện
const showPartModal = ref(false)
const linhKienList = ref([
  'Đổi TV',
  'Thay màn hình',
  'Thay bo chính',
  'Thay bo nguồn',
  'Thay Tcon',
  'Thay Led'
])

const openPartModal = () => showPartModal.value = true
const selectPart = (part) => {
  newReplacedPart.value = part
  showPartModal.value = false
}
const closePartModal = () => showPartModal.value = false

// === CHỨC NĂNG THÔNG BÁO CA TRỄ ===
const showTreModal = ref(false)
const openTreModal = () => showTreModal.value = true
const closeTreModal = () => showTreModal.value = false

const treCaList = computed(() => {
  const now = new Date().getTime()
  return customers.value.filter(c => {
    if (c.status !== 0) return false
    if (!c.createdAt) return false
    const created = new Date(c.createdAt).getTime()
    return now - created > 86400000
  })
})

const selectTreCa = (item) => {
  searchQuery.value = item.ticketId
  closeTreModal()
}

const formatDate = (dateStr) => {
  if (!dateStr) return 'Chưa có ngày tạo'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return 'Ngày không hợp lệ'
  return date.toLocaleString('vi-VN', { 
    day: '2-digit', month: '2-digit', year: 'numeric', 
    hour: '2-digit', minute: '2-digit' 
  })
}

// Tìm + lưu/sửa/xóa linh kiện
const searchTicketId = ref('')
const newReplacedPart = ref('')
const editingPart = ref(false)

const loadPartForEdit = async () => {
  if (!searchTicketId.value.trim()) return alert('Vui lòng nhập mã ASVN')

  const ticket = searchTicketId.value.trim().toUpperCase()

  const { data: ca, error } = await supabase
    .from('customers')
    .select('id, replacedPart')
    .eq('ticketId', ticket)
    .maybeSingle()

  if (error) return alert('Lỗi tìm ca: ' + error.message)
  if (!ca) return alert('Không tìm thấy ca với mã ASVN: ' + ticket)

  const defaultValues = ['Chưa có linh kiện thay', 'Chưa nhập linh kiện', '']
  if (ca.replacedPart && !defaultValues.includes(ca.replacedPart.trim())) {
    newReplacedPart.value = ca.replacedPart
    editingPart.value = true
  } else {
    newReplacedPart.value = ''
    editingPart.value = false
  }
}

const saveLinhKien = async () => {
  if (!searchTicketId.value.trim()) return alert('Vui lòng nhập mã ASVN')
  if (!newReplacedPart.value.trim()) return alert('Vui lòng nhập/chọn loại linh kiện thay')

  const ticket = searchTicketId.value.trim().toUpperCase()

  const { data: ca, error: errFind } = await supabase
    .from('customers')
    .select('id')
    .eq('ticketId', ticket)
    .maybeSingle()

  if (errFind) return alert('Lỗi tìm ca: ' + errFind.message)
  if (!ca) return alert('Không tìm thấy ca với mã ASVN: ' + ticket)

  const { error: errUpdate } = await supabase
    .from('customers')
    .update({ replacedPart: newReplacedPart.value.trim() })
    .eq('id', ca.id)

  if (errUpdate) return alert('Lỗi cập nhật: ' + errUpdate.message)

  alert(editingPart.value ? 'Đã sửa linh kiện thành công!' : 'Đã lưu linh kiện thay thành công!')
  searchTicketId.value = ''
  newReplacedPart.value = ''
  editingPart.value = false
  await loadData()
}

const deleteLinhKien = async () => {
  if (!searchTicketId.value.trim()) return alert('Vui lòng nhập mã ASVN')

  if (!confirm('Bạn có chắc muốn xóa linh kiện của ca này?')) return

  const ticket = searchTicketId.value.trim().toUpperCase()

  const { data: ca, error: errFind } = await supabase
    .from('customers')
    .select('id')
    .eq('ticketId', ticket)
    .maybeSingle()

  if (errFind) return alert('Lỗi tìm ca: ' + errFind.message)
  if (!ca) return alert('Không tìm thấy ca')

  const { error } = await supabase
    .from('customers')
    .update({ replacedPart: 'Chưa có linh kiện thay' })
    .eq('id', ca.id)

  if (error) return alert('Lỗi xóa: ' + error.message)

  alert('Đã xóa linh kiện, reset về mặc định!')
  searchTicketId.value = ''
  newReplacedPart.value = ''
  editingPart.value = false
  await loadData()
}

// Load data
const loadData = async () => {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('id', { ascending: false })
  if (!error) customers.value = data
}

// FIX PARSE: Parse chính xác theo format tin nhắn Zalo của anh (dòng "số sửa chữa:", "Tên khách hàng:", "Số điện thoại:", "Model:", "Địa chỉ:", "Hiện tượng:", "Faulty description:")
const handleParse = async (manualText = null) => {
  const text = (manualText || rawInput.value || "").trim()
  if (!text) return

  if (text.includes('MutationObserver') || text.includes('const ') || text.includes('==')) {
    rawInput.value = ''; return
  }

  const ticketMatch = text.match(/ASVN[0-9]+/i)
  const ticketId = ticketMatch ? ticketMatch[0].toUpperCase() : 'ASVN-TRỐNG'

  if (ticketId !== 'ASVN-TRỐNG') {
    const { data: exist } = await supabase.from('customers').select('ticketId').eq('ticketId', ticketId).maybeSingle()
    if (exist) {
      console.log("Ca đã tồn tại:", ticketId)
      rawInput.value = ''; return
    }
  }

  const lines = text.split('\n').map(line => line.trim()).filter(line => line)

  let phone = ''
  let name = 'Khách chưa tên'
  let model = 'Chưa rõ model'
  let address = 'Chưa bóc được địa chỉ'
  let issue = 'Bảo hành thiết bị'

  // **FIX: Tìm địa chỉ "Mới" nếu có, nếu không thì lấy "Cũ" hoặc dòng "Địa chỉ:"**
  let addressNew = null
  let addressOld = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lowerLine = line.toLowerCase()

    // SĐT
    if (lowerLine.includes('số điện thoại') || lowerLine.includes('phone') || lowerLine.includes('sdt') || lowerLine.includes('tel')) {
      const match = line.match(/(?:0|\+84)[3-9][0-9\s.-]{8,10}/)
      if (match) phone = match[0].replace(/[^0-9+]/g, '')
    }

    // Tên khách (ưu tiên "Customer Name:" rồi sau đó "Tên khách:")
    if (lowerLine.includes('customer name') || lowerLine.includes('tên khách') || lowerLine.includes('khách hàng') || lowerLine.includes('tên:')) {
      const raw = line.replace(/Customer Name:?|Tên khách hàng?:?|Khách hàng?:?|Tên?:?/i, '').trim()
      if (raw && raw !== 'Anh' && raw !== 'Chị') name = raw
    }

    // Model (ưu tiên "Model:" hay "Product Model:")
    if (lowerLine.includes('model') || lowerLine.includes('product model') || lowerLine.includes('thiết bị') || lowerLine.includes('tv model') || lowerLine.includes('xiaomi')) {
      if (!lowerLine.includes('serial') && !lowerLine.includes('s/n')) { // loại "S/N" line
        const match = line.match(/:\s*(.+)/) || line.match(/Model\s*(.+)/i)
        if (match && match[1]) {
          const raw = match[1].trim()
          if (raw.toLowerCase() !== 'xiaomi' && !raw.includes('ASVN')) model = raw
        }
      }
    }

    // **FIX: Địa chỉ - ưu tiên "Mới:", nếu không có thì "Cũ:", nếu không có thì dòng "Địa chỉ:"**
    if (lowerLine.includes('mới:') || lowerLine.includes('địa chỉ mới') || lowerLine.includes('customer address:')) {
      const match = line.match(/:\s*(.+)/) || line.match(/Mới\s*(.+)/i)
      if (match && match[1]) addressNew = match[1].trim()
    }
    
    if (lowerLine.includes('cũ:') || lowerLine.includes('địa chỉ cũ')) {
      const match = line.match(/:\s*(.+)/) || line.match(/Cũ\s*(.+)/i)
      if (match && match[1]) addressOld = match[1].trim()
    }

    if (lowerLine.includes('địa chỉ') && !lowerLine.includes('mới') && !lowerLine.includes('cũ')) {
      const match = line.match(/:\s*(.+)/) || line.match(/Địa chỉ\s*(.+)/i)
      if (match && match[1]) address = match[1].trim()
    }

    // Issue (lỗi/hiện tượng/Faulty description)
    if (lowerLine.includes('faulty description') || lowerLine.includes('hiện tượng') || lowerLine.includes('lỗi') || lowerLine.includes('vấn đề') || lowerLine.includes('problem description')) {
      const match = line.match(/:\s*(.+)/) || line.match(/(Faulty description|Hiện tượng|Problem Description)\s*(.+)/i)
      if (match && match[1]) {
        const raw = match[1].trim()
        if (raw) issue = raw
      }
    }
  }

  // **FIX: Ưu tiên địa chỉ "Mới" > "Cũ" > dòng "Địa chỉ:" > default**
  if (addressNew && addressOld) {
    // Có cả 2 → lấy "Mới"
    address = addressNew
    console.log('[📍 Address] Có cả Mới & Cũ → lấy "Mới":', address)
  } else if (addressNew) {
    // Chỉ có "Mới"
    address = addressNew
    console.log('[📍 Address] Chỉ có "Mới" → lấy "Mới":', address)
  } else if (addressOld) {
    // Chỉ có "Cũ"
    address = addressOld
    console.log('[📍 Address] Chỉ có "Cũ" → lấy "Cũ":', address)
  } else if (address && address !== 'Chưa bóc được địa chỉ') {
    // Không có Mới/Cũ → lấy dòng "Địa chỉ:" thường
    console.log('[📍 Address] Lấy từ dòng "Địa chỉ:":', address)
  }

  // Nếu vẫn không lấy được tên từ dòng riêng, thử lấy từ dòng có "A " hoặc "Chị "
  if (name === 'Khách chưa tên') {
    const nameMatch = text.match(/(?:A |Chị |Anh |Bác |Ông |Bà |Khách )([^|\n,]+)/i)
    if (nameMatch) name = nameMatch[1].trim()
  }

  const newCustomer = {
    ticketId,
    name,
    phone,
    model,
    address,
    issue,
    media: [],
    folderDrive: '',
    status: 0,
    replacedPart: 'Chưa có linh kiện thay',
    doneDate: null,
    createdAt: new Date().toISOString()
  }

  const { error } = await supabase.from('customers').insert([newCustomer])
  if (!error) {
    rawInput.value = ''
    console.log("✅ Đã thêm ca:", ticketId)
    console.log("📍 Địa chỉ final:", address)
    console.log("📋 Toàn bộ info:", JSON.stringify(newCustomer, null, 2))
    await loadData()
  } else {
    console.error("Lỗi insert ca:", error)
  }
}

// Media functions (giữ nguyên)
const formatDriveLink = (link) => {
  if (!link) return null
  const driveIdMatch = link.match(/id=([^&]+)|d\/([^/]+)/)
  if (driveIdMatch) {
    const id = driveIdMatch[1] || driveIdMatch[2]
    return `https://lh3.googleusercontent.com/d/${id}`
  }
  return link
}

const onFileChange = async (e, item) => {
  const files = Array.from(e.target.files)
  const currentMedia = item.media || []
  for (const file of files) {
    const reader = new FileReader()
    const base64 = await new Promise(r => {
      reader.onload = () => r(reader.result)
      reader.readAsDataURL(file)
    })
    currentMedia.push({ type: file.type.startsWith('video') ? 'video' : 'image', data: base64, source: 'local' })
  }
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  loadData()
}

const addSingleDrive = async (item) => {
  const inputEl = document.getElementById(`single-drive-${item.id}`)
  if (!inputEl || !inputEl.value.trim()) return
  const currentMedia = item.media || []
  const link = inputEl.value.trim()
  currentMedia.push({ type: 'image', data: formatDriveLink(link), source: 'drive', original: link })
  await supabase.from('customers').update({ media: currentMedia }).eq('id', item.id)
  inputEl.value = ''
  loadData()
}

const removeMedia = async (item, index) => {
  const customerIndex = customers.value.findIndex(c => c.id === item.id)
  if (customerIndex !== -1) {
    const updatedMedia = [...customers.value[customerIndex].media]
    updatedMedia.splice(index, 1)
    customers.value[customerIndex].media = updatedMedia
  }

  const updatedMedia = [...item.media]
  updatedMedia.splice(index, 1)

  const { error } = await supabase
    .from('customers')
    .update({ media: updatedMedia })
    .eq('id', item.id)

  if (error) {
    console.error('Lỗi xoá ảnh:', error)
    alert('Xoá ảnh thất bại, thử lại nhé!')
    await loadData()
  }
}

// Trạng thái ca
const hoanTatKiemTra = async (item) => {
  await supabase.from('customers').update({ status: 1 }).eq('id', item.id)
  await loadData()
}

const dongCa = async (item) => {
  const now = new Date()
  const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth()+1).toString().padStart(2, '0')}/${now.getFullYear()}`
  await supabase.from('customers').update({ status: 2, doneDate: dateStr }).eq('id', item.id)
  await loadData()
}

const revertToDangLam = async (item) => {
  await supabase.from('customers').update({ status: 0, doneDate: null }).eq('id', item.id)
  await loadData()
  if (showDetailModal.value) closeDetailModal()
}

const deleteCustomer = async (id) => {
  if (confirm("Bạn có chắc chắn muốn xóa ca này?")) {
    await supabase.from('customers').delete().eq('id', id)
    await loadData()
    if (showDetailModal.value) closeDetailModal()
  }
}

const startEditFolder = (id, currentLink) => {
  isEditingLink.value[id] = true
  tempFolderLink.value[id] = currentLink || ''
}

const saveFolderLink = async (id) => {
  const link = tempFolderLink.value[id]
  await supabase.from('customers').update({ folderDrive: link }).eq('id', id)
  isEditingLink.value[id] = false
  await loadData()
}

// Export
const exportToExcel = (data, fileName) => {
  if (!data.length) return alert("Không có dữ liệu!")
  const excelData = data.map(item => ({ 
    "Mã Ca": item.ticketId, 
    "Ngày Hoàn thành": item.doneDate, 
    "Khách Hàng": item.name, 
    "SĐT": item.phone, 
    "Model": item.model, 
    "Địa Chỉ": item.address, 
    "Lỗi": item.issue,
    "Linh kiện thay": item.replacedPart 
  }))
  const ws = XLSX.utils.json_to_sheet(excelData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Báo Cáo")
  XLSX.writeFile(wb, `${fileName}.xlsx`)
}

const exportAllHoanThanh = () => exportToExcel(customers.value.filter(c => c.status === 2), 'Bao-Cao-Hoan-Thanh')

// Computed
const dangLam = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return customers.value.filter(c => c.status === 0 && (
    c.name?.toLowerCase().includes(q) || 
    c.phone?.includes(q) || 
    c.ticketId?.toLowerCase().includes(q)
  ))
})

const choLinhKien = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return customers.value.filter(c => c.status === 1 && (
    c.name?.toLowerCase().includes(q) || 
    c.phone?.includes(q) || 
    c.ticketId?.toLowerCase().includes(q)
  ))
})

const hoanThanh = computed(() => {
  const q = historySearchQuery.value.toLowerCase()
  const items = customers.value.filter(c => c.status === 2 && (
    c.name?.toLowerCase().includes(q) || 
    c.phone?.includes(q) || 
    c.ticketId?.toLowerCase().includes(q)
  ))
  const groups = {}
  items.forEach(item => {
    const d = item.doneDate || 'N/A'
    if (!groups[d]) groups[d] = []
    groups[d].push(item)
  })
  return groups
})

onMounted(() => {
  loadData()
  const channel = new BroadcastChannel('zalo_bridge')
  channel.onmessage = (event) => {
    if (event.data) {
      console.log('[Vue] Nhận tin từ Zalo qua Tampermonkey:', event.data.substring(0, 200) + '...')
      handleParse(event.data)
    }
  }
  window.addEventListener('focus', async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.includes("ASVN")) {
        const ticketMatch = text.match(/ASVN[0-9]+/i)
        const tid = ticketMatch ? ticketMatch[0].toUpperCase() : null
        if (tid && !customers.value.some(c => c.ticketId === tid)) handleParse(text)
      }
    } catch (err) {}
  })
})
</script>

<template>
  <div class="page-wrap">
    <div class="layout">
      <div class="control-card">
        <div class="toggle-row">
          <button @click="showTab = 'danglam'" :class="['flex-1', showTab === 'danglam' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700']">
            ĐANG LÀM ({{ dangLam.length }})
          </button>
          <button @click="showTab = 'cholinkien'" :class="['flex-1', showTab === 'cholinkien' ? 'bg-warning text-white' : 'bg-gray-100 text-gray-700']">
            CHỜ LINH KIỆN ({{ choLinhKien.length }})
          </button>
          <button @click="showTab = 'hoanthanh'" :class="['flex-1', showTab === 'hoanthanh' ? 'bg-success text-white' : 'bg-gray-100 text-gray-700']">
            HOÀN THÀNH ({{ customers.filter(c=>c.status===2).length }})
          </button>
        </div>

        <div class="control-actions flex flex-col sm:flex-row gap-3 mt-4">
          <button @click="handleParse()" class="btn btn-primary flex-1">NHẬP KHÁCH</button>
          <button @click="openRouteModal" class="btn btn-info flex-1">TÍNH HÀNH TRÌNH</button>
          <input type="text" v-model="searchQuery" class="form-control" placeholder="Tìm nhanh..." />
        </div>
        <div v-if="showTab === 'danglam'" class="control-body">
          <div class="d-flex justify-content-between align-items-start mb-3">
            <textarea v-model="rawInput" rows="2" class="form-control flex-grow-1 me-3" placeholder="Dán nội dung hoặc đợi tin nhắn Zalo..."></textarea>
            <div class="position-relative" style="min-width: 50px;">
              <button 
                class="btn btn-outline-warning position-relative rounded-circle p-2 shadow" 
                style="width: 50px; height: 50px; display: flex; align-items: center; justify-content: center;"
                @click="openTreModal"
                title="Thông báo ca trễ"
              >
                <span style="font-size: 1.8rem;">🔔</span>
                <span v-if="treCaList.length > 0" 
                      class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-white"
                      style="font-size: 0.75rem; min-width: 20px; height: 20px; line-height: 1.2; padding: 0;">
                  {{ treCaList.length }}
                </span>
              </button>
            </div>
          </div>

          <div class="control-actions">
            <button @click="handleParse()" class="btn btn-primary fw-bold">NHẬP KHÁCH</button>
            <button @click="openRouteModal" class="btn btn-info fw-bold">🗺️ TÍNH HÀNH TRÌNH</button>
            <input type="text" v-model="searchQuery" class="form-control" placeholder="🔍 Tìm kiếm nhanh...">
          </div>
        </div>

        <div v-else-if="showTab === 'cholinkien'" class="control-body">
          <div class="d-flex flex-column gap-3">
            <div class="d-flex gap-3 flex-wrap align-items-end">
              <input v-model="searchTicketId" type="text" class="form-control flex-grow-1" placeholder="Nhập mã ASVN cần cập nhật/sửa linh kiện..." @keyup.enter="loadPartForEdit">
              <button @click="loadPartForEdit" class="btn btn-outline-primary">Tìm</button>
            </div>

            <div class="d-flex gap-3 flex-wrap align-items-end">
              <input 
                v-model="newReplacedPart" 
                type="text" 
                class="form-control flex-grow-1" 
                :placeholder="editingPart ? 'Sửa linh kiện hiện tại...' : 'Loại linh kiện thay (ví dụ: Mainboard, Màn hình)...'"
                @click="openPartModal"
              >
              <button @click="saveLinhKien" class="btn btn-success px-4">
                {{ editingPart ? 'Sửa linh kiện' : 'Lưu linh kiện' }}
              </button>
              <button v-if="editingPart" @click="deleteLinhKien" class="btn btn-danger px-4">Xóa linh kiện</button>
            </div>

            <input v-model="searchQuery" type="text" class="form-control" placeholder="Tìm theo tên, sđt, mã ca trong chờ linh kiện...">
          </div>
        </div>

        <div v-else class="control-body">
          <div class="d-flex gap-2">
            <input type="text" v-model="historySearchQuery" class="form-control flex-grow-1" placeholder="🔍 Tìm trong lịch sử hoàn thành...">
            <button @click="exportAllHoanThanh" class="btn btn-outline-dark fw-bold">📊 XUẤT EXCEL</button>
          </div>
        </div>
      </div>

      <section class="cases-section">
        <div class="section-header">
          <h2 class="section-title">
            {{ showTab === 'danglam' ? 'Ca đang xử lý' : showTab === 'cholinkien' ? 'Ca chờ linh kiện' : 'Lịch sử hoàn thành' }}
          </h2>
        </div>

                  <div v-if="showTab === 'danglam'">
                    <div class="case-strip">
          <div v-for="item in dangLam" :key="item.id" class="case-card">
            <div class="card-header">
              <div class="flex items-center gap-3">
                <input type="checkbox" @change="hoanTatKiemTra(item)" class="w-5 h-5 rounded text-primary" />
                <span class="ticket-id">{{ item.ticketId }}</span>
                <span class="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">Chờ xử lý</span>
              </div>
              <button @click="deleteCustomer(item.id)" class="text-danger text-sm font-medium">Xóa</button>
            </div>

            <div class="info-content">
              <div class="name">👤 {{ item.name }}</div>
              <div class="phone">📞 {{ item.phone }}</div>
              <div class="model">📺 {{ item.model }}</div>
              <div class="address">📍 {{ item.address }}</div>
              <div class="issue">⚠️ {{ item.issue }}</div>
              <div class="part">🔧 Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
            </div>

            <!-- Giữ nguyên phần media, link ảnh, Drive -->
            <div class="p-4 border-t border-gray-100">
              <div class="media-grid">
                <!-- ... media items ... -->
              </div>

              <div class="input-group mt-3">
                <input :id="'single-drive-'+item.id" class="form-control" placeholder="Link ảnh lẻ..." @keyup.enter="addSingleDrive(item)" />
                <button @click="addSingleDrive(item)" class="btn btn-info">Thêm</button>
              </div>

              <div class="input-group mt-3">
                <input v-model="tempFolderLink[item.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(item.id)" />
                <button @click="saveFolderLink(item.id)" class="btn btn-primary">Lưu</button>
              </div>
            </div>
          </div>
          </div>
        </div>

        <div v-if="showTab === 'cholinkien'">
          <div class="case-strip">
            <div v-for="item in choLinhKien" :key="item.id" class="case-card">
              <div class="card border-0 shadow-sm h-100">
                <div class="card-body border-start border-5 border-warning d-flex flex-column">
                  <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
                    <div class="d-flex align-items-center gap-2 flex-wrap">
                      <button @click="dongCa(item)" class="btn btn-sm btn-success">Chốt ca</button>
                      <span class="fw-bold text-primary">{{ item.ticketId }}</span>
                      <span class="badge bg-warning text-dark">Chờ linh kiện</span>
                    </div>
                    <button @click="deleteCustomer(item.id)" class="btn btn-sm text-danger opacity-50">Xóa</button>
                  </div>
                  <div class="info-content">
                    <div class="fw-bold text-dark">👤 {{ item.name }}</div>
                    <div class="fw-bold text-secondary mb-1">📞 {{ item.phone }}</div>
                    <div class="small text-muted mb-1">📺 {{ item.model }}</div>
                    <div class="small text-muted mb-2">📍 {{ item.address }}</div>
                    <div class="text-danger small fw-bold mb-2">⚠️ {{ item.issue }}</div>
                    <div class="text-info small fw-bold mb-3">🔧 Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>

                    <div class="media-grid">
                      <div v-for="(m, idx) in item.media" :key="idx" class="media-item">
                        <img v-if="m.type === 'image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh">
                        <video v-else :src="m.data" controls @click="openMediaModal(m)" preload="metadata"></video>
                        <span @click.stop="removeMedia(item, idx)" class="media-del">×</span>
                      </div>
                      <label class="media-add"><span>+</span><input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, item)"></label>
                    </div>

                    <div class="input-group input-group-sm mb-3 mt-2">
                      <input :id="'single-drive-'+item.id" class="form-control" placeholder="Link ảnh lẻ..." @keyup.enter="addSingleDrive(item)">
                      <button @click="addSingleDrive(item)" class="btn btn-outline-primary">Thêm</button>
                    </div>

                    <div class="mt-auto">
                      <div v-if="!item.folderDrive && !isEditingLink[item.id]" class="input-group input-group-sm">
                        <input v-model="tempFolderLink[item.id]" class="form-control" placeholder="Link Drive tổng..." @keyup.enter="saveFolderLink(item.id)">
                        <button @click="saveFolderLink(item.id)" class="btn btn-primary">Lưu</button>
                      </div>
                      <div v-else class="d-flex gap-1">
                        <a :href="item.folderDrive" target="_blank" class="btn btn-sm btn-info text-white flex-grow-1 fw-bold">📂 DRIVE TỔNG</a>
                        <button @click="startEditFolder(item.id, item.folderDrive)" class="btn btn-sm btn-light border">Sửa</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="showTab === 'hoanthanh'">
          <div v-for="(group, date) in hoanThanh" :key="date" class="mb-4">
            <div class="mb-3"><span class="date-pill">📅 {{ date }} ({{ group.length }} ca)</span></div>
            <div class="case-strip">
              <div v-for="item in group" :key="item.id" class="case-card" @click="openDetailModal(item)" style="cursor: pointer;">
                <div class="card border-0 shadow-sm">
                  <div class="card-body border-start border-5 border-success">
                    <div class="d-flex justify-content-between mb-2">
                      <span class="fw-bold text-success">{{ item.ticketId }} - {{ item.name }}</span>
                      <button @click.stop="revertToDangLam(item)" class="btn btn-sm btn-warning">Hoàn lại chờ</button>
                    </div>
                    <div class="small text-muted mb-2">{{ item.phone }} | {{ item.model }} | Linh kiện: {{ item.replacedPart || 'Chưa có' }}</div>
                   
                    <div v-if="item.media && item.media.length" class="media-grid-mini">
                      <div v-for="(m, idx) in item.media" :key="idx" class="media-item-mini">
                        <img v-if="m.type === 'image'" :src="m.data" @click.stop="openMediaModal(m)" alt="Ảnh nhỏ">
                        <video v-else :src="m.data" controls @click.stop="openMediaModal(m)" preload="metadata" style="width:100%; height:100%; object-fit:cover;"></video>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Modal chi tiết ca hoàn thành -->
      <div v-if="showDetailModal && selectedCustomer" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.7);">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header bg-success text-white">
              <h5 class="modal-title">Chi tiết ca hoàn thành: {{ selectedCustomer.ticketId }}</h5>
              <button type="button" class="btn-close btn-close-white" @click="closeDetailModal"></button>
            </div>
            <div class="modal-body">
              <div class="row">
                <div class="col-md-5">
                  <h5 class="text-success mb-3">{{ selectedCustomer.name }} - {{ selectedCustomer.phone }}</h5>
                  <p><strong>Model:</strong> {{ selectedCustomer.model }}</p>
                  <p><strong>Địa chỉ:</strong> {{ selectedCustomer.address }}</p>
                  <p><strong>Lỗi:</strong> <span class="text-danger">{{ selectedCustomer.issue }}</span></p>
                  <p><strong>Linh kiện thay:</strong> {{ selectedCustomer.replacedPart || 'Chưa có' }}</p>
                  <p><strong>Ngày hoàn thành:</strong> {{ selectedCustomer.doneDate }}</p>
                  <p><strong>Ngày tạo:</strong> {{ formatDate(selectedCustomer.createdAt) }}</p>
                </div>

                <div class="col-md-7">
                  <h6 class="mb-3">Ảnh & Video</h6>
                  <div class="media-grid">
                    <div v-for="(m, idx) in selectedCustomer.media || []" :key="idx" class="media-item position-relative">
                      <img v-if="m.type === 'image'" :src="m.data" @click="openMediaModal(m)" alt="Ảnh" style="cursor: pointer;">
                      <video v-else :src="m.data" controls @click="openMediaModal(m)" preload="metadata" style="cursor: pointer;"></video>
                      <span @click.stop="removeMedia(selectedCustomer, idx)" class="media-del">×</span>
                    </div>
                    <label class="media-add"><span>+</span><input type="file" hidden multiple accept="image/*,video/*" @change="onFileChange($event, selectedCustomer)"></label>
                  </div>

                  <div class="input-group input-group-sm mb-3 mt-3">
                    <input :id="'single-drive-'+selectedCustomer.id" class="form-control" placeholder="Link ảnh lẻ từ Drive..." @keyup.enter="addSingleDrive(selectedCustomer)">
                    <button @click="addSingleDrive(selectedCustomer)" class="btn btn-outline-primary">Thêm</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button @click="revertToDangLam(selectedCustomer)" class="btn btn-warning">Hoàn lại chờ xử lý</button>
              <button type="button" class="btn btn-secondary" @click="closeDetailModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal phóng to media -->
      <div v-if="showModal" class="media-modal-overlay" @click="closeMediaModal">
        <div class="media-modal-content" @click.stop>
          <button class="modal-close" @click="closeMediaModal">×</button>
          <img v-if="modalMedia?.type === 'image'" :src="modalMedia.data" alt="Ảnh phóng to" class="modal-media">
          <video v-else-if="modalMedia?.type === 'video'" :src="modalMedia.data" controls autoplay class="modal-media"></video>
        </div>
      </div>

      <!-- Modal chọn linh kiện -->
      <div v-if="showPartModal" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Chọn loại linh kiện thay</h5>
              <button type="button" class="btn-close" @click="closePartModal"></button>
            </div>
            <div class="modal-body">
              <div class="list-group">
                <button v-for="part in linhKienList" :key="part" class="list-group-item list-group-item-action" @click="selectPart(part)">{{ part }}</button>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closePartModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal ca trễ -->
      <div v-if="showTreModal" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.5);">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
          <div class="modal-content">
            <div class="modal-header bg-warning text-dark">
              <h5 class="modal-title">Ca bị trễ ({{ treCaList.length }} ca)</h5>
              <button type="button" class="btn-close" @click="closeTreModal"></button>
            </div>
            <div class="modal-body p-3">
              <div v-if="treCaList.length === 0" class="text-center text-muted py-5">
                Không có ca nào bị trễ
              </div>
              <div v-else class="list-group">
                <button v-for="item in treCaList" :key="item.id" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3" @click="selectTreCa(item)">
                  <div class="flex-grow-1">
                    <div class="d-flex justify-content-between mb-1">
                      <strong class="text-primary fs-5">{{ item.ticketId }}</strong>
                      <small class="text-muted">{{ formatDate(item.createdAt) }}</small>
                    </div>
                    <div class="mb-1 fw-bold">{{ item.name }} - {{ item.phone }}</div>
                    <small class="text-danger d-block">{{ item.issue }}</small>
                  </div>
                  <span class="badge bg-danger text-white ms-3">Trễ</span>
                </button>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeTreModal">Đóng</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <!-- Modal tính hành trình -->
<div v-if="showRouteModal" class="modal fade show" tabindex="-1" style="display: block; background: rgba(0,0,0,0.7); overflow-y: auto;">
  <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
    <div class="modal-content">
      <div class="modal-header bg-info text-white">
        <h5 class="modal-title">📍 Tính Hành Trình Thuận Tiện</h5>
        <button type="button" class="btn-close btn-close-white" @click="closeRouteModal"></button>
      </div>
      <div class="modal-body">
        <div class="mb-4">
          <label class="form-label fw-bold">Địa chỉ hiện tại của bạn:</label>
          <div class="input-group">
            <input 
              v-model="currentLocation" 
              type="text" 
              class="form-control" 
              placeholder="VD: 123 Nguyễn Văn Linh, Thanh Khê, Đà Nẵng"
              @keyup.enter="calculateRoute"
            >
            <button @click="calculateRoute" :disabled="isLoadingRoute" class="btn btn-info fw-bold">
              {{ isLoadingRoute ? '⏳ Đang tính...' : '🚀 Tính tuyến đường' }}
            </button>
          </div>
          <small class="form-text text-muted mt-1">Nhập càng chi tiết (số nhà, phường, quận, thành phố) sẽ càng chính xác.</small>
        </div>

        <div v-if="currentCoords" class="alert alert-success mb-4">
          ✅ Vị trí hiện tại: <strong>{{ currentCoords.displayName || `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}` }}</strong>
        </div>

        <div v-if="isLoadingRoute" class="text-center py-5">
          <div class="spinner-border text-info" role="status" style="width: 3rem; height: 3rem;"></div>
          <p class="mt-3 fw-bold">Đang tìm tọa độ và tính toán khoảng cách...</p>
          <small>(Có thể mất vài giây nếu nhiều khách hàng)</small>
        </div>

        <div v-else-if="routeCustomers.length > 0">
          <h6 class="mb-3 fw-bold">Thứ tự gợi ý (gần nhất → xa nhất):</h6>
          <div class="list-group">
            <button 
              v-for="(item, idx) in routeCustomers" 
              :key="item.id" 
              class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3"
              @click="searchQuery = item.ticketId; closeRouteModal()"
              :class="{ 'list-group-item-warning': item.distance === 'N/A' }"
            >
              <div class="flex-grow-1">
                <div class="d-flex align-items-center gap-3 mb-2">
                  <span class="badge bg-primary rounded-pill fs-5 px-3 py-2">{{ idx + 1 }}</span>
                  <div>
                    <strong class="fs-5">{{ item.ticketId }} - {{ item.name }}</strong>
                    <span v-if="item.distance !== 'N/A'" class="badge bg-warning ms-2">{{ item.distance }} km</span>
                    <span v-else class="badge bg-secondary ms-2">Không xác định</span>
                  </div>
                </div>
                <div class="mb-1"><strong>📞</strong> {{ item.phone || 'Không có' }}</div>
                <div class="mb-1"><strong>📍</strong> {{ item.displayAddress }}</div>
                <small v-if="item.status !== 'OK'" class="text-danger fw-bold d-block">{{ item.status }}</small>
                <small class="text-danger fw-bold">⚠️ {{ item.issue }}</small>
              </div>
            </button>
          </div>
        </div>

        <div v-else-if="currentCoords && !isLoadingRoute" class="alert alert-warning mt-4">
          Không có ca đang xử lý nào có địa chỉ hợp lệ để tính tuyến đường. Hãy kiểm tra lại thông tin địa chỉ khách hàng.
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" @click="closeRouteModal">Đóng</button>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
/* Base mobile-first */
.page-wrap {
  min-height: 100vh;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  padding: 1rem 0.75rem;
  font-family: system-ui, -apple-system, sans-serif;
}

/* Layout */
.layout {
  max-width: 100%;
  margin: 0 auto;
}

/* Control Card - gọn, bo tròn */
.control-card {
  background: white;
  border-radius: 1.25rem;
  padding: 1rem;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(229, 231, 235, 0.6);
}

/* Toggle Buttons - nhỏ hơn, dễ bấm trên mobile */
.toggle-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.toggle-row button {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0.75rem 1rem;
  font-size: 0.9rem;
  font-weight: 600;
  border-radius: 0.75rem;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  white-space: nowrap;
}

.toggle-row button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

/* Case Strip - card nhỏ gọn, dễ scroll */
.case-strip {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Case Card - tối ưu mobile */
.case-card {
  border-radius: 1rem;
  overflow: hidden;
  background: white;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
  transition: all 0.2s;
}

.case-card:hover {
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

/* Header card */
.card-header {
  padding: 0.75rem 1rem;
  background: linear-gradient(to right, #f8fafc, #ffffff);
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header .ticket-id {
  font-size: 1.1rem;
  font-weight: 700;
  color: #2563eb;
}

/* Info content - dễ đọc */
.info-content {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.95rem;
}

.info-content .name { font-weight: 600; color: #1f2937; }
.info-content .phone { color: #374151; }
.info-content .model { color: #4b5563; }
.info-content .address { color: #6b7280; line-height: 1.4; }
.info-content .issue { color: #dc2626; font-weight: 500; }
.info-content .part { color: #0ea5e9; }

/* Media Grid - nhỏ gọn */
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
  gap: 0.5rem;
  margin: 0.75rem 0;
}

.media-item {
  aspect-ratio: 1;
  border-radius: 0.5rem;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.media-del {
  position: absolute;
  top: -6px;
  right: -6px;
  background: #ef4444;
  color: white;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

/* Input & Button - dễ bấm */
.input-group {
  display: flex;
  gap: 0.5rem;
}

.form-control {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  border: 1px solid #d1d5db;
  font-size: 0.95rem;
}

.btn {
  padding: 0.75rem 1.25rem;
  border-radius: 0.75rem;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-primary { background: #2563eb; color: white; }
.btn-success { background: #10b981; color: white; }
.btn-danger { background: #ef4444; color: white; }
.btn-info { background: #0ea5e9; color: white; }

/* Modal - responsive */
.modal-content {
  border-radius: 1.25rem;
  max-height: 90vh;
  overflow-y: auto;
}

/* Responsive */
@media (min-width: 768px) {
  .case-strip {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .toggle-row {
    flex-wrap: nowrap;
  }
  
  .page-wrap {
    padding: 1.5rem 1rem;
  }
}
</style>