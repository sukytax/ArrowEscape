export const MODES = {
  Easy: { cols: 12, rows: 14, arrows: 25, stroke: 0.16, hints: 5, label: 'Easy', color: '#3f9879' },
  Medium: { cols: 19, rows: 23, arrows: 60, stroke: 0.165, hints: 3, label: 'Medium', color: '#d99a32' },
  Hard: { cols: 36, rows: 44, arrows: 200, stroke: 0.13, hints: 1, label: 'Hard', color: '#d05f5f' },
};

export const SHAPES_CATALOG = [
  { id: 'rectangle', nameId: 'Persegi', nameEn: 'Rectangle' },
  { id: 'cross', nameId: 'Salib (+)', nameEn: 'Cross' },
  { id: 'diamond', nameId: 'Berlian', nameEn: 'Diamond' },
  { id: 'hourglass', nameId: 'Jam Pasir', nameEn: 'Hourglass' },
  { id: 'shield', nameId: 'Perisai', nameEn: 'Shield' },
  { id: 'pyramid', nameId: 'Piramida', nameEn: 'Pyramid' },
  { id: 'star', nameId: 'Bintang', nameEn: 'Star' },
  { id: 't_shape', nameId: 'Bentuk T', nameEn: 'T-Shape' },
  { id: 'staircase', nameId: 'Tangga Zigzag', nameEn: 'Staircase' },
  { id: 'hexagon', nameId: 'Heksagon', nameEn: 'Hexagon' },
];

export function getBoardShapeInfo(level) {
  if (!level || level <= 1) return SHAPES_CATALOG[0];
  const idx = 1 + ((level - 2) % (SHAPES_CATALOG.length - 1));
  return SHAPES_CATALOG[idx];
}

export function isCellInShape(x, y, cols, rows, shapeId) {
  if (shapeId === 'rectangle' || !shapeId) return true;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const nx = (x - cx) / Math.max(1, cx);
  const ny = (y - cy) / Math.max(1, cy);
  const u = Math.abs(nx);
  const v = Math.abs(ny);

  switch (shapeId) {
    case 'cross': {
      // Greek cross: cut out 4 corner rectangles
      return !(u > 0.52 && v > 0.52);
    }
    case 'diamond': {
      // Chamfered 4 corners (faceted octagon / diamond)
      return (u + v) <= 1.34;
    }
    case 'hourglass': {
      // Pinched horizontal waist
      const maxU = 0.52 + 0.48 * (v * v);
      return u <= maxU;
    }
    case 'shield': {
      // Rounded oval / barrel shape
      return (u * u + v * v) <= 1.15;
    }
    case 'pyramid': {
      // Stepped pyramid: narrower at top (ny < -0.3), wider at bottom
      const maxW = ny < -0.3 ? 0.55 : (ny < 0.3 ? 0.8 : 1.0);
      return u <= maxW;
    }
    case 'star': {
      // 8-notched star: cut outer corner blocks
      return !(u > 0.65 && v > 0.65);
    }
    case 't_shape': {
      // T-shape: wide bar at top, centered stem at bottom
      if (ny <= -0.15) return true;
      return u <= 0.48;
    }
    case 'staircase': {
      // Diagonal stepped / staircase mask
      return Math.abs(nx - ny * 0.7) <= 1.15;
    }
    case 'hexagon': {
      // Vertical hexagon: top and bottom tapered
      return (u * 0.5 + v) <= 1.25 && u <= 1.0;
    }
    default:
      return true;
  }
}

export function getBoundaryPath(cols, rows, shapeId) {
  const edges = new Map();
  function addEdge(x1, y1, x2, y2) {
    const key = `${x1},${y1}->${x2},${y2}`;
    edges.set(key, { from: [x1, y1], to: [x2, y2] });
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isCellInShape(x, y, cols, rows, shapeId)) continue;
      if (y === 0 || !isCellInShape(x, y - 1, cols, rows, shapeId)) {
        addEdge(x - 0.5, y - 0.5, x + 0.5, y - 0.5);
      }
      if (x === cols - 1 || !isCellInShape(x + 1, y, cols, rows, shapeId)) {
        addEdge(x + 0.5, y - 0.5, x + 0.5, y + 0.5);
      }
      if (y === rows - 1 || !isCellInShape(x, y + 1, cols, rows, shapeId)) {
        addEdge(x + 0.5, y + 0.5, x - 0.5, y + 0.5);
      }
      if (x === 0 || !isCellInShape(x - 1, y, cols, rows, shapeId)) {
        addEdge(x - 0.5, y + 0.5, x - 0.5, y - 0.5);
      }
    }
  }

  const adj = new Map();
  for (const { from, to } of edges.values()) {
    const kFrom = `${from[0]},${from[1]}`;
    if (!adj.has(kFrom)) adj.set(kFrom, []);
    adj.get(kFrom).push(to);
  }

  const visited = new Set();
  const paths = [];

  for (const [startKey, targets] of adj.entries()) {
    for (const target of targets) {
      const edgeKey = `${startKey}->${target[0]},${target[1]}`;
      if (visited.has(edgeKey)) continue;

      const loop = [];
      let currPt = startKey.split(',').map(Number);
      loop.push(currPt);

      let nextPt = target;
      visited.add(edgeKey);

      while (nextPt) {
        loop.push(nextPt);
        const currKey = `${nextPt[0]},${nextPt[1]}`;
        const nextTargets = adj.get(currKey) || [];
        let chosen = null;
        for (const t of nextTargets) {
          const ek = `${currKey}->${t[0]},${t[1]}`;
          if (!visited.has(ek)) {
            visited.add(ek);
            chosen = t;
            break;
          }
        }
        nextPt = chosen;
      }

      if (loop.length > 2) {
        const simp = [loop[0]];
        for (let i = 1; i < loop.length - 1; i++) {
          const prev = simp[simp.length - 1];
          const curr = loop[i];
          const next = loop[i + 1];
          const dx1 = curr[0] - prev[0];
          const dy1 = curr[1] - prev[1];
          const dx2 = next[0] - curr[0];
          const dy2 = next[1] - curr[1];
          if ((dx1 === 0 && dx2 === 0) || (dy1 === 0 && dy2 === 0)) continue;
          simp.push(curr);
        }
        simp.push(loop[loop.length - 1]);

        let d = `M ${simp[0][0]} ${simp[0][1]}`;
        for (let i = 1; i < simp.length; i++) {
          d += ` L ${simp[i][0]} ${simp[i][1]}`;
        }
        d += ' Z';
        paths.push(d);
      }
    }
  }

  return paths.join(' ');
}

const DIRS = [
  { name: 'right', dx: 1, dy: 0 },
  { name: 'left', dx: -1, dy: 0 },
  { name: 'up', dx: 0, dy: -1 },
  { name: 'down', dx: 0, dy: 1 },
];
export const VEC = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };

// ─── deterministic RNG ────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dirBetween(a, b) {
  const dx = Math.sign(b[0] - a[0]);
  const dy = Math.sign(b[1] - a[1]);
  if (dx === 1) return 'right';
  if (dx === -1) return 'left';
  if (dy === -1) return 'up';
  return 'down';
}

function simplifyPts(raw) {
  if (raw.length <= 2) return raw.slice();
  const out = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = raw[i];
    const [cx, cy] = raw[i + 1];
    if ((ax === bx && bx === cx) || (ay === by && by === cy)) continue;
    out.push(raw[i]);
  }
  out.push(raw[raw.length - 1]);
  return out;
}

// Shared vertices are never allowed between distinct arrows.
export function hasCrossing(arrows) {
  const owner = new Map();
  for (const arrow of arrows) {
    for (let i = 1; i < arrow.pts.length; i++) {
      const [x1, y1] = arrow.pts[i - 1];
      const [x2, y2] = arrow.pts[i];
      const dx = Math.sign(x2 - x1);
      const dy = Math.sign(y2 - y1);
      for (let x = x1, y = y1; ; x += dx, y += dy) {
        const key = `${x},${y}`;
        if (owner.has(key) && owner.get(key) !== arrow.id) return true;
        owner.set(key, arrow.id);
        if (x === x2 && y === y2) break;
      }
    }
  }
  return false;
}

// ─── collision ────────────────────────────────────────────────────────────────
function segmentHitDistance(ax, ay, bx, by, tx, ty, dx, dy) {
  if (dx !== 0) {
    if (ax === bx) {
      const lo = Math.min(ay, by), hi = Math.max(ay, by);
      if (ty >= lo && ty <= hi && (dx > 0 ? ax > tx : ax < tx)) {
        return Math.abs(ax - tx);
      }
    } else if (ay === by && ay === ty) {
      const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
      if (dx > 0 && hi > tx) return lo > tx ? lo - tx : 1;
      if (dx < 0 && lo < tx) return hi < tx ? tx - hi : 1;
    }
  } else {
    if (ay === by) {
      const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
      if (tx >= lo && tx <= hi && (dy > 0 ? ay > ty : ay < ty)) {
        return Math.abs(ay - ty);
      }
    } else if (ax === bx && ax === tx) {
      const lo = Math.min(ay, by), hi = Math.max(ay, by);
      if (dy > 0 && hi > ty) return lo > ty ? lo - ty : 1;
      if (dy < 0 && lo < ty) return hi < ty ? ty - hi : 1;
    }
  }
  return Infinity;
}

export function hitDistance(arrow, arrows) {
  if (arrow.removed || arrow.exiting) return Infinity;
  const [dx, dy] = VEC[arrow.dir];
  const tip = arrow.pts[arrow.pts.length - 1];
  const tx = tip[0], ty = tip[1];
  let minDist = Infinity;

  for (const other of arrows) {
    if (other.removed || other.exiting) continue;
    const maxK = other === arrow ? other.pts.length - 1 : other.pts.length;
    for (let k = 1; k < maxK; k++) {
      const [ax, ay] = other.pts[k - 1];
      const [bx, by] = other.pts[k];
      const d = segmentHitDistance(ax, ay, bx, by, tx, ty, dx, dy);
      if (d < minDist) minDist = d;
    }
  }
  return minDist;
}

export function isClear(arrow, arrows) {
  if (arrow.removed || arrow.exiting) return false;
  return hitDistance(arrow, arrows) === Infinity;
}

export function solveCount(arrows) {
  const list = arrows.map(a => ({ ...a, removed: false, exiting: false }));
  let count = 0;
  let progress = true;
  while (progress) {
    progress = false;
    for (const a of list) {
      if (!a.removed && isClear(a, list)) {
        a.removed = true;
        count++;
        progress = true;
      }
    }
  }
  return count;
}

// ─── dense interlocking maze generator ────────────────────────────────────────
function rayClearOfGrid(tip, dir, occGrid, cols, rows) {
  const [dx, dy] = VEC[dir];
  let x = tip[0] + dx;
  let y = tip[1] + dy;
  while (x >= 0 && x < cols && y >= 0 && y < rows) {
    if (occGrid[y * cols + x] !== -1) return false;
    x += dx;
    y += dy;
  }
  return true;
}

function isTurnClockwise(fromDir, toDir) {
  if (fromDir === 'right') return toDir === 'down';
  if (fromDir === 'down') return toDir === 'left';
  if (fromDir === 'left') return toDir === 'up';
  if (fromDir === 'up') return toDir === 'right';
  return false;
}

function generateMaze(cols, rows, seed, shapeId = 'rectangle') {
  const rng = mulberry32(seed);
  const total = cols * rows;
  const owner = new Int32Array(total).fill(-1);
  const paths = [];

  function inShape(x, y) {
    return isCellInShape(x, y, cols, rows, shapeId);
  }

  function countFreeNeighbors(x, y) {
    let c = 0;
    for (const d of DIRS) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && inShape(nx, ny) && owner[ny * cols + nx] === -1) c++;
    }
    return c;
  }

  function pickStart() {
    let minDeg = 99;
    let best = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!inShape(x, y)) continue;
        if (owner[y * cols + x] !== -1) continue;
        const deg = countFreeNeighbors(x, y);
        if (deg === 0) continue;
        if (deg < minDeg) {
          minDeg = deg;
          best = [[x, y]];
        } else if (deg === minDeg) {
          best.push([x, y]);
        }
      }
    }
    return best.length ? best[Math.floor(rng() * best.length)] : null;
  }

  let nextId = 0;

  while (true) {
    const start = pickStart();
    if (!start) break;
    const pid = nextId++;
    const cells = [start];
    owner[start[1] * cols + start[0]] = pid;

    const styleRoll = rng();
    let style = 'compact';
    let targetLen = 4;
    let maxStraight = 2;
    const spiralCW = rng() < 0.5;

    if (styleRoll < 0.22) {
      // Wrapper / Barrier: Creates prominent walls & brackets that cover/gate inner clusters
      style = 'wrapper';
      targetLen = 10 + Math.floor(rng() * 8); // 10 to 17 cells
      maxStraight = 5 + Math.floor(rng() * 4); // 5 to 8 cells straight!
    } else if (styleRoll < 0.52) {
      // Spiral / Hook: Loops inwards or outwards, creating pockets for smaller arrows
      style = 'spiral';
      targetLen = 7 + Math.floor(rng() * 6); // 7 to 12 cells
      maxStraight = 2 + Math.floor(rng() * 2);
    } else if (styleRoll < 0.78) {
      // Zigzag / Stepper: Weaves through paths
      style = 'zigzag';
      targetLen = 5 + Math.floor(rng() * 4); // 5 to 8 cells
      maxStraight = 2;
    } else {
      // Compact: Small key arrows
      style = 'compact';
      targetLen = 3 + Math.floor(rng() * 3); // 3 to 5 cells
      maxStraight = 2;
    }

    let prevDir = null;
    let straightRun = 0;

    while (cells.length < targetLen) {
      const [cx, cy] = cells[cells.length - 1];
      const candidates = [];
      for (const d of DIRS) {
        const nx = cx + d.dx, ny = cy + d.dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        if (!inShape(nx, ny)) continue;
        if (owner[ny * cols + nx] !== -1) continue;
        const deg = countFreeNeighbors(nx, ny);
        let score = (4 - deg) * 2.2;
        if (prevDir) {
          const isStraight = d.name === prevDir;
          const isCW = isTurnClockwise(prevDir, d.name);

          if (style === 'wrapper') {
            if (isStraight) {
              score += straightRun < maxStraight ? 4.5 : -3.5;
            } else {
              score += straightRun >= 3 ? 3.0 : 0.2;
            }
          } else if (style === 'spiral') {
            if (isStraight) {
              score += straightRun < maxStraight ? 1.5 : -2.5;
            } else {
              score += isCW === spiralCW ? 3.5 : 0.5;
            }
          } else if (style === 'zigzag') {
            if (isStraight) {
              score += straightRun < maxStraight ? 1.0 : -2.8;
            } else {
              score += straightRun >= 1 ? 2.5 : 0.8;
            }
          } else {
            if (isStraight) {
              score += straightRun < maxStraight ? 1.2 : -2.0;
            } else {
              score += 1.0;
            }
          }
        }
        score += rng() * 1.5;
        candidates.push({ nx, ny, dir: d.name, score });
      }
      if (!candidates.length) break;
      candidates.sort((a, b) => b.score - a.score);
      const chosen = candidates[0];
      owner[chosen.ny * cols + chosen.nx] = pid;
      cells.push([chosen.nx, chosen.ny]);
      if (chosen.dir === prevDir) straightRun++;
      else { prevDir = chosen.dir; straightRun = 1; }
    }
    paths.push({ id: pid, cells });
  }

  // Absorb isolated 1-cell spots into an adjacent path endpoint
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!inShape(x, y)) continue;
      if (owner[y * cols + x] !== -1) continue;
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        if (!inShape(nx, ny)) continue;
        const pid = owner[ny * cols + nx];
        if (pid === -1) continue;
        const p = paths[pid];
        if (p.cells[0][0] === nx && p.cells[0][1] === ny) {
          p.cells.unshift([x, y]);
          owner[y * cols + x] = pid;
          break;
        } else if (p.cells[p.cells.length - 1][0] === nx && p.cells[p.cells.length - 1][1] === ny) {
          p.cells.push([x, y]);
          owner[y * cols + x] = pid;
          break;
        }
      }
    }
  }

  const active = paths.filter(p => p.cells.length >= 2);
  owner.fill(-1);
  for (const p of active) {
    for (const [x, y] of p.cells) owner[y * cols + x] = p.id;
  }

  const remaining = new Map(active.map(p => [p.id, p]));
  const finalArrows = [];

  while (remaining.size > 0) {
    const clearChoices = [];
    for (const p of remaining.values()) {
      const c = p.cells;
      const fwdDir = dirBetween(c[c.length - 2], c[c.length - 1]);
      const fwdOk = rayClearOfGrid(c[c.length - 1], fwdDir, owner, cols, rows);
      const revDir = dirBetween(c[1], c[0]);
      const revOk = rayClearOfGrid(c[0], revDir, owner, cols, rows);
      if (fwdOk || revOk) clearChoices.push({ p, fwdOk, revOk, fwdDir, revDir });
    }

    if (clearChoices.length > 0) {
      const pick = clearChoices[Math.floor(rng() * clearChoices.length)];
      const { p, fwdOk, revOk, fwdDir, revDir } = pick;
      let orientedCells, dir;
      if (fwdOk && revOk) {
        if (rng() < 0.5) { orientedCells = p.cells; dir = fwdDir; }
        else { orientedCells = [...p.cells].reverse(); dir = revDir; }
      } else if (fwdOk) {
        orientedCells = p.cells; dir = fwdDir;
      } else {
        orientedCells = [...p.cells].reverse(); dir = revDir;
      }
      for (const [x, y] of p.cells) owner[y * cols + x] = -1;
      remaining.delete(p.id);
      finalArrows.push({
        id: finalArrows.length,
        pts: simplifyPts(orientedCells),
        dir,
        removed: false,
        exiting: false,
      });
      continue;
    }

    // Break mutual-blocking deadlock by splitting an outer-clear segment
    let foundSplit = null;
    for (const p of remaining.values()) {
      const c = p.cells;
      if (c.length < 3) continue;
      for (let i = 1; i < c.length - 1; i++) {
        const d1 = dirBetween(c[i - 1], c[i]);
        if (rayClearOfGrid(c[i], d1, owner, cols, rows)) {
          const remnantLen = c.length - (i + 1);
          if (!foundSplit || (remnantLen >= 2 && foundSplit.remnantLen < 2)) {
            foundSplit = { p, idx: i, forward: true, dir: d1, remnantLen };
            if (remnantLen >= 2) break;
          }
        }
        const d2 = dirBetween(c[i + 1], c[i]);
        if (rayClearOfGrid(c[i], d2, owner, cols, rows)) {
          const remnantLen = i;
          if (!foundSplit || (remnantLen >= 2 && foundSplit.remnantLen < 2)) {
            foundSplit = { p, idx: i, forward: false, dir: d2, remnantLen };
            if (remnantLen >= 2) break;
          }
        }
      }
      if (foundSplit && foundSplit.remnantLen >= 2) break;
    }

    if (!foundSplit) return null;

    const { p, idx, forward, dir } = foundSplit;
    const c = p.cells;
    const exitingCells = forward ? c.slice(0, idx + 1) : c.slice(idx).reverse();
    const restCells = forward ? c.slice(idx + 1) : c.slice(0, idx);

    for (const [x, y] of exitingCells) owner[y * cols + x] = -1;
    finalArrows.push({
      id: finalArrows.length,
      pts: simplifyPts(exitingCells),
      dir,
      removed: false,
      exiting: false,
    });

    if (restCells.length >= 2) {
      p.cells = restCells;
    } else {
      const [rx, ry] = restCells[0];
      owner[ry * cols + rx] = -1;
      remaining.delete(p.id);
      for (const d of DIRS) {
        const nx = rx + d.dx, ny = ry + d.dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        if (!inShape(nx, ny)) continue;
        const nid = owner[ny * cols + nx];
        if (nid !== -1 && remaining.has(nid)) {
          const np = remaining.get(nid);
          const f = np.cells[0], l = np.cells[np.cells.length - 1];
          if (f[0] === nx && f[1] === ny) {
            np.cells.unshift([rx, ry]);
            owner[ry * cols + rx] = nid;
            break;
          } else if (l[0] === nx && l[1] === ny) {
            np.cells.push([rx, ry]);
            owner[ry * cols + rx] = nid;
            break;
          }
        }
      }
    }
  }

  return finalArrows;
}

export function makeBoard(mode, level = 1, customSeed) {
  const cfg = MODES[mode];
  const shapeInfo = getBoardShapeInfo(level);
  const randomSalt = customSeed ?? ((Math.random() * 0x7fffffff) | 0);
  const baseSeed = (1337 + level * 977 + mode.length * 131 + randomSalt) >>> 0;

  for (let attempt = 0; attempt < 25; attempt++) {
    const board = generateMaze(cfg.cols, cfg.rows, (baseSeed + attempt * 7919) >>> 0, shapeInfo.id);
    if (board && board.length >= 4 && !hasCrossing(board) && solveCount(board) === board.length) {
      board.shape = shapeInfo.id;
      board.shapeName = shapeInfo.nameId;
      board.level = level;
      return board;
    }
  }

  // Safe fallback to default rectangle
  const fallback = generateMaze(cfg.cols, cfg.rows, baseSeed, 'rectangle');
  if (fallback) {
    fallback.shape = 'rectangle';
    fallback.shapeName = 'Persegi';
    fallback.level = level;
    return fallback;
  }
  return [];
}
