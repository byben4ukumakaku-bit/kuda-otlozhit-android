// Финансовый планировщик. Локальная версия для Android.
function parseWholeAmount(value) {
  const compact = String(value).replace(/[\s\u00a0\u202f]/g, '').replace(/₽$/, '');
  if (!/^\d+$/.test(compact)) return null;
  const amount = Number(compact);
  return Number.isSafeInteger(amount) ? amount : null;
}

function parseIncome(value) {
  const text = String(value);
  if (/[−-]\s*\d/.test(text)) return null;
  const matches = text.match(/\d[\d\s\u00a0\u202f]*/g) || [];
  if (matches.length !== 1) return null;
  return parseWholeAmount(matches[0]);
}

function daysUntil(date, now) {
  if (!date) return null;
  const due = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(due)) return null;
  return Math.ceil((due - now) / 86400000);
}

function reasonFor(goal, days) {
  if (days !== null && days <= 0) return 'Срок цели уже наступил';
  if (days !== null && days <= 30) return 'Срок близко';
  if (days !== null) return `До срока около ${Math.max(1, Math.ceil(days / 30))} мес.`;
  return goal.priority === 'high' ? 'Важная цель' : 'Без срока';
}

function planAllocation(income, share, goals, now = Date.now()) {
  if (!Number.isSafeInteger(income) || income < 0 || !Number.isInteger(share) || share < 0 || share > 100) {
    throw new RangeError('Некорректные сумма или доля');
  }
  const budget = Math.round(income * share / 100);
  const candidates = goals.map(goal => {
    const remaining = Math.max(0, goal.target - goal.saved);
    const days = daysUntil(goal.date, now);
    const months = days === null ? 12 : Math.max(1, days / 30.44);
    return {
      id: goal.id,
      name: goal.name,
      remaining,
      weight: remaining / months * (goal.priority === 'high' ? 1.5 : 1),
      reason: reasonFor(goal, days),
      amount: 0
    };
  }).filter(goal => goal.remaining > 0 && Number.isFinite(goal.weight));

  let left = Math.min(budget, candidates.reduce((sum, goal) => sum + goal.remaining, 0));
  while (left > 0) {
    const active = candidates.filter(goal => goal.amount < goal.remaining);
    if (!active.length) break;
    const totalWeight = active.reduce((sum, goal) => sum + goal.weight, 0);
    if (totalWeight <= 0) break;
    const shares = active.map(goal => ({goal, ideal: left * goal.weight / totalWeight}));
    let distributed = 0;
    for (const item of shares) {
      const grant = Math.min(item.goal.remaining - item.goal.amount, Math.floor(item.ideal));
      item.goal.amount += grant;
      distributed += grant;
    }
    left -= distributed;
    if (left === 0) break;
    // The remaining fractional shares are assigned in descending order; capped
    // goals are removed on the next pass so no planned amount exceeds a target.
    const best = shares.filter(item => item.goal.amount < item.goal.remaining)
      .sort((a, b) => (b.ideal - Math.floor(b.ideal)) - (a.ideal - Math.floor(a.ideal)) || b.goal.weight - a.goal.weight)[0];
    if (!best) continue;
    best.goal.amount += 1;
    left -= 1;
  }
  const allocations = candidates.filter(goal => goal.amount > 0)
    .map(({id, name, amount, reason}) => ({id, name, amount, reason}));
  const savings = allocations.reduce((sum, goal) => sum + goal.amount, 0);
  return {income, share, budget, savings, expenses: income - savings, allocations};
}


const STORAGE_KEY = 'kuda-otlozhit-v1';
const format = amount => `${new Intl.NumberFormat('ru-RU').format(amount)} ₽`;
const $ = selector => document.querySelector(selector);
const defaultState = () => ({
  share: 20,
  income: '',
  goals: [{id: 'initial-cushion', name: 'Подушка безопасности', target: 100000, saved: 0, date: '', priority: 'high', example: true}],
  plan: null
});

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.goals)) return defaultState();
    return {
      share: Number.isInteger(saved.share) && saved.share >= 0 && saved.share <= 100 ? saved.share : 20,
      income: typeof saved.income === 'string' ? saved.income.slice(0, 100) : '',
      goals: saved.goals.filter(g => typeof g.id === 'string' && typeof g.name === 'string' && Number.isSafeInteger(g.target) && g.target > 0 && Number.isSafeInteger(g.saved) && g.saved >= 0).map(g => ({...g, saved: Math.min(g.saved, g.target)})),
      plan: saved.plan && typeof saved.plan === 'object' && Array.isArray(saved.plan.allocations) ? saved.plan : null
    };
  } catch { return defaultState(); }
}

let state = readState();
let editingId = null;
let toastTimer;
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { showToast('Не удалось сохранить данные в браузере'); } }
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function previewExpenses() {
  const share = Number($('#share').value);
  $('#share-output').textContent = `${share}%`;
  $('#share').style.setProperty('--progress', `${share}%`);
  const amount = parseIncome($('#income').value);
  $('#expense-preview').textContent = amount !== null && amount > 0
    ? `${format(Math.round(amount * share / 100))} — максимум на цели. Остальное останется на расходы.`
    : 'Остальное останется на расходы. Долю можно изменить.';
}

function renderGoals() {
  const container = $('#goals-list');
  container.replaceChildren();
  $('#goals-count').textContent = state.goals.length;
  if (state.goals.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'goal-empty';
    empty.textContent = 'Добавь хотя бы одну цель, чтобы распределить доход.';
    container.append(empty);
    return;
  }
  for (const goal of state.goals) {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'goal-card';
    card.setAttribute('aria-label', `Изменить цель ${goal.name}`);
    const top = document.createElement('div'); top.className = 'goal-card-top';
    const heading = document.createElement('h3'); heading.textContent = goal.name;
    const edit = document.createElement('span'); edit.className = 'edit-glyph'; edit.setAttribute('aria-hidden','true'); edit.textContent = '↗';
    top.append(heading,edit);
    const meta = document.createElement('p'); meta.className = 'goal-meta';
    const parts = [goal.example ? 'Пример цели — измени под себя' : (goal.priority === 'high' ? 'Важная цель' : 'Обычная цель')];
    if (goal.date) parts.push(`к ${new Intl.DateTimeFormat('ru-RU').format(new Date(`${goal.date}T12:00:00`))}`);
    meta.textContent = parts.join(' · ');
    const bar = document.createElement('div'); bar.className = 'goal-progress';
    const fill = document.createElement('i'); fill.style.width = `${Math.min(100,goal.saved / goal.target * 100)}%`; bar.append(fill);
    const bottom = document.createElement('div'); bottom.className = 'goal-bottom';
    const saved = document.createElement('strong'); saved.textContent = format(goal.saved);
    const target = document.createElement('span'); target.textContent = `из ${format(goal.target)}`;
    bottom.append(saved,target);
    card.append(top,meta,bar,bottom);
    card.addEventListener('click', () => openGoal(goal.id));
    container.append(card);
  }
}

function renderPlan() {
  const container = $('#plan-content');
  const plan = state.plan;
  if (!plan) {
    $('#plan-date').textContent = '';
    container.innerHTML = '<div class="empty-plan"><span class="empty-symbol" aria-hidden="true">₽</span><h3>Суммы появятся здесь</h3><p>Добавь свои цели, введи доход и нажми «Составить план».</p></div>';
    return;
  }
  $('#plan-date').textContent = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(new Date(plan.createdAt));
  container.replaceChildren();
  const total = document.createElement('div'); total.className = 'plan-total';
  const onGoals = document.createElement('div'); const saveLabel = document.createElement('small'); saveLabel.textContent = 'По целям';
  const saveAmount = document.createElement('strong'); saveAmount.textContent = format(plan.savings); onGoals.append(saveLabel,saveAmount);
  const onLife = document.createElement('div'); onLife.className = 'life-amount';
  const lifeLabel = document.createElement('small'); lifeLabel.textContent = 'Оставить себе';
  const lifeAmount = document.createElement('strong'); lifeAmount.textContent = format(plan.expenses); onLife.append(lifeLabel,lifeAmount);
  total.append(onGoals,onLife); container.append(total);
  const list = document.createElement('div'); list.className = 'allocation-list';
  for (const item of plan.allocations) {
    const row = document.createElement('div'); row.className = 'allocation-row';
    const dot = document.createElement('span'); dot.className = 'goal-dot'; dot.setAttribute('aria-hidden','true');
    const content = document.createElement('div'); content.className = 'allocation-text';
    const title = document.createElement('strong'); title.textContent = item.name;
    const reason = document.createElement('small'); reason.textContent = item.reason;
    content.append(title,reason);
    const amount = document.createElement('span'); amount.className = 'allocation-value'; amount.textContent = format(item.amount);
    row.append(dot,content,amount); list.append(row);
  }
  container.append(list);
  const explanation = document.createElement('p'); explanation.className = 'plan-explanation';
  if (plan.budget > plan.savings) {
    explanation.textContent = `Ты выбрал ${plan.share}% на цели, но до их полного заполнения нужно только ${format(plan.savings)}. Остаток остаётся у тебя.`;
  } else if (plan.allocations.length === 0) {
    explanation.textContent = 'На цели выбрано 0%. Измени долю, если хочешь что-то отложить.';
  } else {
    explanation.textContent = `Суммы рассчитаны из ${plan.share}% дохода. Цели с близким сроком и высоким приоритетом получают большую долю; каждая сумма ограничена остатком цели.`;
  }
  container.append(explanation);
  if (plan.applied) {
    const note = document.createElement('div'); note.className = 'applied-note'; note.textContent = 'Отмечено как отложенное. Баланс целей обновлён.'; container.append(note);
  } else if (plan.savings > 0) {
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'confirm-button';
    confirm.textContent = 'Я отложил эти суммы'; confirm.addEventListener('click', applyPlan); container.append(confirm);
  }
}

function applyPlan() {
  if (!state.plan || state.plan.applied) return;
  for (const item of state.plan.allocations) {
    const goal = state.goals.find(g => g.id === item.id);
    if (goal) goal.saved = Math.min(goal.target, goal.saved + item.amount);
  }
  state.plan.applied = true; save(); renderPlan(); renderGoals(); showToast('Суммы добавлены к целям');
}

function openGoal(id = null) {
  editingId = id;
  const goal = state.goals.find(g => g.id === id);
  $('#dialog-heading').textContent = goal ? 'Изменить цель' : 'Добавить цель';
  $('#goal-name').value = goal?.name ?? '';
  $('#goal-target').value = goal ? String(goal.target) : '';
  $('#goal-saved').value = goal ? String(goal.saved) : '';
  $('#goal-date').value = goal?.date || '';
  $('#goal-priority').value = goal?.priority === 'high' ? 'high' : 'normal';
  $('#goal-error').hidden = true;
  $('#delete-goal').hidden = !goal;
  $('#goal-dialog').showModal();
  $('#goal-name').focus();
}

$('#plan-form').addEventListener('submit', event => {
  event.preventDefault();
  const income = parseIncome($('#income').value);
  const error = $('#income-error');
  if (income === null || income <= 0) {
    error.textContent = 'Введи одну положительную сумму в целых рублях.'; error.hidden = false; $('#income').focus(); return;
  }
  if (!state.goals.some(g => g.saved < g.target)) {
    error.textContent = 'Добавь цель с суммой, которую ещё нужно собрать.'; error.hidden = false; $('#add-goal').focus(); return;
  }
  error.hidden = true;
  state.income = $('#income').value;
  state.share = Number($('#share').value);
  state.plan = {...planAllocation(income,state.share,state.goals),createdAt:new Date().toISOString(),applied:false};
  save(); renderPlan();
  if (window.innerWidth < 821) $('#plan-panel').scrollIntoView({behavior:'smooth',block:'start'});
});

$('#goal-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#goal-name').value.trim();
  const target = parseWholeAmount($('#goal-target').value);
  const saved = $('#goal-saved').value.trim() ? parseWholeAmount($('#goal-saved').value) : 0;
  const error = $('#goal-error');
  if (!name || target === null || target <= 0 || saved === null || saved < 0 || saved > target) {
    error.textContent = 'Укажи название и суммы в целых рублях. Уже отложено не может быть больше цели.'; error.hidden = false; return;
  }
  const goal = {id: editingId || (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`),name,target,saved,date:$('#goal-date').value,priority:$('#goal-priority').value};
  if (editingId) state.goals = state.goals.map(g => g.id === editingId ? goal : g);
  else state.goals.push(goal);
  state.plan = null; save(); renderGoals(); renderPlan(); $('#goal-dialog').close(); showToast('Цель сохранена');
});

$('#delete-goal').addEventListener('click', () => {
  if (!editingId || !window.confirm('Удалить эту цель и сохранённый для неё баланс?')) return;
  state.goals = state.goals.filter(g => g.id !== editingId);
  state.plan = null; save(); renderGoals(); renderPlan(); $('#goal-dialog').close(); showToast('Цель удалена');
});
$('#add-goal').addEventListener('click', () => openGoal());
$('#close-dialog').addEventListener('click', () => $('#goal-dialog').close());
$('#goal-dialog').addEventListener('click', event => { if (event.target === $('#goal-dialog')) $('#goal-dialog').close(); });
$('#share').addEventListener('input', previewExpenses);
$('#income').addEventListener('input', () => { $('#income-error').hidden = true; previewExpenses(); });
$('#income').value = state.income;
$('#share').value = state.share;
previewExpenses(); renderGoals(); renderPlan();

// Browsers with WebMCP can expose the same two actions to an assistant.
// Browsers without it use the ordinary form and goal editor above.
const context = document.modelContext;
if (context?.registerTool) {
  const register = tool => {
    try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch { /* unsupported implementation */ }
  };
  register({
    name: 'create_savings_goal', title: 'Добавить цель накопления',
    description: 'Создать цель с названием и целевой суммой в рублях. Не переводит деньги.',
    inputSchema: {type:'object',properties:{name:{type:'string',minLength:1,maxLength:48},target:{type:'integer',minimum:1},saved:{type:'integer',minimum:0},priority:{type:'string',enum:['normal','high']},date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}},required:['name','target'],additionalProperties:false},
    annotations: {readOnlyHint:false,untrustedContentHint:false},
    execute(input) {
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      const target = input?.target;
      const saved = input?.saved ?? 0;
      if (!name || name.length > 48 || !Number.isSafeInteger(target) || target <= 0 || !Number.isSafeInteger(saved) || saved < 0 || saved > target ||
          (input.priority !== undefined && !['normal','high'].includes(input.priority)) ||
          (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date))) throw new Error('Некорректная цель');
      const goal = {id:crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,name,target,saved,date:input.date || '',priority:input.priority || 'normal'};
      state.goals.push(goal); state.plan = null; save(); renderGoals(); renderPlan();
      return {id:goal.id,name:goal.name,target:goal.target,saved:goal.saved};
    }
  });
  register({
    name: 'plan_income_allocation', title: 'Распределить доход',
    description: 'Рассчитать, сколько рублей предложить для каждой текущей цели. Не отмечает взносы и не переводит деньги.',
    inputSchema: {type:'object',properties:{income:{type:'integer',minimum:1},share:{type:'integer',minimum:0,maximum:100}},required:['income'],additionalProperties:false},
    annotations: {readOnlyHint:false,untrustedContentHint:false},
    execute(input) {
      const income = input?.income;
      const share = input?.share ?? state.share;
      if (!Number.isSafeInteger(income) || income <= 0 || !Number.isInteger(share) || share < 0 || share > 100) throw new Error('Некорректная сумма или доля');
      if (!state.goals.some(g => g.saved < g.target)) throw new Error('Сначала добавьте незавершённую цель');
      state.income = String(income); state.share = share;
      state.plan = {...planAllocation(income,share,state.goals),createdAt:new Date().toISOString(),applied:false};
      $('#income').value = state.income; $('#share').value = share;
      previewExpenses(); save(); renderPlan();
      return {savings:state.plan.savings,expenses:state.plan.expenses,allocations:state.plan.allocations};
    }
  });
}
