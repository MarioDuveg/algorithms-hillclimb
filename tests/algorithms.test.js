import test from 'node:test';
import assert from 'node:assert/strict';
import { findLandmarks, heightAt, withinBounds } from '../shared/terrain.js';
import { ALGORITHMS, createAgent, normalizeParams, stepAgent } from '../shared/algorithms.js';
import { Room } from '../server/room.js';

test('Relieve: existe una cumbre prominente y ocho mínimos globales de altura cero', () => {
  const landmarks = findLandmarks();
  assert.ok(landmarks.summit.h > 35);
  assert.equal(landmarks.minima.length, 8);
  landmarks.minima.forEach(({ x, z, h }) => {
    assert.equal(heightAt(x, z), 0);
    assert.equal(h, 0);
    // El valle es puntualmente mínimo, no una planicie horizontal recortada a 0.
    assert.ok(heightAt(x + 0.3, z) > 0);
    assert.ok(heightAt(x, z + 0.3) > 0);
  });
  assert.equal(withinBounds(31, 0), false);
});

test('Se ofrecen las seis variantes de Hill Climbing y el recocido simulado', () => {
  assert.equal(ALGORITHMS.length, 7);
  assert.deepEqual(new Set(ALGORITHMS.map((a) => a.id)), new Set(['simple','steepest','stochastic','first_choice','random_restart','sideways','annealing']));
});

test('Los parámetros enviados por clientes se acotan en el servidor', () => {
  const params = normalizeParams({ startTemp: 500000, coolingRate: 0, minTemp: -9, neighbors: 500, maxRestarts: -10, maxSteps: 'nope' });
  assert.equal(params.startTemp, 30);
  assert.equal(params.coolingRate, .9);
  assert.equal(params.minTemp, .01);
  assert.equal(params.neighbors, 16);
  assert.equal(params.maxRestarts, 0);
  assert.equal(params.maxSteps, 650);
});

test('Los escaladores clásicos nunca descienden y mantienen el récord', () => {
  for(const algorithm of ['simple','steepest','stochastic','first_choice','sideways']) {
    const agent=createAgent(-15,-11,algorithm);
    let last=agent.h;
    for(let i=0;i<200&&agent.status==='active';i++) {
      stepAgent(agent,()=>.3);
      assert.ok(agent.h >= last - (algorithm==='sideways' ? .061 : .000001), `Descenso indebido: ${algorithm}`);
      last=agent.h;
      assert.ok(agent.bestHeight >= agent.h-.07);
      assert.ok(withinBounds(agent.x,agent.z));
    }
    assert.ok(agent.steps>0);
  }
});

test('Recocido simulado puede aceptar un paso cuesta abajo según la temperatura', () => {
  const agent=createAgent(11,-9.8,'annealing',{startTemp:30,coolingRate:.9,stepsPerTemp:1});
  const oldH=agent.h;
  stepAgent(agent,()=>0); // elige vecino 0 y acepta siempre si probabilidad >0
  assert.ok(agent.h<oldH);
  assert.equal(agent.accepted,1);
  assert.equal(agent.steps,1);
  assert.ok(agent.bestHeight>=oldH);
  assert.ok(agent.temperature<30);
});

test('Random-Restart conserva récord al reiniciar una búsqueda', () => {
  const agent=createAgent(11,-9.8,'random_restart',{maxRestarts:1});
  const initialBest=agent.bestHeight;
  stepAgent(agent,()=>.15);
  assert.equal(agent.restarts,1);
  assert.ok(agent.bestHeight>=initialBest);
  assert.equal(agent.status,'active');
});

test('Start y Reset requieren rol admin y Reset obliga a re-elegir', () => {
  const room=new Room(()=>{},()=>.25);
  room.join('admin-id','admin',true);
  room.join('u1','Elena');
  assert.throws(()=>room.start('u1'),/administrador/);
  room.select('u1','annealing',{startTemp:15});
  assert.equal(room.snapshot().readyCount,1);
  assert.equal(room.start('admin-id'),1);
  assert.equal(room.phase,'running');
  room.tick();
  assert.equal(room.snapshot().leaderboard.length,1);
  assert.equal(room.snapshot().leaderboard[0].name,'Elena');
  room.reset('admin-id');
  assert.equal(room.phase,'lobby');
  assert.equal(room.round,2);
  assert.equal(room.players.get('u1').algorithm,null);
  assert.equal(room.snapshot().leaderboard.length,0);
  assert.equal(room.snapshot().players.length,2);
});
