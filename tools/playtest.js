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
