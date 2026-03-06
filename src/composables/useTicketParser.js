// src/composables/useTicketParser.js
import { ref } from 'vue'
import { getSupabase } from '@/lib/supabase'

export function useTicketParser(onSuccess = () => {}) {
  const rawInput = ref('')
  const supabase = getSupabase()

  const DEFAULTS = {
    NAME: 'Khách chưa tên',
    PHONE: '',
    MODEL: 'Chưa rõ model',
    ADDRESS: 'Chưa bóc được địa chỉ',
    ISSUE: 'Bảo hành thiết bị',
    REPLACED_PART: 'Chưa có linh kiện thay'
  }

  const extractField = (lines, keywords, extractor) => {
    for (const line of lines) {
      const lower = line.toLowerCase()
      if (keywords.some(kw => lower.includes(kw))) {
        const value = extractor(line)
        if (value && value.trim()) return value.trim()
      }
    }
    return null
  }

  const parseAddress = (lines) => {
    let addressNew = null
    let addressOld = null
    let addressDefault = null

    for (const line of lines) {
      const lower = line.toLowerCase()
      const value = line.split(/[:：]/)[1]?.trim() || ''

      if (lower.includes('mới:') || lower.includes('địa chỉ mới')) {
        addressNew = value || line.replace(/mới:?/i, '').trim()
      } else if (lower.includes('cũ:') || lower.includes('địa chỉ cũ')) {
        addressOld = value || line.replace(/cũ:?/i, '').trim()
      } else if (lower.includes('địa chỉ') && !lower.includes('mới') && !lower.includes('cũ')) {
        addressDefault = value || line.replace(/địa chỉ:?/i, '').trim()
      }
    }

    return addressNew || addressOld || addressDefault || DEFAULTS.ADDRESS
  }

  // ✅ Parse CSVN - format có label rõ ràng
  const handleParseCsvn = async (text) => {
    const ticketMatch = text.match(/Mã Thông Tin[:\s]+([A-Z0-9]+)/i)
    const ticketId = ticketMatch ? ticketMatch[1].trim() : null
    if (!ticketId) {
      alert('Không tìm thấy Mã Thông Tin CSVN!')
      return
    }

    const { data: exist } = await supabase
      .from('customers').select('ticketId').eq('ticketId', ticketId).maybeSingle()
    if (exist) {
      console.log('Ca đã tồn tại:', ticketId)
      rawInput.value = ''
      return
    }

    const nameMatch = text.match(/Tên KH[:\s]+(.+)/i)
    const name = nameMatch ? nameMatch[1].trim() : DEFAULTS.NAME

    const phoneMatch = text.match(/SĐT[:\s]+([\d]+)/i)
    const phone = phoneMatch ? phoneMatch[1].trim() : DEFAULTS.PHONE

    const addressNewMatch = text.match(/Địa chỉ[:\s]+(?!cũ)(.+)/i)
    const addressOldMatch = text.match(/Địa chỉ cũ[:\s]+(.+)/i)
    const address = (addressNewMatch ? addressNewMatch[1].trim() : null)
      || (addressOldMatch ? addressOldMatch[1].trim() : DEFAULTS.ADDRESS)

    const modelMatch = text.match(/Model[:\s]+(.+)/i)
    const model = modelMatch ? modelMatch[1].trim() : DEFAULTS.MODEL

    const issueMatch = text.match(/Tình Trạng[:\s]+(.+)/i)
    const issue = issueMatch ? issueMatch[1].trim() : DEFAULTS.ISSUE

    const serialMatch = text.match(/Số Serial[:\s]+(.+)/i)
    const serial = serialMatch ? serialMatch[1].trim() : ''

    const branchMatch = text.match(/Trạm[:\s]+(.+)/i)
    const branch = branchMatch ? branchMatch[1].trim() : ''

    const newCustomer = {
      ticketId, name, phone, model, address, issue,
      media: [], folderDrive: '', status: 0,
      replacedPart: DEFAULTS.REPLACED_PART, doneDate: null,
      createdAt: new Date().toISOString(),
      warehouse: '', serial, branch
    }

    console.log('📋 Ca CSVN sẽ lưu:', JSON.stringify(newCustomer, null, 2))

    const { error } = await supabase.from('customers').insert([newCustomer])
    if (!error) {
      console.log(`✅ Thêm ca CSVN thành công: ${ticketId}`)
      rawInput.value = ''
      onSuccess()
    } else {
      console.error('Lỗi insert CSVN:', error)
      alert('Lỗi lưu ca CSVN: ' + error.message)
    }
  }

  // ✅ Parse ASVN TDP
  const handleParse = async (manualText = null) => {
    const text = (manualText || rawInput.value || '').trim()
    if (!text) return

    if (text.includes('Mã Thông Tin') || text.match(/CSVN\d+/i)) {
      await handleParseCsvn(text)
      return
    }

    if (text.includes('MutationObserver') || text.includes('const ') || text.includes('==')) {
      rawInput.value = ''
      return
    }

    const ticketMatch = text.match(/ASVN[0-9]+/i)
    const ticketId = ticketMatch ? ticketMatch[0].toUpperCase() : 'ASVN-TRỐNG'

    if (ticketId !== 'ASVN-TRỐNG') {
      const { data: exist } = await supabase
        .from('customers').select('ticketId').eq('ticketId', ticketId).maybeSingle()
      if (exist) {
        console.log(`Ca đã tồn tại: ${ticketId}`)
        rawInput.value = ''
        return
      }
    }

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

    // ✅ Phone - bắt cả +84, normalize về 0
    const phoneRaw = extractField(lines,
      ['số điện thoại', 'phone', 'sdt', 'tel'],
      line => line.match(/(?:\+84|0)[3-9][0-9]{8}/)?.[0]
    ) || ''
    const phone = phoneRaw.replace(/^\+84/, '0') || DEFAULTS.PHONE

    // ✅ Name - ưu tiên label tiếng Việt
    const nameMatch = text.match(/^Tên khách hàng\s*:\s*(.+?)$/im)
    let finalName = nameMatch ? nameMatch[1].trim() : null

    if (!finalName) {
      finalName = extractField(lines,
        ['customer name', 'tên khách', 'khách hàng', 'tên:'],
        line => line.replace(/Customer Name:?|Tên khách hàng?:?|Khách hàng?:?|Tên?:?/i, '').trim()
      ) || DEFAULTS.NAME
    }

    if (finalName === DEFAULTS.NAME) {
      const fallback = text.match(/(?:A |Chị |Anh |Bác |Ông |Bà |Khách )([^|\n,]+)/i)
      if (fallback) finalName = fallback[1].trim()
    }

    // ✅ Model - ưu tiên dòng label đầu tiên (ngoài ngoặc kép)
    const modelLabelMatch = text.match(/^model\s*:\s*(.+?)$/im)
    const model = modelLabelMatch
      ? modelLabelMatch[1].trim()
      : (extractField(lines,
          ['product model', 'thiết bị', 'tv model', 'xiaomi'],
          line => {
            if (line.toLowerCase().includes('serial') || line.toLowerCase().includes('s/n')) return null
            return (line.match(/:\s*(.+)/) || line.match(/Model\s*(.+)/i))?.[1]?.trim()
          }
        )?.replace(/^xiaomi\s*/i, '').trim() || DEFAULTS.MODEL)

    // ✅ Issue - lấy Faulty description bên trong ngoặc kép
    const issueMatch = text.match(/Faulty description\s*:\s*(.+?)(?:\nCS handle:|")/is)
    const issue = issueMatch
      ? issueMatch[1].trim().replace(/\n/g, ' ')
      : DEFAULTS.ISSUE

    // ✅ Address - ưu tiên label tiếng Việt đầu tiên
    const addressLabelMatch = text.match(/^Địa chỉ\s*:\s*(.+?)$/im)
    const address = addressLabelMatch
      ? addressLabelMatch[1].trim()
      : parseAddress(lines)

    const newCustomer = {
      ticketId,
      name: finalName,
      phone,
      model,
      address,
      issue,
      media: [],
      folderDrive: '',
      status: 0,
      replacedPart: DEFAULTS.REPLACED_PART,
      doneDate: null,
      createdAt: new Date().toISOString(),
      warehouse: 'TDP'
    }

    console.log('📋 Ca TDP sẽ lưu:', JSON.stringify(newCustomer, null, 2))

    const { error } = await supabase.from('customers').insert([newCustomer])
    if (!error) {
      console.log(`✅ Thêm ca thành công: ${ticketId}`)
      rawInput.value = ''
      onSuccess()
    } else {
      console.error('Lỗi insert:', error)
    }
  }

  return {
    rawInput,
    handleParse
  }
}