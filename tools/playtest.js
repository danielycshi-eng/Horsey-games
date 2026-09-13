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
   TUTORIAL
   ================================================================== */
loadLevel(0);
state.running = true;
WScript.Echo('[tutorial: the apple]');

placeOn(2765, GROUND);
tap('KeyB');
ok('B near the pedestal picks the apple up', p.holding === 'apple');
step(3);

die();
step(60);                                   // respawn fires after 0.7s
ok('death returns the apple to its pedestal',
   level.pickup.x === level.pickup.home.x && level.pickup.y === level.pickup.home.y,
   'at ' + level.pickup.x + ',' + level.pickup.y);
ok('the apple never lands on the scarecrow',
   !hits(box(level.pickup), box(level.scarecrow)),
   'apple x=' + level.pickup.x + ' scarecrow x=' + level.scarecrow.x);

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
   level.pickup.y + level.pickup.h === platE.y,
   'key bottom = ' + (level.pickup.y + level.pickup.h) + ' platform top = ' + platE.y);

placeOn(level.door.x - 40, 300);
step(6);
ok('the door stays shut without the key', state.complete === false);

loadLevel(1); state.running = true;
placeOn(1930, 300);
tap('KeyB');
ok('B picks the key up', p.holding === 'key', 'holding=' + p.holding);
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
    if (sw.x > s.x - sw.r && sw.x < s.x + s.w + sw.r) {
      sawsClear = false;
      sawDetail = 'saw at ' + sw.x + ' overlaps platform ' + s.x + '..' + (s.x + s.w);
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
   level.saws[3].x > r2[3].x + r2[3].w && level.saws[4].x < r2[4].x,
   'saws at ' + level.saws[3].x + ' and ' + level.saws[4].x);
ok('the last gap is the widest', (r2[4].x - (r2[3].x + r2[3].w)) === 240,
   'gap = ' + (r2[4].x - (r2[3].x + r2[3].w)));

loadLevel(2); state.running = true;
placeOn(level.saws[0].x - SIZE / 2, 380);   // stand in the saw's path
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
ok('the cube is smaller than you', level.enemy.w < SIZE && level.enemy.h < SIZE);
ok('the key starts hidden', level.pickup.hidden === true);
ok('the door wants the key', level.door.needs === 'key');

/* it should come at you */
placeOn(1600, GROUND);
var startGap = Math.abs(level.enemy.x - p.x);
step(40);
ok('the cube chases you', Math.abs(level.enemy.x - p.x) < startGap,
   'gap went ' + Math.round(startGap) + ' -> ' + Math.round(Math.abs(level.enemy.x - p.x)));

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
var spawnX = level.enemy.x;
var reached = false, jumps = 0, wasAir = false;
for (var i = 0; i < 900; i++) {
  state.grab = 0;                          // don't let it kill us mid-measurement
  p.x = 200; p.y = GROUND - SIZE;          // stand still and wait
  p.vx = 0; p.vy = 0;
  step(1);
  if (!wasAir && !level.enemy.onGround) { jumps++; wasAir = true; }
  if (level.enemy.onGround) wasAir = false;
  if (Math.abs(level.enemy.x - p.x) < 60) { reached = true; break; }
}
ok('the cube jumps', jumps > 0, jumps + ' jumps');
ok('the cube crosses the room to reach you', reached,
   'started at ' + Math.round(spawnX) + ', got to ' + Math.round(level.enemy.x));
ok('it never falls out of the world', level.enemy.y < level.fallY);

/* two seconds of contact kills you */
loadLevel(3); state.running = true;
placeOn(level.enemy.x - 4, GROUND);
var heldFor = 0;
for (var i = 0; i < 400; i++) {
  p.x = level.enemy.x - 4;                 // pinned against it
  step(1);
  heldFor += 0.016;
  if (p.dead) break;
}
ok('two seconds in its grip kills you', p.dead === true);
ok('it takes about two seconds, not instantly',
   heldFor > 1.6 && heldFor < 2.6, 'died after ' + heldFor.toFixed(2) + 's');

/* a brush past should NOT kill you */
loadLevel(3); state.running = true;
placeOn(level.enemy.x - 4, GROUND);
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
ok('the cube has three hit points', level.enemy.hp === 3);

var swings = 0;
for (var i = 0; i < 60 && !level.enemy.dead; i++) {
  /* stand just off its side and swing */
  p.x = level.enemy.x - SIZE - 2;
  p.y = level.enemy.y + level.enemy.h - SIZE;
  p.face = 1;
  state.grab = 0;                          // isolate the fight from the grip
  release('KeyI'); tap('KeyI');
  if (p.atk > 0) swings++;
  step(24);                                // past the 0.32s swing cooldown
}
ok('three swings kill it', level.enemy.dead === true,
   'hp=' + level.enemy.hp + ' after ' + swings + ' swings');
ok('it took exactly three', swings === 3, swings + ' swings');
ok('killing it drops the key', level.pickup.hidden === false);

step(60);                                  // let the key fall
ok('the key lands on something solid',
   level.pickup.grounded === true && level.pickup.y + level.pickup.h <= GROUND + 1,
   'key at y=' + level.pickup.y);
ok('the key drops somewhere in the room',
   level.pickup.x > 0 && level.pickup.x < level.worldW,
   'key x=' + level.pickup.x);

/* one swing must not count as three */
loadLevel(3); state.running = true;
p.x = level.enemy.x - SIZE - 2;
p.y = level.enemy.y + level.enemy.h - SIZE;
p.face = 1;
tap('KeyI');
for (var i = 0; i < 12; i++) { state.grab = 0; step(1); }
ok('a single swing only lands once', level.enemy.hp === 2, 'hp=' + level.enemy.hp);

WScript.Echo('');
WScript.Echo('[room three: the way out]');
loadLevel(3); state.running = true;
placeOn(level.door.x - 40, 380);
step(6);
ok('the door stays shut with the cube alive', state.complete === false);

level.enemy.hp = 1;                        // finish it off
p.x = level.enemy.x - SIZE - 2;
p.y = level.enemy.y + level.enemy.h - SIZE;
p.face = 1;
tap('KeyI');
for (var i = 0; i < 40; i++) { state.grab = 0; step(1); }
ok('the cube dies on the last hit', level.enemy.dead === true);

p.x = level.pickup.x - 10;
p.y = level.pickup.y;
tap('KeyB');
ok('you can pick the dropped key up', p.holding === 'key', 'holding=' + p.holding);

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
