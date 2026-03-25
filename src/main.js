const STORAGE_KEY = 'financial-kanban-board'
const REMINDER_SEEN_KEY = 'financial-kanban-reminder-seen'
const DEFAULT_BOARD_TITLE = 'Сделки'
const DEFAULT_COLUMNS = ['Новые клиенты', 'На согласовании', 'Ожидание оплаты', 'Регулярные', 'Расходы', 'Клиенты ушли']
const NEW_BOARD_COLUMNS = ['Сделать', 'В работе', 'Сделано']
const CARD_TEMPLATES = [
  { id: 'consulting', title: 'Консультация', service: 'Консультация', price: 5000, tags: ['консалтинг'] },
  { id: 'ads-month', title: 'Ведение рекламы', service: 'Ведение рекламы (месяц)', price: 30000, tags: ['реклама'] },
  { id: 'expense-tools', title: 'Расход: инструменты', service: 'Оплата сервисов/инструментов', price: 7000, tags: ['расход'] },
]

const state = loadState()
const reminderSeen = loadReminderSeenMap()
let reminderSchedulerStarted = false
const undoStack = []

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function createDefaultState() {
  const defaultBoard = {
    id: createId('board'),
    title: DEFAULT_BOARD_TITLE,
    columns: DEFAULT_COLUMNS.map((title) => ({
      id: createId('col'),
      title,
      cards: [],
    })),
  }

  return {
    boards: [defaultBoard],
    activeBoardId: defaultBoard.id,
    tagOptions: [],
    filters: {
      query: '',
      reminder: 'all',
      onlyExpenses: false,
    },
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultState()

    const parsed = JSON.parse(raw)
    const fallback = createDefaultState()
    const boards = Array.isArray(parsed.boards) && parsed.boards.length
      ? parsed.boards
      : Array.isArray(parsed.columns)
        ? [{
            id: createId('board'),
            title: DEFAULT_BOARD_TITLE,
            columns: parsed.columns,
          }]
        : fallback.boards
    const activeBoardId = boards.some((board) => board.id === parsed.activeBoardId)
      ? parsed.activeBoardId
      : boards[0].id

    return {
      boards,
      activeBoardId,
      tagOptions: Array.isArray(parsed.tagOptions) ? parsed.tagOptions : [],
      filters: {
        query: '',
        reminder: 'all',
        onlyExpenses: false,
      },
    }
  } catch {
    return createDefaultState()
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    boards: state.boards,
    activeBoardId: state.activeBoardId,
    tagOptions: state.tagOptions,
  }))
}

function loadReminderSeenMap() {
  try {
    const raw = localStorage.getItem(REMINDER_SEEN_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveReminderSeenMap() {
  localStorage.setItem(REMINDER_SEEN_KEY, JSON.stringify(reminderSeen))
}

function normalizeImportedState(candidate) {
  const fallback = createDefaultState()
  if (!candidate || typeof candidate !== 'object') return fallback

  const parseBoards = (boards) => boards
    .filter((board) => board && typeof board === 'object')
    .map((board) => ({
      id: board.id || createId('board'),
      title: String(board.title || 'Без названия'),
      columns: Array.isArray(board.columns)
        ? board.columns
          .filter((column) => column && typeof column === 'object')
          .map((column) => ({
            id: column.id || createId('col'),
            title: String(column.title || 'Колонка'),
            cards: Array.isArray(column.cards) ? column.cards : [],
          }))
        : [],
    }))
    .filter((board) => board.columns.length > 0)

  let boards = []
  if (Array.isArray(candidate.boards)) {
    boards = parseBoards(candidate.boards)
  } else if (Array.isArray(candidate.columns)) {
    boards = parseBoards([{
      id: createId('board'),
      title: DEFAULT_BOARD_TITLE,
      columns: candidate.columns,
    }])
  }

  if (!boards.length) return fallback

  const activeBoardId = boards.some((board) => board.id === candidate.activeBoardId)
    ? candidate.activeBoardId
    : boards[0].id

  return {
    boards,
    activeBoardId,
    tagOptions: Array.isArray(candidate.tagOptions) ? candidate.tagOptions : [...fallback.tagOptions],
    filters: { ...fallback.filters },
  }
}

function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    state: {
      boards: state.boards,
      activeBoardId: state.activeBoardId,
      tagOptions: state.tagOptions,
    },
    reminderSeen,
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `kanban-export-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function importData(file) {
  if (!file) return
  const raw = await file.text()
  const parsed = JSON.parse(raw)
  const importedState = normalizeImportedState(parsed.state || parsed)

  state.boards = importedState.boards
  state.activeBoardId = importedState.activeBoardId
  state.tagOptions = importedState.tagOptions
  state.filters = importedState.filters

  Object.keys(reminderSeen).forEach((key) => delete reminderSeen[key])
  if (parsed.reminderSeen && typeof parsed.reminderSeen === 'object') {
    Object.entries(parsed.reminderSeen).forEach(([key, value]) => {
      reminderSeen[key] = value
    })
  }

  saveState()
  saveReminderSeenMap()
  render()
}

function formatCurrency(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
}

function getColumnTotal(column) {
  return column.cards.reduce((sum, card) => sum + (Number(card.price) || 0), 0)
}

function getActiveBoard() {
  return state.boards.find((board) => board.id === state.activeBoardId) || state.boards[0] || null
}

function parseDateOnly(value) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function formatDateOnly(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addPeriod(dateString, recurrence, customDays = 0) {
  const date = parseDateOnly(dateString)
  if (!date) return ''

  if (recurrence === 'day') date.setDate(date.getDate() + 1)
  if (recurrence === 'week') date.setDate(date.getDate() + 7)
  if (recurrence === 'month') date.setMonth(date.getMonth() + 1)
  if (recurrence === 'year') date.setFullYear(date.getFullYear() + 1)
  if (recurrence === 'custom' && Number(customDays) > 0) date.setDate(date.getDate() + Number(customDays))

  return formatDateOnly(date)
}

function getReminderStatus(card) {
  if (!card.reminderDate) return 'none'

  const reminderDate = parseDateOnly(card.reminderDate)
  if (!reminderDate) return 'none'

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  reminderDate.setHours(0, 0, 0, 0)

  if (reminderDate < today) return 'overdue'
  if (reminderDate.getTime() === today.getTime()) return 'today'

  const soonDate = new Date(today)
  soonDate.setDate(soonDate.getDate() + 3)
  if (reminderDate <= soonDate) return 'soon'

  return 'scheduled'
}

function getReminderLabel(card) {
  if (!card.reminderDate) return '—'

  const recurrenceMap = {
    none: 'Без повторения',
    day: 'Каждый день',
    week: 'Каждую неделю',
    month: 'Каждый месяц',
    year: 'Каждый год',
  }

  const statusMap = {
    overdue: 'Просрочено',
    today: 'Сегодня',
    soon: 'Скоро',
    scheduled: 'Запланировано',
  }

  const parsed = parseDateOnly(card.reminderDate)
  const formattedDate = parsed ? new Intl.DateTimeFormat('ru-RU').format(parsed) : card.reminderDate
  let recurrence = ''
  if (card.reminderRecurrence === 'custom' && Number(card.reminderCustomDays) > 0) {
    recurrence = ` · Каждые ${Number(card.reminderCustomDays)} дн.`
  } else if (card.reminderRecurrence) {
    recurrence = ` · ${recurrenceMap[card.reminderRecurrence] || recurrenceMap.none}`
  }
  const status = getReminderStatus(card)
  return `${statusMap[status] || 'Запланировано'}: ${formattedDate}${recurrence}`
}

function getNextReminderDate(card) {
  if (!card.reminderDate) return ''
  const recurrence = card.reminderRecurrence || 'day'
  return addPeriod(card.reminderDate, recurrence, card.reminderCustomDays)
}

function parseTags(raw) {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)
}

function mergeTagOptions(tags = []) {
  const normalized = tags
    .map((tag) => String(tag || '').replace(/^#/, '').trim())
    .filter(Boolean)
  if (!normalized.length) return

  const seen = new Set(state.tagOptions.map((tag) => tag.toLowerCase()))
  normalized.forEach((tag) => {
    if (seen.has(tag.toLowerCase())) return
    state.tagOptions.push(tag)
    seen.add(tag.toLowerCase())
  })
}

function pushUndoAction(action) {
  undoStack.push(action)
  if (undoStack.length > 30) undoStack.shift()
}

function undoLastAction() {
  const action = undoStack.pop()
  if (!action) return
  if (action.type !== 'delete-card') return

  const board = state.boards.find((item) => item.id === action.boardId)
  const column = board?.columns.find((item) => item.id === action.columnId)
  if (!column) return
  if (column.cards.some((card) => card.id === action.card.id)) return

  const insertIndex = Math.max(0, Math.min(action.index, column.cards.length))
  column.cards.splice(insertIndex, 0, action.card)
  saveState()
  render()
}

function initTagEditor(form, initialTags = []) {
  const editor = form.querySelector('[data-tag-editor]')
  const list = editor.querySelector('.tag-editor-list')
  const input = editor.querySelector('input[name="tagsInput"]')
  const hidden = form.elements.tags
  let tags = [...initialTags]

  const sync = () => {
    hidden.value = tags.join(', ')
    list.innerHTML = tags.map((tag, index) => `
      <button type="button" class="tag-token" data-remove-tag="${index}">
        <span>${tag}</span>
        <span>×</span>
      </button>
    `).join('')

    list.querySelectorAll('[data-remove-tag]').forEach((button) => {
      button.addEventListener('click', () => {
        tags = tags.filter((_, idx) => idx !== Number(button.dataset.removeTag))
        sync()
        input.focus()
      })
    })
  }

  const addTag = (raw) => {
    const tag = String(raw || '').trim().replace(/^#/, '')
    if (!tag) return
    if (tags.some((item) => item.toLowerCase() === tag.toLowerCase())) return
    tags.push(tag)
    sync()
    input.value = ''
    input.focus()
  }

  input.addEventListener('keydown', (event) => {
    const shouldCreate = event.key === 'Tab' || event.key === 'Enter' || event.key === ','
    if (shouldCreate && input.value.trim()) {
      event.preventDefault()
      addTag(input.value)
      return
    }

    if (event.key === 'Backspace' && !input.value && tags.length) {
      tags.pop()
      sync()
      event.preventDefault()
    }
  })

  input.addEventListener('blur', () => {
    if (input.value.trim()) addTag(input.value)
  })

  sync()

  return {
    getTags: () => [...tags],
    setTags: (nextTags = []) => {
      tags = [...nextTags]
      sync()
    },
  }
}

function cardMatchesFilters(card, query, reminderFilter) {
  const tags = Array.isArray(card.tags) ? card.tags : []
  const textMatches = !query || [
    card.client,
    card.service,
    card.messenger,
    card.phone,
    ...tags,
  ].some((field) => String(field || '').toLowerCase().includes(query))

  if (!textMatches) return false

  if (reminderFilter === 'with' && !card.reminderDate) return false
  if (reminderFilter === 'overdue' && getReminderStatus(card) !== 'overdue') return false

  return true
}

function compareCardsByReminderDate(a, b) {
  const aCompleted = Boolean(a.completed)
  const bCompleted = Boolean(b.completed)
  if (aCompleted !== bCompleted) return aCompleted ? 1 : -1

  const aDate = parseDateOnly(a.reminderDate)
  const bDate = parseDateOnly(b.reminderDate)

  if (aDate && bDate) return aDate - bDate
  if (aDate) return -1
  if (bDate) return 1
  return 0
}

function getVisibleColumns() {
  const query = state.filters.query.trim().toLowerCase()
  const reminderFilter = state.filters.reminder
  const activeBoard = getActiveBoard()
  if (!activeBoard) return []
  const baseColumns = state.filters.onlyExpenses
    ? activeBoard.columns.filter((column) => column.title.toLowerCase().includes('расход'))
    : activeBoard.columns

  return baseColumns.map((column) => ({
    column,
    visibleCards: column.cards
      .filter((card) => cardMatchesFilters(card, query, reminderFilter))
      .sort(compareCardsByReminderDate),
  }))
}

function updateActiveBoard(updater) {
  state.boards = state.boards.map((board) => (board.id === state.activeBoardId ? updater(board) : board))
  saveState()
  render()
}

function updateColumn(columnId, updater) {
  updateActiveBoard((board) => ({
    ...board,
    columns: board.columns.map((column) => (column.id === columnId ? updater(column) : column)),
  }))
}

function openCardDialog(columnId, cardId = null) {
  const column = getActiveBoard()?.columns.find((item) => item.id === columnId)
  const card = column?.cards.find((item) => item.id === cardId)
  const dialog = document.createElement('dialog')
  dialog.className = 'modal'
  dialog.innerHTML = `
    <form class="modal-form" method="dialog">
      <div class="modal-header">
        <h3>${card ? 'Редактировать карточку' : 'Новая карточка'}</h3>
        <button type="button" data-close>✕</button>
      </div>
      <label>Задача<input name="service" required /></label>
      <label>Быстрый шаблон
        <div class="template-row">
          <select name="cardTemplate">
            <option value="">Выберите шаблон</option>
            ${CARD_TEMPLATES.map((template) => `<option value="${template.id}">${template.title}</option>`).join('')}
          </select>
          <button type="button" class="secondary-btn" data-action="apply-template">Применить</button>
        </div>
      </label>
      <label>Клиент<input name="client" required /></label>
      <label>Теги</label>
      <div class="tag-editor" data-tag-editor>
        <div class="tag-editor-list"></div>
        <input name="tagsInput" list="tags-memory-list" placeholder="Введите тег и нажмите Tab" />
      </div>
      <input name="tags" type="hidden" />
      <datalist id="tags-memory-list">
        ${state.tagOptions.map((tag) => `<option value="${tag}"></option>`).join('')}
      </datalist>
      <label>Стоимость, ₽<input name="price" type="number" min="0" /></label>
      <label>Мессенджер<input name="messenger" /></label>
      <label>Телефон<input name="phone" /></label>
      <label>Дата напоминания<input name="reminderDate" type="date" /></label>
      <label>Цикличность</label>
      <div class="recurrence-buttons" data-recurrence-group>
        <button type="button" class="recurrence-btn" data-recurrence="none">Без повторения</button>
        <button type="button" class="recurrence-btn" data-recurrence="day">Каждый день</button>
        <button type="button" class="recurrence-btn" data-recurrence="week">Каждую неделю</button>
        <button type="button" class="recurrence-btn" data-recurrence="month">Каждый месяц</button>
        <button type="button" class="recurrence-btn" data-recurrence="year">Каждый год</button>
        <button type="button" class="recurrence-btn" data-recurrence="custom">Через N дней</button>
      </div>
      <input name="reminderRecurrence" type="hidden" value="none" />
      <label>Через сколько дней
        <input name="reminderCustomDays" type="number" min="1" step="1" placeholder="Например, 10" />
      </label>
      <div class="modal-actions">
        <button type="button" class="secondary-btn" data-close>Отмена</button>
        <button type="submit" class="primary-btn">Сохранить</button>
      </div>
    </form>
  `

  const form = dialog.querySelector('form')
  const tagEditor = initTagEditor(form, Array.isArray(card?.tags) ? card.tags : [])
  form.elements.service.value = card?.service ?? ''
  form.elements.client.value = card?.client ?? ''
  form.elements.price.value = card?.price ?? ''
  form.elements.messenger.value = card?.messenger ?? ''
  form.elements.phone.value = card?.phone ?? ''
  form.elements.reminderDate.value = card?.reminderDate ?? ''
  form.elements.reminderCustomDays.value = Number(card?.reminderCustomDays) > 0 ? Number(card.reminderCustomDays) : ''

  const recurrenceButtons = Array.from(form.querySelectorAll('[data-recurrence]'))
  const customDaysInput = form.elements.reminderCustomDays
  const setRecurrence = (value) => {
    const normalized = value || 'none'
    form.elements.reminderRecurrence.value = normalized
    recurrenceButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.recurrence === normalized))
    customDaysInput.disabled = normalized !== 'custom'
    if (normalized !== 'custom') customDaysInput.value = ''
  }

  recurrenceButtons.forEach((button) => {
    button.addEventListener('click', () => setRecurrence(button.dataset.recurrence))
  })
  setRecurrence(card?.reminderRecurrence || 'none')
  if ((card?.reminderRecurrence || 'none') === 'custom' && Number(card?.reminderCustomDays) > 0) {
    customDaysInput.value = Number(card.reminderCustomDays)
  }

  form.querySelector('[data-action="apply-template"]').addEventListener('click', () => {
    const templateId = form.elements.cardTemplate.value
    const template = CARD_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return

    form.elements.service.value = template.service || ''
    form.elements.price.value = Number(template.price) > 0 ? Number(template.price) : ''
    tagEditor.setTags(Array.isArray(template.tags) ? template.tags : [])
    mergeTagOptions(Array.isArray(template.tags) ? template.tags : [])
    form.elements.client.focus()
  })

  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()))
  form.addEventListener('submit', (event) => {
    event.preventDefault()

    const payload = {
      client: form.elements.client.value.trim(),
      service: form.elements.service.value.trim(),
      price: Number(form.elements.price.value) || 0,
      messenger: form.elements.messenger.value.trim(),
      phone: form.elements.phone.value.trim(),
      tags: tagEditor.getTags(),
      reminderDate: form.elements.reminderDate.value || '',
      reminderRecurrence: form.elements.reminderRecurrence.value === 'none' ? '' : form.elements.reminderRecurrence.value,
      reminderCustomDays: Number(form.elements.reminderCustomDays.value) > 0 ? Number(form.elements.reminderCustomDays.value) : 0,
    }

    if (!payload.client || !payload.service) return
    mergeTagOptions(payload.tags)

    updateColumn(columnId, (columnState) => ({
      ...columnState,
      cards: card
        ? columnState.cards.map((item) => (item.id === card.id ? { ...item, ...payload } : item))
        : [...columnState.cards, { id: createId('card'), ...payload }],
    }))
    dialog.close()
  })

  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog)
  dialog.showModal()
}

function moveItem(list, fromIndex, toIndex) {
  const copy = [...list]
  const [item] = copy.splice(fromIndex, 1)
  copy.splice(toIndex, 0, item)
  return copy
}

function onDragStart(event) {
  const columnEl = event.target.closest('[data-column-id]')
  const cardEl = event.target.closest('[data-card-id]')

  if (cardEl) {
    event.dataTransfer.setData('application/json', JSON.stringify({
      type: 'card',
      cardId: cardEl.dataset.cardId,
      fromColumnId: cardEl.dataset.parentColumnId,
    }))
    event.dataTransfer.effectAllowed = 'move'
    return
  }

  if (columnEl) {
    event.dataTransfer.setData('application/json', JSON.stringify({
      type: 'column',
      columnId: columnEl.dataset.columnId,
    }))
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onDrop(event) {
  event.preventDefault()
  const raw = event.dataTransfer.getData('application/json')
  if (!raw) return

  const payload = JSON.parse(raw)
  const targetCard = event.target.closest('[data-card-id]')
  const targetColumn = event.target.closest('[data-column-id]')
  if (!targetColumn) return

  if (payload.type === 'column') {
    const activeBoard = getActiveBoard()
    if (!activeBoard) return
    const fromIndex = activeBoard.columns.findIndex((column) => column.id === payload.columnId)
    const toIndex = activeBoard.columns.findIndex((column) => column.id === targetColumn.dataset.columnId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

    activeBoard.columns = moveItem(activeBoard.columns, fromIndex, toIndex)
    saveState()
    render()
    return
  }

  if (payload.type !== 'card') return

  const activeBoard = getActiveBoard()
  if (!activeBoard) return
  const sourceColumn = activeBoard.columns.find((column) => column.id === payload.fromColumnId)
  const destinationColumn = activeBoard.columns.find((column) => column.id === targetColumn.dataset.columnId)
  if (!sourceColumn || !destinationColumn) return

  const cardIndex = sourceColumn.cards.findIndex((card) => card.id === payload.cardId)
  if (cardIndex < 0) return

  const [card] = sourceColumn.cards.splice(cardIndex, 1)
  const insertIndex = targetCard
    ? destinationColumn.cards.findIndex((item) => item.id === targetCard.dataset.cardId)
    : destinationColumn.cards.length

  destinationColumn.cards.splice(insertIndex < 0 ? destinationColumn.cards.length : insertIndex, 0, card)
  saveState()
  render()
}

function getReminderDueCards() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const due = []
  state.boards.forEach((board) => {
    board.columns.forEach((column) => {
      column.cards.forEach((card) => {
        const reminder = parseDateOnly(card.reminderDate)
        if (!reminder) return
        reminder.setHours(0, 0, 0, 0)
        if (reminder <= today) due.push({ board, column, card })
      })
    })
  })

  return due
}

function notifyDueReminders() {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  const dueCards = getReminderDueCards()
  if (!dueCards.length) return

  dueCards.forEach(({ board, column, card }) => {
    const reminderKey = `${card.id}|${card.reminderDate}`
    if (reminderSeen[reminderKey]) return

    const title = card.client || 'Напоминание по карточке'
    const body = `${card.service || 'Услуга'} • ${board.title} / ${column.title}`
    new Notification(title, { body })

    reminderSeen[reminderKey] = Date.now()
  })

  saveReminderSeenMap()
}

function ensureReminderScheduler() {
  if (reminderSchedulerStarted) return
  reminderSchedulerStarted = true

  notifyDueReminders()
  setInterval(notifyDueReminders, 60000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) notifyDueReminders()
  })
}

function renderTags(tags = []) {
  if (!tags.length) return ''
  return `<div class="tag-list">${tags.map((tag) => `<span class="tag-chip">#${tag}</span>`).join('')}</div>`
}

function renderCard(card, columnId) {
  const reminderStatus = getReminderStatus(card)
  const isCompleted = Boolean(card.completed)

  return `
    <article class="card reminder-${reminderStatus} ${isCompleted ? 'card-completed' : ''}" draggable="true" data-card-id="${card.id}" data-parent-column-id="${columnId}">
      <div class="card-head">
        <strong>${card.service}</strong>
        <span>${formatCurrency(card.price)}</span>
      </div>
      <p>${card.client}</p>
      ${renderTags(card.tags || [])}
      <dl class="card-meta">
        <div><dt>Мессенджер</dt><dd>${card.messenger || '—'}</dd></div>
        <div><dt>Телефон</dt><dd>${card.phone || '—'}</dd></div>
        <div><dt>Напоминание</dt><dd>${getReminderLabel(card)}</dd></div>
      </dl>
      <div class="card-actions">
        <label class="reminder-done">
          <input type="checkbox" data-action="complete-reminder" data-column-id="${columnId}" data-card-id="${card.id}" ${isCompleted ? 'checked' : ''} />
          <span>${isCompleted ? 'Завершено' : 'Выполнено'}</span>
        </label>
        <button class="danger-btn" data-action="delete-card" data-column-id="${columnId}" data-card-id="${card.id}">Удалить</button>
      </div>
    </article>
  `
}

function renderColumn({ column, visibleCards }) {
  const total = getColumnTotal(column)
  const tone = column.title.toLowerCase().includes('расход') ? 'expense' : 'income'

  return `
    <section class="column ${tone}" draggable="true" data-column-id="${column.id}">
      <div class="column-header">
        <div>
          <h2>${column.title}</h2>
          <p>${formatCurrency(total)}</p>
        </div>
        <div class="column-actions">
          <button data-action="rename-column" data-column-id="${column.id}">✎</button>
          <button data-action="delete-column" data-column-id="${column.id}">🗑</button>
        </div>
      </div>
      <button class="ghost-btn" data-action="add-card" data-column-id="${column.id}">+ Быстро добавить</button>
      <div class="card-list">
        ${visibleCards.length ? visibleCards.map((card) => renderCard(card, column.id)).join('') : '<div class="empty-state">Перетащите сюда карточку или создайте новую.</div>'}
      </div>
    </section>
  `
}

function bindBoardEvents(board) {
  board.querySelectorAll('[data-action="add-card"]').forEach((button) => button.addEventListener('click', () => openCardDialog(button.dataset.columnId)))

  board.querySelectorAll('[data-action="delete-card"]').forEach((button) => {
    button.addEventListener('click', () => {
      const column = getActiveBoard()?.columns.find((item) => item.id === button.dataset.columnId)
      const index = column?.cards.findIndex((card) => card.id === button.dataset.cardId) ?? -1
      const cardToDelete = index >= 0 ? column.cards[index] : null
      if (cardToDelete) {
        pushUndoAction({
          type: 'delete-card',
          boardId: state.activeBoardId,
          columnId: button.dataset.columnId,
          card: structuredClone(cardToDelete),
          index,
        })
      }

      updateColumn(button.dataset.columnId, (column) => ({
        ...column,
        cards: column.cards.filter((card) => card.id !== button.dataset.cardId),
      }))
    })
    button.addEventListener('dblclick', (event) => event.stopPropagation())
  })

  board.querySelectorAll('[data-action="complete-reminder"]').forEach((checkbox) => {
    checkbox.addEventListener('click', (event) => event.stopPropagation())
    checkbox.addEventListener('change', (event) => {
      const { columnId, cardId } = checkbox.dataset
      updateColumn(columnId, (column) => ({
        ...column,
        cards: column.cards.map((card) => {
          if (card.id !== cardId) return card
          if (!event.target.checked) return { ...card, completed: false, completedAt: null }

          if (!card.reminderRecurrence) {
            return { ...card, completed: true, completedAt: Date.now() }
          }

          if (!card.reminderDate) {
            return { ...card, completed: true, completedAt: Date.now() }
          }

          const nextDate = getNextReminderDate(card)
          return nextDate
            ? { ...card, reminderDate: nextDate, completed: false, completedAt: null }
            : card
        }),
      }))
    })
  })

  board.querySelectorAll('[data-card-id]').forEach((card) => {
    card.addEventListener('dblclick', () => openCardDialog(card.dataset.parentColumnId, card.dataset.cardId))
  })

  board.querySelectorAll('[data-action="rename-column"]').forEach((button) => button.addEventListener('click', () => {
    const column = getActiveBoard()?.columns.find((item) => item.id === button.dataset.columnId)
    const title = prompt('Новое название колонки', column?.title ?? '')
    if (!title?.trim()) return

    updateColumn(button.dataset.columnId, (columnState) => ({ ...columnState, title: title.trim() }))
  }))

  board.querySelectorAll('[data-action="delete-column"]').forEach((button) => button.addEventListener('click', () => {
    const column = getActiveBoard()?.columns.find((item) => item.id === button.dataset.columnId)
    if (!column || !confirm(`Удалить колонку «${column.title}» со всеми карточками?`)) return

    updateActiveBoard((boardState) => ({
      ...boardState,
      columns: boardState.columns.filter((item) => item.id !== button.dataset.columnId),
    }))
  }))

  board.querySelectorAll('[draggable="true"]').forEach((item) => item.addEventListener('dragstart', onDragStart))
  board.querySelectorAll('[data-column-id], [data-card-id]').forEach((item) => {
    item.addEventListener('dragover', (event) => event.preventDefault())
    item.addEventListener('drop', onDrop)
  })
}

function updateNotificationButton() {
  const button = document.querySelector('#enable-notifications-btn')
  if (!button) return
  if (!('Notification' in window)) {
    button.textContent = 'Напоминания недоступны'
    button.disabled = true
    return
  }

  if (Notification.permission === 'granted') {
    button.textContent = 'Напоминания включены'
    button.disabled = true
    return
  }

  if (Notification.permission === 'denied') {
    button.textContent = 'Разрешите уведомления в браузере'
    button.disabled = true
    return
  }

  button.textContent = 'Включить напоминания'
  button.disabled = false
}

function render() {
  const app = document.querySelector('#app')
  const activeBoard = getActiveBoard()

  if (!app.querySelector('.app-shell')) {
    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar toolbar-row">
          <div class="toolbar-left">
            <div class="board-tabs" id="board-tabs"></div>
            <button class="secondary-btn" id="add-board-btn">+ Доска</button>
            <button class="primary-btn" id="add-column-btn">+ Колонка</button>
            <input class="search-input" id="search-input" placeholder="Поиск по клиентам, услугам" />
            <select class="filter-select" id="reminder-filter">
              <option value="all">Все карточки</option>
              <option value="with">Только с напоминаниями</option>
              <option value="overdue">Только просроченные</option>
            </select>
            <label class="checkbox-filter"><input id="expense-filter" type="checkbox" /> Только расходы</label>
            <button class="secondary-btn" id="export-data-btn">Экспорт</button>
            <button class="secondary-btn" id="import-data-btn">Импорт</button>
            <input id="import-file-input" type="file" accept="application/json" hidden />
            <button class="secondary-btn" id="enable-notifications-btn">Включить напоминания</button>
          </div>
        </header>
        <main class="board-grid" id="board-grid"></main>
      </div>
    `

    document.querySelector('#add-board-btn').addEventListener('click', () => {
      const title = prompt('Название новой доски')
      if (!title?.trim()) return

      const board = {
        id: createId('board'),
        title: title.trim(),
        columns: NEW_BOARD_COLUMNS.map((columnTitle) => ({ id: createId('col'), title: columnTitle, cards: [] })),
      }

      state.boards.push(board)
      state.activeBoardId = board.id
      saveState()
      render()
    })

    document.querySelector('#add-column-btn').addEventListener('click', () => {
      const board = getActiveBoard()
      if (!board) return
      const title = prompt('Название новой колонки')
      if (!title?.trim()) return

      board.columns.push({ id: createId('col'), title: title.trim(), cards: [] })
      saveState()
      render()
    })

    document.querySelector('#search-input').addEventListener('input', (event) => {
      state.filters.query = event.target.value
      render()
    })

    document.querySelector('#reminder-filter').addEventListener('change', (event) => {
      state.filters.reminder = event.target.value
      render()
    })

    document.querySelector('#expense-filter').addEventListener('change', (event) => {
      state.filters.onlyExpenses = event.target.checked
      render()
    })

    document.querySelector('#enable-notifications-btn').addEventListener('click', async () => {
      if (!('Notification' in window)) return
      const result = await Notification.requestPermission()
      if (result === 'granted') notifyDueReminders()
      updateNotificationButton()
    })

    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      const activeTag = document.activeElement?.tagName?.toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return
      event.preventDefault()
      undoLastAction()
    })

    document.querySelector('#export-data-btn').addEventListener('click', exportData)

    const importFileInput = document.querySelector('#import-file-input')
    document.querySelector('#import-data-btn').addEventListener('click', () => importFileInput.click())
    importFileInput.addEventListener('change', async (event) => {
      const [file] = event.target.files || []
      if (!file) return
      try {
        await importData(file)
      } catch (error) {
        alert(`Не удалось импортировать файл: ${error.message}`)
      } finally {
        event.target.value = ''
      }
    })
  }

  const boardTabs = document.querySelector('#board-tabs')
  boardTabs.innerHTML = state.boards.map((board) => `
    <button
      class="board-tab ${board.id === activeBoard?.id ? 'is-active' : ''}"
      data-action="switch-board"
      data-board-id="${board.id}"
      type="button"
    >${board.title}</button>
  `).join('')
  boardTabs.querySelectorAll('[data-action="switch-board"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeBoardId = button.dataset.boardId
      render()
    })
  })

  const searchInput = document.querySelector('#search-input')
  if (document.activeElement !== searchInput) {
    searchInput.value = state.filters.query
  }
  document.querySelector('#reminder-filter').value = state.filters.reminder
  document.querySelector('#expense-filter').checked = state.filters.onlyExpenses

  updateNotificationButton()

  const board = document.querySelector('#board-grid')
  board.innerHTML = getVisibleColumns().map((entry) => renderColumn(entry)).join('')
  bindBoardEvents(board)
}

render()
ensureReminderScheduler()
