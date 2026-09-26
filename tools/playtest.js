/* Headless playtest for games/unnamed.html.
 *
 * Loads the real game script with a stubbed DOM, then drives the real
 * frame loop with scripted key input and asserts what actually happens.
 * Run:  cscript //Nologo //E:JScript tools\playtest.js [game.html]
 */

/* ---- JScript is ES3-ish; the game assumes ES5 ---- */
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function (o) {
    for (var i = 0; i < this.length; i++) if (this[i] === o) return i;
    return -1;
  };
}
if (!String.prototype.trim) {
  String.prototype.trim = function () { return this.replace(/^\s+|\s+$/g, ''); };
}

/* WSH's JScript predates JSON; every real browser has it. Implicit global
   assignment (no var) so there's no hoisting shadow. */
if (typeof JSON === 'undefined') {
  JSON = {
    stringify: function (o) {
      if (o === null || o === undefined) return 'null';
      var t = typeof o, i, parts = [];
      if (t === 'number' || t === 'boolean') return String(o);
      if (t === 'string') {
        return '"' + o.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      }
      if (o instanceof Array) {
        for (i = 0; i < o.length; i++) parts.push(JSON.stringify(o[i]));
        return '[' + parts.join(',') + ']';
      }
      for (var k in o) {
        if (o.hasOwnProperty(k)) parts.push('"' + k + '":' + JSON.stringify(o[k]));
      }
      return '{' + parts.join(',') + '}';
    },
    parse: function (s) { return eval('(' + s + ')'); }
  };
}

/* ---- fake DOM ---- */
function noop() {}
function FakeCtx() {}
FakeCtx.prototype.save = noop;
FakeCtx.prototype.restore = noop;
FakeCtx.prototype.translate = noop;
FakeCtx.prototype.rotate = noop;
FakeCtx.prototype.scale = noop;
FakeCtx.prototype.beginPath = noop;
FakeCtx.prototype.closePath = noop;
FakeCtx.prototype.moveTo = noop;
FakeCtx.prototype.lineTo = noop;
FakeCtx.prototype.arc = noop;
FakeCtx.prototype.arcTo = noop;
FakeCtx.prototype.fill = noop;
FakeCtx.prototype.stroke = noop;
FakeCtx.prototype.fillRect = noop;
FakeCtx.prototype.strokeRect = noop;
FakeCtx.prototype.fillText = noop;
FakeCtx.prototype.clearRect = noop;
FakeCtx.prototype.setLineDash = noop;
FakeCtx.prototype.quadraticCurveTo = noop;
FakeCtx.prototype.bezierCurveTo = noop;
FakeCtx.prototype.ellipse = noop;
FakeCtx.prototype.clip = noop;
FakeCtx.prototype.measureText = function () { return { width: 0 }; };
FakeCtx.prototype.createRadialGradient = function () { return { addColorStop: noop }; };
FakeCtx.prototype.createLinearGradient = function () {
  return { addColorStop: noop };
};

function fakeEl() {
  return {
    value: '',
    textContent: '',
    classList: { add: noop, remove: noop },
    addEventListener: noop,
    focus: noop,
    getContext: function () { return new FakeCtx(); }
  };
}

var document = {
  getElementById: fakeEl,
  querySelector: fakeEl,
  addEventListener: noop,
  readyState: 'complete'
};
var window = { addEventListener: noop };
var requestAnimationFrame = noop;

var localStorage = {
  _d: {},
  getItem: function (k) { return this._d.hasOwnProperty(k) ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};

/* ---- load the game, unwrapped so its internals become globals ---- */
var fso = new ActiveXObject('Scripting.FileSystemObject');
var HERE = fso.GetParentFolderName(WScript.ScriptFullName);
var HTML = WScript.Arguments.length
  ? WScript.Arguments(0)
  : fso.BuildPath(HERE, '..\\games\\unnamed.html');

var fh = fso.OpenTextFile(HTML, 1, false, 0);
var all = fh.ReadAll();
fh.Close();

var a = all.indexOf('<script>');
var b = all.lastIndexOf('</script>');
var code = all.substring(a + 8, b);
code = code.replace(/^\s*\(function \(\) \{/, '');
code = code.replace(/\}\)\(\);\s*$/, '');
code = code.replace(/'use strict';/, '');
eval(code);

/* ---- test scaffolding ---- */
var passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; WScript.Echo('  PASS  ' + name); }
  else { failed++; WScript.Echo('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

var T = 0;
function step(n) {
  for (var i = 0; i < n; i++) { T += 16; frame(T); }
}

/* stand the player on top of `top`, at x */
function placeOn(x, top) {
  p.x = x; p.y = top - SIZE;
  p.vx = 0; p.vy = 0;
  p.onGround = true; p.airJumps = 1;
  p.dead = false; p.deadT = 0;
  p.face = 1; p.atk = 0; p.cool = 0;
  state.buffer = 0; state.coyote = 0;
  state.complete = false;
  state.running = true;
}

function box(o) { return { x: o.x, y: o.y, w: o.w, h: o.h }; }
function hold(k) { keys[k] = true; }
function release(k) { keys[k] = false; }
function tap(k) { keys[k] = true; press(k); }
function letGo() { release('ArrowRight'); release('ArrowLeft'); release('Space'); }

function solidAt(x, y) {
  for (var i = 0; i < level.solids.length; i++) {
    var s = level.solids[i];
    if (s.x === x && s.y === y) return s;
  }
  return null;
}

/* Run right from (startX, startTop), jump when the right edge passes
   jumpAtX, optionally jump again near the apex. Report where we ended. */
/* `useDouble` may be true (spend the second jump near the apex) or a vy
   threshold — delaying it until you are falling carries you much further.
   Measured: apex timing reaches 288px, a late second jump up to 349px. */
function attempt(startX, startTop, jumpAtX, useDouble, limit) {
  var thresh = (typeof useDouble === 'number') ? useDouble : -120;
  placeOn(startX, startTop);
  hold('ArrowRight');
  var jumped = false, doubled = false;
  for (var i = 0; i < limit; i++) {
    if (!jumped && p.x + p.w >= jumpAtX) { tap('Space'); jumped = true; }
    else if (jumped && !doubled && useDouble && p.vy > thresh) {
      release('Space'); tap('Space'); doubled = true;
    }
    step(1);
    if (p.dead) { letGo(); return { r: 'died' }; }
    if (jumped && p.onGround) { letGo(); return { r: 'landed', x: p.x, y: p.y + p.h }; }
  }
  letGo();
  return { r: 'stuck' };
}

/* Same idea, but anchored to the platform's lip rather than to an
   arbitrary start — on a wide platform the take-off point that matters
   is hundreds of pixels from where you begin walking. */
function canReachFrom(from, target, useDouble) {
  var edge = from.x + from.w;
  var startX = Math.max(from.x + 2, edge - 320);
  var timings = useDouble ? [true, 300] : [false];
  for (var m = 0; m < timings.length; m++) {
    for (var jx = edge - 150; jx <= edge + 6; jx += 6) {
      var r = attempt(startX, from.y, jx, timings[m], 300);
      if (r.r === 'landed' && r.y === target.y &&
          r.x + SIZE > target.x && r.x < target.x + target.w) {
        return true;
      }
    }
  }
  return false;
}

/* Is there ANY take-off point that gets you from here onto `target`? */
function canReach(startX, startTop, target, useDouble) {
  var timings = useDouble ? [true, 300] : [false];
  for (var m = 0; m < timings.length; m++) {
    for (var jx = startX; jx <= startX + 320; jx += 8) {
      var r = attempt(startX, startTop, jx, timings[m], 260);
      if (r.r === 'landed' && r.y === target.y &&
          r.x + SIZE > target.x && r.x < target.x + target.w) {
        return true;
      }
    }
  }
  return false;
}

state.name = 'TESTER';

WScript.Echo('');
WScript.Echo('=== ??? headless playtest ===');
WScript.Echo('');

/* ==================================================================
   EVERY ROOM IS WELL FORMED
   The engine loops over these on every frame, so a room that forgets
   one crashes the moment you enter it — and only that room. Cheap to
   check here, expensive to find by hand.
   ================================================================== */
WScript.Echo('[every room]');
var NEEDED = ['name', 'worldW', 'start', 'fallY', 'solids', 'hazards',
              'saws', 'waves', 'enemies', 'pickups', 'door', 'arrows', 'hints',
              'bombs', 'sinkers', 'orbs'];
var missing = '';
for (var li = 0; li < BUILDERS.length; li++) {
  var built = BUILDERS[li]();
  for (var f = 0; f < NEEDED.length; f++) {
    if (built[NEEDED[f]] === undefined) {
      missing += built.name + ' has no ' + NEEDED[f] + '; ';
    }
  }
}
ok('every room defines every field the engine walks', missing === '', missing);

/* and every room must survive simply being entered and left running */
for (var li = 0; li < BUILDERS.length; li++) {
  var threw = '';
  try {
    loadLevel(li);
    state.running = true;
    step(150);
  } catch (err) {
    threw = String(err.message || err);
  }
  ok('running ' + BUILDERS[li]().name + ' for 2.5s never throws', threw === '', threw);
}
WScript.Echo('');

/* ==================================================================
   TUTORIAL
   ================================================================== */
loadLevel(0);
state.running = true;
WScript.Echo('[tutorial: the apple]');

placeOn(2765, GROUND);
tap('KeyB');
ok('B near the pedestal picks the apple up', p.holding && p.holding.kind === 'apple');
step(3);

die();
step(60);                                   // respawn fires after 0.7s
ok('death returns the apple to its pedestal',
   level.pickups[0].x === level.pickups[0].home.x && level.pickups[0].y === level.pickups[0].home.y,
   'at ' + level.pickups[0].x + ',' + level.pickups[0].y);
ok('the apple never lands on the scarecrow',
   !hits(box(level.pickups[0]), box(level.scarecrow)),
   'apple x=' + level.pickups[0].x + ' scarecrow x=' + level.scarecrow.x);

WScript.Echo('');
WScript.Echo('[tutorial: the pit]');
loadLevel(0); state.running = true;
var ground = solidAt(-60, GROUND);
var groundB = solidAt(1320, GROUND);
ok('a single jump falls short of the pit',
   attempt(1000, GROUND, level.pit.x - 2, false, 200).r === 'died');
loadLevel(0); state.running = true;
ok('a double jump clears the pit',
   attempt(1000, GROUND, level.pit.x - 2, true, 200).r === 'landed');

WScript.Echo('');
WScript.Echo('[tutorial: the ledge]');
loadLevel(0); state.running = true;
ok('one jump gets you onto the ledge',
   canReach(700, GROUND, solidAt(820, 370), false));

WScript.Echo('');
WScript.Echo('[tutorial: the scarecrow]');
loadLevel(0); state.running = true;
ok('the barrier starts closed', level.barrier.open === false);

placeOn(1765, GROUND);
for (var i = 0; i < 120 && level.scarecrow.hp > 0; i++) {
  release('KeyI'); tap('KeyI');
  step(25);                                 // longer than the 0.32s cooldown
}
ok('three swings break the scarecrow', level.scarecrow.hp <= 0, 'hp=' + level.scarecrow.hp);
ok('breaking it opens the barrier', level.barrier.open === true);
step(200);                                  // past the 2.6s regen
ok('the scarecrow grows back to practise on',
   level.scarecrow.hp === level.scarecrow.maxHp);

WScript.Echo('');
WScript.Echo('[tutorial: the barrier]');
loadLevel(0); state.running = true;
placeOn(2100, GROUND);
hold('ArrowRight');
step(150);
ok('a closed barrier stops you walking past',
   p.x + p.w <= level.barrier.x + 1, 'right edge = ' + (p.x + p.w));
var over = false;
for (var i = 0; i < 200; i++) {
  if (p.onGround) tap('Space'); else { release('Space'); tap('Space'); }
  step(1);
  if (p.x > level.barrier.x + level.barrier.w) { over = true; break; }
}
letGo();
ok('you cannot double-jump over the barrier either', !over);

/* ==================================================================
   ROOM ONE — the four beats
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room one: beat 1, one jump up]');
loadLevel(1); state.running = true;
ok('the room loads', level.name === 'Room One');
var platA = solidAt(700, 370);
var platB = solidAt(960, 240);
var platC = solidAt(1180, 300);
var platD = solidAt(1560, 300);
var platE = solidAt(1860, 300);
var platF = solidAt(2200, 300);
ok('every platform exists',
   platA && platB && platC && platD && platE && platF);
ok('one jump reaches the first platform', canReach(420, GROUND, platA, false));

WScript.Echo('');
WScript.Echo('[room one: beat 2, double jump higher]');
loadLevel(1); state.running = true;
ok('one jump CANNOT reach the high platform', !canReach(700, 370, platB, false));
loadLevel(1); state.running = true;
ok('two jumps can', canReach(700, 370, platB, true));

WScript.Echo('');
WScript.Echo('[room one: beat 3, double jump over spikes]');
loadLevel(1); state.running = true;
ok('the spikes sit between the run-up and the landing',
   level.hazards[0].x > platC.x + platC.w - 1 &&
   level.hazards[0].x + level.hazards[0].w < platD.x + 1,
   'spikes ' + level.hazards[0].x + '..' + (level.hazards[0].x + level.hazards[0].w));
ok('one jump CANNOT clear the spikes', !canReach(platC.x, 300, platD, false));
loadLevel(1); state.running = true;
ok('two jumps can', canReach(platC.x, 300, platD, true));

loadLevel(1); state.running = true;
placeOn(1400, 300);                          // stood right on the spike bed
step(4);
ok('touching the spikes kills you', p.dead === true);

loadLevel(1); state.running = true;
placeOn(650, GROUND);                        // walked off into the first gap
p.onGround = false;
var fell = false;
for (var i = 0; i < 80; i++) {               // stop at the death, not after
  step(1);                                   // the 0.7s respawn would hide it
  if (p.dead) { fell = true; break; }
}
ok('falling off the platforms kills you', fell, 'ended at y=' + p.y);

WScript.Echo('');
WScript.Echo('[room one: beat 4, the key and the door]');
loadLevel(1); state.running = true;
ok('the key starts on a platform you can stand on',
   level.pickups[0].y + level.pickups[0].h === platE.y,
   'key bottom = ' + (level.pickups[0].y + level.pickups[0].h) + ' platform top = ' + platE.y);

placeOn(level.door.x - 40, 300);
step(6);
ok('the door stays shut without the key', state.complete === false);

loadLevel(1); state.running = true;
placeOn(1930, 300);
tap('KeyB');
ok('B picks the key up', p.holding && p.holding.kind === 'key');
ok('picking it up flags the door', state.picked === true);

hold('ArrowRight');
var opened = false;
for (var i = 0; i < 300; i++) {
  /* jump the gap between the key platform and the door platform */
  if (p.onGround && p.x + p.w > platE.x + platE.w - 40) tap('Space');
  else if (!p.onGround && p.vy > -120) { release('Space'); tap('Space'); }
  step(1);
  if (state.complete) { opened = true; break; }
  if (p.dead) break;
}
letGo();
ok('carrying the key to the door ends the room', opened,
   p.dead ? 'died on the way' : 'stopped at x=' + p.x);
ok('the key came with you', state.picked === true);

WScript.Echo('');
WScript.Echo('[room one: reachable end to end]');
loadLevel(1); state.running = true;
var chain =
  canReach(420, GROUND, platA, false) &&
  canReach(platA.x, 370, platB, true) &&
  canReach(platB.x, 240, platC, false) &&
  canReach(platC.x, 300, platD, true) &&
  canReach(platD.x, 300, platE, true) &&
  canReach(platE.x, 300, platF, true);
ok('you can get from the start to the door', chain);

/* ==================================================================
   ROOM TWO — four jumps, each gap patrolled by a saw
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room two: the saws]');
loadLevel(2); state.running = true;
ok('the room loads', level.name === 'Room Two');
ok('five platforms, five saws',
   level.solids.length === 5 && level.saws.length === 5);

/* every saw must ride through the gap it guards, not over a platform */
var sawsClear = true, sawDetail = '';
for (var i = 0; i < level.saws.length; i++) {
  var sw = level.saws[i];
  for (var j = 0; j < level.solids.length; j++) {
    var s = level.solids[j];
    if (sw.x0 > s.x - sw.r && sw.x0 < s.x + s.w + sw.r) {
      sawsClear = false;
      sawDetail = 'saw at ' + sw.x0 + ' overlaps platform ' + s.x + '..' + (s.x + s.w);
    }
  }
}
ok('every saw hangs in a gap, not over a platform', sawsClear, sawDetail);

/* One attempt at a gap, starting the saws at a given point in their cycle. */
function crossSawGap(startX, startTop, target, useDouble, t0, jumpAtX) {
  loadLevel(2);
  state.running = true;
  placeOn(startX, startTop);
  state.t = t0;
  hold('ArrowRight');
  var jumped = false, doubled = false;
  for (var i = 0; i < 300; i++) {
    if (!jumped && p.x + p.w >= jumpAtX) { tap('Space'); jumped = true; }
    else if (jumped && !doubled && useDouble && p.vy > -120) {
      release('Space'); tap('Space'); doubled = true;
    }
    step(1);
    if (p.dead) { letGo(); return 'died'; }
    if (jumped && p.onGround) {
      letGo();
      return (p.y + p.h === target.y &&
              p.x + SIZE > target.x && p.x < target.x + target.w) ? 'ok' : 'short';
    }
  }
  letGo();
  return 'stuck';
}

/* Sweep the whole saw cycle and count how many launch moments work. */
function sawGapStats(from, target, useDouble) {
  var res = { ok: 0, died: 0, total: 0 };
  var edge = from.x + from.w;
  var startX = Math.max(0, from.x + 10);
  for (var t0 = 0; t0 < 2.6; t0 += 0.1) {
    var r = crossSawGap(startX, from.y, target, useDouble, t0, edge - 2);
    res.total++;
    if (r === 'ok') res.ok++;
    else if (r === 'died') res.died++;
  }
  return res;
}

var r2 = level.solids;
var names = ['jump 1', 'jump 2', 'jump 3'];
for (var g = 0; g < 3; g++) {
  var st = sawGapStats(r2[g], r2[g + 1], false);
  WScript.Echo('        window: ' + st.ok + ' safe, ' + st.died + ' fatal, of ' + st.total);
  ok(names[g] + ': there is a safe moment to go',
     st.ok > 0, st.ok + '/' + st.total + ' launches survived');
  ok(names[g] + ': the saw actually threatens you',
     st.died > 0, 'nobody ever died - the saw is decorative');
}

WScript.Echo('');
WScript.Echo('[room two: jump 4, two saws and a double jump]');
var g4single = sawGapStats(r2[3], r2[4], false);
ok('jump 4 CANNOT be done with one jump', g4single.ok === 0,
   g4single.ok + ' single jumps got across');

var g4double = sawGapStats(r2[3], r2[4], true);
WScript.Echo('        window: ' + g4double.ok + ' safe, ' + g4double.died + ' fatal, of ' + g4double.total);
ok('jump 4 can be done with a double jump', g4double.ok > 0,
   g4double.ok + '/' + g4double.total + ' launches survived');
ok('both saws are in the last gap',
   level.saws[3].x0 > r2[3].x + r2[3].w && level.saws[4].x0 < r2[4].x,
   'saws at ' + level.saws[3].x0 + ' and ' + level.saws[4].x0);
ok('the last gap is the widest', (r2[4].x - (r2[3].x + r2[3].w)) === 240,
   'gap = ' + (r2[4].x - (r2[3].x + r2[3].w)));

loadLevel(2); state.running = true;
placeOn(level.saws[0].x0 - SIZE / 2, 380);   // stand in the saw's path
p.y = 300;
state.t = 0;                                 // phase 0 = blade at the top
step(3);
ok('touching a saw kills you', p.dead === true);

WScript.Echo('');
WScript.Echo('[room two: the way out]');
loadLevel(2); state.running = true;
ok('the door needs no key here', level.door.needs === null);
placeOn(level.door.x - 40, 380);
hold('ArrowRight');
var out = false;
for (var i = 0; i < 120; i++) {
  step(1);
  if (state.complete) { out = true; break; }
}
letGo();
ok('walking into the door ends the room', out);

/* ==================================================================
   ROOM THREE — the red cube
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room three: the cube]');
loadLevel(3); state.running = true;
ok('the room loads', level.name === 'Room Three');
ok('the cube is smaller than you', level.enemies[0].w < SIZE && level.enemies[0].h < SIZE);
ok('the key starts hidden', level.pickups[0].hidden === true);
ok('the door wants the key', level.door.needs === 'key');

/* it should come at you */
placeOn(1600, GROUND);
var startGap = Math.abs(level.enemies[0].x - p.x);
step(40);
ok('the cube chases you', Math.abs(level.enemies[0].x - p.x) < startGap,
   'gap went ' + Math.round(startGap) + ' -> ' + Math.round(Math.abs(level.enemies[0].x - p.x)));

/* every gap is a double jump */
loadLevel(3); state.running = true;
var gapsOk = true, gapList = '';
for (var i = 0; i < level.solids.length - 1; i++) {
  var gp = level.solids[i + 1].x - (level.solids[i].x + level.solids[i].w);
  gapList += gp + ' ';
  if (gp !== 240) gapsOk = false;
}
ok('every gap is double-jump distance', gapsOk, 'gaps: ' + gapList);

for (var i = 0; i < level.solids.length - 1; i++) {
  loadLevel(3); state.running = true;
  var from = level.solids[i], to = level.solids[i + 1];
  ok('you can double jump gap ' + (i + 1), canReachFrom(from, to, true));
}

/* it has to be able to come and get you, wherever you are */
loadLevel(3); state.running = true;
placeOn(200, GROUND);                      // as far from its spawn as possible
var spawnX = level.enemies[0].x;
var reached = false, jumps = 0, wasAir = false;
for (var i = 0; i < 900; i++) {
  state.grab = 0;                          // don't let it kill us mid-measurement
  p.x = 200; p.y = GROUND - SIZE;          // stand still and wait
  p.vx = 0; p.vy = 0;
  step(1);
  if (!wasAir && !level.enemies[0].onGround) { jumps++; wasAir = true; }
  if (level.enemies[0].onGround) wasAir = false;
  if (Math.abs(level.enemies[0].x - p.x) < 60) { reached = true; break; }
}
ok('the cube jumps', jumps > 0, jumps + ' jumps');
ok('the cube crosses the room to reach you', reached,
   'started at ' + Math.round(spawnX) + ', got to ' + Math.round(level.enemies[0].x));
ok('it never falls out of the world', level.enemies[0].y < level.fallY);

/* two seconds of contact kills you */
loadLevel(3); state.running = true;
placeOn(level.enemies[0].x - 4, GROUND);
var heldFor = 0;
for (var i = 0; i < 400; i++) {
  p.x = level.enemies[0].x - 4;                 // pinned against it
  step(1);
  heldFor += 0.016;
  if (p.dead) break;
}
ok('two seconds in its grip kills you', p.dead === true);
ok('it takes about two seconds, not instantly',
   heldFor > 1.6 && heldFor < 2.6, 'died after ' + heldFor.toFixed(2) + 's');

/* a brush past should NOT kill you */
loadLevel(3); state.running = true;
placeOn(level.enemies[0].x - 4, GROUND);
step(30);                                  // ~0.5s of contact
var meterAfterTouch = state.grab;
p.x = 1560;                                // break away
step(120);                                 // ~2s clear
ok('breaking away bleeds the meter back down',
   state.grab < meterAfterTouch && !p.dead,
   'meter ' + meterAfterTouch.toFixed(2) + ' -> ' + state.grab.toFixed(2));

WScript.Echo('');
WScript.Echo('[room three: the fight]');
loadLevel(3); state.running = true;
ok('the cube has three hit points', level.enemies[0].hp === 3);

var swings = 0;
for (var i = 0; i < 60 && !level.enemies[0].dead; i++) {
  /* stand just off its side and swing */
  p.x = level.enemies[0].x - SIZE - 2;
  p.y = level.enemies[0].y + level.enemies[0].h - SIZE;
  p.face = 1;
  state.grab = 0;                          // isolate the fight from the grip
  release('KeyI'); tap('KeyI');
  if (p.atk > 0) swings++;
  step(24);                                // past the 0.32s swing cooldown
}
ok('three swings kill it', level.enemies[0].dead === true,
   'hp=' + level.enemies[0].hp + ' after ' + swings + ' swings');
ok('it took exactly three', swings === 3, swings + ' swings');
ok('killing it drops the key', level.pickups[0].hidden === false);

step(60);                                  // let the key fall
ok('the key lands on something solid',
   level.pickups[0].grounded === true && level.pickups[0].y + level.pickups[0].h <= GROUND + 1,
   'key at y=' + level.pickups[0].y);
ok('the key drops somewhere in the room',
   level.pickups[0].x > 0 && level.pickups[0].x < level.worldW,
   'key x=' + level.pickups[0].x);

/* one swing must not count as three */
loadLevel(3); state.running = true;
p.x = level.enemies[0].x - SIZE - 2;
p.y = level.enemies[0].y + level.enemies[0].h - SIZE;
p.face = 1;
tap('KeyI');
for (var i = 0; i < 12; i++) { state.grab = 0; step(1); }
ok('a single swing only lands once', level.enemies[0].hp === 2, 'hp=' + level.enemies[0].hp);

WScript.Echo('');
WScript.Echo('[room three: the way out]');
loadLevel(3); state.running = true;
placeOn(level.door.x - 40, 380);
step(6);
ok('the door stays shut with the cube alive', state.complete === false);

level.enemies[0].hp = 1;                        // finish it off
p.x = level.enemies[0].x - SIZE - 2;
p.y = level.enemies[0].y + level.enemies[0].h - SIZE;
p.face = 1;
tap('KeyI');
for (var i = 0; i < 40; i++) { state.grab = 0; step(1); }
ok('the cube dies on the last hit', level.enemies[0].dead === true);

p.x = level.pickups[0].x - 10;
p.y = level.pickups[0].y;
tap('KeyB');
ok('you can pick the dropped key up', p.holding && p.holding.kind === 'key');

placeOn(level.door.x - 40, 380);
hold('ArrowRight');
var out3 = false;
for (var i = 0; i < 120; i++) {
  step(1);
  if (state.complete) { out3 = true; break; }
}
letGo();
ok('the key opens the door', out3);

/* ==================================================================
   ROOM FOUR — three reds, three platforms, three saws
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room four: the layout]');
loadLevel(4); state.running = true;
ok('the room loads', level.name === 'Room Four');
ok('three reds, three saws', level.enemies.length === 3 && level.saws.length === 3);
ok('there is solid ground under it all',
   solidAt(-60, GROUND) !== null);

var p4 = [solidAt(560, 350), solidAt(1060, 270), solidAt(1560, 190)];
ok('three floating platforms', p4[0] && p4[1] && p4[2]);

/* a red starts on each platform */
var onPlat = 0;
for (var i = 0; i < 3; i++) {
  var e = level.enemies[i];
  if (e.y + e.h === p4[i].y &&
      e.x >= p4[i].x && e.x + e.w <= p4[i].x + p4[i].w) onPlat++;
}
ok('one red on each platform', onPlat === 3, onPlat + ' of 3');

/* saws sit ON the platforms and never poke out underneath */
var sawsOk = true, sawWhy = '';
for (var i = 0; i < 3; i++) {
  var sw = level.saws[i], pl = p4[i];
  if (sw.y0 !== sw.y1) { sawsOk = false; sawWhy = 'saw ' + i + ' is not horizontal'; }
  if (sw.y0 + sw.r !== pl.y) {
    sawsOk = false;
    sawWhy = 'saw ' + i + ' underside at ' + (sw.y0 + sw.r) + ', platform top ' + pl.y;
  }
  if (sw.x0 - sw.r < pl.x - 0.01 || sw.x1 + sw.r > pl.x + pl.w + 0.01) {
    sawsOk = false;
    sawWhy = 'saw ' + i + ' overhangs its platform';
  }
}
ok('saws slide along the tops and never stick out underneath', sawsOk, sawWhy);

/* the blades really do travel sideways */
loadLevel(4); state.running = true;
var sawXs = [];
for (var i = 0; i < 3; i++) sawXs.push(sawPos(level.saws[i]).x);
state.t = 1.2;
var moved = 0;
for (var i = 0; i < 3; i++) {
  if (Math.abs(sawPos(level.saws[i]).x - sawXs[i]) > 20) moved++;
}
ok('the saws move left to right', moved === 3, moved + ' of 3 moved');

WScript.Echo('');
WScript.Echo('[room four: reds and saws]');
loadLevel(4); state.running = true;
placeOn(200, GROUND);
var redsHurt = false;
for (var i = 0; i < 600; i++) {
  state.grab = 0;
  p.x = 200; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  for (var n = 0; n < 3; n++) {
    if (level.enemies[n].dead) redsHurt = true;
  }
  if (redsHurt) break;
}
ok('saws never kill the reds', !redsHurt);

WScript.Echo('');
WScript.Echo('[room four: the key]');
loadLevel(4); state.running = true;
ok('the key starts hidden', level.pickups[0].hidden === true);

/* kill two - the key must stay hidden */
level.enemies[0].dead = true;
level.enemies[1].dead = true;
var e3 = level.enemies[2];
e3.hp = 1;
p.x = e3.x - SIZE - 2; p.y = e3.y + e3.h - SIZE; p.face = 1;
state.grab = 0;
tap('KeyI');
for (var i = 0; i < 3; i++) { state.grab = 0; step(1); }
ok('the key only appears when all three are down', level.pickups[0].hidden === false);
ok('the key spawns on the top platform',
   level.pickups[0].y + level.pickups[0].h === p4[2].y &&
   level.pickups[0].x >= p4[2].x && level.pickups[0].x + level.pickups[0].w <= p4[2].x + p4[2].w,
   'key at ' + level.pickups[0].x + ',' + level.pickups[0].y);

step(40);
ok('the key stays up top rather than falling to the ground',
   level.pickups[0].y + level.pickups[0].h === p4[2].y,
   'key bottom = ' + (level.pickups[0].y + level.pickups[0].h));

/* Climbability splits into two questions: can the jumps be made at all,
   and is there ever somewhere on a platform the saw isn't. Simulating a
   naive run-and-jump can't answer either — a blade crossing the run-up
   kills it regardless of whether a human could time it. */
loadLevel(4); state.running = true;
var keptSaws = level.saws;
level.saws = [];
var reachOk = canReachFrom(p4[0], p4[1], true) && canReachFrom(p4[1], p4[2], true);
level.saws = keptSaws;
ok('the platforms are within double-jump reach', reachOk);

var roomToStand = true, worst = '';
for (var t0 = 0; t0 < 3.2; t0 += 0.1) {
  state.t = t0;
  for (var i = 0; i < 3; i++) {
    var sw = level.saws[i], pl = p4[i], at = sawPos(sw);
    var freeLeft = (at.x - sw.r) - pl.x;
    var freeRight = (pl.x + pl.w) - (at.x + sw.r);
    if (Math.max(freeLeft, freeRight) < SIZE + 4) {
      roomToStand = false;
      worst = 'platform ' + i + ' boxed in at t=' + t0.toFixed(1);
    }
  }
}
ok('a saw never fills its whole platform', roomToStand, worst);

ok('a saw can be jumped over',
   level.saws[0].r * 2 < 102, 'saw stands ' + (level.saws[0].r * 2) + 'px proud');

WScript.Echo('');
WScript.Echo('[room four: platforms you can pass up through]');
loadLevel(4); state.running = true;
ok('the floating platforms are one-way',
   p4[0].oneWay && p4[1].oneWay && p4[2].oneWay);

/* Stand under one and jump: you should end up on top, not bonk. Clear
   the saw and the red off it first — this is about the platform, and
   landing into a blade proves nothing either way. */
level.saws = [];
level.enemies = [];
placeOn(p4[0].x + 100, GROUND);
tap('Space');
for (var i = 0; i < 6; i++) { step(1); release('Space'); tap('Space'); }
var landedOnTop = false;
for (var i = 0; i < 90; i++) {
  step(1);
  if (p.onGround && p.y + p.h === p4[0].y) { landedOnTop = true; break; }
}
letGo();
ok('you can jump up through the underside and land on top', landedOnTop,
   'ended at y=' + p.y);

/* and it must not block you sideways */
loadLevel(4); state.running = true;
p.x = p4[0].x + 40; p.y = p4[0].y - 10;      // overlapping the slab
p.vx = 0; p.vy = 0; p.dead = false; p.onGround = false;
hold('ArrowRight');
var startedAt = p.x;
step(20);
letGo();
ok('a one-way platform never blocks you sideways', p.x > startedAt + 20,
   'moved ' + Math.round(p.x - startedAt) + 'px');

WScript.Echo('');
WScript.Echo('[room five: the green fellow]');
loadLevel(5); state.running = true;
ok('the room loads', level.name === 'Room Five');
ok('nothing in here can hurt you',
   level.enemies.length === 0 && level.saws.length === 0 &&
   level.hazards.length === 0 && level.waves.length === 0);
ok('he has his line', level.npc.line.indexOf('some apples') !== -1);
ok('a buttload of apples', level.pickups.length >= 20, level.pickups.length + ' apples');
ok('the door needs nothing', level.door.needs === null);

var allHidden = true;
for (var i = 0; i < level.pickups.length; i++) {
  if (!level.pickups[i].hidden) allHidden = false;
}
ok('the apples start out of sight', allHidden);

placeOn(200, GROUND);                        // too far away to trigger him
step(5);
ok('he keeps quiet until you come near', level.npc.said === false);

placeOn(level.npc.x - 120, GROUND);
step(3);
ok('walking up to him sets him talking', level.npc.said === true);

step(90);                                    // past the 1.1s before they drop
var dropped = 0;
for (var i = 0; i < level.pickups.length; i++) {
  if (!level.pickups[i].hidden) dropped++;
}
ok('the apples fall out of nowhere', dropped === level.pickups.length,
   dropped + ' of ' + level.pickups.length);

step(200);                                   // let them all land
var landed = 0;
for (var i = 0; i < level.pickups.length; i++) {
  if (level.pickups[i].grounded) landed++;
}
ok('they all land on the ground', landed === level.pickups.length,
   landed + ' of ' + level.pickups.length);

/* carry one around, drop it, pick up another */
var near1 = level.pickups[0];
p.x = near1.x - 10; p.y = near1.y - 4;
tap('KeyB');
ok('you can pick an apple up', p.holding !== null);
release('KeyB'); tap('KeyB');
ok('and put it down again', p.holding === null);
ok('picking apples up does not unlock anything', state.picked === false);

placeOn(level.door.x - 40, GROUND);
hold('ArrowRight');
var out5 = false;
for (var i = 0; i < 120; i++) { step(1); if (state.complete) { out5 = true; break; } }
letGo();
ok('you can just walk out when you are done', out5);

WScript.Echo('');
WScript.Echo('[room six: everything at once]');
loadLevel(6); state.running = true;
ok('the room loads', level.name === 'Room Six');
ok('ten reds', level.enemies.length === 10, level.enemies.length + ' reds');
ok('no saws anywhere in this room', level.saws.length === 0,
   level.saws.length + ' saws');
ok('spikes come out of the ground in a wave', level.waves.length > 6,
   level.waves.length + ' beds');

/* one tooth to a bed: they come up one at a time, not in threes */
var fatBed6 = '';
for (var i = 0; i < level.waves.length; i++) {
  if (level.waves[i].w > 45) fatBed6 = level.waves[i].w + 'px wide';
}
ok('each bed of the carpet is a single spike', fatBed6 === '', fatBed6);

var ledge6 = solidAt(40, 350);
ok('you spawn on a ledge, not in the spikes',
   ledge6 !== null && level.start.y + SIZE === ledge6.y,
   'start y=' + level.start.y);

/* the spikes are one unbroken carpet, under the ledge included */
var gapFound = '';
for (var i = 0; i < level.waves.length - 1; i++) {
  if (Math.abs((level.waves[i].x + level.waves[i].w) - level.waves[i + 1].x) > 0.01) {
    gapFound = 'gap after bed ' + i;
  }
}
ok('the spikes run with no gaps between beds', gapFound === '', gapFound);

var first6 = level.waves[0];
var last6 = level.waves[level.waves.length - 1];
ok('they start before the ledge and reach past the door',
   first6.x <= ledge6.x && last6.x + last6.w >= level.door.x + level.door.w,
   'carpet ' + first6.x + '..' + (last6.x + last6.w) +
   ', ledge at ' + ledge6.x + ', door at ' + level.door.x);

var underLedge = false;
for (var i = 0; i < level.waves.length; i++) {
  var wv = level.waves[i];
  if (wv.x < ledge6.x + ledge6.w && wv.x + wv.w > ledge6.x) underLedge = true;
}
ok('there are spikes under the ledge too', underLedge);

/* ...and the ledge still clears them at full extension */
var tallest = 0;
for (var i = 0; i < level.waves.length; i++) {
  if (level.waves[i].h > tallest) tallest = level.waves[i].h;
}
ok('the ledge sits above the spikes at full height',
   ledge6.y < GROUND - tallest,
   'ledge top ' + ledge6.y + ' vs spike tips at ' + (GROUND - tallest));

/* a carpet with no troughs would be impassable */
var narrowest = 1e9;
for (var t0 = 0; t0 < 3.0; t0 += 0.05) {
  state.t = t0;
  var best = 0, run = 0;
  for (var i = 0; i < level.waves.length; i++) {
    if (waveOut(level.waves[i]) < 0.05) { run += level.waves[i].w; if (run > best) best = run; }
    else run = 0;
  }
  if (best < narrowest) narrowest = best;
}
ok('there is always a trough wide enough to stand in',
   narrowest >= SIZE + 20, 'narrowest safe run was ' + narrowest + 'px');

ok('a raised bed can be jumped over', tallest < 102,
   'spikes reach ' + tallest + 'px, one jump is 102px');

/* The carpet has no gaps, so crossing it means jumping raised stretches.
   If one is ever longer than a double jump carries you, the room is not
   crossable on foot and the far half is unreachable. */
var longestUp = 0;
for (var t0 = 0; t0 < 3.0; t0 += 0.02) {
  state.t = t0;
  var run = 0;
  for (var i = 0; i < level.waves.length; i++) {
    if (waveOut(level.waves[i]) >= 0.05) {
      run += level.waves[i].w;
      if (run > longestUp) longestUp = run;
    } else run = 0;
  }
}
ok('no raised stretch is longer than a double jump',
   longestUp <= 280,
   'longest raised run ' + longestUp +
   'px; a double jump carries 288px at apex timing, 349px at the latest');

/* every bed must telegraph before it fires, with enough notice to move */
var wv1 = level.waves[5];
var sawTellFor = 0, tellRanOut = false, everWarned = false;
for (var t0 = 0; t0 < wv1.period * 2; t0 += 0.02) {
  state.t = t0;
  var wn = waveWarn(wv1), o = waveOut(wv1);
  if (wn > 0) { everWarned = true; sawTellFor += 0.02; }
  if (o > 0 && sawTellFor > 0 && sawTellFor < 0.4) tellRanOut = true;
  if (o > 0) sawTellFor = 0;
}
ok('a bed warns you before it fires', everWarned);
ok('the warning gives you time to move', !tellRanOut);

/* and the warning must never be showing while the spikes are already up */
var overlap = false;
for (var t0 = 0; t0 < wv1.period * 2; t0 += 0.02) {
  state.t = t0;
  if (waveWarn(wv1) > 0 && waveOut(wv1) > 0) overlap = true;
}
ok('the warning stops once the spikes are out', !overlap);

ok('the spikes are low', level.waves[0].h <= 40,
   'spikes reach ' + level.waves[0].h + 'px');
ok('and slow', level.waves[0].period >= 4,
   'period ' + level.waves[0].period + 's');

/* The point of the ledge is that the ROOM doesn't kill you the instant
   you appear. The reds will come for you, and should — so take them out
   of it and check the terrain alone is survivable. */
level.enemies = [];
placeOn(level.start.x, 350);
step(320);
ok('the spawn ledge is safe from the spikes', !p.dead,
   'died standing still at x=' + Math.round(p.x));

/* the wave has to actually rise and fall, and leave gaps */
var everUp = false, everDown = false;
for (var t0 = 0; t0 < 3.0; t0 += 0.05) {
  state.t = t0;
  var o = waveOut(level.waves[0]);
  if (o > 0.8) everUp = true;
  if (o <= 0.001) everDown = true;
}
ok('the spikes rise all the way and retract all the way', everUp && everDown);

var neverAllUp = true;
for (var t0 = 0; t0 < 3.0; t0 += 0.05) {
  state.t = t0;
  var up = 0;
  for (var i = 0; i < level.waves.length; i++) {
    if (waveOut(level.waves[i]) > 0.5) up++;
  }
  if (up === level.waves.length) neverAllUp = false;
}
ok('they travel as a wave, never all up at once', neverAllUp);

/* spikes must kill when out, and not when down */
loadLevel(6); state.running = true;
var wv0 = level.waves[0];
placeOn(wv0.x + wv0.w / 2 - SIZE / 2, GROUND);
state.t = wv0.period * (0.5 - wv0.phase);    // that bed fully out
step(3);
ok('raised spikes kill you', p.dead === true);

loadLevel(6); state.running = true;
wv0 = level.waves[0];
placeOn(wv0.x + wv0.w / 2 - SIZE / 2, GROUND);
state.t = wv0.period * (1 - wv0.phase);      // same bed fully down
step(3);
ok('retracted spikes are safe to stand on', p.dead === false);

loadLevel(6); state.running = true;
ok('the key starts hidden', level.pickups[0].hidden === true);
var plat6C = solidAt(1700, 190);
ok('the key is set to spawn on the tallest platform',
   level.pickups[0].spawnAt.y + level.pickups[0].h === plat6C.y,
   'key bottom ' + (level.pickups[0].spawnAt.y + level.pickups[0].h) +
   ' vs platform ' + plat6C.y);

for (var i = 0; i < 9; i++) level.enemies[i].dead = true;
ok('nine down is not enough', level.pickups[0].hidden === true);
var last6 = level.enemies[9];
last6.hp = 1;
p.x = last6.x - SIZE - 2; p.y = last6.y + last6.h - SIZE; p.face = 1;
state.grab = 0;
tap('KeyI');
for (var i = 0; i < 3; i++) { state.grab = 0; step(1); }
ok('the tenth drops the key', level.pickups[0].hidden === false);
ok('and it appears up on the tallest platform',
   level.pickups[0].y + level.pickups[0].h === plat6C.y);

/* ==================================================================
   ROOM SEVEN — the boss
   ================================================================== */
WScript.Echo('');
WScript.Echo('[boss: the arena]');
loadLevel(7); state.running = true;
ok('the room loads', level.name === 'The Boss');
ok('it has three hit points', level.boss.hp === 3);
ok('it floats well above you', level.boss.y + level.boss.h < 200);

var bL = solidAt(420, 330), bH = solidAt(880, 210), bR = solidAt(1340, 330);
ok('two low platforms with a high one between them',
   bL && bH && bR && bH.y < bL.y && bH.y < bR.y &&
   bH.x > bL.x && bH.x < bR.x);
ok('you can get under all three',
   bL.y < GROUND - SIZE && bH.y < GROUND - SIZE && bR.y < GROUND - SIZE);
ok('the key is set to spawn on the high platform',
   level.pickups[1].spawnAt.y + level.pickups[1].h === bH.y);

WScript.Echo('');
WScript.Echo('[boss: the sweeping laser]');
loadLevel(7); state.running = true;
var B = level.boss;
B.moves.length = 0;
startMove(B, 'laser');
var laser = B.moves[0];
ok('the laser charges before it fires', laser.charge >= 0.5,
   'charge ' + laser.charge + 's');
ok('it sweeps from one side of the arena to the other',
   Math.abs(laser.toX - laser.fromX) > level.worldW * 0.6,
   'from ' + Math.round(laser.fromX) + ' to ' + Math.round(laser.toX));

/* the beam has to actually travel: sample where it is over the attack */
var beamAt = [];
placeOn(60, GROUND);                          // tucked in a corner, out of it
for (var i = 0; i < Math.floor(laser.dur / 0.016) - 4; i++) {
  p.x = 60; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  if (i % 20 === 0) beamAt.push(B.x + B.w / 2);
}
var minB = 1e9, maxB = -1e9;
for (var i = 0; i < beamAt.length; i++) {
  if (beamAt[i] < minB) minB = beamAt[i];
  if (beamAt[i] > maxB) maxB = beamAt[i];
}
ok('the beam really crosses the arena', maxB - minB > level.worldW * 0.5,
   'beam covered ' + Math.round(minB) + '..' + Math.round(maxB));

/* standing in the open anywhere along the sweep gets you */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
startMove(B, 'laser');
laser = B.moves[0];
var openX = 1860;
ok('there is open sky over that spot',
   beamFloor(openX, 100) === GROUND);
var diedOpen = false;
for (var i = 0; i < Math.floor(laser.dur / 0.016) - 4; i++) {
  p.x = openX; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  if (p.dead) { diedOpen = true; break; }
}
ok('standing in the open, the sweep gets you', diedOpen);

/* under a platform you survive the whole pass */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
startMove(B, 'laser');
laser = B.moves[0];
var shelterX = bH.x + 140;
ok('that spot has a platform over it',
   beamFloor(shelterX, 100) === bH.y);
var safeUnder = true;
for (var i = 0; i < Math.floor(laser.dur / 0.016) - 4; i++) {
  p.x = shelterX; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  if (p.dead) { safeUnder = false; break; }
}
ok('hiding under a platform survives the whole sweep', safeUnder);

WScript.Echo('');
WScript.Echo('[boss: the crash]');
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(1900, GROUND);                       // in the open, no platform
B.x = 1900; B.y = 96;
startMove(B, 'crash');
var crash = B.moves[0];
ok('it slams more than once', crash.slams >= 3, crash.slams + ' slams');

var hitByCrash = false;
for (var i = 0; i < 220; i++) {
  p.x = 1900; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  if (p.dead) { hitByCrash = true; break; }
}
ok('standing still under a crash kills you', hitByCrash);

/* The smash has NO blast. Landing next to you must not hurt you — the
   danger is the thing itself coming down, and stepping aside is the
   whole answer. The crash homes in, so drop it at a fixed spot rather
   than letting it follow the player into the test. */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(1760, GROUND);
startMove(B, 'crash');
crash = B.moves[0];
B.x = 1900; B.y = 96;
crash.sub = 'drop'; crash.subT = 0;

var landedNearby = false, killedAnyway = false;
for (var i = 0; i < 200; i++) {
  if (!p.dead) { p.x = 1760; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0; }
  if (crash.sub === 'drop') B.x = 1900;      // hold it off the player
  step(1);
  if (crash.done > 0) landedNearby = true;
  if (p.dead) { killedAnyway = true; break; }
}
ok('the smash lands', landedNearby);
ok('standing clear of the smash is safe - there is no blast',
   !killedAnyway, 'landed at ~1937, player stood at 1760 (140px clear)');
ok('the smash carries no shockwave state', crash.blasts === undefined);

/* it should keep slamming, not stop after one */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(bH.x + 140, GROUND);                 // sheltered, so we can watch
B.x = 1900; B.y = 96;
startMove(B, 'crash');
crash = B.moves[0];
for (var i = 0; i < 460 && crash.done < crash.slams; i++) {
  p.x = bH.x + 140; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  p.dead = false;
  step(1);
}
ok('it gets through all its slams', crash.done >= crash.slams,
   crash.done + ' of ' + crash.slams);

loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(bH.x + 140, GROUND);                 // under the high platform
B.x = bH.x + 140; B.y = 96;
startMove(B, 'crash');
crash = B.moves[0];
var shelteredFromCrash = true;
for (var i = 0; i < 120; i++) {
  p.x = bH.x + 140; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  if (p.dead) { shelteredFromCrash = false; break; }
}
ok('the first slam lands on the platform above you', shelteredFromCrash);

WScript.Echo('');
WScript.Echo('[boss: the spike eruption]');
/* Same trick as the crash: it comes down on top of you, so park the
   player up on the high platform and drop it at a known spot. */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(bH.x + 140, bH.y);
startMove(B, 'spikes');
var sp = B.moves[0];
B.x = 1700; B.y = 100;              // clear of the platform we parked on
sp.sub = 'drop'; sp.subT = 0;

var slammed = false;
for (var i = 0; i < 150; i++) {
  p.x = bH.x + 140; p.y = bH.y - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  if (sp.sub === 'erupt') { slammed = true; break; }
  if (p.dead) break;
}
ok('it slams into the ground to start the spikes', slammed, 'phase ' + sp.sub);
ok('the spikes come out from under it',
   sp.beds !== null && sp.beds.length > 8, sp.beds ? sp.beds.length + ' beds' : 'none');

/* the eruption spreads outward in BOTH directions from the impact */
var impactX = B.x + B.w / 2;
var leftBed = null, rightBed = null;
for (var i = 0; i < sp.beds.length; i++) {
  var bd = sp.beds[i];
  if (bd.x + bd.w < impactX - 500 && !leftBed) leftBed = bd;
  if (bd.x > impactX + 500 && !rightBed) rightBed = bd;
}
ok('spikes are laid out on both sides of the impact',
   leftBed !== null && rightBed !== null);

/* one tooth to a bed: they come up one at a time, not in threes */
var wideBed = '';
for (var i = 0; i < sp.beds.length; i++) {
  if (sp.beds[i].w > 40) wideBed = sp.beds[i].w + 'px wide';
}
ok('each bed of the eruption is a single spike', wideBed === '', wideBed);

/* nearer beds must come up before farther ones */
var nearBed = sp.beds[0], farBed = sp.beds[0];
for (var i = 0; i < sp.beds.length; i++) {
  if (sp.beds[i].upAt < nearBed.upAt) nearBed = sp.beds[i];
  if (sp.beds[i].upAt > farBed.upAt) farBed = sp.beds[i];
}
ok('it spreads outward rather than all at once',
   farBed.upAt > nearBed.upAt + 0.4,
   'nearest ' + nearBed.upAt.toFixed(2) + 's, farthest ' + farBed.upAt.toFixed(2) + 's');

/* and once a bed is up it STAYS up */
var everRetracted = false, wasUp = {};
for (var i = 0; i < 170; i++) {
  p.x = bH.x + 140; p.y = bH.y - SIZE; p.vx = 0; p.vy = 0;   // safe up top
  step(1);
  if (sp.t > sp.dur - 0.8) break;             // it's allowed to clear at the end
  for (var q = 0; q < sp.beds.length; q++) {
    var o = bedOut(sp, sp.beds[q]);
    if (o > 0.9) wasUp[q] = true;
    else if (wasUp[q] && o < 0.4) everRetracted = true;
  }
}
ok('spikes stay up once they are out', !everRetracted);

/* on the ground you get caught; on a platform you do not */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(400, GROUND);
startMove(B, 'spikes');
B.x = 1900;                                  // open floor, past every platform
B.y = 100;
B.moves[0].sub = 'drop'; B.moves[0].subT = 0;
ok('that spot really is open floor',
   beamFloor(1937, 100) === GROUND, 'lands on y=' + beamFloor(1937, 100));
var caught = false;
for (var i = 0; i < 300; i++) {
  if (!p.dead) { p.x = 400; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0; }
  step(1);
  if (p.dead) { caught = true; break; }
}
ok('standing on the ground, the spikes get you', caught);

/* The slam itself will flatten you wherever you stand — that's the
   dodge. What matters here is that the SPIKES can't climb a platform,
   so drop it clear of the one we're standing on. */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(bH.x + 140, bH.y);
startMove(B, 'spikes');
B.x = 1700; B.y = 100;
B.moves[0].sub = 'drop'; B.moves[0].subT = 0;
var safeUpTop = true, eruptionRan = false;
for (var i = 0; i < 300; i++) {
  p.x = bH.x + 140; p.y = bH.y - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  if (B.moves.length && B.moves[0].sub === 'erupt') eruptionRan = true;
  if (p.dead) { safeUpTop = false; break; }
}
ok('the eruption actually happened', eruptionRan);
ok('up on a platform the spikes cannot reach you', safeUpTop);

/* slam a platform instead of the floor and the spikes go on it */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(120, GROUND);                        // well out of the way
startMove(B, 'spikes');
var spP = B.moves[0];
B.x = bH.x + 120; B.y = 100;                 // right over the high platform
spP.sub = 'drop'; spP.subT = 0;
for (var i = 0; i < 150 && spP.sub !== 'erupt'; i++) {
  p.x = 120; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  step(1);
}
ok('it lands on the platform rather than falling through',
   spP.sub === 'erupt' && Math.abs((B.y + B.h) - bH.y) < 1,
   'boss bottom ' + Math.round(B.y + B.h) + ', platform top ' + bH.y);
ok('the spikes come up on that platform',
   spP.surfY === bH.y, 'spikes on y=' + spP.surfY);

var offPlatform = false;
for (var i = 0; i < spP.beds.length; i++) {
  var bd2 = spP.beds[i];
  if (bd2.x < bH.x - 1 || bd2.x + bd2.w > bH.x + bH.w + 1) offPlatform = true;
}
ok('and they stay within the platform', !offPlatform,
   spP.beds.length + ' beds across ' + bH.x + '..' + (bH.x + bH.w));

/* standing on that platform is now lethal; the floor below is not */
var floorSafe = true;
for (var i = 0; i < 200; i++) {
  p.x = bH.x + 140; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;   // underneath it
  step(1);
  if (p.dead) { floorSafe = false; break; }
}
ok('the floor under that platform stays clear', floorSafe);

WScript.Echo('');
WScript.Echo('[boss: the saw wall]');
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
startMove(B, 'saws');
var sw7 = B.moves[0];
ok('the blades circle the boss first', sw7.orbit >= 1.2,
   'orbit ' + sw7.orbit + 's');
ok('then it throws them at you', sw7.gather > 0);
ok('the whole warning is over a second', sw7.orbit + sw7.gather > 1.5,
   (sw7.orbit + sw7.gather).toFixed(1) + 's of notice');
ok('they sweep slowly enough to read', sw7.speed <= 420,
   sw7.speed + ' px/s, you move at ' + MOVE_SPD);

/* nothing should hurt you while they are still circling */
placeOn(1000, GROUND);
var hurtWhileCircling = false;
for (var i = 0; i < Math.floor(sw7.orbit / 0.016) - 4; i++) {
  p.x = 1000; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;
  step(1);
  if (p.dead) { hurtWhileCircling = true; break; }
}
ok('the circling blades are a warning, not a weapon', !hurtWhileCircling);

loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
startMove(B, 'saws');
sw7 = B.moves[0];
ok('there is a gap in it', sw7.gapH >= 100, 'gap ' + sw7.gapH + 'px');
ok('the gap is somewhere you can reach',
   sw7.gapY > 120 && sw7.gapY < GROUND, 'gap centred at y=' + sw7.gapY);

/* in the gap you live; out of it you don't */
var inGap = { survived: false }, outGap = { died: false };
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
startMove(B, 'saws');
sw7 = B.moves[0];
var gapTop = sw7.gapY - sw7.gapH / 2, gapBottom = sw7.gapY + sw7.gapH / 2;
var holdX = level.worldW / 2;
var frames = Math.floor(sw7.dur / 0.016) + 10;   // the full sweep, not a guess

var survived = true, passedUs = false;
for (var i = 0; i < frames; i++) {
  p.x = holdX; p.y = sw7.gapY - SIZE / 2;    // sat right in the gap
  p.vx = 0; p.vy = 0;
  step(1);
  if (sw7.colX !== null && sw7.colX !== undefined &&
      Math.abs(sw7.colX - holdX) < 30) passedUs = true;
  if (p.dead) { survived = false; break; }
}
ok('the wall actually swept past the player', passedUs,
   'ended at colX=' + Math.round(sw7.colX));
ok('sitting in the gap gets you through', survived,
   'gap ' + Math.round(gapTop) + '..' + Math.round(gapBottom));

loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
startMove(B, 'saws');
sw7 = B.moves[0];
frames = Math.floor(sw7.dur / 0.016) + 10;

/* Pick a slot that is a blade AND somewhere the player can actually be.
   The lowest slot sits below the floor, so a player there gets pushed
   up out of the ground before the blade ever reaches them. */
var bladeY = null;
for (var i = 0; i < sw7.slots.length; i++) {
  var sy = sw7.slots[i];
  if (!sawSlotBlocked(sw7, sy)) continue;
  if (sy > GROUND - 20 || sy < 120) continue;
  bladeY = sy;
  break;
}
var cut = false;
for (var i = 0; i < frames; i++) {
  p.x = holdX; p.y = bladeY - SIZE / 2;      // sat right where a blade is
  p.vx = 0; p.vy = 0;
  step(1);
  if (p.dead) { cut = true; break; }
}
ok('standing where a blade is gets you cut', cut,
   'blade slot at y=' + bladeY + ', gap at ' + Math.round(sw7.gapY));

WScript.Echo('');
WScript.Echo('[boss: the bombs]');
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
placeOn(120, GROUND);
startMove(B, 'bombs');
var blue = level.pickups[0];
ok('the blue bomb starts hidden', blue.hidden === true);

for (var i = 0; i < 160; i++) {
  p.x = 120; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0;   // far from the drops
  step(1);
}
ok('red bombs get dropped', level.bombs.length > 0 || B.moves.length === 0);
ok('a blue one turns up too', blue.hidden === false);

/* pick it up, let go, and it should fly at the boss */
loadLevel(7); state.running = true;
B = level.boss; B.moves.length = 0;
B.x = 1000; B.y = 96;
blue = level.pickups[0];
blue.hidden = false; blue.grounded = true; blue.flying = false;
blue.x = 300; blue.y = GROUND - blue.h;
p.x = 300; p.y = GROUND - SIZE; p.vx = 0; p.vy = 0; p.dead = false;
tap('KeyB');
ok('you can pick the blue bomb up', p.holding === blue);

release('KeyB'); tap('KeyB');
ok('letting go throws it', blue.flying === true);

var hpWas = B.hp;
for (var i = 0; i < 120; i++) {
  step(1);
  if (B.hp < hpWas) break;
}
ok('the thrown bomb damages the boss', B.hp === hpWas - 1,
   'hp ' + hpWas + ' -> ' + B.hp);
ok('and the bomb is spent', blue.hidden === true);

WScript.Echo('');
WScript.Echo('[boss: going down]');
loadLevel(7); state.running = true;
B = level.boss;
ok('the key stays hidden while it lives', level.pickups[1].hidden === true);
hurtBoss(B); hurtBoss(B);
ok('two hits is not enough', !B.dead && level.pickups[1].hidden === true,
   'hp=' + B.hp);
hurtBoss(B);
ok('three hits kills it', B.dead === true);
ok('and it drops the key on the high platform',
   level.pickups[1].hidden === false &&
   level.pickups[1].y + level.pickups[1].h === bH.y);

B.moves.length = 0;
placeOn(level.door.x - 40, GROUND);
state.picked = true;
hold('ArrowRight');
var outBoss = false;
for (var i = 0; i < 150; i++) { step(1); if (state.complete) { outBoss = true; break; } }
letGo();
ok('the key opens the way out', outBoss);

WScript.Echo('');
WScript.Echo('[boss: how it picks attacks]');
loadLevel(7); state.running = true;
B = level.boss;
var seen = {}, combos = 0, bombRuns = 0, rounds = 400;
for (var i = 0; i < rounds; i++) {
  B.moves.length = 0;
  chooseAttack(B);
  if (B.moves.length > 1) combos++;
  for (var m = 0; m < B.moves.length; m++) seen[B.moves[m].kind] = true;
  if (B.moves.length === 1 && B.moves[0].kind === 'bombs') bombRuns++;
}
ok('it uses the laser', seen.laser === true);
ok('it uses the crash', seen.crash === true);
ok('it uses the spikes', seen.spikes === true);
ok('it uses the saws', seen.saws === true);
ok('it drops bombs roughly a third of the time',
   bombRuns > rounds * 0.22 && bombRuns < rounds * 0.45,
   Math.round(bombRuns / rounds * 100) + '%');
ok('it sometimes combines two attacks', combos > 0,
   combos + ' combos in ' + rounds);

/* ==================================================================
   ROOM EIGHT — sinking platforms
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room eight: the sinking platforms]');
loadLevel(8); state.running = true;
ok('the room loads', level.name === 'Room Eight');
ok('the platforms are small', level.sinkers[0].w <= 160,
   level.sinkers[0].w + 'px wide');
ok('there are platforms that sink', level.sinkers.length >= 6,
   level.sinkers.length + ' sinkers');
ok('nothing to land on if you fall', level.fallY > GROUND);

/* standing on one takes it down */
var s1 = level.sinkers[0];
var startY = s1.y;
placeOn(s1.x + 60, s1.y);
step(90);
ok('it sinks while you stand on it', s1.y > startY + 40,
   'dropped ' + Math.round(s1.y - startY) + 'px in 1.4s');
ok('and it drops at a decent clip', s1.rate >= 45,
   s1.rate + ' px/s');
ok('and it carries you down with it',
   Math.abs((p.y + p.h) - s1.y) < 3,
   'player bottom ' + Math.round(p.y + p.h) + ', platform ' + Math.round(s1.y));

/* it stops sinking rather than dropping forever */
step(900);
ok('it bottoms out instead of falling forever', s1.y <= s1.home + s1.max + 1,
   'ended ' + Math.round(s1.y - s1.home) + 'px down, cap ' + s1.max);

/* step off and it comes back */
loadLevel(8); state.running = true;
s1 = level.sinkers[0];
placeOn(s1.x + 60, s1.y);
step(120);
var sunkTo = s1.y;
p.x = -20; p.y = level.start.y;               // back on the start ledge
p.onGround = true;
step(200);
ok('it rises again once you are off', s1.y < sunkTo - 10,
   'came back ' + Math.round(sunkTo - s1.y) + 'px');
ok('it never rises above where it started', s1.y >= s1.home - 0.5);

WScript.Echo('');
WScript.Echo('[room eight: the chains]');
loadLevel(8); state.running = true;
var chained = [];
for (var i = 0; i < level.sinkers.length; i++) {
  if (level.sinkers[i].chain) chained.push(level.sinkers[i]);
}
ok('some platforms share a chain', chained.length >= 4,
   chained.length + ' chained');

var chA = [];
for (var i = 0; i < level.sinkers.length; i++) {
  if (level.sinkers[i].chain === 'a') chA.push(level.sinkers[i]);
}
ok('one chain has four platforms on it', chA.length === 4,
   chA.length + ' on chain a');

var partnerStart = chA[1].y;
placeOn(chA[0].x + 60, chA[0].y);             // stand on the FIRST one only
step(90);
ok('standing on one drags its partner down too',
   chA[1].y > partnerStart + 15,
   'partner dropped ' + Math.round(chA[1].y - partnerStart) + 'px');
ok('they go down together',
   Math.abs((chA[0].y - chA[0].home) - (chA[1].y - chA[1].home)) < 2,
   'one at ' + Math.round(chA[0].y - chA[0].home) +
   ', other at ' + Math.round(chA[1].y - chA[1].home));

/* an unchained platform must NOT move when you stand elsewhere */
var lone = null;
for (var i = 0; i < level.sinkers.length; i++) {
  if (!level.sinkers[i].chain) { lone = level.sinkers[i]; break; }
}
ok('unchained platforms stay put', Math.abs(lone.y - lone.home) < 1,
   'moved ' + Math.round(lone.y - lone.home) + 'px');

WScript.Echo('');
WScript.Echo('[room eight: spikes on the platforms themselves]');
loadLevel(8); state.running = true;
var spiky = [];
for (var i = 0; i < level.sinkers.length; i++) {
  if (level.sinkers[i].spike) spiky.push(level.sinkers[i]);
}
ok('some platforms carry spikes', spiky.length >= 2, spiky.length + ' of them');
ok('no separate spike platforms any more', level.hazards.length === 0);

var partial = true;
for (var i = 0; i < spiky.length; i++) {
  if (spiky[i].spike.w >= spiky[i].w - 40) partial = false;
}
ok('the spikes only cover part of the platform', partial,
   'platform ' + spiky[0].w + 'px, spikes ' + spiky[0].spike.w + 'px');

/* landing on the teeth kills you; landing clear of them does not */
var sk8 = spiky[0];
placeOn(sk8.x + sk8.spike.off + 10, sk8.y);
step(4);
ok('landing on the spikes kills you', p.dead === true);

loadLevel(8); state.running = true;
sk8 = null;
for (var i = 0; i < level.sinkers.length; i++) {
  if (level.sinkers[i].spike) { sk8 = level.sinkers[i]; break; }
}
var clearX = sk8.spike.off === 0 ? sk8.x + sk8.w - SIZE - 6 : sk8.x + 6;
placeOn(clearX, sk8.y);
step(10);
ok('landing clear of them is fine', !p.dead,
   'stood at ' + Math.round(clearX) + ', teeth ' +
   (sk8.x + sk8.spike.off) + '..' + (sk8.x + sk8.spike.off + sk8.spike.w));

/* and the teeth ride down with the platform */
var teethAt = sk8.y;
step(90);
ok('a spiked platform sinks like the rest', sk8.y > teethAt + 20,
   'dropped ' + Math.round(sk8.y - teethAt) + 'px');
ok('the spikes go down with it - they are part of it',
   sk8.spike.off !== undefined && !p.dead);

WScript.Echo('');
WScript.Echo('[room eight: hitting the bottom]');
loadLevel(8); state.running = true;
var deep = level.sinkers[0];
placeOn(deep.x + 60, deep.y);
for (var i = 0; i < 600; i++) {
  step(1);
  if (p.dead) break;
}
ok('riding one all the way down does not kill you', !p.dead,
   'platform ended ' + Math.round(deep.y - deep.home) + 'px down');
ok('it stopped at its limit', Math.abs(deep.y - (deep.home + deep.max)) < 2,
   'at ' + Math.round(deep.y - deep.home) + 'px of ' + deep.max);
ok('the bottom is well clear of the drop', deep.home + deep.max < level.fallY - 60,
   'bottom at ' + (deep.home + deep.max) + ', you die past ' + level.fallY);

/* The way out of the bottom is to stop standing on it: hop in place and
   it climbs back while you're in the air. */
loadLevel(8); state.running = true;
var d2 = level.sinkers[0];
placeOn(d2.x + 40, d2.y);
for (var i = 0; i < 400 && d2.y < d2.home + d2.max - 1; i++) step(1);
var bottomY = d2.y;

for (var hop = 0; hop < 6; hop++) {
  release('Space'); tap('Space');
  for (var i = 0; i < 40; i++) {
    step(1);
    if (p.onGround) break;
  }
}
letGo();
ok('hopping lets a sunk platform climb back up', d2.y < bottomY - 40,
   'recovered ' + Math.round(bottomY - d2.y) + 'px of ' +
   Math.round(bottomY - d2.home));
ok('and you are still alive to do it', !p.dead);

WScript.Echo('');
WScript.Echo('[room eight: getting across]');
loadLevel(8); state.running = true;

/* every gap you must cross, in order, and what it takes */
var run8 = [];
for (var i = 0; i < level.solids.length; i++) run8.push(level.solids[i]);
run8.sort(function (a, b) { return a.x - b.x; });

var landables = [];
for (var i = 0; i < run8.length; i++) {
  if (!run8[i].spiked) landables.push(run8[i]);
}
/* These platforms sink as you walk them, so every take-off attempt has
   to start from a fresh room. Reusing one leaves it lower each try and
   eventually reports a perfectly good jump as impossible. */
function solidByX(x) {
  for (var k = 0; k < level.solids.length; k++) {
    if (level.solids[k].x === x) return level.solids[k];
  }
  return null;
}

function canReachSinking(fromX, toX, useDouble) {
  loadLevel(8);
  var edge = solidByX(fromX).x + solidByX(fromX).w;
  var timings = useDouble ? [true, 150, 300, 450] : [false];
  for (var m = 0; m < timings.length; m++) {
    for (var jx = edge - 150; jx <= edge + 6; jx += 6) {
      loadLevel(8);
      state.running = true;
      var a = solidByX(fromX), b = solidByX(toX);
      var sx = Math.max(a.x + 2, edge - 320);
      /* never start the run standing on the platform's own teeth */
      if (a.spike && sx < a.x + a.spike.off + a.spike.w + 4) {
        sx = a.x + a.spike.off + a.spike.w + 4;
      }
      var r = attempt(sx, a.y, jx, timings[m], 300);
      if (r.r === 'landed' && Math.abs(r.y - b.y) < 3 &&
          r.x + SIZE > b.x && r.x < b.x + b.w) {
        return true;
      }
    }
  }
  return false;
}

var allReach = true, worstGap = 0, gapReport = '', needDouble = 0;
for (var i = 0; i < landables.length - 1; i++) {
  var gp = landables[i + 1].x - (landables[i].x + landables[i].w);
  if (gp > worstGap) worstGap = gp;
  gapReport += Math.round(gp) + ' ';
  if (gp > 176) needDouble++;
  if (!canReachSinking(landables[i].x, landables[i + 1].x, true)) {
    allReach = false;
    gapReport += '(FAILED here) ';
  }
}
ok('every platform can be reached from the one before it', allReach,
   'gaps: ' + gapReport);
ok('most of them need a double jump',
   needDouble >= landables.length - 2,
   needDouble + ' of ' + (landables.length - 1) +
   ' gaps are past a single jump (176px)');

loadLevel(8); state.running = true;
placeOn(level.start.x, level.start.y + SIZE);
step(6);
ok('you do not start on something that is already sinking',
   Math.abs(level.sinkers[0].y - level.sinkers[0].home) < 1);

/* ==================================================================
   ROOM NINE — dash orbs over a bottomless drop
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room nine: the drop]');
loadLevel(9); state.running = true;
ok('the room loads', level.name === 'Room Nine');
ok('the platforms start lower than Room Eight', level.sinkers[0].home > 400,
   'top at ' + level.sinkers[0].home);
ok('they fall faster than Room Eight', level.sinkers[0].rate > 58,
   level.sinkers[0].rate + ' px/s');
ok('and they never stop', level.sinkers[0].max > 1000,
   'cap ' + level.sinkers[0].max);

/* stay on one and it takes you into the void in about three seconds */
var n1 = level.sinkers[0];
placeOn(n1.x + n1.w - 40, n1.y);
var secs = 0;
for (var i = 0; i < 600; i++) {
  step(1);
  secs += 0.016;
  if (p.dead) break;
}
ok('standing on one eventually kills you', p.dead === true);
ok('it takes about three seconds', secs > 2.4 && secs < 4.2,
   'died after ' + secs.toFixed(1) + 's');

WScript.Echo('');
WScript.Echo('[room nine: more spikes]');
loadLevel(9); state.running = true;
var spiked9 = 0;
for (var i = 0; i < level.sinkers.length; i++) {
  if (level.sinkers[i].spike) spiked9++;
}
ok('every sinking platform carries spikes', spiked9 === level.sinkers.length,
   spiked9 + ' of ' + level.sinkers.length);

WScript.Echo('');
WScript.Echo('[room nine: the dash orb]');
loadLevel(9); state.running = true;
ok('there is an orb for every gap', level.orbs.length === 6,
   level.orbs.length + ' orbs');
ok('the first one is right at the start', level.orbs[0].x < 500,
   'first orb at x=' + level.orbs[0].x);
ok('it is signposted', level.hints.length > 0 &&
   level.hints[0].small.indexOf('ORB') !== -1);

/* the orb only fires when you're in it */
placeOn(100, level.solids[0].y);
tap('Space');
ok('pressing jump away from an orb just jumps', p.dash === 0);

loadLevel(9); state.running = true;
var o9 = level.orbs[0];
p.x = o9.x - SIZE / 2; p.y = o9.y - SIZE / 2;
p.vx = 0; p.vy = 0; p.dead = false; p.onGround = false;
release('Space'); tap('Space');
ok('pressing jump inside an orb dashes instead', p.dash > 0,
   'dash ' + p.dash.toFixed(2) + 's');
p.dash = 0;
release('Space'); tap('Space');
ok('and there is no cooldown - it fires again at once', p.dash > 0);

var dashFrom = p.x, heldLevel = p.y;
for (var i = 0; i < 40 && p.dash > 0; i++) step(1);
ok('the dash throws you a long way forward', p.x - dashFrom > 300,
   'carried ' + Math.round(p.x - dashFrom) + 'px');
ok('and it is flat - no falling during it',
   Math.abs(p.y - heldLevel) < 6,
   'drifted ' + Math.round(p.y - heldLevel) + 'px');

WScript.Echo('');
WScript.Echo('[room nine: the gaps need it]');
loadLevel(9); state.running = true;
var plats9 = [];
for (var i = 0; i < level.solids.length; i++) plats9.push(level.solids[i]);
plats9.sort(function (a, b) { return a.x - b.x; });

var widest9 = 0, allWide = true;
for (var i = 0; i < plats9.length - 1; i++) {
  var g9 = plats9[i + 1].x - (plats9[i].x + plats9[i].w);
  if (g9 > widest9) widest9 = g9;
  if (g9 <= 349) allWide = false;
}
ok('every gap is past what any jump can reach', allWide,
   'widest ' + widest9 + 'px, best double jump is 349px');

/* prove it: no jump alone gets across the first gap */
loadLevel(9); state.running = true;
var jumpedIt = false;
for (var m = 0; m < 4 && !jumpedIt; m++) {
  var timing = [false, true, 150, 300][m];
  for (var jx = plats9[0].x + plats9[0].w - 200;
       jx <= plats9[0].x + plats9[0].w + 6 && !jumpedIt; jx += 8) {
    loadLevel(9); state.running = true;
    level.orbs.length = 0;                    // take the orbs away
    var r9 = attempt(40, plats9[0].y, jx, timing, 300);
    if (r9.r === 'landed' && r9.x > 600) jumpedIt = true;
  }
}
ok('with the orbs gone the first gap is impossible', !jumpedIt);

/* ...and with the orbs there, every single gap goes. This is the room's
   one load-bearing property: if any gap fails, it cannot be finished. */
function crossesWithOrb(gi) {
  for (var jx = -160; jx <= 8; jx += 6) {
    loadLevel(9); state.running = true;
    var a = null, b = null;
    for (var k = 0; k < level.solids.length; k++) {
      if (level.solids[k].x === plats9[gi].x) a = level.solids[k];
      if (level.solids[k].x === plats9[gi + 1].x) b = level.solids[k];
    }
    var edge = a.x + a.w;
    var sx = Math.max(a.x + (a.spike ? a.spike.w + 6 : 4), edge - 300);
    placeOn(sx, a.y);
    hold('ArrowRight');
    var jumped = false, dashed = false, made = false;
    for (var i = 0; i < 260; i++) {
      if (!jumped && p.x + p.w >= edge + jx) { tap('Space'); jumped = true; }
      else if (jumped && !dashed) {
        for (var q = 0; q < level.orbs.length; q++) {
          var oo = level.orbs[q];
          if (circleHitsBox(oo.x, oo.y, ORB_CATCH, p)) {
            release('Space'); tap('Space');
            if (p.dash > 0) dashed = true;
          }
        }
      }
      step(1);
      if (p.dead) break;
      if (jumped && p.onGround && p.x > b.x - 20) { made = dashed; break; }
    }
    letGo();
    if (made) return true;
  }
  return false;
}

var everyGap = true, gapWhich = '';
for (var i = 0; i < plats9.length - 1; i++) {
  if (!crossesWithOrb(i)) { everyGap = false; gapWhich += (i + 1) + ' '; }
}
ok('every gap can be crossed using its orb', everyGap,
   'failed on gap ' + gapWhich);

WScript.Echo('');
WScript.Echo('[room nine: the orb itself]');
loadLevel(9); state.running = true;
ok('the dash orb is the size it has always been', level.orbs[0].r === 17,
   'radius ' + level.orbs[0].r);
ok('and the catch is forgiving', ORB_CATCH > level.orbs[0].r,
   'catch radius ' + ORB_CATCH + ' around a ' + level.orbs[0].r + 'px ring');

WScript.Echo('');
WScript.Echo('[room nine: the saws at the end]');
loadLevel(9); state.running = true;
ok('there are saws between the last platforms', level.saws.length === 3,
   level.saws.length + ' saws');

var sawsLate = true;
for (var i = 0; i < level.saws.length; i++) {
  if (level.saws[i].x0 < level.worldW / 2) sawsLate = false;
}
ok('they are all in the back half of the room', sawsLate);

var inGaps = true;
for (var i = 0; i < level.saws.length; i++) {
  var sx9 = level.saws[i].x0;
  for (var k = 0; k < level.solids.length; k++) {
    var s9 = level.solids[k];
    if (sx9 > s9.x - 24 && sx9 < s9.x + s9.w + 24) inGaps = false;
  }
}
ok('they hang in the gaps, not over the platforms', inGaps);

/* the dash corridor must be blocked sometimes and clear at others */
var corridor = level.orbs[0].y + SIZE / 2;
for (var i = 0; i < level.saws.length; i++) {
  var sw9 = level.saws[i];
  var blockedEver = false, clearEver = false;
  for (var t0 = 0; t0 < sw9.period; t0 += 0.02) {
    state.t = t0;
    var at9 = sawPos(sw9);
    if (Math.abs(at9.y - corridor) < sw9.r + SIZE / 2) blockedEver = true;
    else clearEver = true;
  }
  ok('saw ' + (i + 1) + ' blocks the dash line some of the time', blockedEver);
  ok('saw ' + (i + 1) + ' leaves it clear some of the time', clearEver);
}


/* ==================================================================
   ROOM TEN — every trick the orb has, in one room
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room ten: the room]');
loadLevel(10); state.running = true;
ok('the room loads', level.name === 'Room Ten');
ok('it sits where Room Ten should', levelIndex === 10);
ok('the pads sag faster than Room Nine', level.sinkers[0].rate > 78,
   level.sinkers[0].rate + ' px/s');
ok('and they never stop either', level.sinkers[0].max > 1000);

var shelfTen = solidByX(2350);
ok('the shelf in the middle is solid', shelfTen !== null);
var shelfCovered = false;
for (var i = 0; i < level.hazards.length; i++) {
  var hz = level.hazards[i];
  if (hz.x <= shelfTen.x && hz.x + hz.w >= shelfTen.x + shelfTen.w) {
    shelfCovered = true;
  }
}
ok('and every inch of it is teeth - you cannot land there', shelfCovered);

WScript.Echo('');
WScript.Echo('[room ten: letting go of the dash]');

/* fire the first orb and ride the dash for `hold` seconds, then let go */
function dashFor(holdFor) {
  loadLevel(10); state.running = true;
  var o = level.orbs[0];
  p.x = o.x - SIZE / 2; p.y = o.y - SIZE / 2;
  p.vx = 0; p.vy = 0; p.dead = false; p.onGround = false;
  p.face = 1;
  release('Space'); tap('Space');
  var from = p.x, spent = 0;
  for (var i = 0; i < 60 && p.dash > 0; i++) {
    if (spent >= holdFor) release('Space');
    step(1);
    spent += 0.016;
  }
  release('Space');
  return p.x - from;
}

var fullDash = dashFor(99);
var shortDash = dashFor(0.14);
ok('riding the dash out carries you the full length', fullDash > 330,
   Math.round(fullDash) + 'px');
ok('letting go early cuts it short', shortDash < fullDash - 120,
   Math.round(shortDash) + 'px vs ' + Math.round(fullDash) + 'px');
ok('but an early release still moves you somewhere', shortDash > 60,
   Math.round(shortDash) + 'px');

WScript.Echo('');
WScript.Echo('[room ten: every gap goes]');

var landTen = [-60, 1000, 1610, 2110, 2640, 3570, 4180];

/* One honest attempt at a gap: sprint right, jump as the lip goes by,
   fire every orb you touch, and let go of the dash after `cut` seconds
   (99 = ride it out). */

/* Is there another live orb straight ahead, close enough to fly into?
   While there is, a player rides the dash out rather than cutting it.
   `limitX` is the platform being aimed at: an orb sitting past it
   belongs to the next gap, and letting it talk you out of cutting is
   how you sail over a short landing. */
function orbOnTheLine(limitX) {
  for (var q = 0; q < level.orbs.length; q++) {
    var oo = level.orbs[q];
    if (oo.x > p.x + p.w && oo.x < p.x + 380 &&
        (limitX === undefined || oo.x < limitX) &&
        Math.abs(oo.y - (p.y + SIZE / 2)) < 60) return true;
  }
  return false;
}
/* Which room these gap-crossers work in, and whether the room's own
   safety net is allowed to help. */
var GAPLVL   = 10;
var NORESCUE = false;
/* Room Eleven's wave now runs right to the lip, so there is no fixed
   spot to start a gap attempt from — you arrive at the edge riding it.
   Crossing the wave is its own test; with NOWAVE set, these ones ask
   only whether the jump itself is there once you reach the edge. */
var NOWAVE   = false;

function tenRun(fromX, toX, jx, cut, t0, sxAt) {
  loadLevel(GAPLVL); state.running = true;
  if (NORESCUE) level.rescue = null;
  if (NOWAVE) level.waves = [];
  var aT = solidByX(fromX), bT = solidByX(toX);
  var edge = aT.x + aT.w;
  var sx = sxAt !== undefined ? sxAt
           : Math.max(safeStrip(aT).lo, edge - 340);
  placeOn(sx, aT.y);
  state.t = t0 || 0;              /* blades do not care when you arrive */
  hold('ArrowRight');
  var jumped = false, dashes = 0, spent = 0;
  for (var i = 0; i < 420; i++) {
    if (!jumped && p.x + p.w >= edge + jx) { tap('Space'); jumped = true; }
    else if (jumped) {
      var fired = false;
      for (var q = 0; q < level.orbs.length; q++) {
        var oo = level.orbs[q];
        if (circleHitsBox(oo.x, oo.y, ORB_CATCH, p)) {
          release('Space'); tap('Space');
          if (p.dash > 0) { dashes++; spent = 0; fired = true; }
        }
      }
      if (!fired && p.dash > 0 && spent >= cut && !orbOnTheLine(bT.x)) {
        release('Space');           /* nothing left to chain into */
      }
    }
    step(1);
    if (p.dash > 0) spent += 0.016;
    if (p.dead) { letGo(); return { r: 'died', n: dashes }; }
    if (jumped && p.onGround) {
      letGo();
      return { r: 'landed', x: p.x, y: p.y + p.h, n: dashes, on: standingOnX() };
    }
  }
  letGo();
  return { r: 'stuck', n: dashes };
}

/* Which solid you are actually standing on, asked while you are still
   standing on it. A pad has sunk by the time you land, so its y is no
   longer the one the builder handed out — only its x still says who
   it is. */
function standingOnX() {
  for (var k = 0; k < level.solids.length; k++) {
    var s = level.solids[k];
    if (Math.abs((p.y + p.h) - s.y) > 4) continue;
    if (p.x + p.w > s.x && p.x < s.x + s.w) return s.x;
  }
  return null;
}

function landedOn(r, toX) {
  return r.r === 'landed' && r.on === toX;
}

var CUTS = [99, 0.08, 0.11, 0.14, 0.17, 0.20, 0.23, 0.26, 0.30, 0.34, 0.40];
var ARRIVE = [0, 0.25, 0.5, 0.75, 1.0, 1.25];   /* when you reach the lip */

/* Where on a pad you might be standing when you start the next gap.
   This matters because the pads sag under you: dawdle at the back of
   one and it has dropped far enough that the orb is out of reach by
   the time you jump. You arrive on a pad from a dash, near its far
   end, and you go again straight away — so try there first and work
   backwards towards the teeth. */
/* The strip of a platform you can actually stand on: past the near
   teeth, and short of the far ones where a platform has both. */
function safeStrip(s) {
  var lo = s.x + 4, hi = s.x + s.w - SIZE - 4;
  var bed = teethOf(s);
  for (var i = 0; i < bed.length; i++) {
    var tl = s.x + bed[i].off, tr = tl + bed[i].w;
    if (tl <= s.x + 1) lo = Math.max(lo, tr + 6);        // near-lip bed
    else hi = Math.min(hi, tl - SIZE - 6);               // far-lip bed
  }
  return { lo: lo, hi: Math.max(lo, hi) };
}

function startSpots(fromX) {
  var aT = solidByX(fromX);
  var strip = safeStrip(aT);
  var hi = Math.max(strip.lo, Math.min(strip.hi, aT.x + aT.w - 60));
  var out = [];
  for (var f = 0; f < 5; f++) out.push(hi - (hi - strip.lo) * (f / 4));
  return out;
}

function tenGapGoes(fromX, toX, sxAt) {
  loadLevel(GAPLVL);
  var spots = sxAt !== undefined ? [sxAt] : startSpots(fromX);
  for (var si = 0; si < spots.length; si++) {
    for (var jx = -160; jx <= 8; jx += 20) {
      for (var c = 0; c < CUTS.length; c++) {
        for (var ti = 0; ti < ARRIVE.length; ti++) {
          var r = tenRun(fromX, toX, jx, CUTS[c], ARRIVE[ti], spots[si]);
          if (landedOn(r, toX)) {
            return { ok: true, cut: CUTS[c], jx: jx, n: r.n,
                     t: ARRIVE[ti], sx: Math.round(spots[si]) };
          }
        }
      }
    }
  }
  return { ok: false };
}

var tenAll = true;
for (var i = 0; i < landTen.length - 1; i++) {
  var res = tenGapGoes(landTen[i], landTen[i + 1]);
  var gapW = 0;
  loadLevel(10);
  gapW = solidByX(landTen[i + 1]).x -
         (solidByX(landTen[i]).x + solidByX(landTen[i]).w);
  ok('gap ' + (i + 1) + ' (' + gapW + 'px) can be crossed', res.ok,
     'no jump, dash or release timing lands it');
  if (!res.ok) tenAll = false;
}
ok('so the room can actually be finished', tenAll);
WScript.Echo('');

/* ==================================================================
   ROOM ELEVEN — the mixture, and the gap that needs somebody else
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room eleven: the room]');
loadLevel(11); state.running = true;
ok('the room loads', level.name === 'Room Eleven');
ok('it sits where Room Eleven should', levelIndex === 11);
ok('it has all four of the hazards the game owns, at once',
   level.waves.length > 0 && level.saws.length > 0 &&
   level.orbs.length > 0 && level.sinkers.length > 0,
   level.waves.length + ' beds, ' + level.saws.length + ' blades, ' +
   level.orbs.length + ' orbs, ' + level.sinkers.length + ' pads');

var g11 = solidByX(-60);
ok('you start on solid ground, not on a pad',
   g11 !== null && level.start.y + SIZE === g11.y);
ok('the pads sit on the floor own line, so the wave reads right',
   level.sinkers[0].y === g11.y && g11.y === GROUND);

var shelf11 = solidByX(2990);
ok('the shelf in the middle is solid', shelf11 !== null);
var covered11 = false;
for (var i = 0; i < level.hazards.length; i++) {
  var hz11 = level.hazards[i];
  if (hz11.x <= shelf11.x && hz11.x + hz11.w >= shelf11.x + shelf11.w) {
    covered11 = true;
  }
}
ok('and every inch of it is teeth - there is no landing on it', covered11);

/* the pads are meaner from here on than they were in Room Ten */
var tenRate = BUILDERS[10]().sinkers[0].rate;
ok('the pads sag faster than Room Ten\'s did',
   level.sinkers[0].rate > tenRate * 1.25,
   level.sinkers[0].rate + ' px/s vs Room Ten\'s ' + tenRate);
ok('and they still never stop', level.sinkers[0].max > 1000);

/* ---------------- part one: the ground, and what is on it -------- */
WScript.Echo('');
WScript.Echo('[room eleven: the gate]');

/* Two blades with a bed of floor spikes between them. There is nowhere
   to stand in the middle, so the whole thing is one jump — and it is
   further than one jump goes. */
var gate11 = null;
for (var i = 0; i < level.hazards.length; i++) {
  if (level.hazards[i].x < 1000) gate11 = level.hazards[i];
}
ok('there are spikes on the floor between the first two blades',
   gate11 !== null && gate11.x > level.saws[0].x0 &&
   gate11.x + gate11.w < level.saws[1].x0,
   gate11 ? 'spikes ' + gate11.x + '..' + (gate11.x + gate11.w) +
            ', blades at ' + level.saws[0].x0 + ' and ' + level.saws[1].x0 : 'none');
ok('the two blades swing on different beats', level.saws[0].period !==
   level.saws[1].period);

/* the span you must clear in one go, and what your legs actually do */
var gateFrom = level.saws[0].x0 + 18;          // past the first blade
var gateTo   = level.saws[1].x0 + 18;          // past the second
ok('clearing it needs more than one jump',
   gateTo - gateFrom > 176 && gateTo - gateFrom < 288,
   (gateTo - gateFrom) + 'px; one jump carries 176, two carry 288');

/* Take the gate: run at it and leap, spending the second jump at the
   top. The blades sweep from well overhead down to the floor, so what
   you are waiting for is both of them hanging LOW — a double jump flies
   over a blade that is down, and there is no getting past one that is
   halfway. A player finds that window by dying at it; the bot finds it
   by trying every moment in a whole cycle of both blades. */
function takeTheGate(t0, fromX, useDouble) {
  loadLevel(11); state.running = true;
  var g = solidByX(-60);
  placeOn(fromX, g.y);
  state.t = t0;
  hold('ArrowRight');
  var jumped = false, second = false;
  for (var i = 0; i < 300; i++) {
    if (!jumped && p.onGround) { tap('Space'); jumped = true; }
    else if (jumped && !second && useDouble && p.vy > -80) {
      release('Space'); tap('Space'); second = true;
    }
    step(1);
    if (p.dead) { letGo(); return 'died at x=' + Math.round(p.x); }
    if (p.onGround && jumped) {
      letGo();
      return p.x > gateTo ? 'ok' : 'short at x=' + Math.round(p.x);
    }
  }
  letGo();
  return 'stuck at x=' + Math.round(p.x);
}

/* sweep a whole cycle of both blades, and a few take-off points */
function gateGoes(useDouble) {
  for (var t = 0; t < 6.0; t += 0.1) {
    for (var fx = 120; fx <= 170; fx += 10) {
      if (takeTheGate(t, fx, useDouble) === 'ok') {
        return 't=' + t.toFixed(1) + ' from x=' + fx;
      }
    }
  }
  return '';
}

var gateDbl = gateGoes(true);
var gateSgl = gateGoes(false);
ok('a double jump gets you through the gate', gateDbl !== '',
   'no moment in a whole cycle of both blades lets you through');
ok('and a single jump never does', gateSgl === '',
   'one jump cleared it at ' + gateSgl);

/* ---------------- the wave ---------------------------------------- */
WScript.Echo('');
WScript.Echo('[room eleven: riding the wave off the edge]');

loadLevel(11);
var nogap11 = '';
for (var i = 0; i < level.waves.length - 1; i++) {
  if (Math.abs((level.waves[i].x + level.waves[i].w) -
               level.waves[i + 1].x) > 0.01) {
    nogap11 = 'gap after bed ' + i;
  }
}
ok('the wave is one unbroken carpet', nogap11 === '', nogap11);

/* one tooth to a bed here too */
var fatBed11 = '';
for (var i = 0; i < level.waves.length; i++) {
  if (level.waves[i].w > 45) fatBed11 = level.waves[i].w + 'px wide';
}
ok('each bed of it is a single spike', fatBed11 === '', fatBed11);

var fw11 = level.waves[0], lw11 = level.waves[level.waves.length - 1];
ok('it starts past the gate', fw11.x > level.saws[1].x0 + 40,
   'gate blade at ' + level.saws[1].x0 + ', spikes from ' + fw11.x);
ok('and now runs all the way to the lip - no run-up at the end',
   Math.abs((lw11.x + lw11.w) - (g11.x + g11.w)) < 2,
   'spikes end ' + (lw11.x + lw11.w) + ', lip at ' + (g11.x + g11.w));

var stuckUp11 = '';
for (var i = 0; i < level.waves.length; i++) {
  var down11 = 0;
  for (var s = 0; s < 460; s++) {
    state.t = s * 0.01;
    if (waveOut(level.waves[i]) <= 0.02) down11++;
  }
  if (down11 < 180) stuckUp11 = 'bed ' + i + ' down only ' + down11 + '/460';
}
ok('every bed is down for about half the time', stuckUp11 === '', stuckUp11);

/* Which bed of the wave covers a given x, if any. */
function bedAt(x) {
  for (var k = 0; k < level.waves.length; k++) {
    var wv = level.waves[k];
    if (x >= wv.x && x < wv.x + wv.w) return wv;
  }
  return null;
}

/* Standing at the near edge, reading it: if you set off now and keep
   running, is every bed still down as you reach it? That is the whole
   skill of the beat — the wave rolls right at about the speed you run,
   so leaving on the right beat carries you the length of it. */
function waveRunClear() {
  var was = state.t, clear = true;
  for (var k = 0; k < level.waves.length && clear; k++) {
    var wv = level.waves[k];
    var tIn  = (wv.x - (p.x + SIZE)) / MOVE_SPD;
    var tOut = (wv.x + wv.w - p.x) / MOVE_SPD;
    for (var s = Math.max(0, tIn); s <= tOut; s += 0.04) {
      state.t = was + s;
      if (waveOut(wv) > 0.02) { clear = false; break; }
    }
  }
  state.t = was;
  return clear;
}

var stepPh = ((level.waves[0].phase - level.waves[1].phase) % 1 + 1) % 1;
var waveSpd = level.waves[0].w / (stepPh * level.waves[0].period);
ok('the wave rolls rightwards, at about the speed you run',
   Math.abs(waveSpd - MOVE_SPD) < 60,
   Math.round(waveSpd) + ' px/s vs your ' + MOVE_SPD + ' px/s');

/* Ride it: from the clear strip between the gate and the spikes, wait
   for a clean read and then run the whole length without stopping. */
function rideTheWave(t0) {
  loadLevel(11); state.running = true;
  var g = solidByX(-60);
  var first = level.waves[0];
  placeOn(level.saws[1].x0 + 30, g.y);
  state.t = t0;
  var running = false;
  for (var i = 0; i < 1600; i++) {
    if (p.x + SIZE > first.x + 8) running = true;
    release('ArrowRight'); release('Space');
    if (running || waveRunClear()) hold('ArrowRight');
    step(1);
    if (p.dead) { letGo(); return 'died at x=' + Math.round(p.x); }
    if (p.x + SIZE >= g.x + g.w - 2) { letGo(); return 'ok'; }
  }
  letGo();
  return 'stuck at x=' + Math.round(p.x);
}

var rodeAt = '', rideNote = '';
for (var i = 0; i < 26 && rodeAt === ''; i++) {
  var rr11 = rideTheWave(i * 0.2);
  if (rr11 === 'ok') rodeAt = 't=' + (i * 0.2).toFixed(1);
  else rideNote = 'from t=' + (i * 0.2).toFixed(1) + ': ' + rr11;
}
ok('the wave carries you the whole way to the lip', rodeAt !== '', rideNote);

/* ---------------- part two: the gaps you are meant to cross ------ */
WScript.Echo('');
WScript.Echo('[room eleven: the gaps you are meant to cross]');
GAPLVL = 11;

/* Reaching the lip is the wave's test, above. These ask the separate
   question of whether the jump is there once you are standing on it. */
NOWAVE = true;
var land11 = [-60, 1780, 2730, 3250];
var starts11 = [1300, undefined, undefined];
var all11 = true;
for (var i = 0; i < land11.length - 1; i++) {
  loadLevel(11);
  var a11 = solidByX(land11[i]), b11 = solidByX(land11[i + 1]);
  var gw11 = b11.x - (a11.x + a11.w);
  var r11 = tenGapGoes(land11[i], land11[i + 1], starts11[i]);
  ok('gap ' + (i + 1) + ' (' + gw11 + 'px) can be crossed', r11.ok,
     'no jump, dash or release timing lands it');
  if (!r11.ok) all11 = false;
}
ok('so everything up to the last pad goes on your own', all11);

/* ---- and the last pad is the one with teeth at both ends ---- */
WScript.Echo('');
WScript.Echo('[room eleven: letting go at the right moment]');
loadLevel(11);
var lastPad11 = solidByX(3250);
var bed11 = teethOf(lastPad11);
ok('the last pad has teeth at both ends', bed11.length === 2,
   bed11.length + ' bed(s)');
var strip11 = safeStrip(lastPad11);
ok('which leaves only a strip in the middle to land on',
   strip11.hi > strip11.lo && strip11.hi - strip11.lo < 100,
   Math.round(strip11.hi - strip11.lo) + 'px of landing, on a ' +
   lastPad11.w + 'px pad');

/* Riding the dash all the way out has to sail into the far teeth, or
   letting go early is not a skill the room is asking for. */
var rodeOutLands = false, spots11 = startSpots(2730);
for (var si = 0; si < spots11.length && !rodeOutLands; si++) {
  for (var jx = -160; jx <= 8 && !rodeOutLands; jx += 20) {
    for (var ti = 0; ti < ARRIVE.length; ti++) {
      var full11 = tenRun(2730, 3250, jx, 99, ARRIVE[ti], spots11[si]);
      if (landedOn(full11, 3250)) { rodeOutLands = true; break; }
    }
  }
}
ok('riding the dash all the way out overshoots into the far teeth',
   !rodeOutLands, 'it lands cleanly without ever letting go');

var cut11 = tenGapGoes(2730, 3250);
ok('and letting go early does land it', cut11.ok && cut11.cut !== 99,
   cut11.ok ? 'landed with cut=' + cut11.cut : 'nothing lands it at all');
NOWAVE = false;

/* ---------------- part three: the gap that is not a gap ---------- */
WScript.Echo('');
WScript.Echo('[room eleven: the gap that is not a gap]');
loadLevel(11);
var pad11 = solidByX(3250), end11 = solidByX(4700);
var lastGap11 = end11.x - (pad11.x + pad11.w);
ok('the last gap is far past anything you own', lastGap11 > 1000,
   lastGap11 + 'px');

var past11 = [];
for (var i = 0; i < level.orbs.length; i++) {
  if (level.orbs[i].x > pad11.x + pad11.w) past11.push(level.orbs[i]);
}
ok('there is exactly one orb in it', past11.length === 1,
   past11.length + ' orbs');
ok('and it sits exactly where every other orb in the room sat',
   past11.length === 1 && past11[0].x - (pad11.x + pad11.w) === 160,
   past11.length === 1
     ? (past11[0].x - (pad11.x + pad11.w)) + 'px past the lip'
     : '');
ok('nothing marks it out - no hint, no arrow',
   level.hints.length === 0 && level.arrows.length === 0);

/* with the net taken away, nothing the player has crosses it */
NORESCUE = true;
var tried11 = tenGapGoes(3250, 4700);
NORESCUE = false;
ok('and on your own it cannot be crossed', !tried11.ok,
   'crossed it with cut=' + tried11.cut + ' jx=' + tried11.jx);

/* ---------------- and somebody catches you ----------------------- */
WScript.Echo('');
WScript.Echo('[room eleven: somebody catches you]');

loadLevel(11); state.running = true;
p.x = pad11.x + pad11.w + 60;
p.y = pad11.y - 12;
p.vx = 260; p.vy = 0;
p.onGround = false; p.dead = false;

var saw11 = {}, fellTo11 = 0;
for (var i = 0; i < 600; i++) {
  step(1);
  saw11[level.rescue.phase] = true;
  if (p.y > fellTo11) fellTo11 = p.y;
  if (level.rescue.phase === 'leaving' || level.rescue.phase === 'done') break;
}
ok('you get a moment of falling first', fellTo11 > pad11.y + 60,
   'fell to y=' + Math.round(fellTo11));
ok('he comes up out of the dark and gets you', saw11['swoop'] === true);
ok('and carries you across', saw11['carry'] === true);
ok('you are alive at the end of it', !p.dead);
ok('and standing on the far side',
   p.onGround && p.x >= end11.x && p.x + SIZE <= end11.x + end11.w &&
   Math.abs(p.y + SIZE - end11.y) < 2,
   'x=' + Math.round(p.x) + ' y=' + Math.round(p.y));
ok('set down short of the door, so you still walk the last bit',
   p.x + SIZE < level.door.x,
   'you at ' + Math.round(p.x) + ', door at ' + level.door.x);
ok('he lets go once you are down', !rescueHolding());
ok('and never has to do it twice', level.rescue.phase !== 'waiting');

hold('ArrowRight');
for (var i = 0; i < 500 && !state.complete; i++) step(1);
letGo();
ok('you can walk from where he put you to the door out', state.complete);

/* the net is under that one gap and nowhere else */
loadLevel(11); state.running = true;
p.x = 2300; p.y = 470; p.vx = 0; p.vy = 300;
p.onGround = false; p.dead = false;
for (var i = 0; i < 300 && !p.dead; i++) step(1);
ok('falling anywhere earlier in the room still kills you',
   p.dead && level.rescue.phase === 'waiting');

loadLevel(11); state.running = true;
placeOn(pad11.x + 100, pad11.y);      // in the strip between the teeth
for (var i = 0; i < 400 && !p.dead; i++) step(1);
ok('and standing still on the last pad rides it down to nothing, same as ever',
   p.dead && level.rescue.phase === 'waiting',
   'phase=' + level.rescue.phase + ' dead=' + p.dead);

/* ---------------- the green fellow ------------------------------- */
WScript.Echo('');
WScript.Echo('[the green fellow]');
loadLevel(5);
ok('in Room Five he is the same size and shape as you are',
   level.npc.w === SIZE && level.npc.h === SIZE,
   level.npc.w + 'x' + level.npc.h + ' vs your ' + SIZE + 'x' + SIZE);
ok('and stands on the floor rather than in it',
   level.npc.y + level.npc.h === GROUND);
loadLevel(11);
ok('the one who catches you is that same cube again',
   level.rescue.w === SIZE && level.rescue.h === SIZE);
ok('and he says the one thing', level.rescue.line === 'Up you go!',
   level.rescue.line);

/* ==================================================================
   ROOM TWELVE — the two launcher rings
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room twelve: the room]');
loadLevel(12); state.running = true;
ok('the room loads', level.name === 'Room Twelve');
ok('it is room twelve',
   levelIndex === 12);

var kinds12 = { dash: 0, up: 0, high: 0 };
for (var i = 0; i < level.orbs.length; i++) {
  kinds12[level.orbs[i].kind || 'dash']++;
}
ok('there are rings of all three kinds',
   kinds12.dash > 0 && kinds12.up > 0 && kinds12.high > 0,
   kinds12.dash + ' dash, ' + kinds12.up + ' yellow, ' + kinds12.high + ' red');
ok('three reds stand between you and the key', level.enemies.length === 3);
ok('and the door wants that key', level.door.needs === 'key');
ok('nothing is explained - no hint, no arrow',
   level.hints.length === 0 && level.arrows.length === 0);

/* ---------------- what the rings actually do --------------------- */
WScript.Echo('');
WScript.Echo('[room twelve: what the rings do]');

/* Stand still, put one ring right on top of you, and press jump. */
function launchRise(kind) {
  loadLevel(12); state.running = true;
  placeOn(100, GROUND);
  level.orbs = [{ x: p.x + SIZE / 2, y: p.y + SIZE / 2,
                  r: ORB_R_LAUNCH, kind: kind }];
  var y0 = p.y, best = p.y;
  release('Space'); tap('Space');
  for (var i = 0; i < 200; i++) {
    step(1);
    if (p.y < best) best = p.y;
    if (i > 4 && p.onGround) break;
  }
  letGo();
  return Math.round(y0 - best);
}

/* The same, with no ring and both jumps spent as well as they can be. */
function doubleRise() {
  loadLevel(12); state.running = true;
  placeOn(100, GROUND);
  level.orbs = [];
  var y0 = p.y, best = p.y, used = false;
  release('Space'); tap('Space');
  for (var i = 0; i < 200; i++) {
    if (!used && !p.onGround && p.vy > -60) {
      release('Space'); tap('Space'); used = true;
    }
    step(1);
    if (p.y < best) best = p.y;
    if (i > 4 && p.onGround) break;
  }
  letGo();
  return Math.round(y0 - best);
}

/* The lift off a standing start is only half the story: the rings are
   hung to be taken in mid-air, so what you can actually get up to is a
   jump PLUS the ring. That is the sum the shelves are cut against. */
function reachWith(kind) {
  loadLevel(12); state.running = true;
  placeOn(100, GROUND);
  level.orbs = [];
  var y0 = p.y, best = p.y, fired = false;
  release('Space'); tap('Space');
  for (var i = 0; i < 200; i++) {
    if (!fired && !p.onGround && p.vy > -60) {
      level.orbs = [{ x: p.x + SIZE / 2, y: p.y + SIZE / 2,
                      r: ORB_R_LAUNCH, kind: kind }];
      release('Space'); tap('Space');
      fired = true;
    }
    step(1);
    if (p.y < best) best = p.y;
    if (i > 4 && p.onGround) break;
  }
  letGo();
  return Math.round(y0 - best);
}

var rise2 = doubleRise(), riseUp = launchRise('up'), riseHi = launchRise('high');
var reachUp = reachWith('up'), reachHi = reachWith('high');
ok('a yellow ring lifts you better than twice as high as a jump',
   riseUp > 200, riseUp + 'px of lift');
ok('and a red one better than half as high again as the yellow',
   riseHi > riseUp * 1.5, riseHi + 'px vs the yellow\'s ' + riseUp + 'px');
ok('so jumping into a yellow gets you past what two jumps reach',
   reachUp > rise2 + 80,
   reachUp + 'px up vs a double jump\'s ' + rise2 + 'px');
ok('and jumping into a red gets you past what the yellow reaches',
   reachHi > reachUp + 120,
   reachHi + 'px up vs the yellow\'s ' + reachUp + 'px');
ok('a dash ring still goes flat, not up', launchRise('dash') < 8,
   launchRise('dash') + 'px of lift');

/* Where they hang is the tell: yellow up where a jump tops out, red
   down at knee height, because red from an apex would go off the top
   of the screen. */
loadLevel(12);
var jumpTop = GROUND - SIZE - rise2 / 2;    // roughly one jump's apex
var hangOk = '';
for (var i = 0; i < level.orbs.length; i++) {
  var o12 = level.orbs[i];
  if (o12.kind === 'high' && o12.y < GROUND - 120) {
    hangOk = 'a red ring hangs at y=' + o12.y;
  }
  if (o12.kind === 'up' && o12.y > GROUND - 100) {
    hangOk = 'a yellow ring hangs at y=' + o12.y;
  }
}
ok('every red ring hangs low and every yellow one hangs high',
   hangOk === '', hangOk);

/* and firing one hands your air jump back, same as a dash ring */
loadLevel(12); state.running = true;
placeOn(100, GROUND);
level.orbs = [{ x: 240, y: GROUND - 40, r: ORB_R_LAUNCH, kind: 'high' }];
p.airJumps = 0;
p.x = 225; p.y = GROUND - SIZE;
release('Space'); tap('Space');
step(1);
ok('firing one hands your air jump back', p.airJumps === 1);
letGo();

/* Stand in a low ring and press jump over and over: it launches you
   every single time. Nothing is spent, nothing is counting down. */
loadLevel(12); state.running = true;
placeOn(100, GROUND);
level.orbs = [{ x: 115, y: GROUND - 10, r: ORB_R_LAUNCH, kind: 'high' }];
var fires = 0, presses = 0;
for (var i = 0; i < 700; i++) {
  if (p.onGround) {
    presses++;
    release('Space'); tap('Space');
    if (p.vy <= -HIGH_V + 1) fires++;     // a launch, not an ordinary jump
  }
  step(1);
}
letGo();
ok('a ring fires every time you press jump inside it',
   presses > 2 && fires === presses,
   fires + ' launches out of ' + presses + ' presses');

/* and firing one never dims it - there is no spent state to draw */
loadLevel(12); state.running = true;
var noSpent = true;
for (var i = 0; i < level.orbs.length; i++) {
  if ('spent' in level.orbs[i] || 'cool' in level.orbs[i]) noSpent = false;
}
ok('and a ring carries no cooldown of any kind', noSpent);

/* the launcher rings are the small ones */
loadLevel(12);
var bigLaunch = '';
for (var i = 0; i < level.orbs.length; i++) {
  var o12r = level.orbs[i];
  if (o12r.kind !== 'dash' && o12r.r * 2 >= SIZE) {
    bigLaunch = 'a ' + o12r.kind + ' ring is ' + o12r.r * 2 + 'px across';
  }
  if (o12r.kind === 'dash' && o12r.r !== 17) {
    bigLaunch = 'the dash ring was shrunk to ' + o12r.r;
  }
}
ok('the launchers are smaller than the cube and the dash ring is not',
   bigLaunch === '', bigLaunch);

/* ---------------- the shelves ------------------------------------ */
WScript.Echo('');
WScript.Echo('[room twelve: two shelves your legs cannot reach]');

/* Rings have no cooldown, so pressing jump on every frame you are
   inside one would fire it over and over. A player takes each ring
   once on the way past, and that is what these runs count. */
var used12 = {};
function fireAnyOrb12() {
  for (var q = 0; q < level.orbs.length; q++) {
    var o = level.orbs[q];
    if (used12['x' + o.x]) continue;
    if (circleHitsBox(o.x, o.y, ORB_CATCH, p)) {
      used12['x' + o.x] = true;
      release('Space'); tap('Space');
      return true;
    }
  }
  return false;
}

/* One attempt: run right, jump as the lip goes by, fire every ring you
   touch, and spend the second jump at the top. `only` keeps just one
   kind of ring, so we can ask what yellow alone would manage; `drop`
   names a single ring to take away. */
function twelveRun(fromX, toX, jx, only, drop) {
  loadLevel(12); state.running = true;
  if (only !== undefined) {
    var keep = [];
    for (var q = 0; q < level.orbs.length; q++) {
      var oq = level.orbs[q];
      if (only !== null && oq.kind === only) keep.push(oq);
      else if (only === null) continue;
    }
    level.orbs = keep;
  }
  if (drop !== undefined) {
    var rest = [];
    for (var q = 0; q < level.orbs.length; q++) {
      if (level.orbs[q].x !== drop) rest.push(level.orbs[q]);
    }
    level.orbs = rest;
  }
  used12 = {};
  var a = solidByX(fromX);
  var edge = a.x + a.w;
  placeOn(Math.max(a.x + 4, edge - 320), a.y);
  hold('ArrowRight');
  var jumped = false, used2 = false, air = false, fired = 0;
  for (var i = 0; i < 900; i++) {
    if (fireAnyOrb12()) { jumped = true; fired++; }
    else if (!jumped && p.x + p.w >= edge + jx) { tap('Space'); jumped = true; }
    else if (jumped && !used2 && !p.onGround && p.vy > -60) {
      release('Space'); tap('Space'); used2 = true;
    }
    step(1);
    if (!p.onGround) air = true;
    if (p.dead) { letGo(); return { r: 'died', n: fired }; }
    if (jumped && air && p.onGround) {
      letGo();
      return { r: 'landed', x: p.x, on: standingOnX(), n: fired };
    }
  }
  letGo();
  return { r: 'stuck', n: fired };
}

function twelveGoes(fromX, toX, only, drop) {
  for (var jx = -200; jx <= 10; jx += 10) {
    var r = twelveRun(fromX, toX, jx, only, drop);
    if (r.r === 'landed' && r.on === toX) return { ok: true, n: r.n, jx: jx };
  }
  return { ok: false };
}

var b1 = twelveGoes(-60, 300);
ok('the first shelf goes, with the yellow ring', b1.ok);
ok('and not on your legs alone', !twelveGoes(-60, 300, null).ok);

var b2 = twelveGoes(520, 760);
ok('the second shelf goes, with the red one', b2.ok);
ok('a yellow ring would not have reached it',
   !twelveGoes(520, 760, 'up').ok);
ok('and neither do your legs', !twelveGoes(520, 760, null).ok);

/* the shelves really are past what you can jump */
loadLevel(12);
var shelfB12 = solidByX(300), shelfD12 = solidByX(760);
ok('the first shelf is higher than a double jump gets',
   GROUND - shelfB12.y > rise2, (GROUND - shelfB12.y) + 'px up vs ' +
   rise2 + 'px of jump');
ok('and the second is higher than a yellow ring gets',
   GROUND - shelfD12.y > riseUp, (GROUND - shelfD12.y) + 'px up vs ' +
   riseUp + 'px of yellow');

/* ---------------- the chain -------------------------------------- */
WScript.Echo('');
WScript.Echo('[room twelve: dash, red, yellow, red]');

loadLevel(12);
var chainGap = solidByX(2630).x - (solidByX(1010).x + solidByX(1010).w);
ok('there is nothing at all underneath for ' + chainGap + 'px',
   chainGap > 1200, chainGap + 'px');

var chain12 = twelveGoes(1010, 2630);
ok('the chain carries you across it', chain12.ok);
ok('and it takes every one of the four rings to do it',
   chain12.ok && chain12.n === 4, chain12.ok ? chain12.n + ' rings fired' : '');
ok('with nothing but your legs you are gone',
   !twelveGoes(1010, 2630, null).ok);

/* take any single ring out of the chain and the crossing dies */
var chainX = [1390, 1810, 2160, 2500];
var survived = '';
for (var i = 0; i < chainX.length; i++) {
  if (twelveGoes(1010, 2630, undefined, chainX[i]).ok) {
    survived += chainX[i] + ' ';
  }
}
ok('miss any one of them and there is no recovering', survived === '',
   'crossed it anyway without the ring at ' + survived);

/* ---------------- the reds, the key, the way out ----------------- */
WScript.Echo('');
WScript.Echo('[room twelve: the key and the way out]');

loadLevel(12); state.running = true;
var floorG12 = solidByX(2630);
var onFloor = true;
for (var i = 0; i < level.enemies.length; i++) {
  var en = level.enemies[i];
  if (en.x < floorG12.x || en.x > floorG12.x + floorG12.w) onFloor = false;
}
ok('all three reds stand on the last floor', onFloor);
ok('the key is not there to begin with', level.pickups[0].hidden === true);

/* put two down, then actually swing at the third */
level.enemies[0].dead = true;
level.enemies[1].dead = true;
var last12 = level.enemies[2];
ok('and it is still not there with one red left', level.pickups[0].hidden);

placeOn(last12.x - 40, GROUND);
for (var i = 0; i < 600 && !last12.dead; i++) {
  p.x = last12.x - 34; p.vx = 0;     // stay in reach, and do not get shoved
  state.grab = 0;                    // this is about the key, not the grip
  if (p.cool <= 0 && p.atk <= 0) { release('KeyI'); tap('KeyI'); }
  step(1);
}
letGo();
ok('put the last one down and the key turns up',
   last12.dead && level.pickups[0].hidden === false,
   'dead=' + last12.dead + ' hidden=' + level.pickups[0].hidden);

var out12 = twelveGoes(2630, 3330);
ok('one more red ring gets you up to the door shelf', out12.ok);
ok('a yellow one would leave you short', !twelveGoes(2630, 3330, 'up').ok);
ok('and your legs do not come close', !twelveGoes(2630, 3330, null).ok);

/* and the door itself finishes the room */
loadLevel(12); state.running = true;
var shelfH12 = solidByX(3330);
placeOn(shelfH12.x + 40, shelfH12.y);
state.picked = true;
level.pickups[0].hidden = false;
p.holding = level.pickups[0];
hold('ArrowRight');
for (var i = 0; i < 400 && !state.complete; i++) step(1);
letGo();
ok('walking into it with the key ends the room', state.complete);


/* ==================================================================
   ROOM THIRTEEN — the course
   Everything at once, so every section is checked the hard way: run it
   with real input, sweeping take-off points AND the blade phase, and
   ask whether any timing at all gets across.
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room thirteen: the room]');
loadLevel(13); state.running = true;
ok('the room loads', level.name === 'Room Thirteen');
ok('it is room thirteen', levelIndex === 13);

var ground13 = solidByX(-60);
ok('you start on the one piece of real ground',
   level.start.y + SIZE === ground13.y &&
   level.start.x > ground13.x && level.start.x < ground13.x + ground13.w,
   'start ' + level.start.x + ',' + level.start.y);

var kinds13 = { dash: 0, up: 0, high: 0 };
for (var i = 0; i < level.orbs.length; i++) {
  kinds13[level.orbs[i].kind || 'dash']++;
}
ok('it uses all three rings',
   kinds13.dash > 0 && kinds13.up > 0 && kinds13.high > 0,
   kinds13.dash + ' dash, ' + kinds13.up + ' yellow, ' + kinds13.high + ' red');
ok('and sagging pads', level.sinkers.length === 4,
   level.sinkers.length + ' pads');
ok('and blades', level.saws.length === 6, level.saws.length + ' blades');
ok('nothing is explained - no hint, no arrow',
   level.hints.length === 0 && level.arrows.length === 0);
ok('the door wants nothing but getting there', level.door.needs === null);

/* the pads never stop going down - there is no waiting one out */
var stops13 = '';
for (var i = 0; i < level.sinkers.length; i++) {
  if (level.sinkers[i].max < 1000) {
    stops13 = 'a pad stops at ' + level.sinkers[i].max;
  }
}
ok('a pad you stand on never stops sinking', stops13 === '', stops13);

/* part one's gaps are inside a double jump; the blade is the problem */
var lips13 = [[-60, 480], [480, 870], [870, 1260]];
var wideGap = '';
for (var i = 0; i < lips13.length; i++) {
  var a13 = solidByX(lips13[i][0]), b13 = solidByX(lips13[i][1]);
  var g13 = b13.x - (a13.x + a13.w);
  if (g13 !== 220) wideGap = 'gap ' + (i + 1) + ' is ' + g13;
}
ok('every gap in part one is 220 - inside a double jump', wideGap === '',
   wideGap);

/* a blade hangs in each of those gaps */
var bladeless = '';
for (var i = 0; i < lips13.length; i++) {
  var a13 = solidByX(lips13[i][0]), b13 = solidByX(lips13[i][1]);
  var found = false;
  for (var q = 0; q < level.saws.length; q++) {
    if (level.saws[q].x0 > a13.x + a13.w && level.saws[q].x0 < b13.x) {
      found = true;
    }
  }
  if (!found) bladeless = 'gap ' + (i + 1) + ' has no blade';
}
ok('and a blade swinging in every one of them', bladeless === '', bladeless);

/* the teeth on padD sit on its near lip, so the dash has to carry past */
var padD13 = solidByX(1850);
ok('the dash landing has teeth on its near lip',
   padD13.spike !== null && padD13.spike.off === 0,
   padD13.spike ? 'off ' + padD13.spike.off : 'no teeth');

/* the last lip, to the one thing left in the room to land on */
var void13 = solidByX(4500).x - (solidByX(2800).x + solidByX(2800).w);
ok('the rings carry you over 1460px of nothing', void13 === 1460,
   void13 + 'px');

/* the four rings after the last lip all hang over nothing */
var lastLip13 = solidByX(2800).x + solidByX(2800).w;
var padded13 = '';
for (var i = 0; i < level.orbs.length; i++) {
  var o13 = level.orbs[i];
  if (o13.x < lastLip13) continue;
  for (var k = 0; k < level.solids.length; k++) {
    var s13 = level.solids[k];
    if (o13.x > s13.x && o13.x < s13.x + s13.w && s13.y > o13.y) {
      padded13 = 'a ring at ' + o13.x + ' has floor under it';
    }
  }
}
ok('every ring past the last lip hangs over nothing', padded13 === '',
   padded13);

/* two yellows in a row, with the one horizontal blade between them */
var yellows13 = [];
for (var i = 0; i < level.orbs.length; i++) {
  if (level.orbs[i].kind === 'up') yellows13.push(level.orbs[i].x);
}
ok('there are two yellow rings', yellows13.length === 2,
   yellows13.length + ' yellow rings');

var flat13 = null, upright13 = 0;
for (var i = 0; i < level.saws.length; i++) {
  var sw13 = level.saws[i];
  if (sw13.y0 === sw13.y1 && sw13.x0 !== sw13.x1) flat13 = sw13;
  if (sw13.x0 === sw13.x1) upright13++;
}
ok('one blade runs along your line, not across it', flat13 !== null);
ok('and the rest still swing up and down', upright13 === 5,
   upright13 + ' upright blades');
ok('the flat one sits between the two yellow rings',
   flat13 !== null && flat13.x0 > yellows13[0] && flat13.x1 < yellows13[1],
   flat13 ? flat13.x0 + '..' + flat13.x1 + ' vs rings at ' +
            yellows13[0] + ' and ' + yellows13[1] : 'no flat blade');

/* and nothing to stand on between the last lip and the door */
var betweenLip13 = '';
for (var i = 0; i < level.solids.length; i++) {
  var s13 = level.solids[i];
  if (s13.x >= lastLip13 && s13.x < level.door.x) {
    betweenLip13 += s13.x + ' ';
  }
}
ok('there is exactly one thing to land on, and the door is on it',
   betweenLip13 === '4500 ', 'solids at ' + betweenLip13);
ok('and almost no ground in front of the door',
   level.door.x - 4500 <= 60, (level.door.x - 4500) + 'px of it');

/* ---------------- every section actually goes ---------------------- */
WScript.Echo('');
WScript.Echo('[room thirteen: every section goes]');

var used13 = {};
function fireAny13() {
  for (var q = 0; q < level.orbs.length; q++) {
    var o = level.orbs[q];
    if (used13['x' + o.x]) continue;
    if (circleHitsBox(o.x, o.y, ORB_CATCH, p)) {
      used13['x' + o.x] = true;
      release('Space'); tap('Space');
      return true;
    }
  }
  return false;
}

/* Start clear of the platform's own teeth, run right, take every ring
   once, and spend the second jump on the way down. `wait` stands still
   first, which is how the blade phase gets swept: loadLevel puts the
   clock back to zero on every attempt, so the blades start in the same
   place each time and only the waiting moves them. */
function run13(fromX, jx, wait, noOrbs, noDouble) {
  loadLevel(13); state.running = true;
  /* Pressing jump inside a ring fires it, so asking what your legs
     alone would do means taking the rings out of the room. */
  if (noOrbs) level.orbs = [];
  used13 = {};
  var a = solidByX(fromX);
  var edge = a.x + a.w;
  var clear = a.x + 4;
  if (a.spike) {
    var bed13 = a.spike.length === undefined ? [a.spike] : a.spike;
    for (var t = 0; t < bed13.length; t++) {
      var te = a.x + bed13[t].off + bed13[t].w + 6;
      if (te > clear && a.x + bed13[t].off < edge - 40) clear = te;
    }
  }
  placeOn(Math.max(clear, edge - 300), a.y);
  for (var w = 0; w < wait; w++) step(1);
  hold('ArrowRight');
  var jumped = false, used2 = false, air = false, fired = 0;
  for (var i = 0; i < 700; i++) {
    if (fireAny13()) { jumped = true; fired++; }
    else if (!jumped && p.x + p.w >= edge + jx) { tap('Space'); jumped = true; }
    else if (jumped && !used2 && !noDouble && !p.onGround && p.vy > -60) {
      release('Space'); tap('Space'); used2 = true;
    }
    step(1);
    if (!p.onGround) air = true;
    if (p.dead) { letGo(); return { r: 'died' }; }
    if (jumped && air && p.onGround) {
      letGo();
      return { r: 'landed', on: standingOnX(), n: fired };
    }
  }
  letGo();
  return { r: 'stuck' };
}

function thirteenGoes(fromX, toX, noOrbs, noDouble) {
  var hits = 0, rings = 0;
  for (var wait = 0; wait <= 144; wait += 18) {
    for (var jx = -200; jx <= 10; jx += 20) {
      var r = run13(fromX, jx, wait, noOrbs, noDouble);
      if (r.r === 'landed' && r.on === toX) { hits++; rings = r.n; }
    }
  }
  return { ok: hits > 0, n: hits, rings: rings };
}

var s1 = thirteenGoes(-60, 480);
ok('the ground gets you to the first pad', s1.ok, s1.n + ' timings work');
var s2 = thirteenGoes(480, 870);
ok('and the first pad to the second, while it sags', s2.ok,
   s2.n + ' timings work');
var s3 = thirteenGoes(870, 1260);
ok('and the second to the third, with its chain already dropping', s3.ok,
   s3.n + ' timings work');
var s4 = thirteenGoes(1260, 1850);
ok('one dash carries you over the teeth', s4.ok && s4.rings === 1,
   s4.n + ' timings work, ' + s4.rings + ' rings');
var s5 = thirteenGoes(1850, 2800);
ok('two chained carry you the 760', s5.ok && s5.rings === 2,
   s5.n + ' timings work, ' + s5.rings + ' rings');
/* and then the whole tail in one go, over nothing the entire way: off
   the lip, dash, yellow, past the flat blade, yellow, red, and the
   second jump to cover what the red one deliberately leaves short */
var s6 = thirteenGoes(2800, 4500);
ok('the rings over the void carry you to the door pad', s6.ok,
   s6.n + ' timings work');

var s7 = thirteenGoes(2800, 4500, false, true);
ok('and not unless you spend the second jump after the red one',
   !s7.ok, s7.n + ' timings got there without it');

/* every one of those must actually need its rings */
var legsOnly = '';
var needs13 = [[1260, 1850], [1850, 2800], [2800, 4500]];
for (var i = 0; i < needs13.length; i++) {
  if (thirteenGoes(needs13[i][0], needs13[i][1], true).ok) {
    legsOnly += needs13[i][0] + ' ';
  }
}
ok('and none of them go on your legs alone', legsOnly === '',
   'got across without a ring from ' + legsOnly);

/* and the door finishes it */
loadLevel(13); state.running = true;
var endF13 = solidByX(4500);
placeOn(endF13.x + 40, endF13.y);
hold('ArrowRight');
for (var i = 0; i < 500 && !state.complete; i++) step(1);
letGo();
ok('walking into the door ends the room', state.complete);


/* ==================================================================
   ROOM FOURTEEN
   The boss room's platforms, ten reds, and Room Six's spikes on the
   floor and on top of every platform.
   ================================================================== */
WScript.Echo('');
WScript.Echo('[room fourteen: the room]');
loadLevel(14); state.running = true;
ok('the room loads', level.name === 'Room Fourteen');
ok('it comes after Room Thirteen', levelIndex === 14);
ok('ten reds', level.enemies.length === 10, level.enemies.length + ' reds');
ok('no boss', level.boss === null);

var bL14 = solidAt(420, 330), bH14 = solidAt(880, 210), bR14 = solidAt(1340, 330);
loadLevel(7);
var bossPlats = [solidAt(420, 330), solidAt(880, 210), solidAt(1340, 330)];
loadLevel(14); state.running = true;
var sameAsBoss = bL14 && bH14 && bR14;
var mine14 = [bL14, bH14, bR14];
for (var i = 0; i < 3 && sameAsBoss; i++) {
  if (mine14[i].w !== bossPlats[i].w || mine14[i].h !== bossPlats[i].h ||
      !mine14[i].oneWay) sameAsBoss = false;
}
ok('the platforms are the boss room\'s', sameAsBoss);

var onPlat14 = [0, 0, 0], redsOnGround = 0;
for (var i = 0; i < level.enemies.length; i++) {
  var eb = level.enemies[i].y + level.enemies[i].h;
  for (var k = 0; k < 3; k++) {
    if (eb === mine14[k].y && level.enemies[i].x >= mine14[k].x &&
        level.enemies[i].x + 22 <= mine14[k].x + mine14[k].w) onPlat14[k]++;
  }
  if (eb === GROUND) redsOnGround++;
}
ok('reds on every platform and on the floor',
   onPlat14[0] > 0 && onPlat14[1] > 0 && onPlat14[2] > 0 && redsOnGround > 0,
   onPlat14.join('/') + ' up, ' + redsOnGround + ' down');

/* which beds belong to which surface */
function bedsOn14(surfY) {
  var out = [];
  for (var i = 0; i < level.waves.length; i++) {
    if (waveBase(level.waves[i]) === surfY) out.push(level.waves[i]);
  }
  return out;
}
var floor14 = bedsOn14(GROUND);

var fat14 = '';
for (var i = 0; i < level.waves.length; i++) {
  if (level.waves[i].w > 45) fat14 = level.waves[i].w + 'px wide';
}
ok('every bed is a single spike', fat14 === '', fat14);

ok('the floor carpet runs under the spawn and past the door',
   floor14.length > 0 && floor14[0].x <= level.start.x &&
   floor14[floor14.length - 1].x + 40 >= level.door.x + level.door.w);

var covered14 = '';
for (var k = 0; k < 3; k++) {
  var pb = [], pl = mine14[k];
  for (var i = 0; i < level.waves.length; i++) {
    var wv = level.waves[i];
    if (wv.y === pl.y && wv.x >= pl.x && wv.x + wv.w <= pl.x + pl.w) pb.push(wv);
  }
  if (pb.length * 40 !== pl.w) covered14 += 'platform at ' + pl.x + ' has ' + pb.length + ' beds; ';
}
ok('every platform carries spikes, edge to edge', covered14 === '', covered14);

/* every surface always has somewhere to stand */
function narrowestTrough(beds) {
  var worst = 1e9;
  for (var t0 = 0; t0 < 4.6; t0 += 0.05) {
    state.t = t0;
    var best = 0, run = 0;
    for (var i = 0; i < beds.length; i++) {
      if (waveOut(beds[i]) < 0.05) { run += beds[i].w; if (run > best) best = run; }
      else run = 0;
    }
    if (best < worst) worst = best;
  }
  return worst;
}
var troughs14 = [narrowestTrough(floor14)];
for (var k = 0; k < 3; k++) {
  var pb = [];
  for (var i = 0; i < level.waves.length; i++) {
    var wv = level.waves[i];
    if (wv.y === mine14[k].y && wv.x >= mine14[k].x &&
        wv.x < mine14[k].x + mine14[k].w) pb.push(wv);
  }
  troughs14.push(narrowestTrough(pb));
}
var tooNarrow14 = '';
for (var k = 0; k < troughs14.length; k++) {
  if (troughs14[k] < SIZE + 20) tooNarrow14 += (k ? 'platform ' + k : 'floor') +
    ' ' + troughs14[k] + 'px; ';
}
ok('the floor and every platform always leave a trough to stand in',
   tooNarrow14 === '', tooNarrow14 || troughs14.join('/') + 'px');

/* the spikes on a platform kill, and only when up */
loadLevel(14); state.running = true;
level.enemies = [];
var pw14 = null;
for (var i = 0; i < level.waves.length; i++) {
  if (level.waves[i].y === bH14.y) { pw14 = level.waves[i]; break; }
}
placeOn(pw14.x + pw14.w / 2 - SIZE / 2, bH14.y);
state.t = pw14.period * (0.5 - pw14.phase + 1);   // fully out
step(3);
ok('raised platform spikes kill you', p.dead === true);

loadLevel(14); state.running = true;
level.enemies = [];
placeOn(pw14.x + pw14.w / 2 - SIZE / 2, bH14.y);
state.t = pw14.period * (1 - pw14.phase);         // fully down
step(3);
ok('lowered platform spikes are safe to stand on', p.dead === false);

/* spawning never puts you straight into raised spikes */
loadLevel(14); state.running = true;
level.enemies = [];
placeOn(level.start.x, GROUND);
step(60);
ok('the first second after spawning is safe', !p.dead,
   'died standing still at x=' + Math.round(p.x));

WScript.Echo('');
WScript.Echo('[room fourteen: the fight]');

/* A real fight on a platform: stand in a trough, let a red come to
   you, and swing. It has to be winnable before the trough moves on. */
loadLevel(14); state.running = true;
var foe14 = level.enemies[2];                     // the first one up top
for (var i = 0; i < level.enemies.length; i++) {
  if (level.enemies[i] !== foe14) level.enemies[i].dead = true;
}
/* find a bed on the high platform that has just gone down */
var calm14 = null;
for (var i = 0; i < level.waves.length; i++) {
  var wv = level.waves[i];
  if (wv.y === bH14.y && wv.x >= foe14.x + 60) { calm14 = wv; break; }
}
state.t = calm14.period * (((0.75 - calm14.phase + 2) % 1) + 1);   // just gone down
placeOn(calm14.x + calm14.w / 2 - SIZE / 2, bH14.y);
p.face = -1;
var swings14 = 0;
for (var i = 0; i < 180 && !foe14.dead && !p.dead; i++) {
  if (p.cool <= 0 && Math.abs((foe14.x + 11) - (p.x + 15)) < 60) {
    p.face = foe14.x < p.x ? -1 : 1;
    tap('KeyI'); swings14++;
  }
  step(1);
}
ok('you can kill one up there from inside a trough',
   foe14.dead && !p.dead,
   'dead=' + foe14.dead + ' you dead=' + p.dead + ' swings=' + swings14 +
   ' hp=' + foe14.hp + ' grab=' + state.grab.toFixed(2) + ' frames=' + i);

/* the key: nine down is not enough, the tenth drops it where it dies */
loadLevel(14); state.running = true;
var key14 = level.pickups[0];
ok('the key starts hidden', key14.hidden === true);
for (var i = 0; i < 10; i++) {
  if (i !== 3) level.enemies[i].dead = true;       // leave one up top
}
ok('nine down is not enough', key14.hidden === true);
var last14 = level.enemies[3];
last14.hp = 1;
p.face = 1;
hitEnemies({ x: last14.x - 5, y: last14.y - 5, w: 40, h: 40 });
ok('the tenth drops the key', last14.dead && key14.hidden === false);
level.waves = [];                                  // just watch it fall
p.x = 60; p.y = 350 - SIZE;
for (var i = 0; i < 120; i++) step(1);
ok('and it lands on the platform that red died on',
   Math.abs(key14.y + key14.h - bH14.y) < 1,
   'key bottom ' + Math.round(key14.y + key14.h) + ', platform ' + bH14.y);

/* key in hand, the door takes you out */
loadLevel(14); state.running = true;
level.waves = [];
for (var i = 0; i < 10; i++) level.enemies[i].dead = true;
state.picked = true;
placeOn(level.door.x - 60, GROUND);
hold('ArrowRight');
for (var i = 0; i < 200 && !state.complete; i++) step(1);
letGo();
ok('with the key, the door ends the room', state.complete);

loadLevel(14); state.running = true;
level.waves = [];
for (var i = 0; i < 10; i++) level.enemies[i].dead = true;
placeOn(level.door.x - 60, GROUND);
hold('ArrowRight');
for (var i = 0; i < 200 && !state.complete; i++) step(1);
letGo();
ok('without it, the door does not', !state.complete);


/* ==================================================================
   CHECKPOINTS
   P drops one under your feet; dying puts you back on it instead of
   at the top of the room.
   ================================================================== */
WScript.Echo('');
WScript.Echo('[checkpoints: putting one down]');

loadLevel(13); state.running = true;
ok('a room starts with no checkpoint', checkpoint === null);

placeOn(120, GROUND);
tap('KeyP');
ok('P on your feet puts one down', checkpoint !== null);
ok('and it lands where you are standing',
   checkpoint !== null && checkpoint.x === p.x &&
   checkpoint.y + SIZE === GROUND,
   checkpoint ? checkpoint.x + ',' + checkpoint.y : 'none');

/* in the air it must do nothing - a checkpoint hanging over a void
   would respawn you into the same fall for ever */
loadLevel(13); state.running = true;
placeOn(120, GROUND);
release('Space'); tap('Space'); step(4);
var wasUp = !p.onGround;
tap('KeyP');
ok('P in mid-air puts nothing down', wasUp && checkpoint === null,
   'airborne=' + wasUp);

/* and standing on it again picks it up */
loadLevel(13); state.running = true;
placeOn(120, GROUND);
tap('KeyP');
var down = checkpoint !== null;
tap('KeyP');
ok('P again while standing on it picks it back up',
   down && checkpoint === null);

/* moving away and pressing P moves it rather than clearing it */
loadLevel(13); state.running = true;
placeOn(120, GROUND);
tap('KeyP');
placeOn(220, GROUND);
tap('KeyP');
ok('but away from it, P moves it', checkpoint !== null &&
   checkpoint.x === 220, checkpoint ? 'at ' + checkpoint.x : 'none');

WScript.Echo('');
WScript.Echo('[checkpoints: dying onto one]');

/* no checkpoint: dying still rewinds the room to the top */
loadLevel(13); state.running = true;
placeOn(600, GROUND);
die();
for (var i = 0; i < 60 && p.dead; i++) step(1);
ok('with no checkpoint, dying puts you back at the start',
   Math.round(p.x) === level.start.x, 'x=' + Math.round(p.x));

/* with one: dying puts you on it */
loadLevel(13); state.running = true;
placeOn(150, GROUND);
tap('KeyP');
placeOn(600, GROUND);
die();
for (var i = 0; i < 60 && p.dead; i++) step(1);
ok('with one, dying puts you back on it', Math.round(p.x) === 150,
   'x=' + Math.round(p.x));
ok('on your feet, not falling', p.onGround && p.vy === 0);
ok('and the checkpoint is still there for the next go',
   checkpoint !== null && checkpoint.x === 150);

/* dying still rewinds everything else about the room */
loadLevel(13); state.running = true;
placeOn(150, GROUND);
tap('KeyP');
var padA13 = solidByX(480);
placeOn(padA13.x + 40, padA13.y);
for (var i = 0; i < 40; i++) step(1);          // let it sag
var sagged = padA13.y > padA13.home;
die();
for (var i = 0; i < 60 && p.dead; i++) step(1);
ok('the pads go back up when you respawn on a checkpoint',
   sagged && solidByX(480).y === solidByX(480).home,
   'sagged=' + sagged);
ok('and the blades start over', state.t === 0, 't=' + state.t);

/* a checkpoint on a sinking pad remembers the pad's home height, not
   how far it had sunk - otherwise you respawn buried inside it */
loadLevel(13); state.running = true;
var padB13 = solidByX(870);
placeOn(padB13.x + 40, padB13.y);
for (var i = 0; i < 40; i++) step(1);
var sankTo = padB13.y;
tap('KeyP');
ok('a checkpoint on a sinking pad stores its home, not its sag',
   checkpoint !== null && checkpoint.y + SIZE === padB13.home &&
   sankTo > padB13.home,
   checkpoint ? 'cp y=' + checkpoint.y + ' home=' + padB13.home +
                ' sank to=' + Math.round(sankTo) : 'none');
die();
for (var i = 0; i < 60 && p.dead; i++) step(1);
ok('so you come back standing on top of it, not inside it',
   p.y + SIZE === solidByX(870).home,
   'y=' + Math.round(p.y) + ' pad top=' + solidByX(870).home);

/* leaving the room drops it */
loadLevel(13); state.running = true;
placeOn(120, GROUND);
tap('KeyP');
var carried = checkpoint !== null;
loadLevel(12);
ok('leaving the room drops the checkpoint',
   carried && checkpoint === null);

/* R goes to it too, so you can retry the hard bit without dying */
loadLevel(13); state.running = true;
placeOn(150, GROUND);
tap('KeyP');
placeOn(600, GROUND);
tap('KeyR');
ok('R takes you back to it as well', Math.round(p.x) === 150,
   'x=' + Math.round(p.x));

/* and it must never leave you somewhere that is not solid */
loadLevel(13); state.running = true;
placeOn(150, GROUND);
tap('KeyP');
placeOn(600, GROUND);
die();
for (var i = 0; i < 60 && p.dead; i++) step(1);
for (var i = 0; i < 30; i++) step(1);          // stand there a moment
ok('and you are still alive standing on it a moment later', !p.dead);
letGo();

WScript.Echo('');
WScript.Echo('[checkpoints: no way on]');

/* finish a room the way the door does, and report which room the
   screen's main button would take you to */
function doorAndNext() {
  finishLevel();
  var from = levelIndex;
  onNext();
  return { from: from, to: levelIndex };
}

admin = false;
loadLevel(5); state.running = true;
ok('a fresh room is not marked', state.cpUsed === false);
placeOn(150, GROUND);
tap('KeyP');
ok('just putting a flag down marks you', state.cpUsed === true);
tap('KeyP');                                   // pick it up again
ok('picking it up again does not unmark you',
   checkpoint === null && state.cpUsed === true);
die();
for (var i = 0; i < 60 && p.dead; i++) step(1);
ok('nor does dying from the top with none down',
   Math.round(p.x) === level.start.x && state.cpUsed === true);

finishLevel();
ok('the door keeps the room screen', doneTitle.textContent ===
   BUILDERS[5]().name.toUpperCase() + ' CLEARED', doneTitle.textContent);
ok('but says you cannot pass',
   doneSub.textContent === 'You cannot pass if you used checkpoints',
   doneSub.textContent);
ok('Next Room becomes Try Again', nextBtn.textContent === 'Try Again',
   nextBtn.textContent);
ok('and the other button is still there', againBtn.textContent === 'Play It Again',
   againBtn.textContent);
onNext();
ok('Try Again puts you back in the same room, unmarked',
   levelIndex === 5 && state.cpUsed === false && checkpoint === null,
   'at ' + levelIndex);

/* the last room keeps its Back to the Tutorial */
loadLevel(BUILDERS.length - 1); state.running = true;
placeOn(150, GROUND);
tap('KeyP');
finishLevel();
ok('the last room still offers Back to the Tutorial',
   nextBtn.textContent === 'Try Again' &&
   againBtn.textContent === 'Back to the Tutorial',
   nextBtn.textContent + ' / ' + againBtn.textContent);

/* a flagged tutorial does not start the game either */
loadLevel(0); state.running = true;
placeOn(level.start.x, level.start.y + SIZE);
state.cpUsed = true;
var r = doorAndNext();
ok('not from the tutorial either', r.to === 0, 'went to ' + r.to);

/* nor hand you back a cleared room's screen */
returnToDone = BUILDERS.length - 1;
loadLevel(0); state.running = true;
state.cpUsed = true;
finishLevel();
ok('nor from a detour back through the tutorial',
   doneTitle.textContent === 'TUTORIAL COMPLETE' &&
   nextBtn.textContent === 'Try Again', doneTitle.textContent);
returnToDone = null;

/* no flag: the door takes you on */
loadLevel(5); state.running = true;
r = doorAndNext();
ok('with no flag, the door takes you on', r.to === 6, 'went to ' + r.to);

/* quitting and continuing must not launder the mark */
loadLevel(5); state.running = true;
placeOn(150, GROUND);
tap('KeyP');
saveGame();
loadLevel(0);
continueGame();
ok('the mark survives a save and Continue',
   levelIndex === 5 && state.cpUsed === true);

WScript.Echo('');
WScript.Echo('[admin]');
ok('admin starts off', admin === false);
toggleAdmin();
ok('the title-screen toggle turns it on', admin === true &&
   adminBtn.textContent === 'ADMIN: ON', adminBtn.textContent);
loadLevel(5); state.running = true;
placeOn(150, GROUND);
tap('KeyP');
r = doorAndNext();
ok('with admin on, a flag does not stop you', r.to === 6,
   'went to ' + r.to);
toggleAdmin();
ok('and it turns back off', admin === false &&
   adminBtn.textContent === 'ADMIN: OFF');
clearSave();
letGo();

WScript.Echo('[hitting something that has hold of you]');
loadLevel(3); state.running = true;
var e = level.enemies[0];
p.x = e.x - 6;                            // overlapping, cube on your right
p.y = e.y + e.h - SIZE;
p.face = 1;
state.grab = 0;
tap('KeyI');
for (var i = 0; i < 3; i++) { state.grab = 0; step(1); }
ok('you can hit it while it is on you, facing it', e.hp === 2, 'hp=' + e.hp);

loadLevel(3); state.running = true;
e = level.enemies[0];
p.x = e.x - 6;                            // same, but facing the wrong way
p.y = e.y + e.h - SIZE;
p.face = -1;
state.grab = 0;
tap('KeyI');
for (var i = 0; i < 3; i++) { state.grab = 0; step(1); }
ok('you can hit it while it is on you, facing away', e.hp === 2, 'hp=' + e.hp);

WScript.Echo('');
WScript.Echo('[back to the tutorial and out again]');
loadLevel(4); state.running = true;
showDoneFor(BUILDERS.length - 1);
ok('the last room offers a way back to the tutorial',
   againBtn.textContent === 'Back to the Tutorial');
onAgain();
ok('it drops you into the tutorial', levelIndex === 0);
ok('it remembers where you came from', returnToDone === BUILDERS.length - 1);

state.picked = true;
finishLevel();
ok('finishing the tutorial returns you to that room screen',
   doneTitle.textContent ===
     BUILDERS[BUILDERS.length - 1]().name.toUpperCase() + ' CLEARED',
   'showed "' + doneTitle.textContent + '"');
ok('not back to room one',
   nextBtn.textContent !== 'Start the Game', nextBtn.textContent);

/* ==================================================================
   SAVE / CONTINUE
   ================================================================== */
WScript.Echo('');
WScript.Echo('[save]');
clearSave();
ok('a fresh install has nothing to continue', readSave() === null);

nameInput.value = 'ZELDA';
newGame();
ok('New Game takes the typed name', state.name === 'ZELDA');
ok('New Game starts in the tutorial', levelIndex === 0);
ok('New Game starts you at the beginning', p.x === level.start.x);
ok('New Game writes a save immediately', readSave() !== null);

/* play into room one, then "quit" */
loadLevel(1);
state.running = true;
state.picked = true;
safeSpot.x = 1900; safeSpot.y = 270;
saveGame();

var s = readSave();
ok('the save records which room you are in', s.level === 1, 'level=' + s.level);
ok('the save records how far you got',
   s.x === 1900 && s.picked === true);

loadLevel(0);
ok('loading another room really does reset', levelIndex === 0 && state.picked === false);

continueGame();
ok('Continue puts you back in the right room', levelIndex === 1);
ok('Continue restores your name', state.name === 'ZELDA');
ok('Continue restores where you stood', p.x === 1900, 'p.x=' + p.x);
ok('Continue remembers you had the key', state.picked === true);

nameInput.value = 'LINK';
newGame();
ok('New Game wipes the old progress', levelIndex === 0 && state.picked === false);
ok('New Game overwrites the save file', readSave().name === 'LINK');

/* every spot Continue could restore must be somewhere you can stand */
loadLevel(1); state.running = true;
placeOn(420, GROUND);
hold('ArrowRight');
var spots = [];
for (var i = 0; i < 160; i++) {
  if (p.onGround && p.x + p.w > 560) tap('Space');
  step(1);
  spots.push({ x: safeSpot.x, y: safeSpot.y });
  if (p.dead) break;
}
letGo();

var unsafe = null;
for (var i = 0; i < spots.length && !unsafe; i++) {
  p.x = spots[i].x; p.y = spots[i].y;
  p.vx = 0; p.vy = 0;
  p.dead = false; p.deadT = 0; p.onGround = false;
  state.buffer = 0; state.coyote = 0;
  step(25);
  if (p.dead) unsafe = spots[i];
}
ok('every spot Continue can restore is solid ground',
   unsafe === null,
   unsafe ? 'fell from x=' + unsafe.x + ' y=' + unsafe.y : '');

/* The game is eval'd into this same global scope, so a `var` up here
   named after one of its helpers silently replaces it, and the next
   frame dies with "Function expected" halfway through a run. Cheap
   insurance: check the ones easiest to shadow by accident. */
WScript.Echo('');
WScript.Echo('[the harness has not trodden on the game]');
var trodden = '';
var mustBeFns = ['rr', 'hits', 'circleHitsBox', 'sawPos', 'waveOut', 'waveBox',
                 'waveWarn', 'teethOf', 'loadLevel', 'frame', 'update', 'draw',
                 'die', 'burst', 'standingOn'];
for (var mi = 0; mi < mustBeFns.length; mi++) {
  if (typeof this[mustBeFns[mi]] !== 'function') {
    trodden += mustBeFns[mi] + ' ';
  }
}
ok('no test variable has shadowed a game function', trodden === '',
   'clobbered: ' + trodden);

WScript.Echo('');
WScript.Echo('=== ' + passed + ' passed, ' + failed + ' failed ===');
WScript.Echo('');
WScript.Quit(failed > 0 ? 1 : 0);
