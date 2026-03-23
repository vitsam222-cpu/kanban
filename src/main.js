const STORAGE_KEY = 'financial-kanban-board'
const defaultColumns = ['Новые клиенты', 'На согласовании', 'Ожидание оплаты', 'Регулярные', 'Расходы', 'Клиенты ушли']

const state = loadState()

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function createDefaultState() {
  return {
    columns: defaultColumns.map((title) => ({ id: createId('col'), title, cards: [] })),
    filters: { query: '' },
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultState()
    const parsed = JSON.parse(raw)
    return {
      columns: Array.isArray(parsed.columns) ? parsed.columns : createDefaultState().columns,
      filters: { query: '' },
    }
  } catch {
    return createDefaultState()
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns: state.columns }))
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

function getBoardBalance() {
  return state.columns.reduce((sum, column) => {
    const total = getColumnTotal(column)
    return sum + (column.title.toLowerCase().includes('расход') ? -total : total)
  }, 0)
}

function getVisibleColumns() {
  const base = state.columns

  const query = state.filters.query.trim().toLowerCase()
  if (!query) return base

  return base.map((column) => ({
    ...column,
    cards: column.cards.filter((card) => [card.client, card.service, card.messenger, card.phone].some((field) => String(field).toLowerCase().includes(query))),
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
      <label>Клиент<input name="client" required value="${card?.client ?? ''}" /></label>
      <label>Услуга<input name="service" required value="${card?.service ?? ''}" /></label>
      <label>Стоимость, ₽<input name="price" type="number" min="0" value="${card?.price ?? ''}" /></label>
      <label>Мессенджер<input name="messenger" value="${card?.messenger ?? ''}" /></label>
      <label>Телефон<input name="phone" value="${card?.phone ?? ''}" /></label>
      <div class="modal-actions">
        <button type="button" class="secondary-btn" data-close>Отмена</button>
        <button type="submit" class="primary-btn">Сохранить</button>
      </div>
    </form>
  `

  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()))
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const payload = Object.fromEntries(formData.entries())
    const prepared = {
      client: payload.client.trim(),
      service: payload.service.trim(),
      price: Number(payload.price) || 0,
      messenger: payload.messenger.trim(),
      phone: payload.phone.trim(),
    }

    updateColumn(columnId, (columnState) => ({
      ...columnState,
      cards: card
        ? columnState.cards.map((item) => (item.id === card.id ? { ...item, ...prepared } : item))
        : [...columnState.cards, { id: createId('card'), ...prepared }],
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
    event.dataTransfer.setData('application/json', JSON.stringify({ type: 'card', cardId: cardEl.dataset.cardId, fromColumnId: cardEl.dataset.parentColumnId }))
    event.dataTransfer.effectAllowed = 'move'
    return
  }

  if (columnEl) {
    event.dataTransfer.setData('application/json', JSON.stringify({ type: 'column', columnId: columnEl.dataset.columnId }))
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
  const insertIndex = targetCard ? destinationColumn.cards.findIndex((item) => item.id === targetCard.dataset.cardId) : destinationColumn.cards.length
  destinationColumn.cards.splice(insertIndex < 0 ? destinationColumn.cards.length : insertIndex, 0, card)
  saveState()
  render()
}

function render() {
  const app = document.querySelector('#app')
  const visibleColumns = getVisibleColumns()

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar toolbar-row">
        <div class="toolbar-left">
          <button class="primary-btn" id="add-column-btn">+ Колонка</button>
          <input class="search-input" id="search-input" placeholder="Поиск по клиентам, услугам" value="${state.filters.query}" />
        </div>
      </header>

      <main class="board-grid" id="board-grid">
        ${visibleColumns.map((column) => {
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
                ${column.cards.length ? column.cards.map((card) => `
                  <article class="card" draggable="true" data-card-id="${card.id}" data-parent-column-id="${column.id}">
                    <div class="card-head">
                      <strong>${card.client}</strong>
                      <span>${formatCurrency(card.price)}</span>
                    </div>
                    <p>${card.service}</p>
                    <dl class="card-meta">
                      <div><dt>Мессенджер</dt><dd>${card.messenger || '—'}</dd></div>
                      <div><dt>Телефон</dt><dd>${card.phone || '—'}</dd></div>
                    </dl>
                    <div class="card-actions">
                      <button data-action="edit-card" data-column-id="${column.id}" data-card-id="${card.id}">Редактировать</button>
                      <button data-action="delete-card" data-column-id="${column.id}" data-card-id="${card.id}">Удалить</button>
                    </div>
                  </article>
                `).join('') : '<div class="empty-state">Перетащите сюда карточку или создайте новую.</div>'}
              </div>
            </section>
          `
        }).join('')}
      </main>
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

  app.querySelectorAll('[data-action="add-card"]').forEach((button) => button.addEventListener('click', () => openCardDialog(button.dataset.columnId)))
  app.querySelectorAll('[data-action="edit-card"]').forEach((button) => button.addEventListener('click', () => openCardDialog(button.dataset.columnId, button.dataset.cardId)))
  app.querySelectorAll('[data-action="delete-card"]').forEach((button) => button.addEventListener('click', () => {
    updateColumn(button.dataset.columnId, (column) => ({ ...column, cards: column.cards.filter((card) => card.id !== button.dataset.cardId) }))
  }))
  app.querySelectorAll('[data-action="rename-column"]').forEach((button) => button.addEventListener('click', () => {
    const column = state.columns.find((item) => item.id === button.dataset.columnId)
    const title = prompt('Новое название колонки', column?.title ?? '')
    if (!title?.trim()) return
    updateColumn(button.dataset.columnId, (columnState) => ({ ...columnState, title: title.trim() }))
  }))
  app.querySelectorAll('[data-action="delete-column"]').forEach((button) => button.addEventListener('click', () => {
    const column = state.columns.find((item) => item.id === button.dataset.columnId)
    if (!column || !confirm(`Удалить колонку «${column.title}» со всеми карточками?`)) return
    state.columns = state.columns.filter((item) => item.id !== button.dataset.columnId)
    saveState()
    render()
  }))

  app.querySelectorAll('[draggable="true"]').forEach((item) => item.addEventListener('dragstart', onDragStart))
  app.querySelectorAll('[data-column-id], [data-card-id]').forEach((item) => {
    item.addEventListener('dragover', (event) => event.preventDefault())
    item.addEventListener('drop', onDrop)
  })
}

render()
