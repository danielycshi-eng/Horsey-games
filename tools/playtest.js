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
function attempt(startX, startTop, jumpAtX, useDouble, limit) {
  placeOn(startX, startTop);
  hold('ArrowRight');
  var jumped = false, doubled = false;
  for (var i = 0; i < limit; i++) {
    if (!jumped && p.x + p.w >= jumpAtX) { tap('Space'); jumped = true; }
    else if (jumped && !doubled && useDouble && p.vy > -120) {
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
  for (var jx = edge - 150; jx <= edge + 6; jx += 6) {
    var r = attempt(startX, from.y, jx, useDouble, 300);
    if (r.r === 'landed' && r.y === target.y &&
        r.x + SIZE > target.x && r.x < target.x + target.w) {
      return true;
    }
  }
  return false;
}

/* Is there ANY take-off point that gets you from here onto `target`? */
function canReach(startX, startTop, target, useDouble) {
  for (var jx = startX; jx <= startX + 320; jx += 8) {
    var r = attempt(startX, startTop, jx, useDouble, 260);
    if (r.r === 'landed' && r.y === target.y &&
        r.x + SIZE > target.x && r.x < target.x + target.w) {
      return true;
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
              'saws', 'waves', 'enemies', 'pickups', 'door', 'arrows', 'hints'];
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
ok('saws on the platforms and one on the floor', level.saws.length === 4);
ok('spikes come out of the ground in a wave', level.waves.length > 6,
   level.waves.length + ' beds');

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
   longestUp <= 300,
   'longest raised run ' + longestUp + 'px, a double jump carries ~368px');

/* The point of the ledge is that the ROOM doesn't kill you the instant
   you appear. The reds will come for you, and should — so take them out
   of it and check the terrain alone is survivable. */
level.enemies = [];
placeOn(level.start.x, 350);
step(320);
ok('the spawn ledge is safe from spikes and saws', !p.dead,
   'died standing still at x=' + Math.round(p.x));

/* the floor saw really does patrol */
var floorSaw = level.saws[3];
ok('the floor saw runs the whole length of the room',
   floorSaw.y0 === floorSaw.y1 && floorSaw.y0 + floorSaw.r === GROUND &&
   floorSaw.x0 <= ledge6.x + ledge6.w &&
   floorSaw.x1 >= level.door.x,
   'from ' + floorSaw.x0 + ' to ' + floorSaw.x1 +
   ' (ledge ends ' + (ledge6.x + ledge6.w) + ', door at ' + level.door.x + ')');

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

WScript.Echo('');
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
   doneTitle.textContent === 'ROOM SIX CLEARED',
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

WScript.Echo('');
WScript.Echo('=== ' + passed + ' passed, ' + failed + ' failed ===');
WScript.Echo('');
WScript.Quit(failed > 0 ? 1 : 0);
