import { ALGORITHMS, createAgent, normalizeParams, randomSpawn, stepAgent } from '../shared/algorithms.js';
import { findLandmarks } from '../shared/terrain.js';

const trimNumber = (n, places = 3) => Number(n.toFixed(places));
const landmarks = findLandmarks();

export class Room {
  constructor(onChange = () => {}, rng = Math.random) {
    this.players = new Map();
    this.phase = 'lobby';
    this.round = 1;
    this.startedAt = null;
    this.finishedAt = null;
    this.onChange = onChange;
    this.rng = rng;
    this.sequence = 0;
  }

  join(id, name, isAdmin = false) {
    if (this.players.size >= 100) throw new Error('Capacidad máxima de 100 usuarios');
    if ([...this.players.values()].some((p) => p.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
      throw new Error('Ese nombre ya está en uso');
    }
    const player = { id, name, isAdmin, online: true, algorithm: null, params: null, agent: null, participating: false, order: ++this.sequence };
    this.players.set(id, player);
    this.onChange();
    return player;
  }

  setOnline(id, online) {
    const p = this.players.get(id);
    if (!p || p.online === online) return;
    p.online = online;
    this.onChange();
  }

  remove(id) {
    const deleted = this.players.delete(id);
    if (deleted) {
      if (this.phase === 'running') this.checkFinish();
      this.onChange();
    }
  }

  select(id, algorithm, rawParams) {
    const p = this.players.get(id);
    if (!p) throw new Error('Debes iniciar sesión');
    if (this.phase !== 'lobby') throw new Error('La ronda está activa. Espera el reinicio del administrador.');
    if (!ALGORITHMS.some((a) => a.id === algorithm)) throw new Error('Selecciona un algoritmo válido');
    const params = normalizeParams(rawParams);
    const { x, z } = randomSpawn(this.rng);
    p.algorithm = algorithm;
    p.params = params;
    p.agent = createAgent(x, z, algorithm, params);
    p.participating = false;
    this.onChange();
    return p;
  }

  start(id) {
    const p = this.players.get(id);
    if (!p?.isAdmin) throw new Error('Acción exclusiva del administrador');
    if (this.phase !== 'lobby') throw new Error('La ronda ya comenzó');
    const eligible = [...this.players.values()].filter((v) => v.online && v.algorithm && v.agent);
    if (!eligible.length) throw new Error('Se necesita al menos un jugador con algoritmo seleccionado');
    for (const v of this.players.values()) {
      v.participating = eligible.includes(v);
      if (v.participating) v.agent.status = 'active';
    }
    this.phase = 'running';
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.onChange();
    return eligible.length;
  }

  reset(id) {
    const p = this.players.get(id);
    if (!p?.isAdmin) throw new Error('Acción exclusiva del administrador');
    this.phase = 'lobby';
    this.round++;
    this.startedAt = null;
    this.finishedAt = null;
    for (const v of this.players.values()) {
      v.algorithm = null;
      v.params = null;
      v.agent = null;
      v.participating = false;
    }
    this.onChange();
  }

  checkFinish() {
    const active = [...this.players.values()].filter((p) => p.participating);
    if (this.phase === 'running' && (!active.length || active.every((p) => p.agent.status === 'finished'))) {
      this.phase = 'finished';
      this.finishedAt = Date.now();
    }
  }

  tick() {
    if (this.phase !== 'running') return;
    for (const p of this.players.values()) {
      if (p.participating && p.online && p.agent?.status === 'active') stepAgent(p.agent, this.rng);
    }
    this.checkFinish();
    this.onChange();
  }

  snapshot() {
    const players = [...this.players.values()].map((p) => {
      const a = p.agent;
      return {
        id: p.id, name: p.name, isAdmin: p.isAdmin, online: p.online,
        algorithm: p.algorithm, params: p.params, participating: p.participating,
        status: a?.status ?? 'waiting', reason: a?.reason ?? '',
        x: a ? trimNumber(a.x) : null, z: a ? trimNumber(a.z) : null, h: a ? trimNumber(a.h) : null,
        bestHeight: a ? trimNumber(a.bestHeight) : null,
        bestX: a ? trimNumber(a.bestX) : null, bestZ: a ? trimNumber(a.bestZ) : null,
        steps: a?.steps ?? 0, accepted: a?.accepted ?? 0, rejected: a?.rejected ?? 0,
        restarts: a?.restarts ?? 0, sideways: a?.sideways ?? 0,
        temperature: a ? trimNumber(a.temperature) : null,
        path: a?.path ?? [], order: p.order,
      };
    });
    const leaderboard = players.filter((p) => p.participating)
      .sort((a, b) => b.bestHeight - a.bestHeight || a.order - b.order)
      .map((p, index) => ({ ...p, rank: index + 1 }));
    return {
      phase: this.phase, round: this.round, startedAt: this.startedAt, finishedAt: this.finishedAt,
      onlineCount: players.filter((p) => p.online).length,
      readyCount: players.filter((p) => p.online && p.algorithm).length,
      activeCount: players.filter((p) => p.participating && p.status === 'active').length,
      players, leaderboard,
      summit: { x: trimNumber(landmarks.summit.x), z: trimNumber(landmarks.summit.z), h: trimNumber(landmarks.summit.h) },
      minima: landmarks.minima,
    };
  }
}
