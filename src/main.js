const STORAGE_KEY = 'financial-kanban-board'
const REMINDER_SEEN_KEY = 'financial-kanban-reminder-seen'
const DEFAULT_COLUMNS = ['Новые клиенты', 'На согласовании', 'Ожидание оплаты', 'Регулярные', 'Расходы', 'Клиенты ушли']

const state = loadState()
const reminderSeen = loadReminderSeenMap()
let reminderSchedulerStarted = false

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function createDefaultState() {
  return {
    columns: DEFAULT_COLUMNS.map((title) => ({
      id: createId('col'),
      title,
      cards: [],
    })),
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
    return {
      columns: Array.isArray(parsed.columns) ? parsed.columns : createDefaultState().columns,
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns: state.columns }))
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

function addPeriod(dateString, recurrence) {
  const date = parseDateOnly(dateString)
  if (!date) return ''

  if (recurrence === 'day') date.setDate(date.getDate() + 1)
  if (recurrence === 'week') date.setDate(date.getDate() + 7)
  if (recurrence === 'month') date.setMonth(date.getMonth() + 1)

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
    day: 'Каждый день',
    week: 'Каждую неделю',
    month: 'Каждый месяц',
  }

  const statusMap = {
    overdue: 'Просрочено',
    today: 'Сегодня',
    soon: 'Скоро',
    scheduled: 'Запланировано',
  }

  const parsed = parseDateOnly(card.reminderDate)
  const formattedDate = parsed ? new Intl.DateTimeFormat('ru-RU').format(parsed) : card.reminderDate
  const recurrence = card.reminderRecurrence ? ` · ${recurrenceMap[card.reminderRecurrence]}` : ''
  const status = getReminderStatus(card)
  return `${statusMap[status] || 'Запланировано'}: ${formattedDate}${recurrence}`
}

function getNextReminderDate(card) {
  if (!card.reminderDate) return ''
  const recurrence = card.reminderRecurrence || 'day'
  return addPeriod(card.reminderDate, recurrence)
}

function parseTags(raw) {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
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
  const baseColumns = state.filters.onlyExpenses
    ? state.columns.filter((column) => column.title.toLowerCase().includes('расход'))
    : state.columns

  return baseColumns.map((column) => ({
    column,
    visibleCards: column.cards
      .filter((card) => cardMatchesFilters(card, query, reminderFilter))
      .sort(compareCardsByReminderDate),
  }))
}

function updateColumn(columnId, updater) {
  state.columns = state.columns.map((column) => (column.id === columnId ? updater(column) : column))
  saveState()
  render()
}

function openCardDialog(columnId, cardId = null) {
  const column = state.columns.find((item) => item.id === columnId)
  const card = column?.cards.find((item) => item.id === cardId)
  const dialog = document.createElement('dialog')
  dialog.className = 'modal'
  dialog.innerHTML = `
    <form class="modal-form" method="dialog">
      <div class="modal-header">
        <h3>${card ? 'Редактировать карточку' : 'Новая карточка'}</h3>
        <button type="button" data-close>✕</button>
      </div>
      <label>Клиент<input name="client" required /></label>
      <label>Услуга<input name="service" required /></label>
      <label>Стоимость, ₽<input name="price" type="number" min="0" /></label>
      <label>Мессенджер<input name="messenger" /></label>
      <label>Телефон<input name="phone" /></label>
      <label>Теги (через запятую)<input name="tags" placeholder="например: VIP, срочно" /></label>
      <label>Дата напоминания<input name="reminderDate" type="date" /></label>
      <label>Цикличность
        <select name="reminderRecurrence">
          <option value="">Без повторения</option>
          <option value="day">Каждый день</option>
          <option value="week">Каждую неделю</option>
          <option value="month">Каждый месяц</option>
        </select>
      </label>
      <div class="modal-actions">
        <button type="button" class="secondary-btn" data-close>Отмена</button>
        <button type="submit" class="primary-btn">Сохранить</button>
      </div>
    </form>
  `

  const form = dialog.querySelector('form')
  form.elements.client.value = card?.client ?? ''
  form.elements.service.value = card?.service ?? ''
  form.elements.price.value = card?.price ?? ''
  form.elements.messenger.value = card?.messenger ?? ''
  form.elements.phone.value = card?.phone ?? ''
  form.elements.tags.value = Array.isArray(card?.tags) ? card.tags.join(', ') : ''
  form.elements.reminderDate.value = card?.reminderDate ?? ''
  form.elements.reminderRecurrence.value = card?.reminderRecurrence ?? ''

  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()))
  form.addEventListener('submit', (event) => {
    event.preventDefault()

    const payload = {
      client: form.elements.client.value.trim(),
      service: form.elements.service.value.trim(),
      price: Number(form.elements.price.value) || 0,
      messenger: form.elements.messenger.value.trim(),
      phone: form.elements.phone.value.trim(),
      tags: parseTags(form.elements.tags.value),
      reminderDate: form.elements.reminderDate.value || '',
      reminderRecurrence: form.elements.reminderRecurrence.value || '',
    }

    if (!payload.client || !payload.service) return

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
    const fromIndex = state.columns.findIndex((column) => column.id === payload.columnId)
    const toIndex = state.columns.findIndex((column) => column.id === targetColumn.dataset.columnId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return

    state.columns = moveItem(state.columns, fromIndex, toIndex)
    saveState()
    render()
    return
  }

  if (payload.type !== 'card') return

  const sourceColumn = state.columns.find((column) => column.id === payload.fromColumnId)
  const destinationColumn = state.columns.find((column) => column.id === targetColumn.dataset.columnId)
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
  state.columns.forEach((column) => {
    column.cards.forEach((card) => {
      const reminder = parseDateOnly(card.reminderDate)
      if (!reminder) return
      reminder.setHours(0, 0, 0, 0)
      if (reminder <= today) due.push({ column, card })
    })
  })

  return due
}

function notifyDueReminders() {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  const dueCards = getReminderDueCards()
  if (!dueCards.length) return

  dueCards.forEach(({ column, card }) => {
    const reminderKey = `${card.id}|${card.reminderDate}`
    if (reminderSeen[reminderKey]) return

    const title = card.client || 'Напоминание по карточке'
    const body = `${card.service || 'Услуга'} • ${column.title}`
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
  const canCompleteReminder = Boolean(card.reminderDate)

  return `
    <article class="card reminder-${reminderStatus}" draggable="true" data-card-id="${card.id}" data-parent-column-id="${columnId}">
      <div class="card-head">
        <strong>${card.client}</strong>
        <span>${formatCurrency(card.price)}</span>
      </div>
      <p>${card.service}</p>
      ${renderTags(card.tags || [])}
      <dl class="card-meta">
        <div><dt>Мессенджер</dt><dd>${card.messenger || '—'}</dd></div>
        <div><dt>Телефон</dt><dd>${card.phone || '—'}</dd></div>
        <div><dt>Напоминание</dt><dd>${getReminderLabel(card)}</dd></div>
      </dl>
      <div class="card-actions">
        <label class="reminder-done">
          <input type="checkbox" data-action="complete-reminder" data-column-id="${columnId}" data-card-id="${card.id}" ${canCompleteReminder ? '' : 'disabled'} />
          <span>Выполнено</span>
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
      if (!event.target.checked) return

      const { columnId, cardId } = checkbox.dataset
      updateColumn(columnId, (column) => ({
        ...column,
        cards: column.cards.map((card) => {
          if (card.id !== cardId || !card.reminderDate) return card
          const nextDate = getNextReminderDate(card)
          return nextDate ? { ...card, reminderDate: nextDate } : card
        }),
      }))
    })
  })

  board.querySelectorAll('[data-card-id]').forEach((card) => {
    card.addEventListener('dblclick', () => openCardDialog(card.dataset.parentColumnId, card.dataset.cardId))
  })

  board.querySelectorAll('[data-action="rename-column"]').forEach((button) => button.addEventListener('click', () => {
    const column = state.columns.find((item) => item.id === button.dataset.columnId)
    const title = prompt('Новое название колонки', column?.title ?? '')
    if (!title?.trim()) return

    updateColumn(button.dataset.columnId, (columnState) => ({ ...columnState, title: title.trim() }))
  }))

  board.querySelectorAll('[data-action="delete-column"]').forEach((button) => button.addEventListener('click', () => {
    const column = state.columns.find((item) => item.id === button.dataset.columnId)
    if (!column || !confirm(`Удалить колонку «${column.title}» со всеми карточками?`)) return

    state.columns = state.columns.filter((item) => item.id !== button.dataset.columnId)
    saveState()
    render()
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

  if (!app.querySelector('.app-shell')) {
    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar toolbar-row">
          <div class="toolbar-left">
            <button class="primary-btn" id="add-column-btn">+ Колонка</button>
            <input class="search-input" id="search-input" placeholder="Поиск по клиентам, услугам" />
            <select class="filter-select" id="reminder-filter">
              <option value="all">Все карточки</option>
              <option value="with">Только с напоминаниями</option>
              <option value="overdue">Только просроченные</option>
            </select>
            <label class="checkbox-filter"><input id="expense-filter" type="checkbox" /> Только расходы</label>
            <button class="secondary-btn" id="enable-notifications-btn">Включить напоминания</button>
          </div>
        </header>
        <main class="board-grid" id="board-grid"></main>
      </div>
    `

    document.querySelector('#add-column-btn').addEventListener('click', () => {
      const title = prompt('Название новой колонки')
      if (!title?.trim()) return

      state.columns.push({ id: createId('col'), title: title.trim(), cards: [] })
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
  }

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
