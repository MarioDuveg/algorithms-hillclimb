import { EXTENT, heightAt, withinBounds } from './terrain.js';

export const ALGORITHMS = Object.freeze([
  { id: 'simple', name: 'Escalada simple', short: 'Primer vecino mejor', kind: 'Hill Climbing', description: 'Recorre los vecinos en un orden fijo y acepta el primero que mejore la altura. Se detiene si no encuentra una mejora.', color: '#56d7bf' },
  { id: 'steepest', name: 'Máxima pendiente', short: 'El mejor de todos los vecinos', kind: 'Hill Climbing', description: 'Evalúa todos los vecinos y elige el ascenso más pronunciado. Es voraz y puede quedar atrapado en óptimos locales.', color: '#69a7ff' },
  { id: 'stochastic', name: 'Escalada estocástica', short: 'Mejoras ponderadas por probabilidad', kind: 'Hill Climbing', description: 'Selecciona aleatoriamente una mejora entre los vecinos; las mejoras mayores tienen más probabilidad.', color: '#e7c57f' },
  { id: 'first_choice', name: 'Primera elección aleatoria', short: 'Prueba vecinos aleatorios', kind: 'Hill Climbing', description: 'Prueba los vecinos en orden aleatorio y adopta el primer ascenso encontrado; útil para vecindarios grandes.', color: '#c7a2ff' },
  { id: 'random_restart', name: 'Reinicios aleatorios', short: 'Sale de óptimos locales reiniciando', kind: 'Hill Climbing', description: 'Hace escalada de máxima pendiente. Cuando se estanca, inicia otra búsqueda en una posición aleatoria.', color: '#ff9b90' },
  { id: 'sideways', name: 'Movimientos laterales', short: 'Explora mesetas de altura similar', kind: 'Hill Climbing', description: 'Permite un número limitado de desplazamientos casi horizontales para atravesar mesetas.', color: '#b4dd78' },
  { id: 'annealing', name: 'Recocido simulado', short: 'Acepta descensos según la temperatura', kind: 'Metaheurística', description: 'Acepta siempre ascensos y, con probabilidad exp(Δh / T), algunos descensos. La temperatura se reduce progresivamente.', color: '#ffbd65' },
]);

export const DEFAULT_PARAMS = Object.freeze({
  stepSize: 1.55,
  neighbors: 16,
  sidewaysLimit: 25,
  maxRestarts: 12,
  startTemp: 6.5,
  coolingRate: 0.985,
  minTemp: 0.06,
  stepsPerTemp: 3,
  maxSteps: 650,
});

function boundedNumber(value, fallback, min, max) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function normalizeParams(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  return {
    stepSize: boundedNumber(raw.stepSize, DEFAULT_PARAMS.stepSize, 0.45, 4),
    neighbors: [8, 16, 24].includes(Number(raw.neighbors)) ? Number(raw.neighbors) : 16,
    sidewaysLimit: Math.round(boundedNumber(raw.sidewaysLimit, DEFAULT_PARAMS.sidewaysLimit, 0, 100)),
    maxRestarts: Math.round(boundedNumber(raw.maxRestarts, DEFAULT_PARAMS.maxRestarts, 0, 40)),
    startTemp: boundedNumber(raw.startTemp, DEFAULT_PARAMS.startTemp, 0.5, 30),
    coolingRate: boundedNumber(raw.coolingRate, DEFAULT_PARAMS.coolingRate, 0.9, 0.999),
    minTemp: boundedNumber(raw.minTemp, DEFAULT_PARAMS.minTemp, 0.01, 2),
    stepsPerTemp: Math.round(boundedNumber(raw.stepsPerTemp, DEFAULT_PARAMS.stepsPerTemp, 1, 15)),
    maxSteps: Math.round(boundedNumber(raw.maxSteps, DEFAULT_PARAMS.maxSteps, 50, 1500)),
  };
}

export function createAgent(x, z, algorithm, rawParams = {}) {
  if (!ALGORITHMS.some((a) => a.id === algorithm)) throw new Error('Algoritmo no válido');
  if (!withinBounds(x, z)) throw new Error('Posición inicial fuera del mapa');
  const params = normalizeParams(rawParams);
  const h = heightAt(x, z);
  return {
    x, z, h, bestHeight: h, bestX: x, bestZ: z,
    steps: 0, accepted: 0, rejected: 0, restarts: 0, sideways: 0,
    temperature: params.startTemp,
    status: 'active', reason: '',
    path: [[x, z]], visited: [`${x.toFixed(2)},${z.toFixed(2)}`],
    params, algorithm,
  };
}

export function randomSpawn(rng = Math.random) {
  return { x: -EXTENT + 3.5 + rng() * (EXTENT * 2 - 7), z: -EXTENT + 3.5 + rng() * (EXTENT * 2 - 7) };
}

function neighborhood(agent) {
  const { x, z, h, params } = agent;
  const candidates = [];
  for (let i = 0; i < params.neighbors; i++) {
    const a = i * Math.PI * 2 / params.neighbors;
    const nx = x + Math.cos(a) * params.stepSize;
    const nz = z + Math.sin(a) * params.stepSize;
    if (withinBounds(nx, nz)) {
      const nh = heightAt(nx, nz);
      candidates.push({ x: nx, z: nz, h: nh, delta: nh - h });
    }
  }
  return candidates;
}

function move(agent, next) {
  agent.x = next.x;
  agent.z = next.z;
  agent.h = next.h;
  agent.accepted++;
  agent.path.push([agent.x, agent.z]);
  if (agent.path.length > 90) agent.path.shift();
  agent.visited.push(`${agent.x.toFixed(2)},${agent.z.toFixed(2)}`);
  if (agent.visited.length > 20) agent.visited.shift();
  // Clasificación por la máxima altura histórica, no la altura actual.
  if (next.h > agent.bestHeight + 1e-10) {
    agent.bestHeight = next.h;
    agent.bestX = next.x;
    agent.bestZ = next.z;
  }
}

function finish(agent, reason) {
  agent.status = 'finished';
  agent.reason = reason;
}

function chooseUniform(array, rng) {
  return array[Math.min(array.length - 1, Math.floor(rng() * array.length))];
}

/** Una llamada representa una iteración algorítmica. No confía en el navegador. */
export function stepAgent(agent, rng = Math.random) {
  if (agent.status !== 'active') return agent;
  agent.steps++;
  if (agent.steps > 1800) { finish(agent, 'Límite de seguridad de iteraciones'); return agent; }
  const neighbors = neighborhood(agent);
  const improving = neighbors.filter((n) => n.delta > 0.004);
  let next;

  switch (agent.algorithm) {
    case 'simple':
      next = improving[0];
      if (!next) finish(agent, 'Óptimo local o frontera');
      break;

    case 'steepest':
      next = improving.reduce((best, n) => (!best || n.delta > best.delta ? n : best), null);
      if (!next) finish(agent, 'Óptimo local o frontera');
      break;

    case 'stochastic': {
      if (!improving.length) { finish(agent, 'Sin vecinos mejores'); break; }
      const weights = improving.map((n) => Math.max(0.004, n.delta));
      const sum = weights.reduce((a, b) => a + b, 0);
      let ticket = rng() * sum;
      next = improving[improving.length - 1];
      for (let i = 0; i < weights.length; i++) {
        ticket -= weights[i];
        if (ticket <= 0) { next = improving[i]; break; }
      }
      break;
    }

    case 'first_choice': {
      // Orden aleatorio nuevo en cada iteración; toma el primer ascenso.
      const candidates = [...neighbors];
      while (candidates.length) {
        const index = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
        const candidate = candidates.splice(index, 1)[0];
        if (candidate.delta > 0.004) { next = candidate; break; }
      }
      if (!next) finish(agent, 'Sin mejoras entre los vecinos');
      break;
    }

    case 'random_restart': {
      next = improving.reduce((best, n) => (!best || n.delta > best.delta ? n : best), null);
      if (!next) {
        if (agent.restarts >= agent.params.maxRestarts) {
          finish(agent, 'Reinicios agotados');
        } else {
          const spawn = randomSpawn(rng);
          agent.restarts++;
          agent.sideways = 0;
          // Reiniciar la posición no borra el récord histórico.
          move(agent, { ...spawn, h: heightAt(spawn.x, spawn.z) });
          agent.path = [[agent.x, agent.z]];
          agent.visited = [];
        }
      }
      break;
    }

    case 'sideways': {
      next = improving.reduce((best, n) => (!best || n.delta > best.delta ? n : best), null);
      if (next) {
        agent.sideways = 0;
      } else if (agent.sideways < agent.params.sidewaysLimit) {
        // Tolerancia ligera para representar mesetas en un campo continuo.
        const horizontal = neighbors.filter((n) => Math.abs(n.delta) <= 0.06 && !agent.visited.includes(`${n.x.toFixed(2)},${n.z.toFixed(2)}`));
        if (horizontal.length) {
          next = chooseUniform(horizontal, rng);
          agent.sideways++;
        } else finish(agent, 'Meseta sin salidas disponibles');
      } else finish(agent, 'Límite de movimientos laterales');
      break;
    }

    case 'annealing': {
      if (agent.temperature <= agent.params.minTemp || agent.steps > agent.params.maxSteps) {
        finish(agent, 'Criterio de enfriamiento alcanzado');
        break;
      }
      if (!neighbors.length) { finish(agent, 'Sin vecinos dentro del mapa'); break; }
      const proposal = chooseUniform(neighbors, rng);
      const chance = proposal.delta >= 0 ? 1 : Math.exp(proposal.delta / Math.max(agent.temperature, 0.000001));
      if (rng() < chance) next = proposal;
      else agent.rejected++;
      if (agent.steps % agent.params.stepsPerTemp === 0) agent.temperature *= agent.params.coolingRate;
      break;
    }

    default: finish(agent, 'Algoritmo no reconocido');
  }
  if (next) move(agent, next);
  return agent;
}
