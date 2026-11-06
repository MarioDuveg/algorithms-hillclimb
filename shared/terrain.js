/** El mismo relieve matemático se evalúa en el servidor y en WebGL. */
export const EXTENT = 30;
export const VERTICAL_SCALE = 0.67;

const hills = [
  [-17, -10, 14.5, 6.0],
  [16, 13, 15.7, 6.7],
  [-9, 17, 11.8, 5.7],
  [20, -15, 11.5, 5.3],
  [1, 0, 10.0, 5.0],
  [-24, 19, 7.8, 4.5],
  [10.7, -9.8, 36.0, 4.15], // la cumbre dominante
];

export const VALLEYS = [
  [-22, -23], [-4, -20], [21, 23], [-20, 6],
  [6, 23], [25, -2], [-5, 7], [2, -27]
];

function gaussian(x, z, cx, cz, amplitude, sigma) {
  const dx = x - cx;
  const dz = z - cz;
  return amplitude * Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma));
}

/** Altura real para puntuar. Ocho mínimos puntuales tienen altura 0, sin planicies. */
export function heightAt(x, z) {
  let height = 4.2
    + 1.15 * Math.sin(x * 0.41 + z * 0.1) * Math.cos(z * 0.35)
    + 0.75 * Math.sin(x * 0.67 - z * 0.31);
  for (const [cx, cz, a, s] of hills) height += gaussian(x, z, cx, cz, a, s);
  // Cada mínimo se obtiene como una depresión suave que solo toca 0 en
  // su centro. Evitamos Math.max(0, altura): ese recorte generaba
  // explanadas artificiales en el fondo de los valles.
  for (const [cx, cz] of VALLEYS) {
    const r2 = (x - cx) ** 2 + (z - cz) ** 2;
    height *= 1 - Math.exp(-r2 / (2 * 2.65 ** 2));
  }
  return height;
}

export function withinBounds(x, z) {
  return Number.isFinite(x) && Number.isFinite(z)
    && x >= -EXTENT && x <= EXTENT && z >= -EXTENT && z <= EXTENT;
}

/** Máximo estimado sobre malla fina; su valor de referencia es ilustrativo. */
export function findLandmarks() {
  let summit = { x: 0, z: 0, h: -Infinity };
  const step = 0.2;
  for (let ix = 0; ix <= Math.round(2 * EXTENT / step); ix++) {
    for (let iz = 0; iz <= Math.round(2 * EXTENT / step); iz++) {
      const x = -EXTENT + ix * step;
      const z = -EXTENT + iz * step;
      const h = heightAt(x, z);
      if (h > summit.h) summit = { x, z, h };
    }
  }
  return {
    summit,
    minima: VALLEYS.filter(([x, z]) => heightAt(x, z) < 0.001)
      .map(([x, z]) => ({ x, z, h: 0 })),
  };
}
