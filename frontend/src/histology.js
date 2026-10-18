// A stained airway section in the resting geometry, painted once and then
// warped by the solved displacement field. Colours imitate a Movat pentachrome
// stain (muscle red, cartilage blue-green, collagen yellow, nuclei and elastic
// fibres black), so they are fixed rather than themed. Everything is illustrative.
export const TEXTURE_SIZE = 2048;
const CENTER = TEXTURE_SIZE / 2;
const TAU = 2 * Math.PI;
/** Texture pixels per unit of resting radius. */
export const sectionScale = outerRadius => (CENTER - 8) / outerRadius;

export const STAIN = {
  mucosa: '#b5bd8c', muscle: '#c4504a', cartilage: '#6aa5ae', adventitia: '#d9b354',
};
const NUCLEUS = ['#1f1a2b', '#2a2238', '#352a45', '#191522'];
const ELASTIC = '#2d2530';

function generator(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise on a periodic lattice, summed over octaves.
function noiseField(size, cells, octaves, random) {
  const lattice = Array.from({ length: octaves }, (_, o) => {
    const n = cells * 2 ** o;
    return { n, values: Float32Array.from({ length: n * n }, random) };
  });
  const field = new Float32Array(size * size);
  const smooth = t => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sum = 0, weight = 0;
    lattice.forEach(({ n, values }, o) => {
      const fx = x / size * n, fy = y / size * n, x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = smooth(fx - x0), ty = smooth(fy - y0), x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const top = values[y0 * n + x0] * (1 - tx) + values[y0 * n + x1] * tx;
      const bottom = values[y1 * n + x0] * (1 - tx) + values[y1 * n + x1] * tx;
      const amplitude = .5 ** o;
      sum += amplitude * (top * (1 - ty) + bottom * ty); weight += amplitude;
    });
    field[y * size + x] = sum / weight;
  }
  return field;
}

function shadeCanvas(size, shade) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d'), image = context.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = shade(i);
    image.data[4 * i] = r; image.data[4 * i + 1] = g; image.data[4 * i + 2] = b; image.data[4 * i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function paintSection({ innerRadius, outerRadius }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  const random = generator(7);
  const between = (low, high) => low + (high - low) * random();
  const pick = list => list[Math.floor(random() * list.length)];
  const scale = sectionScale(outerRadius);
  const R = fraction => scale * (innerRadius + fraction * (outerRadius - innerRadius));
  const at = (radius, angle) => [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)];
  const epithelium = R(.06), mucosa = R(.2), muscle = R(.5), cartilage = R(.8), outer = R(1), lumen = R(0);
  const apical = lumen + 5; // cilia fill the space between the apical surface and the free edge
  // Internal interfaces wander by about a pixel on screen, as cut tissue does.
  // The lumen and outer edges are the model's boundaries and stay exact.
  const wobble = [0, .3, 1, 1, 1, 0].map(amplitude => [amplitude, between(0, TAU), between(0, TAU), between(0, TAU)]);
  const edge = (radius, angle, interfaceIndex) => {
    const [amplitude, p, q, r] = wobble[interfaceIndex];
    return radius + amplitude * (3 * Math.sin(5 * angle + p) + 2 * Math.sin(11 * angle + q) + 1.5 * Math.sin(23 * angle + r));
  };
  const band = (inner, outerEdge, color, seed) => {
    ctx.beginPath();
    for (let i = 0; i <= 720; i++) { const a = i / 720 * TAU; const p = at(edge(outerEdge, a, seed + 1), a); if (i) ctx.lineTo(...p); else ctx.moveTo(...p); }
    for (let i = 720; i >= 0; i--) { const a = i / 720 * TAU; ctx.lineTo(...at(edge(inner, a, seed), a)); }
    ctx.fillStyle = color; ctx.fill();
  };
  const ellipse = (x, y, rx, ry, rotation, color, alpha = 1) => {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rotation, 0, TAU); ctx.fill();
  };
  const nucleus = (x, y, rx, ry, rotation, alpha = .85) => {
    ellipse(x, y, rx + .8, ry + .8, rotation, '#4b4060', alpha * .3);
    ellipse(x, y, rx, ry, rotation, pick(NUCLEUS), alpha);
  };
  const fibre = (radius, angle, length, width, color, alpha, curl = 1) => {
    // A wavy collagen or elastic fibre running roughly around the airway.
    const tilt = between(-.5, .5) * curl, steps = 4;
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(...at(radius, angle));
    let r = radius, a = angle;
    for (let s = 0; s < steps; s++) {
      const dr = Math.sin(tilt) * length / steps, da = Math.cos(tilt) * length / steps / r;
      const bend = between(-1, 1) * 4 * curl;
      ctx.quadraticCurveTo(...at(r + dr / 2 + bend, a + da / 2), ...at(r + dr, a + da));
      r += dr; a += da;
    }
    ctx.stroke();
  };
  const spot = (inner, outerEdge) => {
    const radius = Math.sqrt(between(inner ** 2, outerEdge ** 2)), angle = between(0, TAU);
    return { radius, angle, point: at(radius, angle) };
  };
  const vessel = (radius, angle, size, wall) => {
    const [x, y] = at(radius, angle);
    ellipse(x, y, size + wall, (size + wall) * between(.75, .95), angle, '#c4504a', .9);
    for (let i = 0; i < Math.round(size / 2); i++) {
      const a = between(0, TAU), [nx, ny] = [x + (size + wall / 2) * Math.cos(a), y + (size + wall / 2) * Math.sin(a)];
      nucleus(nx, ny, 1.6, 5, a + Math.PI / 2, .8);
    }
    ellipse(x, y, size, size * between(.7, .9), angle, '#f4efe4', 1);
    for (let i = 0; i < size / 2.5; i++) {
      const a = between(0, TAU), d = between(0, size * .6);
      ellipse(x + d * Math.cos(a), y + d * Math.sin(a), 3.6, 3.2, a, '#d9442e', .9);
    }
  };

  // Ground substance of each layer.
  band(apical, epithelium, '#b77b93', 0);
  band(epithelium, mucosa, '#dcdfbd', 1);
  band(mucosa, muscle, '#c9574f', 2);
  // Cartilage matrix is greener under the perichondrium and bluer inside.
  const matrix = ctx.createRadialGradient(CENTER, CENTER, muscle, CENTER, CENTER, cartilage);
  [[0, '#a9c8b0'], [.2, '#88bab4'], [.5, '#6aa5ae'], [.8, '#88bab4'], [1, '#a9c8b0']].forEach(([stop, color]) => matrix.addColorStop(stop, color));
  band(muscle, cartilage, matrix, 3);
  band(cartilage, outer, '#e3c77e', 4);

  // Lamina propria and submucosa: loose collagen, elastic fibres, fibroblasts,
  // lymphocytes, capillaries and a few mucous glands.
  for (let i = 0; i < 700; i++) { const { radius, angle } = spot(epithelium + 4, mucosa - 4); fibre(radius, angle, between(14, 40), between(.8, 2), pick(['#d9c27a', '#e0cd8c', '#cdb46a']), between(.35, .7)); }
  for (let i = 0; i < 260; i++) { const { radius, angle } = spot(epithelium + 4, mucosa - 4); fibre(radius, angle, between(16, 44), between(.7, 1.1), ELASTIC, between(.4, .65)); }
  for (let i = 0; i < 4; i++) {
    const angle = between(0, TAU), radius = between(epithelium + 30, mucosa - 26);
    for (let j = 0; j < 7; j++) {
      const a = angle + between(-.05, .05), r = radius + between(-12, 12), [x, y] = at(r, a), size = between(9, 13);
      ellipse(x, y, size, size * .85, a, '#7fb4c9', 1);
      for (let n = 0; n < 9; n++) { const t = n / 9 * TAU; nucleus(x + size * .82 * Math.cos(t), y + size * .82 * Math.sin(t), 1.5, 2.6, t, .85); }
      ellipse(x, y, 2.2, 2, 0, '#eef3f0', 1);
    }
  }
  for (let i = 0; i < 16; i++) { const { radius, angle } = spot(epithelium + 14, mucosa - 12); vessel(radius, angle, between(5, 9), 2.5); }
  for (let i = 0; i < 420; i++) { const { angle, point } = spot(epithelium + 3, mucosa - 2); nucleus(...point, between(1.4, 2), between(4, 6.5), angle + Math.PI / 2 + between(-.6, .6), .8); }
  for (let i = 0; i < 160; i++) { const { point } = spot(epithelium + 3, mucosa - 2); const size = between(2.2, 2.9); nucleus(...point, size, size, 0, .9); }

  // Pseudostratified ciliated epithelium on a basement membrane.
  ctx.globalAlpha = .8; ctx.strokeStyle = '#7a5a6a'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 720; i++) { const a = i / 720 * TAU, p = at(edge(epithelium, a, 1), a); if (i) ctx.lineTo(...p); else ctx.moveTo(...p); }
  ctx.stroke();
  for (let tier = 0; tier < 4; tier++) {
    const radius = epithelium - 4 - tier * 5.5, count = Math.round(TAU * radius / (tier < 2 ? 6.5 : 10));
    for (let i = 0; i < count; i++) {
      const angle = (i + between(-.3, .3) + tier * .5) / count * TAU;
      nucleus(...at(radius + between(-1.5, 1.5), angle), between(2.2, 2.9), between(3.6, 4.8), angle + between(-.25, .25), .82);
    }
  }
  for (let i = 0; i < 170; i++) {
    const angle = between(0, TAU), [x, y] = at(apical + between(4, 7), angle);
    ellipse(x, y, between(5, 7), between(3, 4), angle, '#5fa8c4', .9);
  }
  ctx.lineWidth = 1; ctx.lineCap = 'round';
  for (let i = 0; i < 4200; i++) {
    const angle = between(0, TAU), tip = lumen + between(.3, 1.8);
    ctx.globalAlpha = between(.35, .75); ctx.strokeStyle = pick(['#a7708a', '#b98299', '#93617a']);
    ctx.beginPath(); ctx.moveTo(...at(apical + 1, angle)); ctx.lineTo(...at(tip, angle + between(-.002, .002))); ctx.stroke();
  }

  // Smooth muscle: red fascicles of circumferential cells in slightly different
  // tones, split by thin collagen septa. Long, thin nuclei sit in staggered
  // rows along the cells.
  for (let i = 0; i < 90; i++) {
    const radius = between(mucosa + 8, muscle - 8), angle = between(0, TAU);
    ctx.globalAlpha = between(.08, .2); ctx.strokeStyle = pick(['#b8433f', '#d8786c', '#c2504a']); ctx.lineWidth = between(10, 26);
    ctx.beginPath(); ctx.arc(CENTER, CENTER, radius, angle, angle + between(.3, 1.2)); ctx.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    const { radius, angle } = spot(mucosa + 2, muscle - 2);
    ctx.globalAlpha = between(.12, .26); ctx.strokeStyle = pick(['#b4423d', '#c75a50', '#df8a7c']); ctx.lineWidth = between(1, 2.4);
    ctx.beginPath(); ctx.arc(CENTER, CENTER, radius, angle, angle + between(20, 60) / radius); ctx.stroke();
  }
  for (let i = 0; i < 34; i++) {
    let radius = between(mucosa + 10, muscle - 10), angle = between(0, TAU);
    const span = between(.5, 1.8), steps = 40;
    ctx.globalAlpha = between(.3, .55); ctx.strokeStyle = '#ddb98a'; ctx.lineWidth = between(1.8, 3.6);
    ctx.beginPath(); ctx.moveTo(...at(radius, angle));
    for (let step = 0; step < steps; step++) {
      radius = Math.min(muscle - 6, Math.max(mucosa + 6, radius + between(-2.5, 2.5)));
      angle += span / steps; ctx.lineTo(...at(radius, angle));
    }
    ctx.stroke();
    // An oblique septum branching off toward a neighbouring fascicle.
    if (random() < .7) {
      const start = angle - between(0, span), r0 = between(mucosa + 8, muscle - 8), r1 = Math.min(muscle - 6, Math.max(mucosa + 6, r0 + between(-40, 40)));
      ctx.lineWidth = between(1.5, 3); ctx.beginPath(); ctx.moveTo(...at(r0, start)); ctx.lineTo(...at(r1, start + between(.03, .09))); ctx.stroke();
    }
  }
  const tracks = Math.round((muscle - mucosa) / 7);
  for (let track = 0; track < tracks; track++) {
    const base = mucosa + 4 + (track + .5) * (muscle - mucosa - 8) / tracks;
    for (let angle = between(0, TAU), end = angle + TAU; angle < end; angle += between(34, 80) / base) {
      if (random() < .25) continue;
      const [x, y] = at(base + between(-2.5, 2.5), angle), rotation = angle + Math.PI / 2 + between(-.08, .08);
      ellipse(x, y, between(12, 17), 3.2, rotation, '#e9a598', .3);
      nucleus(x, y, between(10, 16), between(1.3, 1.9), rotation, between(.55, .8));
    }
  }

  // Hyaline cartilage: glassy proteoglycan-rich matrix, chondrocytes in lacunae
  // (often in small isogenous groups), and a collagenous perichondrium.
  const perichondrium = 13;
  band(muscle, muscle + perichondrium, '#dcc47e', 3);
  band(cartilage - perichondrium, cartilage, '#dcc47e', 3);
  for (const edge of [muscle + perichondrium / 2, cartilage - perichondrium / 2]) {
    for (let i = 0; i < 260; i++) {
      const angle = between(0, TAU), [x, y] = at(edge + between(-4, 4), angle);
      nucleus(x, y, between(5, 8), between(1.2, 1.7), angle + Math.PI / 2, .8);
    }
  }
  const placed = [];
  for (let attempt = 0; attempt < 9000 && placed.length < 420; attempt++) {
    const { radius, angle, point } = spot(muscle + perichondrium + 6, cartilage - perichondrium - 6);
    const spacing = between(22, 44);
    if (placed.some(([x, y]) => (x - point[0]) ** 2 + (y - point[1]) ** 2 < spacing ** 2)) continue;
    placed.push(point);
    // Lacunae are small and flattened under the perichondrium, and larger
    // and more often grouped toward the middle of the plate.
    const depth = Math.min(1, Math.min(radius - muscle, cartilage - radius) / ((cartilage - muscle) / 2) * 1.3);
    const flat = .45 + .55 * depth;
    const cells = depth > .55 ? (random() < .4 ? 1 : random() < .65 ? 2 : 3 + Math.floor(random() * 2)) : random() < .8 ? 1 : 2;
    const spread = angle + Math.PI / 2 + between(-.6, .6), size = .75 + .4 * depth;
    ellipse(...point, (13 + 3.5 * cells) * size, (12 + 2 * cells) * flat * size, spread, '#4f8f9c', .22);
    let [x, y] = point;
    for (let c = 0; c < cells; c++) {
      // Daughter cells sit beside one another in a loose cluster, not a chain.
      if (c) { const turn = spread + c * between(1.2, 2.4), step = between(8, 11) * size; x = point[0] + step * Math.cos(turn); y = point[1] + step * Math.sin(turn) * flat; }
      const rx = between(5, 8.5) * size, ry = between(4.5, 7) * flat * size;
      ellipse(x, y, rx, ry, spread + between(-.3, .3), '#eef3ee', .95);
      ellipse(x, y, rx * .7, ry * .68, spread, '#a7bfbd', .7);
      nucleus(x + between(-1, 1), y + between(-1, 1), 2.4, 2.1, spread, .8);
    }
  }

  // Adventitia: denser collagen bundles, elastic fibres, fibroblasts and vessels.
  for (let i = 0; i < 900; i++) { const { radius, angle } = spot(cartilage + 3, outer - 2); fibre(radius, angle, between(20, 60), between(1, 3.4), pick(['#d1ad55', '#c9a148', '#dcbd6c']), between(.35, .65), 1.4); }
  for (let i = 0; i < 200; i++) { const { radius, angle } = spot(cartilage + 3, outer - 2); fibre(radius, angle, between(20, 50), between(.7, 1.1), ELASTIC, between(.35, .6), 1.4); }
  for (let i = 0; i < 6; i++) { const { radius, angle } = spot(cartilage + 24, outer - 24); vessel(radius, angle, between(8, 16), between(4, 8)); }
  for (let i = 0; i < 300; i++) { const { angle, point } = spot(cartilage + 3, outer - 2); nucleus(...point, between(1.3, 1.9), between(4.5, 7), angle + Math.PI / 2 + between(-.8, .8), .8); }

  // Uneven staining and section grain over the whole ring.
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.beginPath(); ctx.arc(CENTER, CENTER, outer, 0, TAU); ctx.arc(CENTER, CENTER, apical, 0, TAU, true); ctx.clip('evenodd');
  const blotches = noiseField(256, 6, 4, random);
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shadeCanvas(256, i => { const v = 255 - Math.round(64 * Math.max(0, blotches[i] - .3)); return [v, Math.min(255, v + 4), v]; }), 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = .1;
  ctx.drawImage(shadeCanvas(1024, () => { const v = Math.round(between(150, 255)); return [v, v - 6, v - 16]; }), 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx.restore();
  ctx.globalAlpha = 1;
  return canvas;
}
