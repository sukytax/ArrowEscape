import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp } from 'firebase/firestore';
import {
  ArrowLeft, ArrowRight, ChevronLeft, RotateCcw, Trophy, Heart,
  Volume2, VolumeX, X, Check, Sparkles, Play, HelpCircle, Shuffle, Flame,
  ZoomIn, ZoomOut,
} from 'lucide-react';
import { db } from './firebase';
import { MODES, VEC, hitDistance, isClear, makeBoard } from './game';
import logoImg from './assets/logo.png';

// ─── sound ────────────────────────────────────────────────────────────────────
let audioCtx = null;
function playTone(freq, dur, type = 'sine', vol = 0.05) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch { /* ignore */ }
}

// ─── snake path helpers ───────────────────────────────────────────────────────
const VIEW_PAD = 0.72;

function buildTrack(pts, dir, cols, rows) {
  const [dx, dy] = VEC[dir];
  const tip = pts[pts.length - 1];
  const [tx, ty] = tip;

  let distToEdge = 2;
  if (dx > 0) distToEdge = cols - 1 + VIEW_PAD + 1.5 - tx;
  else if (dx < 0) distToEdge = tx - (-VIEW_PAD - 1.5);
  else if (dy > 0) distToEdge = rows - 1 + VIEW_PAD + 1.5 - ty;
  else distToEdge = ty - (-VIEW_PAD - 1.5);
  distToEdge = Math.max(2, distToEdge);

  const cumLens = [0];
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    cumLens.push(cumLens[cumLens.length - 1] + seg);
  }
  const arrowLen = cumLens[cumLens.length - 1];
  const travelDist = arrowLen + distToEdge;
  const extLen = distToEdge + arrowLen + 2;

  const track = [...pts, [tx + dx * extLen, ty + dy * extLen]];
  cumLens.push(arrowLen + extLen);

  return { track, cumLens, arrowLen, travelDist, dx, dy };
}

function pointAtTrack(track, cumLens, dist) {
  if (dist <= 0) return track[0];
  const last = cumLens.length - 1;
  if (dist >= cumLens[last]) return track[last];
  for (let i = 1; i <= last; i++) {
    if (dist <= cumLens[i]) {
      const prev = cumLens[i - 1];
      const seg = cumLens[i] - prev;
      const r = seg > 0 ? (dist - prev) / seg : 0;
      const [ax, ay] = track[i - 1];
      const [bx, by] = track[i];
      return [ax + (bx - ax) * r, ay + (by - ay) * r];
    }
  }
  return track[last];
}

function sliceTrack(track, cumLens, startDist, endDist) {
  const res = [pointAtTrack(track, cumLens, startDist)];
  for (let i = 1; i < track.length - 1; i++) {
    if (cumLens[i] > startDist + 1e-5 && cumLens[i] < endDist - 1e-5) {
      res.push(track[i]);
    }
  }
  res.push(pointAtTrack(track, cumLens, endDist));
  return res;
}

function formatBodyPoints(pts, dx, dy, headBack) {
  const last = pts.length - 1;
  return pts
    .map((p, idx) =>
      idx === last ? `${p[0] - dx * headBack},${p[1] - dy * headBack}` : `${p[0]},${p[1]}`
    )
    .join(' ');
}

function arrowCells(pts) {
  const cells = [];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);
    let x = x1, y = y1;
    while (true) {
      if (i === 1 || x !== x1 || y !== y1) cells.push([x, y]);
      if (x === x2 && y === y2) break;
      x += dx;
      y += dy;
    }
  }
  return cells;
}

const VacatedDots = memo(function VacatedDots({ pts, sw }) {
  const cells = useMemo(() => arrowCells(pts), [pts]);
  const r = Math.max(0.065, sw * 0.44);
  return (
    <g className="vacated-dots" style={{ pointerEvents: 'none' }}>
      {cells.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={r} fill="#8fb0a4" />
      ))}
    </g>
  );
});

// ─── board components ─────────────────────────────────────────────────────────
const StaticArrow = memo(function StaticArrow({ arrow, sw, isHint, interactive, onTap }) {
  const color = isHint ? '#e59a16' : '#2a3d46';
  const strokeW = isHint ? sw * 1.25 : sw;
  const tip = arrow.pts[arrow.pts.length - 1];
  const before = arrow.pts[arrow.pts.length - 2];
  const angle = (Math.atan2(tip[1] - before[1], tip[0] - before[0]) * 180) / Math.PI;
  const [dx, dy] = VEC[arrow.dir];

  const headBack = strokeW * 1.1;
  const bodyPts = formatBodyPoints(arrow.pts, dx, dy, headBack);
  const hitPts = arrow.pts.map(([x, y]) => `${x},${y}`).join(' ');
  const headBase = -strokeW * 1.45;
  const headTip = strokeW * 0.75;
  const headHalfW = strokeW * 1.55;

  return (
    <g
      className={isHint ? 'arrow-hint' : ''}
      onClick={interactive ? () => onTap(arrow) : undefined}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      {interactive && (
        <polyline
          points={hitPts}
          fill="none"
          stroke="transparent"
          strokeWidth={0.85}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <polyline
        points={bodyPts}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <polygon
        points={`${headBase},${-headHalfW} ${headTip},0 ${headBase},${headHalfW}`}
        fill={color}
        transform={`translate(${tip[0]} ${tip[1]}) rotate(${angle})`}
      />
    </g>
  );
});

function BumpingArrow({ arrow, hitDist, seq, sw, onDone }) {
  const polyRef = useRef(null);
  const headRef = useRef(null);
  const sparkRef = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const headBack = sw * 1.1;
  const headBase = -sw * 1.45;
  const headTip = sw * 0.75;
  const headHalfW = sw * 1.55;
  const [initDx, initDy] = VEC[arrow.dir];
  const initTip = arrow.pts[arrow.pts.length - 1];
  const initBefore = arrow.pts[arrow.pts.length - 2];
  const initAngle = (Math.atan2(initTip[1] - initBefore[1], initTip[0] - initBefore[0]) * 180) / Math.PI;
  const initBodyPts = formatBodyPoints(arrow.pts, initDx, initDy, headBack);

  useEffect(() => {
    const [dx, dy] = VEC[arrow.dir];
    const tip0 = arrow.pts[arrow.pts.length - 1];
    // Lunge forward until the arrowhead tip touches the edge of the blocking line ahead
    const bumpDist = Math.max(0.45, hitDist - (headTip + sw * 0.55));
    const cumLens = [0];
    for (let i = 1; i < arrow.pts.length; i++) {
      const seg = Math.hypot(arrow.pts[i][0] - arrow.pts[i - 1][0], arrow.pts[i][1] - arrow.pts[i - 1][1]);
      cumLens.push(cumLens[cumLens.length - 1] + seg);
    }
    const arrowLen = cumLens[cumLens.length - 1];
    const ext = bumpDist + 1;
    const track = [...arrow.pts, [tip0[0] + dx * ext, tip0[1] + dy * ext]];
    cumLens.push(arrowLen + ext);

    const hitX = tip0[0] + dx * (bumpDist + headTip);
    const hitY = tip0[1] + dy * (bumpDist + headTip);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const lungePhase = 0.38;
    const duration = Math.min(520, Math.max(300, 260 + bumpDist * 38));
    let rafId = 0;
    const startTime = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      let s = 0;
      if (t < lungePhase) {
        const p = t / lungePhase;
        s = bumpDist * (p * p);
      } else {
        const p = (t - lungePhase) / (1 - lungePhase);
        // Quick bounce recoil back to original position
        const inv = 1 - p;
        s = bumpDist * (inv * inv);
      }

      const visible = sliceTrack(track, cumLens, s, s + arrowLen);
      const tip = visible[visible.length - 1];

      if (polyRef.current) {
        polyRef.current.setAttribute('points', formatBodyPoints(visible, dx, dy, headBack));
      }
      if (headRef.current) {
        headRef.current.setAttribute('transform', `translate(${tip[0]} ${tip[1]}) rotate(${angle})`);
      }
      if (sparkRef.current) {
        if (t >= lungePhase && t <= lungePhase + 0.38) {
          const sp = (t - lungePhase) / 0.38;
          sparkRef.current.setAttribute('cx', String(hitX));
          sparkRef.current.setAttribute('cy', String(hitY));
          sparkRef.current.setAttribute('r', String(sw * (0.8 + sp * 2.2)));
          sparkRef.current.setAttribute('opacity', String((1 - sp) * 0.85));
        } else {
          sparkRef.current.setAttribute('opacity', '0');
        }
      }

      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        onDoneRef.current(arrow.id, seq);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [arrow.id, arrow.pts, arrow.dir, hitDist, seq, sw, headBack, headTip]);

  return (
    <g style={{ pointerEvents: 'none' }}>
      <polyline
        ref={polyRef}
        points={initBodyPts}
        fill="none"
        stroke="#cf4545"
        strokeWidth={sw}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <polygon
        ref={headRef}
        points={`${headBase},${-headHalfW} ${headTip},0 ${headBase},${headHalfW}`}
        fill="#cf4545"
        transform={`translate(${initTip[0]} ${initTip[1]}) rotate(${initAngle})`}
      />
      <circle
        ref={sparkRef}
        cx={initTip[0]}
        cy={initTip[1]}
        r={sw}
        fill="none"
        stroke="#cf4545"
        strokeWidth={sw * 0.65}
        opacity="0"
      />
    </g>
  );
}

function ExitingArrow({ arrow, cols, rows, sw, onDone }) {
  const glowRef = useRef(null);
  const polyRef = useRef(null);
  const headRef = useRef(null);
  const burstRef = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const headBack = sw * 1.1;
  const headBase = -sw * 1.45;
  const headTip = sw * 0.75;
  const headHalfW = sw * 1.55;
  const [initDx, initDy] = VEC[arrow.dir];
  const initTip = arrow.pts[arrow.pts.length - 1];
  const initBefore = arrow.pts[arrow.pts.length - 2];
  const initAngle = (Math.atan2(initTip[1] - initBefore[1], initTip[0] - initBefore[0]) * 180) / Math.PI;
  const initBodyPts = formatBodyPoints(arrow.pts, initDx, initDy, headBack);

  useEffect(() => {
    const { track, cumLens, arrowLen, travelDist, dx, dy } = buildTrack(arrow.pts, arrow.dir, cols, rows);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const duration = Math.min(700, Math.max(250, 170 + travelDist * 11));
    let rafId = 0;
    const startTime = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      // Responsive ease-in: moves right away and accelerates cleanly off the board
      const eased = 0.35 * t + 0.65 * t * t;
      const s = eased * travelDist;
      const visible = sliceTrack(track, cumLens, s, s + arrowLen);
      const tip = visible[visible.length - 1];
      const bodyStr = formatBodyPoints(visible, dx, dy, headBack);

      if (glowRef.current) {
        glowRef.current.setAttribute('points', bodyStr);
        glowRef.current.setAttribute('opacity', String(Math.max(0, 0.38 * (1 - t * 0.75))));
      }
      if (polyRef.current) {
        polyRef.current.setAttribute('points', bodyStr);
      }
      if (headRef.current) {
        headRef.current.setAttribute('transform', `translate(${tip[0]} ${tip[1]}) rotate(${angle})`);
      }
      if (burstRef.current) {
        const burstP = Math.min(1, t / 0.45);
        if (burstP < 1) {
          burstRef.current.setAttribute('r', String(sw * (0.9 + burstP * 3.1)));
          burstRef.current.setAttribute('opacity', String((1 - burstP) * 0.75));
        } else {
          burstRef.current.setAttribute('opacity', '0');
        }
      }

      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        onDoneRef.current(arrow.id);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [arrow.id, arrow.pts, arrow.dir, cols, rows, sw, headBack]);

  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle
        ref={burstRef}
        cx={initTip[0]}
        cy={initTip[1]}
        r={sw}
        fill="none"
        stroke="#22c58b"
        strokeWidth={sw * 0.7}
        opacity="0.75"
      />
      <polyline
        ref={glowRef}
        points={initBodyPts}
        fill="none"
        stroke="#2dd49d"
        strokeWidth={sw * 2.35}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.38"
      />
      <polyline
        ref={polyRef}
        points={initBodyPts}
        fill="none"
        stroke="#159e70"
        strokeWidth={sw * 1.08}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      <polygon
        ref={headRef}
        points={`${headBase},${-headHalfW} ${headTip},0 ${headBase},${headHalfW}`}
        fill="#159e70"
        transform={`translate(${initTip[0]} ${initTip[1]}) rotate(${initAngle})`}
      />
    </g>
  );
}

function BoardSVG({ arrows, mode, onTap, onExitDone, onBumpDone, hintId, bumping, interactive = false }) {
  const cfg = MODES[mode];
  const cols = cfg.cols;
  const rows = cfg.rows;
  const sw = cfg.stroke;

  return (
    <svg
      viewBox={`${-VIEW_PAD} ${-VIEW_PAD} ${cols - 1 + VIEW_PAD * 2} ${rows - 1 + VIEW_PAD * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className="board-svg"
    >
      {/* Static grid dots appear only at coordinates of arrows that have been cleared */}
      {arrows.map(a => (a.removed ? <VacatedDots key={`dots-${a.id}`} pts={a.pts} sw={sw} /> : null))}

      {arrows.map(a => {
        if (a.removed) return null;
        if (a.exiting) {
          return (
            <ExitingArrow
              key={a.id}
              arrow={a}
              cols={cols}
              rows={rows}
              sw={sw}
              onDone={onExitDone}
            />
          );
        }
        const bump = bumping?.[a.id];
        if (bump) {
          return (
            <BumpingArrow
              key={a.id}
              arrow={a}
              hitDist={bump.hitDist}
              seq={bump.seq}
              sw={sw}
              onDone={onBumpDone}
            />
          );
        }
        return (
          <StaticArrow
            key={a.id}
            arrow={a}
            sw={sw}
            isHint={hintId === a.id}
            interactive={interactive}
            onTap={onTap}
          />
        );
      })}
    </svg>
  );
}

function HintBulbIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <line x1="12" y1="1.8" x2="12" y2="3.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <line x1="4.8" y1="4.8" x2="6.1" y2="6.1" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <line x1="19.2" y1="4.8" x2="17.9" y2="6.1" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <line x1="2.2" y1="11.2" x2="4" y2="11.2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="11.2" x2="21.8" y2="11.2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M9.2 17.2h5.6M9.8 19.8h4.4M12 5.6a5.4 5.4 0 0 0-3.4 9.6c.6.5 1 1.2 1.1 2h4.6c.1-.8.5-1.5 1.1-2A5.4 5.4 0 0 0 12 5.6Z"
        stroke="#fff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── score storage & validation ──────────────────────────────────────────────
const DUMMY_NAMES = new Set([
  'nadia s.', 'raka pratama', 'alya m.', 'fajar k.', 'siti rahma',
  'aris setiawan', 'maya putri', 'gilang ramadhan', 'dodi nugraha', 'eka lestari',
  'gilang r.', 'vina pandu', 'taufik h.', 'dewi anggraini', 'reza fauzi',
  'hendra w.', 'chandra k.', 'salsa b.', 'indra jaya', 'rina yuliana',
  'aldo wijaya', 'kirana putri', 'bayu saputra', 'tari anindya', 'rian kurniawan',
  'farhan d.', 'anisa zahra', 'kevin sanjaya', 'citra kirana', 'dimas anggara',
  'zahra amelia', 'rizky fadillah',
]);

function isSamePlayer(nameA, nameB) {
  if (!nameA || !nameB) return false;
  return nameA.trim().toLowerCase() === nameB.trim().toLowerCase();
}

function getSavedScores() {
  try {
    const raw = localStorage.getItem('arrow-scores');
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    // Purge any previously stored mock names so only actual gameplay scores remain
    const cleaned = list.filter(item => {
      const n = (item.name || '').trim().toLowerCase();
      return !DUMMY_NAMES.has(n);
    });
    if (cleaned.length !== list.length) {
      try {
        localStorage.setItem('arrow-scores', JSON.stringify(cleaned));
      } catch { /* ignore */ }
    }
    return cleaned.sort((a, b) => (b.score || 0) - (a.score || 0));
  } catch {
    return [];
  }
}

// ─── app ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState('Easy');
  const [level, setLevel] = useState(1);
  const [arrows, setArrows] = useState(() => makeBoard('Easy', 1));
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(0);
  const [lives, setLives] = useState(3);
  const [screen, setScreen] = useState('home');
  const [hintId, setHintId] = useState(null);
  const [hintsLeft, setHintsLeft] = useState(() => MODES.Easy.hints);
  const [bumping, setBumping] = useState({});
  const [sound, setSound] = useState(true);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [player, setPlayer] = useState(() => {
    try {
      return localStorage.getItem('arrow-player-name') || '';
    } catch {
      return '';
    }
  });
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [gameOverReason, setGameOverReason] = useState('lives'); // 'lives' | 'quit'
  const [leaderboard, setLeaderboard] = useState(() => getSavedScores());
  const [leaderboardTab, setLeaderboardTab] = useState('Easy');
  const [levelBonus, setLevelBonus] = useState(0);
  const completedRef = useRef(false);
  const persistedRef = useRef(false);
  const bumpSeqRef = useRef(0);
  const levelBaseScoreRef = useRef(0);
  const gameOverTimerRef = useRef(null);

  // ─── zoom & pan ────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const didPanRef = useRef(false);
  const pinchStartDistRef = useRef(null);
  const pinchStartZoomRef = useRef(1);
  const stageRef = useRef(null);

  const clampPan = useCallback((x, y, currentZoom) => {
    if (currentZoom <= 1.01) return { x: 0, y: 0 };
    const stage = stageRef.current;
    const w = stage ? stage.clientWidth : 400;
    const h = stage ? stage.clientHeight : 500;
    const maxPanX = (w * (currentZoom - 1)) / 2 + 50;
    const maxPanY = (h * (currentZoom - 1)) / 2 + 50;
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, y)),
    };
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom(z => {
      const next = Math.min(3.0, Math.round((z + 0.35) * 100) / 100);
      setPan(p => clampPan(p.x, p.y, next));
      return next;
    });
  }, [clampPan]);

  const handleZoomOut = useCallback(() => {
    setZoom(z => {
      const next = Math.max(1.0, Math.round((z - 0.35) * 100) / 100);
      if (next <= 1.01) {
        setPan({ x: 0, y: 0 });
        return 1.0;
      }
      setPan(p => clampPan(p.x, p.y, next));
      return next;
    });
  }, [clampPan]);

  const handleZoomReset = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  const onMouseDownStage = useCallback((e) => {
    if (zoom <= 1.01) return;
    if (e.button !== 0) return;
    setIsDragging(true);
    didPanRef.current = false;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }, [zoom, pan]);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.hypot(dx, dy) > 5) {
        didPanRef.current = true;
      }
      setPan(clampPan(dragStartRef.current.panX + dx, dragStartRef.current.panY + dy, zoom));
    };

    const onMouseUp = () => {
      setIsDragging(false);
      setTimeout(() => {
        didPanRef.current = false;
      }, 50);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, zoom, clampPan]);

  const onTouchStartStage = useCallback((e) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDistRef.current = d;
      pinchStartZoomRef.current = zoom;
      didPanRef.current = true;
      setIsDragging(false);
    } else if (e.touches.length === 1 && zoom > 1.01) {
      const t = e.touches[0];
      didPanRef.current = false;
      setIsDragging(true);
      dragStartRef.current = {
        x: t.clientX,
        y: t.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    }
  }, [zoom, pan]);

  const onTouchMoveStage = useCallback((e) => {
    if (e.touches.length === 2 && pinchStartDistRef.current) {
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = d / pinchStartDistRef.current;
      const next = Math.min(3.0, Math.max(1.0, pinchStartZoomRef.current * ratio));
      setZoom(next);
      setPan(p => clampPan(p.x, p.y, next));
      didPanRef.current = true;
    } else if (e.touches.length === 1 && isDragging && zoom > 1.01) {
      const t = e.touches[0];
      const dx = t.clientX - dragStartRef.current.x;
      const dy = t.clientY - dragStartRef.current.y;
      if (Math.hypot(dx, dy) > 6) {
        didPanRef.current = true;
      }
      setPan(clampPan(dragStartRef.current.panX + dx, dragStartRef.current.panY + dy, zoom));
    }
  }, [isDragging, zoom, clampPan]);

  const onTouchEndStage = useCallback(() => {
    pinchStartDistRef.current = null;
    setIsDragging(false);
    setTimeout(() => {
      didPanRef.current = false;
    }, 60);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      setZoom(z => {
        const next = Math.min(3.0, Math.max(1.0, Math.round((z + delta) * 100) / 100));
        if (next <= 1.01) {
          setPan({ x: 0, y: 0 });
          return 1.0;
        }
        setPan(p => clampPan(p.x, p.y, next));
        return next;
      });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [clampPan, screen]);

  const allRemoved = useMemo(
    () => arrows.length > 0 && arrows.every(a => a.removed),
    [arrows]
  );
  const clearList = useMemo(
    () => arrows.filter(a => !a.removed && !a.exiting && isClear(a, arrows)),
    [arrows]
  );

  // ─── leaderboard filtering & rank computation ─────────────────────────────
  const tabScores = useMemo(() => {
    const targetMode = (leaderboardTab || 'Easy').toLowerCase();
    const filtered = (leaderboard || [])
      .filter(e => (e.mode || 'Easy').toLowerCase() === targetMode)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    // Deduplicate named players so each displays their personal best
    const seen = new Set();
    const unique = [];
    for (const entry of filtered) {
      const rawName = (entry.name || 'Pemain').trim();
      const isAnonymous = rawName.toLowerCase() === 'pemain';
      const key = rawName.toLowerCase();
      if (isAnonymous) {
        unique.push(entry);
      } else if (!seen.has(key)) {
        seen.add(key);
        unique.push(entry);
      }
    }
    return unique;
  }, [leaderboard, leaderboardTab]);

  const playerRankIndex = useMemo(() => {
    if (!player || !player.trim()) return -1;
    return tabScores.findIndex(e => isSamePlayer(e.name, player));
  }, [tabScores, player]);

  const top8Scores = useMemo(() => {
    return tabScores.slice(0, 8);
  }, [tabScores]);

  const playerBelowTop8 = useMemo(() => {
    if (playerRankIndex >= 8) {
      return {
        rank: playerRankIndex + 1,
        entry: tabScores[playerRankIndex],
      };
    }
    return null;
  }, [tabScores, playerRankIndex]);

  useEffect(() => {
    if (screen !== 'leaderboard') return;
    (async () => {
      if (db) {
        try {
          const snap = await getDocs(query(collection(db, 'scores'), orderBy('score', 'desc'), limit(150)));
          if (!snap.empty) {
            const firestoreScores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const cleaned = firestoreScores.filter(item => {
              const n = (item.name || '').trim().toLowerCase();
              return !DUMMY_NAMES.has(n);
            });
            setLeaderboard(cleaned.sort((a, b) => (b.score || 0) - (a.score || 0)));
            return;
          }
        } catch { /* fall through */ }
      }
      setLeaderboard(getSavedScores());
    })();
  }, [screen]);

  const startGame = useCallback((m = mode, lv = 1, carryScore = 0) => {
    if (gameOverTimerRef.current) {
      clearTimeout(gameOverTimerRef.current);
      gameOverTimerRef.current = null;
    }
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    completedRef.current = false;
    persistedRef.current = false;
    setShowQuitConfirm(false);
    setGameOverReason('lives');
    levelBaseScoreRef.current = carryScore;
    setMode(m);
    setLevel(lv);
    setArrows(makeBoard(m, lv));
    setScore(carryScore);
    setMoves(0);
    setLives(3);
    setHintId(null);
    setHintsLeft(MODES[m]?.hints ?? 3);
    setBumping({});
    setScreen('game');
  }, [mode]);

  const saveScore = useCallback(async (finalScore, name) => {
    const trimmed = (name || player || '').trim() || 'Pemain';
    try {
      localStorage.setItem('arrow-player-name', trimmed);
    } catch { /* ignore */ }
    setPlayer(trimmed);
    const record = {
      name: trimmed,
      score: finalScore,
      mode: mode || 'Easy',
      level: level || 1,
      date: new Date().toISOString(),
    };
    const currentScores = getSavedScores();
    const updated = [record, ...currentScores]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 150);
    try {
      localStorage.setItem('arrow-scores', JSON.stringify(updated));
    } catch { /* ignore */ }
    setLeaderboard(updated);
    if (db) {
      try {
        await addDoc(collection(db, 'scores'), { ...record, createdAt: serverTimestamp() });
      } catch (e) {
        console.warn('Firebase save failed:', e);
      }
    }
  }, [mode, level, player]);

  useEffect(() => {
    if (screen !== 'game' || !allRemoved || completedRef.current) return;
    completedRef.current = true;
    const bonus = lives * 50 + 200;
    const finalScore = score + bonus;
    const t = setTimeout(() => {
      setLevelBonus(bonus);
      setScore(finalScore);
      // Auto-save progress so finishing the level is immediately preserved in leaderboard
      saveScore(finalScore, player.trim() || 'Pemain');
      setScreen('complete');
    }, 200);
    return () => clearTimeout(t);
  }, [allRemoved, screen, lives, score, player, saveScore]);

  const finishAnd = async (next) => {
    persistedRef.current = true;
    await saveScore(score, player.trim() || 'Pemain');
    next();
  };

  const handleExitDone = useCallback((id) => {
    setArrows(cur => cur.map(a => (a.id === id ? { ...a, removed: true, exiting: false } : a)));
  }, []);

  const handleBumpDone = useCallback((id, seq) => {
    setBumping(cur => {
      if (!cur[id] || cur[id].seq !== seq) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);

  const tapArrow = useCallback((arrow) => {
    if (didPanRef.current) return;
    if (arrow.removed || arrow.exiting || bumping[arrow.id]) return;

    const hitDist = hitDistance(arrow, arrows);
    if (hitDist !== Infinity) {
      if (sound) playTone(150, 0.16, 'sawtooth', 0.035);
      const seq = ++bumpSeqRef.current;
      setBumping(cur => ({ ...cur, [arrow.id]: { hitDist, seq } }));
      setLives(prev => {
        const next = prev - 1;
        if (next <= 0) {
          setGameOverReason('lives');
          gameOverTimerRef.current = setTimeout(() => setScreen('gameover'), 500);
        }
        return next;
      });
      return;
    }

    if (sound) playTone(620, 0.11, 'triangle', 0.045);
    if (hintId === arrow.id) setHintId(null);
    setMoves(v => v + 1);
    setScore(v => v + 100);
    setArrows(cur => cur.map(a => (a.id === arrow.id ? { ...a, exiting: true } : a)));
  }, [arrows, sound, hintId, bumping]);

  const showHint = () => {
    if (hintsLeft <= 0) return;
    if (!clearList.length) return;
    const pick = clearList[Math.floor(Math.random() * clearList.length)];
    setHintId(pick.id);
    setHintsLeft(h => Math.max(0, h - 1));
    setTimeout(() => setHintId(cur => (cur === pick.id ? null : cur)), 2500);
  };

  // ─── interactive home demo ─────────────────────────────────────────────────
  const [demoArrows, setDemoArrows] = useState(() => makeBoard('Easy', 2));
  const [demoBumping, setDemoBumping] = useState({});
  const demoBumpSeqRef = useRef(0);

  const resetDemo = useCallback(() => {
    setDemoArrows(makeBoard('Easy', Math.floor(Math.random() * 20) + 1));
    setDemoBumping({});
  }, []);

  const handleDemoExitDone = useCallback((id) => {
    setDemoArrows(cur => cur.map(a => (a.id === id ? { ...a, removed: true, exiting: false } : a)));
  }, []);

  const handleDemoBumpDone = useCallback((id, seq) => {
    setDemoBumping(cur => {
      if (!cur[id] || cur[id].seq !== seq) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);

  const tapDemoArrow = useCallback((arrow) => {
    if (arrow.removed || arrow.exiting || demoBumping[arrow.id]) return;
    const hitDist = hitDistance(arrow, demoArrows);
    if (hitDist !== Infinity) {
      if (sound) playTone(150, 0.16, 'sawtooth', 0.035);
      const seq = ++demoBumpSeqRef.current;
      setDemoBumping(cur => ({ ...cur, [arrow.id]: { hitDist, seq } }));
      return;
    }
    if (sound) playTone(620, 0.11, 'triangle', 0.045);
    setDemoArrows(cur => cur.map(a => (a.id === arrow.id ? { ...a, exiting: true } : a)));
  }, [demoArrows, sound, demoBumping]);

  const demoRemaining = useMemo(
    () => demoArrows.filter(a => !a.removed && !a.exiting).length,
    [demoArrows]
  );

  const cfg = MODES[mode];
  const isPlaying = screen === 'game' || screen === 'complete' || screen === 'gameover';

  useEffect(() => {
    const theme = isPlaying ? 'game' : mode.toLowerCase();
    document.body.dataset.lobbyTheme = theme;
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      if (isPlaying) metaThemeColor.setAttribute('content', '#d6eae3');
      else if (mode === 'Hard') metaThemeColor.setAttribute('content', '#fae0e3');
      else if (mode === 'Medium') metaThemeColor.setAttribute('content', '#faedd3');
      else metaThemeColor.setAttribute('content', '#d8ebe3');
    }
    return () => {
      document.body.removeAttribute('data-lobby-theme');
    };
  }, [isPlaying, mode]);

  return (
    <main className={`app-shell ${isPlaying ? 'playing' : ''}`}>
      {!isPlaying && (
        <header className="topbar">
          <button className="brand" onClick={() => setScreen('home')}>
            <img src={logoImg} alt="Arrow Escape Logo" className="brand-logo" />
            <span className="brand-text">arrow<span className="brand-light">escape</span></span>
          </button>
          <div className="topbar-actions">
            <button className="topbar-nav-btn" onClick={() => setShowHowToPlay(true)}>
              <HelpCircle size={15} /> <span>Cara Main</span>
            </button>
            <button
              className={`topbar-nav-btn ${screen === 'leaderboard' ? 'active' : ''}`}
              onClick={() => {
                setLeaderboardTab(mode || 'Easy');
                setScreen('leaderboard');
              }}
            >
              <Trophy size={15} /> <span>Peringkat</span>
            </button>
            <button
              className="sound-btn"
              onClick={() => setSound(s => !s)}
              aria-label="Suara"
              title={sound ? 'Matikan Suara' : 'Nyalakan Suara'}
            >
              {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
        </header>
      )}

      {screen === 'home' && (
        <section className="home-page">
          <div className="hero-content">
            <div className="hero-badge">
              <Sparkles size={12} className="badge-sparkle" />
              <span>PUZZLE ARROW LABIRIN</span>
            </div>

            <h1 className="hero-title">
              Bebaskan panah,<br />
              <em>buka jalan</em> keluar.
            </h1>

            <p className="hero-desc">
              Tiap panah meluncur seperti ular menyusuri lekukan jalurnya. Temukan panah yang bebas hambatan dan bersihkan papan sampai tuntas!
            </p>

            <div className="hero-actions">
              <div className="difficulty-picker">
                <span className="diff-picker-label">Pilih Tingkat Kesulitan:</span>
                <div className="diff-pill-group">
                  <button
                    type="button"
                    className={`diff-pill-btn easy ${mode === 'Easy' ? 'active' : ''}`}
                    onClick={() => setMode('Easy')}
                  >
                    Easy
                  </button>
                  <button
                    type="button"
                    className={`diff-pill-btn medium ${mode === 'Medium' ? 'active' : ''}`}
                    onClick={() => setMode('Medium')}
                  >
                    Medium
                  </button>
                  <button
                    type="button"
                    className={`diff-pill-btn hard ${mode === 'Hard' ? 'active' : ''}`}
                    onClick={() => setMode('Hard')}
                  >
                    <Flame size={12} /> Hard
                  </button>
                </div>
                <div className="diff-picker-info">
                  {mode === 'Easy' && 'Grid 12×14 · 25+ panah · Papan santai & cepat'}
                  {mode === 'Medium' && 'Grid 19×23 · 60+ panah · Uji fokus & logika labirin'}
                  {mode === 'Hard' && 'Grid 36×44 · 200+ panah · Labirin super padat & seru'}
                </div>
              </div>

              <button className="cta-play-btn" onClick={() => startGame(mode, 1)}>
                <Play size={18} fill="currentColor" />
                <span>Mulai Bermain ({cfg.label})</span>
              </button>
            </div>
          </div>

          <div className="hero-preview-area">
            <div className="preview-card">
              <div className="preview-header">
                <div className="preview-status">
                  <span className="live-pulse"></span>
                  <span className="preview-tag">Demo Interaktif</span>
                </div>
                <button className="preview-refresh-btn" onClick={resetDemo} title="Ganti papan contoh">
                  <Shuffle size={13} /> <span>Acak</span>
                </button>
              </div>

              <div className="preview-board-box">
                <BoardSVG
                  arrows={demoArrows}
                  mode="Easy"
                  interactive={true}
                  onTap={tapDemoArrow}
                  onExitDone={handleDemoExitDone}
                  onBumpDone={handleDemoBumpDone}
                  bumping={demoBumping}
                />
              </div>

              <div className="preview-footer">
                {demoRemaining > 0 ? (
                  <p className="preview-tip">
                    <span className="hand-icon">👉</span> Ketuk panah bebas di atas untuk mencobanya langsung!
                  </p>
                ) : (
                  <div className="preview-cleared">
                    <span>🎉 Papan bersih! Keren banget.</span>
                    <button className="preview-start-btn" onClick={() => startGame(mode, 1)}>
                      Mulai Main Asli <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {screen === 'select' && (
        <section className="select-page">
          <button className="back-link" onClick={() => setScreen('home')}>
            <ArrowLeft size={15} /> Kembali ke Home
          </button>
          <div className="section-heading">
            <div className="eyebrow">PILIH TANTANGAN</div>
            <h2>Pilih Tingkat Kesulitan</h2>
            <p>Pilih tingkat kesulitan yang kamu inginkan, lalu tekan Mulai Bermain.</p>
          </div>
          <div className="mode-grid">
            {Object.entries(MODES).map(([name, info], i) => {
              const isSelected = mode === name;
              return (
                <div
                  className={`mode-card mc-${name.toLowerCase()} ${isSelected ? 'selected' : ''}`}
                  key={name}
                  onClick={() => setMode(name)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="mode-card-top">
                    <span className="mode-number">0{i + 1}</span>
                    {isSelected && <span className="mode-selected-badge"><Check size={12} /> Terpilih</span>}
                  </div>
                  <div className="mode-card-icon" style={{ color: info.color }}>{['↗', '⌁', '✳'][i]}</div>
                  <h3>{name}</h3>
                  <p>{name === 'Easy' ? 'Papan santai & cepat' : name === 'Medium' ? 'Uji fokus & logika' : 'Labirin padat & menantang'}</p>
                  <div className="mode-meta">
                    <span>{info.cols}×{info.rows} grid</span>
                    <span>{info.arrows}+ panah</span>
                  </div>
                  <div className="mode-select-status">
                    {isSelected ? '✓ Mode Terpilih' : 'Pilih Mode Ini'}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="select-cta-box">
            <button className="cta-play-btn" onClick={() => startGame(mode, 1)}>
              <Play size={18} fill="currentColor" />
              <span>Mulai Bermain ({cfg.label})</span>
            </button>
          </div>
        </section>
      )}

      {isPlaying && (
        <section className="game-screen">
          <div className="game-header-area">
            <div className="game-header-inner">
              <div className="game-top">
                <button className="circle-btn light" onClick={() => setShowQuitConfirm(true)} aria-label="Kembali">
                  <ChevronLeft size={24} strokeWidth={3} />
                </button>
                <div className="game-title">
                  <span className="pill">{cfg.label}</span>
                  <h1>Level {level}</h1>
                </div>
                <button className="circle-btn dark" onClick={() => startGame(mode, level, levelBaseScoreRef.current)} aria-label="Ulangi">
                  <RotateCcw size={21} strokeWidth={2.5} />
                </button>
              </div>

              <div className="hearts-row">
                {[0, 1, 2].map(i => (
                  <Heart
                    key={i}
                    size={28}
                    fill={i < lives ? '#bd2c2c' : 'transparent'}
                    color={i < lives ? '#bd2c2c' : '#b79e9e'}
                    strokeWidth={i < lives ? 0 : 2}
                  />
                ))}
              </div>
            </div>
          </div>

          <div
            className="board-stage"
            ref={stageRef}
            onMouseDown={onMouseDownStage}
            onTouchStart={onTouchStartStage}
            onTouchMove={onTouchMoveStage}
            onTouchEnd={onTouchEndStage}
          >
            <div
              className="board-shell"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
                cursor: zoom > 1.01 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              }}
            >
              <BoardSVG
                arrows={arrows}
                mode={mode}
                onTap={tapArrow}
                onExitDone={handleExitDone}
                onBumpDone={handleBumpDone}
                hintId={hintId}
                bumping={bumping}
                interactive={screen === 'game'}
              />
            </div>
          </div>

          <footer className="game-bottom-bar">
            <div className="zoom-controls" aria-label="Kontrol Zoom">
              <button
                type="button"
                className="zoom-btn"
                onClick={handleZoomOut}
                disabled={zoom <= 1.01}
                title="Perkecil (Zoom Out)"
                aria-label="Zoom Out"
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                className={`zoom-indicator ${zoom > 1.05 ? 'active' : ''}`}
                onClick={handleZoomReset}
                title={zoom > 1.05 ? 'Reset ke 100%' : 'Ukuran Pas'}
                aria-label="Reset Zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="zoom-btn"
                onClick={handleZoomIn}
                disabled={zoom >= 3.0}
                title="Perbesar (Zoom In)"
                aria-label="Zoom In"
              >
                <ZoomIn size={16} />
              </button>
            </div>

            <span className="game-footer-text">made by Bimo Bagas</span>

            <button
              type="button"
              className={`hint-fab-bar ${hintsLeft <= 0 ? 'depleted' : ''}`}
              onClick={showHint}
              disabled={hintsLeft <= 0}
              aria-label="Petunjuk"
              title={hintsLeft > 0 ? `Gunakan Petunjuk (${hintsLeft} tersisa)` : 'Petunjuk habis'}
            >
              <HintBulbIcon />
              <span className="hint-count-badge">{hintsLeft}</span>
            </button>
          </footer>
        </section>
      )}

      {showQuitConfirm && (
        <div className="modal-backdrop">
          <section className="result-modal confirm-modal">
            <button className="close-modal" onClick={() => setShowQuitConfirm(false)}><X size={16} /></button>
            <div className="result-icon alert">!</div>
            <div className="eyebrow centered">KONFIRMASI KELUAR</div>
            <h2>Keluar dari game?</h2>
            <p>Permainan saat ini akan berakhir (Game Over) dan kamu dapat menyimpan skor akhir ke papan peringkat.</p>
            <div className="confirm-buttons">
              <button
                className="danger-button full"
                onClick={() => {
                  setShowQuitConfirm(false);
                  setGameOverReason('quit');
                  setScreen('gameover');
                }}
              >
                Ya, Akhiri Permainan
              </button>
              <button
                className="secondary-button full"
                onClick={() => setShowQuitConfirm(false)}
              >
                Lanjut Bermain
              </button>
            </div>
          </section>
        </div>
      )}

      {screen === 'complete' && (
        <div className="modal-backdrop">
          <section className="result-modal">
            <button className="close-modal" onClick={() => finishAnd(() => setScreen('home'))}>
              <X size={16} />
            </button>
            <div className="result-icon"><Check size={26} /></div>
            <div className="eyebrow centered">LEVEL {level} SELESAI</div>
            <h2>Hebat sekali!</h2>
            <p>Semua panah berhasil kamu keluarkan.</p>
            <div className="result-score">
              <span>Total skor</span>
              <strong>{score}</strong>
              <small>{mode} · {moves} langkah · +{levelBonus} bonus</small>
            </div>
            <label className="name-input">
              Nama untuk papan peringkat
              <input
                value={player}
                onChange={e => {
                  const val = e.target.value;
                  setPlayer(val);
                  try {
                    localStorage.setItem('arrow-player-name', val);
                  } catch { /* ignore */ }
                }}
                placeholder="Pemain"
                maxLength={18}
              />
            </label>
            <div className="modal-actions">
              <button
                className="primary-button full"
                onClick={() => finishAnd(() => startGame(mode, level + 1, score))}
              >
                Lanjut Level {level + 1} <ArrowRight size={15} />
              </button>
              <button
                className="secondary-button full"
                onClick={() => {
                  setLeaderboardTab(mode || 'Easy');
                  finishAnd(() => setScreen('leaderboard'));
                }}
              >
                <Trophy size={15} /> Simpan ke Papan Peringkat
              </button>
            </div>
          </section>
        </div>
      )}

      {screen === 'gameover' && (
        <div className="modal-backdrop">
          <section className="result-modal">
            <button className="close-modal" onClick={() => finishAnd(() => setScreen('home'))}><X size={16} /></button>
            <div className={`result-icon ${gameOverReason === 'quit' ? 'alert' : 'sad'}`}>
              {gameOverReason === 'quit' ? '!' : '♡'}
            </div>
            <div className="eyebrow centered">
              {gameOverReason === 'quit' ? 'PERMAINAN DIAKHIRI' : 'PERMAINAN BERAKHIR'}
            </div>
            <h2>{gameOverReason === 'quit' ? 'Kamu Keluar!' : 'Nyawa habis!'}</h2>
            <p>
              {gameOverReason === 'quit'
                ? `Permainan di Level ${level} telah berakhir. Masukkan namamu untuk disimpan ke dashboard papan peringkat!`
                : `Kamu bertahan sampai Level ${level}. Simpan skormu ke papan peringkat!`}
            </p>
            <div className="result-score">
              <span>Skor akhir</span>
              <strong>{score}</strong>
              <small>{mode} · Level {level}</small>
            </div>
            <label className="name-input">
              Nama untuk papan peringkat
              <input
                value={player}
                onChange={e => {
                  const val = e.target.value;
                  setPlayer(val);
                  try {
                    localStorage.setItem('arrow-player-name', val);
                  } catch { /* ignore */ }
                }}
                placeholder="Pemain"
                maxLength={18}
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <button
                className="primary-button full"
                onClick={() => {
                  setLeaderboardTab(mode || 'Easy');
                  finishAnd(() => setScreen('leaderboard'));
                }}
              >
                <Trophy size={15} /> Simpan ke Papan Peringkat
              </button>
              <button className="secondary-button full" onClick={() => finishAnd(() => startGame(mode, 1, 0))}>
                <RotateCcw size={15} /> Simpan & Main Lagi
              </button>
            </div>
          </section>
        </div>
      )}

      {screen === 'leaderboard' && (
        <section className="leader-page">
          <button className="back-link" onClick={() => setScreen('home')}>
            <ArrowLeft size={15} /> Kembali
          </button>
          <div className="section-heading">
            <div className="eyebrow">YANG TERHEBAT</div>
            <h2>Papan Peringkat</h2>
            <p>Skor terbaik pemain Arrow Escape berdasarkan tingkat kesulitan.</p>

            <div className="leader-tabs" role="tablist" aria-label="Tingkat Kesulitan Papan Peringkat">
              <button
                type="button"
                role="tab"
                aria-selected={leaderboardTab === 'Easy'}
                className={`leader-tab-btn tab-easy ${leaderboardTab === 'Easy' ? 'active' : ''}`}
                onClick={() => setLeaderboardTab('Easy')}
              >
                Easy
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={leaderboardTab === 'Medium'}
                className={`leader-tab-btn tab-medium ${leaderboardTab === 'Medium' ? 'active' : ''}`}
                onClick={() => setLeaderboardTab('Medium')}
              >
                Medium
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={leaderboardTab === 'Hard'}
                className={`leader-tab-btn tab-hard ${leaderboardTab === 'Hard' ? 'active' : ''}`}
                onClick={() => setLeaderboardTab('Hard')}
              >
                <Flame size={13} style={{ marginRight: 2 }} /> Hard
              </button>
            </div>
          </div>

          <div className="leader-list">
            {top8Scores.length > 0 ? (
              <>
                {top8Scores.map((e, i) => {
                  const isPlayerRow = isSamePlayer(e.name, player);
                  return (
                    <div
                      className={`leader-row ${isPlayerRow ? 'is-player' : ''}`}
                      key={e.id || `${e.name}-${i}`}
                    >
                      <span className={`rank rank-${i + 1}`}>{String(i + 1).padStart(2, '0')}</span>
                      <div className="leader-name">
                        <div className="leader-name-wrap">
                          <b>{e.name || 'Pemain'}</b>
                          {isPlayerRow && <span className="player-tag">Kamu</span>}
                        </div>
                        <small>Level {e.level || 1}</small>
                      </div>
                      <strong>{e.score}</strong>
                    </div>
                  );
                })}

                {playerBelowTop8 && (
                  <>
                    <div className="leader-dots-row" aria-hidden="true">
                      <span className="leader-dots-text">....</span>
                    </div>
                    <div className="leader-row is-player player-pin-row">
                      <span className="rank rank-pinned">{String(playerBelowTop8.rank).padStart(2, '0')}</span>
                      <div className="leader-name">
                        <div className="leader-name-wrap">
                          <b>{playerBelowTop8.entry.name}</b>
                          <span className="player-tag">Kamu</span>
                        </div>
                        <small>Level {playerBelowTop8.entry.level || 1}</small>
                      </div>
                      <strong>{playerBelowTop8.entry.score}</strong>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="empty-leader">
                <Trophy size={24} />
                <b>Belum ada skor ({leaderboardTab})</b>
                <span>Selesaikan level pertama di tingkat ini untuk masuk ke sini!</span>
              </div>
            )}
          </div>
        </section>
      )}

      {showHowToPlay && (
        <div className="modal-backdrop" onClick={() => setShowHowToPlay(false)}>
          <section className="result-modal guide-modal" onClick={e => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setShowHowToPlay(false)}><X size={16} /></button>
            <div className="result-icon guide">?</div>
            <div className="eyebrow centered">PANDUAN SINGKAT</div>
            <h2>Cara Bermain</h2>
            <p>Aturan sederhana, tantangan yang memikat.</p>

            <div className="guide-steps">
              <div className="guide-step">
                <span className="step-num">1</span>
                <div className="step-content">
                  <b>Cari Jalur Bebas</b>
                  <small>Perhatikan arah mata panah. Pastikan garis lurus di depannya bersih dari panah lain.</small>
                </div>
              </div>

              <div className="guide-step">
                <span className="step-num">2</span>
                <div className="step-content">
                  <b>Ketuk Untuk Melepas</b>
                  <small>Panah akan meluncur berliku seperti ular menyusuri tubuhnya sendiri keluar papan.</small>
                </div>
              </div>

              <div className="guide-step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <b>Jaga Nyawamu</b>
                  <small>Mengetuk panah yang terhalang akan memicu tabrakan dan menghabiskan 1 dari 3 nyawa.</small>
                </div>
              </div>

              <div className="guide-step">
                <span className="step-num">4</span>
                <div className="step-content">
                  <b>Manfaatkan Petunjuk</b>
                  <small>Tekan tombol lampu kuning di pojok kanan bawah jika terjebak.</small>
                </div>
              </div>
            </div>

            <button className="primary-button full" onClick={() => setShowHowToPlay(false)}>
              Siap, Saya Paham!
            </button>
          </section>
        </div>
      )}

      {!isPlaying && (
        <footer className="site-footer">
          <span>made by Bimo Bagas</span>
          <span>Lihat jalurnya. Lepaskan.</span>
        </footer>
      )}
    </main>
  );
}
