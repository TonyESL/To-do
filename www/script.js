// ==================================================
// 1. GLOBAL VARIABLES AND STATE
// ==================================================
let tasks = [];
let currentFilter = 'all';
let taskToDeleteId = null;

// DOM Elements Reference
const tasksListEl = document.getElementById('tasks-list');
const emptyStateEl = document.getElementById('empty-state');
const summaryEl = document.getElementById('task-summary');
const filterBtns = document.querySelectorAll('.filter-btn');

const modalTaskEl = document.getElementById('task-modal');
const modalConfirmEl = document.getElementById('confirm-modal');
const taskForm = document.getElementById('task-form');

const inputId = document.getElementById('task-id');
const inputTitle = document.getElementById('task-title');
const inputDesc = document.getElementById('task-desc');
const inputDate = document.getElementById('task-date');
const inputTime = document.getElementById('task-time');

const btnFab = document.getElementById('btn-fab');
const btnEmptyAdd = document.getElementById('btn-empty-add');
const btnCancel = document.getElementById('btn-cancel');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const btnConfirmDelete = document.getElementById('btn-confirm-delete');
const btnPerm = document.getElementById('btn-request-perm');
const toastEl = document.getElementById('toast');

// Initialize Capacitor Plugin reference safely
const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;

// ==================================================
// 2. INITIALIZATION
// ==================================================
document.addEventListener('DOMContentLoaded', () => {
  loadTasks();
  setupEventListeners();
  requestNotificationPermissionOnStart();
  renderTasks();
});

function setupEventListeners() {
  btnFab.addEventListener('click', () => openTaskModal());
  btnEmptyAdd.addEventListener('click', () => openTaskModal());
  btnCancel.addEventListener('click', closeTaskModal);

  taskForm.addEventListener('submit', handleTaskFormSubmit);

  btnConfirmCancel.addEventListener('click', closeConfirmModal);
  btnConfirmDelete.addEventListener('click', handleConfirmDelete);

  btnPerm.addEventListener('click', requestNotificationPermission);

  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderTasks();
    });
  });
}

// ==================================================
// 3. STORAGE LOGIC (localStorage)
// ==================================================
function loadTasks() {
  const savedTasks = localStorage.getItem('simple_todo_tasks');
  if (savedTasks) {
    try {
      tasks = JSON.parse(savedTasks);
    } catch (e) {
      tasks = [];
    }
  }
}

function saveTasks() {
  localStorage.setItem('simple_todo_tasks', JSON.stringify(tasks));
}

// ==================================================
// 4. RENDERING LOGIC
// ==================================================
function renderTasks() {
  tasksListEl.innerHTML = '';

  const filteredTasks = tasks.filter(task => {
    if (currentFilter === 'pending') return !task.completed;
    if (currentFilter === 'completed') return task.completed;
    return true;
  });

  const pendingCount = tasks.filter(t => !t.completed).length;
  summaryEl.textContent = `Today · ${pendingCount} pending task${pendingCount !== 1 ? 's' : ''}`;

  if (filteredTasks.length === 0) {
    emptyStateEl.classList.remove('hidden');
    tasksListEl.classList.add('hidden');
    return;
  }

  emptyStateEl.classList.add('hidden');
  tasksListEl.classList.remove('hidden');

  filteredTasks.forEach(task => {
    const card = document.createElement('div');
    card.className = `task-card ${task.completed ? 'completed' : ''}`;

    const formattedTime = formatDisplayTime(task.time);

    card.innerHTML = `
      <div class="task-header">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <span class="task-datetime">📅 ${task.date} · ${formattedTime}</span>
      </div>
      ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}
      <div class="task-actions">
        <button class="btn-action btn-complete" onclick="toggleTaskComplete(${task.id})">
          ${task.completed ? 'Undo' : '✓ Done'}
        </button>
        <button class="btn-action btn-edit" onclick="openTaskModal(${task.id})">Edit</button>
        <button class="btn-action btn-delete" onclick="openConfirmModal(${task.id})">Delete</button>
      </div>
    `;

    tasksListEl.appendChild(card);
  });
}

// ==================================================
// 5. TASK CREATION AND EDITING
// ==================================================
function openTaskModal(id = null) {
  taskForm.reset();
  inputId.value = '';

  if (id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
      document.getElementById('modal-title').textContent = 'Edit Task';
      inputId.value = task.id;
      inputTitle.value = task.title;
      inputDesc.value = task.description || '';
      inputDate.value = task.date;
      inputTime.value = task.time;
    }
  } else {
    document.getElementById('modal-title').textContent = 'New Task';
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    inputDate.value = today;
  }

  modalTaskEl.classList.remove('hidden');
}

function closeTaskModal() {
  modalTaskEl.classList.add('hidden');
}

async function handleTaskFormSubmit(e) {
  e.preventDefault();

  const title = inputTitle.value.trim();
  const description = inputDesc.value.trim();
  const date = inputDate.value;
  const time = inputTime.value;
  const id = inputId.value ? parseInt(inputId.value) : Date.now();

  if (!title || !date || !time) {
    showToast('Please fill all required fields');
    return;
  }

  // Validate that selected date/time is in the future
  const scheduledDateTime = new Date(`${date}T${time}:00`);
  if (scheduledDateTime <= new Date()) {
    showToast('Please select a future date and time');
    return;
  }

  const existingIndex = tasks.findIndex(t => t.id === id);

  if (existingIndex > -1) {
    // Update existing task
    const oldNotificationId = tasks[existingIndex].notificationId;
    await cancelNotification(oldNotificationId);

    tasks[existingIndex] = {
      ...tasks[existingIndex],
      title,
      description,
      date,
      time,
      notificationId: id
    };

    if (!tasks[existingIndex].completed) {
      await scheduleNotification(id, title, scheduledDateTime);
    }
    showToast('Task updated successfully');
  } else {
    // Create new task
    const newTask = {
      id,
      title,
      description,
      date,
      time,
      completed: false,
      notificationId: id
    };

    tasks.push(newTask);
    await scheduleNotification(id, title, scheduledDateTime);
    showToast('Task added successfully');
  }

  saveTasks();
  renderTasks();
  closeTaskModal();
}

// ==================================================
// 6. TASK COMPLETION & DELETION
// ==================================================
async function toggleTaskComplete(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  task.completed = !task.completed;

  if (task.completed) {
    await cancelNotification(task.notificationId);
    showToast('Task completed');
  } else {
    const scheduledDateTime = new Date(`${task.date}T${task.time}:00`);
    if (scheduledDateTime > new Date()) {
      await scheduleNotification(task.id, task.title, scheduledDateTime);
    }
    showToast('Task marked as pending');
  }

  saveTasks();
  renderTasks();
}

function openConfirmModal(id) {
  taskToDeleteId = id;
  modalConfirmEl.classList.remove('hidden');
}

function closeConfirmModal() {
  taskToDeleteId = null;
  modalConfirmEl.classList.add('hidden');
}

async function handleConfirmDelete() {
  if (!taskToDeleteId) return;

  const task = tasks.find(t => t.id === taskToDeleteId);
  if (task) {
    await cancelNotification(task.notificationId);
  }

  tasks = tasks.filter(t => t.id !== taskToDeleteId);
  saveTasks();
  renderTasks();
  closeConfirmModal();
  showToast('Task deleted');
}

// ==================================================
// 7. CAPACITOR LOCAL NOTIFICATIONS INTEGRATION
// ==================================================
async function requestNotificationPermissionOnStart() {
  if (LocalNotifications) {
    try {
      const status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
    } catch (err) {
      console.log('Local Notifications not available in web browser mode');
    }
  }
}

async function requestNotificationPermission() {
  if (!LocalNotifications) {
    showToast('Notifications available only on mobile device');
    return;
  }
  const result = await LocalNotifications.requestPermissions();
  if (result.display === 'granted') {
    showToast('Notification permission granted');
  } else {
    showToast('Notification permission denied');
  }
}

async function scheduleNotification(id, title, scheduledDate) {
  if (!LocalNotifications) return;

  try {
    // Generate a valid 32-bit Integer ID for Android
    const notificationId = Math.abs(id % 2147483647);

    await LocalNotifications.schedule({
      notifications: [
        {
          title: "Task Reminder",
          body: title,
          id: notificationId,
          schedule: { at: scheduledDate },
          sound: undefined, // Uses default Android system sound
          actionTypeId: "",
          extra: null
        }
      ]
    });
    console.log(`Notification scheduled for: ${scheduledDate}`);
  } catch (error) {
    console.error('Error scheduling notification:', error);
  }
}

async function cancelNotification(id) {
  if (!LocalNotifications || !id) return;

  try {
    const notificationId = Math.abs(id % 2147483647);
    await LocalNotifications.cancel({
      notifications: [{ id: notificationId }]
    });
    console.log(`Notification cancelled: ${notificationId}`);
  } catch (error) {
    console.error('Error cancelling notification:', error);
  }
}

// ==================================================
// 8. UTILITY AND HELPER FUNCTIONS
// ==================================================
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2500);
}

function formatDisplayTime(timeString) {
  if (!timeString) return '';
  const [hours, minutes] = timeString.split(':');
  let h = parseInt(hours, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${minutes} ${ampm}`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, match => {
    const chars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return chars[match];
  });
}