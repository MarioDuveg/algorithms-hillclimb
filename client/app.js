import { ALGORITHMS, DEFAULT_PARAMS } from '/shared/algorithms.js';
import { Terrain3D, agentColor } from './terrain3d.js';

const $ = (selector) => document.querySelector(selector);
const scene = new Terrain3D($('#terrain-canvas'), $('#labels-layer'));
const algoById = new Map(ALGORITHMS.map((algorithm) => [algorithm.id, algorithm]));
const paramsByAlgorithm = new Map();
let me = null, state = null, eventStream = null;
let selectedAlgorithm = null, pending = false, lastRound = null, lastPhase = null;
let toastTimer = null;

const PARAMS = {
  stepSize: { label: 'Tamaño del paso', min: .45, max: 4, step: .05, digits: 2, help: 'Distancia del movimiento en el terreno.' },
  neighbors: { label: 'Vecinos por iteración', options: [8, 16, 24], help: 'Direcciones que examina el algoritmo.' },
  sidewaysLimit: { label: 'Límite de movimientos laterales', min: 0, max: 100, step: 1, digits: 0 },
  maxRestarts: { label: 'Número máximo de reinicios', min: 0, max: 40, step: 1, digits: 0 },
  startTemp: { label: 'Temperatura inicial (T₀)', min: .5, max: 30, step: .5, digits: 1, help: 'A mayor temperatura, más probables son los descensos.' },
  coolingRate: { label: 'Factor de enfriamiento (α)', min: .9, max: .999, step: .001, digits: 3, help: 'T ← T × α cada intervalo.' },
  minTemp: { label: 'Temperatura mínima', min: .01, max: 2, step: .01, digits: 2, help: 'Detiene el algoritmo al alcanzar este valor.' },
  stepsPerTemp: { label: 'Pasos por temperatura', min: 1, max: 15, step: 1, digits: 0 },
  maxSteps: { label: 'Máximo de iteraciones', min: 50, max: 1500, step: 50, digits: 0 },
};

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const formatHeight = (value) => Number(value ?? 0).toFixed(1);
const initials = (name) => [...name][0]?.toLocaleUpperCase('es') || '?';

function showToast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3300);
}

async function request(endpoint, payload = {}) {
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch { throw new Error('No se pudo establecer conexión con el servidor.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

function chooseAlgorithm(id) {
  if (!algoById.has(id) || (state && state.phase !== 'lobby')) return;
  selectedAlgorithm = id;
  pending = true;
  if (!paramsByAlgorithm.has(id)) paramsByAlgorithm.set(id, { ...DEFAULT_PARAMS });
  renderAlgorithms();
  renderParameters();
  renderSelection();
}

function renderAlgorithms() {
  const own = state?.players.find((p) => p.id === me?.id);
  $('#algo-list').innerHTML = ALGORITHMS.map((algo, index) => `
    <button class="algo-card ${selectedAlgorithm === algo.id ? 'active' : ''} ${own?.algorithm === algo.id ? 'ready' : ''}"
      type="button" data-algorithm="${algo.id}" aria-pressed="${selectedAlgorithm === algo.id}">
      <span class="algo-number">${String(index + 1).padStart(2, '0')}</span>
      <span class="algo-info"><strong>${escapeHTML(algo.name)}</strong><small>${escapeHTML(algo.short)}</small><em>${escapeHTML(algo.kind.toUpperCase())}</em></span>
    </button>`).join('');
  $('#algo-list').querySelectorAll('[data-algorithm]').forEach((button) => button.addEventListener('click', () => chooseAlgorithm(button.dataset.algorithm)));
}

function renderParameters() {
  const panel = $('#params-panel');
  if (!selectedAlgorithm) {
    panel.innerHTML = '<p class="note">Elige una estrategia para consultar su descripción y ajustar sus parámetros.</p>';
    $('#param-subtitle').textContent = 'POR DEFINIR';
    return;
  }
  const algo = algoById.get(selectedAlgorithm);
  const params = paramsByAlgorithm.get(selectedAlgorithm) || { ...DEFAULT_PARAMS };
  const options = ['stepSize', 'neighbors'];
  if (selectedAlgorithm === 'random_restart') options.push('maxRestarts');
  if (selectedAlgorithm === 'sideways') options.push('sidewaysLimit');
  if (selectedAlgorithm === 'annealing') options.push('startTemp', 'coolingRate', 'minTemp', 'stepsPerTemp', 'maxSteps');
  $('#param-subtitle').textContent = `${options.length} CONTROLES`;
  panel.innerHTML = `<p class="note" style="margin:0 0 17px;color:#a3c2c1">${escapeHTML(algo.description)}</p>` + options.map((key) => {
    const d = PARAMS[key]; const val = params[key];
    if (d.options) return `<div class="parameter"><div class="parameter-top"><span>${escapeHTML(d.label)}</span><strong data-value="${key}">${val}</strong></div><select class="param-select" data-param="${key}" aria-label="${escapeHTML(d.label)}">${d.options.map((op) => `<option value="${op}" ${op === val ? 'selected' : ''}>${op} direcciones</option>`).join('')}</select>${d.help ? `<div class="parameter-help">${escapeHTML(d.help)}</div>` : ''}</div>`;
    return `<div class="parameter"><div class="parameter-top"><span>${escapeHTML(d.label)}</span><strong data-value="${key}">${Number(val).toFixed(d.digits)}</strong></div><input type="range" data-param="${key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${val}" aria-label="${escapeHTML(d.label)}">${d.help ? `<div class="parameter-help">${escapeHTML(d.help)}</div>` : ''}</div>`;
  }).join('');
  panel.querySelectorAll('[data-param]').forEach((control) => control.addEventListener('input', () => {
    const key = control.dataset.param;
    const value = Number(control.value);
    paramsByAlgorithm.get(selectedAlgorithm)[key] = value;
    const valueNode = panel.querySelector(`[data-value="${key}"]`);
    valueNode.textContent = PARAMS[key].options ? String(value) : value.toFixed(PARAMS[key].digits);
    pending = true;
    renderSelection();
  }));
}

function renderSelection() {
  const button = $('#select-btn'), note = $('#selection-note');
  const own = state?.players.find((p) => p.id === me?.id);
  const canEdit = Boolean(me) && (state?.phase === 'lobby');
  button.disabled = !selectedAlgorithm || !canEdit;
  $('#algo-list').style.opacity = canEdit ? '1' : '.55';
  if (state && state.phase !== 'lobby') {
    note.textContent = state.phase === 'running' ? 'La ronda ya comenzó. Las estrategias están bloqueadas hasta Reset.' : 'Ronda terminada. El administrador puede reiniciar.';
    note.classList.remove('note-ready');
  } else if (own?.algorithm && !pending) {
    button.innerHTML = 'Estrategia confirmada <span>✓</span>';
    note.textContent = 'Tu agente ya apareció en el mapa y está esperando Start.';
    note.classList.add('note-ready');
  } else {
    button.innerHTML = 'Confirmar estrategia <span>→</span>';
    note.textContent = own?.algorithm ? 'Hay cambios sin confirmar. Pulsa para actualizar.' : 'Elige una estrategia y confirma para aparecer en el mapa.';
    note.classList.remove('note-ready');
  }
}

function drawLeaderboard() {
  const rankings = state?.leaderboard || [];
  const holder = $('#leaderboard');
  if (!rankings.length) {
    holder.innerHTML = '<div class="empty-rank">Cuando el administrador pulse Start, aparecerá aquí la clasificación por récord de altura.</div>';
    return;
  }
  holder.innerHTML = rankings.map((p) => {
    const color = agentColor(p, me?.id);
    const algo = algoById.get(p.algorithm);
    return `<div class="rank-item ${p.id === me?.id ? 'is-me' : ''}"><span class="rank-number">${String(p.rank).padStart(2, '0')}</span><span class="rank-avatar" style="color:${color};background:${color}19;border-color:${color}65">${escapeHTML(initials(p.name))}</span><span class="rank-main"><strong>${escapeHTML(p.name)}${p.isAdmin ? ' ◈' : ''}</strong><small>${escapeHTML(algo?.name || '')} · ${p.online ? (p.status === 'active' ? 'explorando' : 'terminó') : 'desconectado'}</small></span><span class="rank-score"><strong>${formatHeight(p.bestHeight)}</strong><small>actual ${formatHeight(p.h)}</small></span></div>`;
  }).join('');
}

function drawRoom() {
  const players = state?.players || [];
  const root = $('#room-players');
  if (!players.length) {
    root.innerHTML = '<div class="note" style="padding:0 4px">Aún no hay exploradores conectados.</div>';
    return;
  }
  root.innerHTML = players.map((p) => `<div class="room-player"><span class="room-player-name"><i class="${p.online && p.algorithm ? 'ready' : ''}"></i><span>${escapeHTML(p.name)}${p.id === me?.id ? ' (tú)' : ''}</span></span><small>${p.algorithm ? escapeHTML(algoById.get(p.algorithm)?.short || '') : 'Sin elegir'}</small></div>`).join('');
}

function updateClock() {
  const milliseconds = state?.startedAt ? (state.finishedAt || Date.now()) - state.startedAt : 0;
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  $('#time-counter').textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function applyState(next) {
  const previousRound = lastRound, previousPhase = lastPhase;
  state = next;
  lastRound = state.round;
  lastPhase = state.phase;
  const own = state.players.find((p) => p.id === me?.id);
  if (previousRound !== null && state.round !== previousRound) {
    selectedAlgorithm = null;
    paramsByAlgorithm.clear();
    pending = false;
    showToast('Nueva ronda: elige tu estrategia de nuevo.');
    renderParameters();
  } else if (own?.algorithm && !selectedAlgorithm) {
    selectedAlgorithm = own.algorithm;
    paramsByAlgorithm.set(own.algorithm, { ...own.params });
    pending = false;
    renderParameters();
  }
  if (previousPhase === 'lobby' && state.phase === 'running') showToast('¡La expedición ha comenzado!');
  if (previousPhase === 'running' && state.phase === 'finished') showToast('La ronda ha terminado. Consulta la clasificación.');
  const phaseText = { lobby: 'SALA DE ESPERA', running: 'SIMULACIÓN EN CURSO', finished: 'RONDA FINALIZADA' };
  $('#phase-label').textContent = phaseText[state.phase] || 'SALA DE ESPERA';
  $('#round-label').textContent = `RONDA ${String(state.round).padStart(2, '0')}`;
  $('#users-count').textContent = String(state.onlineCount).padStart(2, '0');
  $('#ready-count').textContent = String(state.readyCount).padStart(2, '0');
  $('#summit-height').textContent = `${formatHeight(state.summit.h)} m`;
  $('#start-btn').disabled = state.phase !== 'lobby' || state.readyCount === 0;
  $('#reset-btn').disabled = false;
  updateClock();
  drawLeaderboard();
  drawRoom();
  renderAlgorithms();
  renderSelection();
  scene.setPlayers(state.players, me?.id);

  const prompt = $('#map-prompt');
  if (!own?.algorithm) {
    prompt.hidden = false;
    prompt.innerHTML = state.phase === 'lobby'
      ? '<span class="map-prompt-icon">◎</span><strong>La expedición está por comenzar</strong><span>Elige tu algoritmo y confirma para aparecer en una posición aleatoria del mapa.</span>'
      : '<span class="map-prompt-icon">◌</span><strong>Ronda en curso</strong><span>Podrás unirte cuando el administrador pulse Reset.</span>';
  } else prompt.hidden = true;

  const hud = $('#my-hud');
  hud.hidden = !own?.algorithm;
  if (own?.algorithm) {
    $('#hud-height').textContent = formatHeight(own.h);
    $('#hud-best').textContent = formatHeight(own.bestHeight);
    $('#hud-steps').textContent = String(own.steps);
    const anneal = own.algorithm === 'annealing';
    $('#hud-temp-block').hidden = !anneal;
    if (anneal) $('#hud-temp').textContent = own.temperature.toFixed(2);
  }
}

function openStream() {
  if (eventStream) eventStream.close();
  eventStream = new EventSource('/api/events');
  eventStream.addEventListener('state', (event) => {
    try { applyState(JSON.parse(event.data)); } catch (error) { console.error('Estado incompleto', error); }
  });
  eventStream.addEventListener('error', () => {
    if (eventStream?.readyState === EventSource.CLOSED && me) showToast('Conexión perdida. Actualiza para iniciar sesión.', true);
  });
}

function enter(response) {
  me = response.player;
  $('#auth-screen').hidden = true;
  $('#account-box').hidden = false;
  $('#account-name').textContent = me.name;
  $('#account-avatar').textContent = initials(me.name);
  $('#admin-controls').hidden = !me.isAdmin;
  applyState(response.state);
  openStream();
}

$('#login-name').addEventListener('input', () => {
  $('#password-field').hidden = $('#login-name').value.trim().toLocaleLowerCase('es') !== 'admin';
  $('#login-error').hidden = true;
});
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('#login-form button[type=submit]');
  button.disabled = true;
  $('#login-error').hidden = true;
  try {
    const response = await request('/api/login', { name: $('#login-name').value, password: $('#login-password').value });
    enter(response);
    showToast(`Bienvenido al laboratorio, ${me.name}.`);
  } catch (error) {
    $('#login-error').textContent = error.message;
    $('#login-error').hidden = false;
  } finally { button.disabled = false; }
});
$('#select-btn').addEventListener('click', async () => {
  if (!selectedAlgorithm || state?.phase !== 'lobby') return;
  const button = $('#select-btn');button.disabled = true;
  try {
    const response = await request('/api/select', { algorithm: selectedAlgorithm, params: paramsByAlgorithm.get(selectedAlgorithm) || DEFAULT_PARAMS });
    pending = false;
    applyState(response.state);
    showToast('Estrategia lista. Tu posición fue asignada aleatoriamente.');
  } catch (error) { showToast(error.message, true); }
  finally { renderSelection(); }
});
$('#start-btn').addEventListener('click', async () => {
  try {
    const response = await request('/api/start');
    applyState(response.state);
    showToast(`${response.count} explorador(es) iniciaron su búsqueda.`);
  } catch (error) { showToast(error.message, true); }
});
$('#reset-btn').addEventListener('click', async () => {
  if (!window.confirm('¿Reiniciar la sala? Se borrarán las posiciones, puntuaciones y estrategias de TODOS los jugadores.')) return;
  try { const response = await request('/api/reset');applyState(response.state); }
  catch (error) { showToast(error.message, true); }
});
$('#logout-btn').addEventListener('click', async () => {
  if (eventStream) { eventStream.close();eventStream = null; }
  try { await request('/api/logout'); } catch { /* La sesión se limpia visualmente. */ }
  me=null;state=null;lastRound=null;lastPhase=null;selectedAlgorithm=null;paramsByAlgorithm.clear();pending=false;
  scene.setPlayers([],null);
  $('#auth-screen').hidden=false;
  $('#account-box').hidden=true;
  $('#admin-controls').hidden=true;
  $('#login-password').value='';
  renderAlgorithms();renderParameters();renderSelection();
  $('#login-name').focus();
});
$('#home-camera').addEventListener('click', () => scene.home());
$('#spin-camera').addEventListener('click', (e) => {scene.spin=!scene.spin;e.currentTarget.classList.toggle('active',scene.spin);});
$('#toggle-trails').addEventListener('click', (e) => {scene.trails=!scene.trails;e.currentTarget.classList.toggle('active',scene.trails);});
setInterval(updateClock, 1000);

renderAlgorithms();renderParameters();renderSelection();
if (scene.error) showToast(scene.error, true);
fetch('/api/me', { credentials: 'same-origin' })
  .then(async (r) => r.ok ? r.json() : null)
  .then((r) => {if(r)enter(r);else $('#login-name').focus();})
  .catch(() => $('#login-name').focus());
