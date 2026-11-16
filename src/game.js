export const MODES = {
  Easy: { cols: 12, rows: 14, arrows: 25, stroke: 0.16, hints: 5, label: 'Easy', color: '#3f9879' },
  Medium: { cols: 19, rows: 23, arrows: 60, stroke: 0.165, hints: 3, label: 'Medium', color: '#d99a32' },
  Hard: { cols: 36, rows: 44, arrows: 200, stroke: 0.13, hints: 1, label: 'Hard', color: '#d05f5f' },
};

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

function generateMaze(cols, rows, seed, level) {
  const rng = mulberry32(seed);
  const total = cols * rows;
  const owner = new Int32Array(total).fill(-1);
  const paths = [];

  function countFreeNeighbors(x, y) {
    let c = 0;
    for (const d of DIRS) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && owner[ny * cols + nx] === -1) c++;
    }
    return c;
  }

  function pickStart() {
    let minDeg = 99;
    let best = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
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
      if (owner[y * cols + x] !== -1) continue;
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
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

export function makeBoard(mode, level, customSeed) {
  const cfg = MODES[mode];
  const randomSalt = customSeed ?? ((Math.random() * 0x7fffffff) | 0);
  const baseSeed = (1337 + level * 977 + mode.length * 131 + randomSalt) >>> 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const board = generateMaze(cfg.cols, cfg.rows, (baseSeed + attempt * 7919) >>> 0, level);
    if (board && board.length >= 6 && !hasCrossing(board) && solveCount(board) === board.length) {
      return board;
    }
  }
  return [];
}
