/* Headless playtest for games/unnamed.html.
 *
 * Loads the real game script with a stubbed DOM, then drives the real
 * frame loop with scripted key input and asserts what actually happens.
 * Run:  cscript //Nologo //E:JScript playtest.js
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
    classList: { add: noop, remove: noop },
    addEventListener: noop,
    focus: noop,
    getContext: function () { return new FakeCtx(); }
  };
}

var document = { getElementById: fakeEl, addEventListener: noop, readyState: 'complete' };
var window = { addEventListener: noop };
var requestAnimationFrame = noop;

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

function place(x) {
  p.x = x; p.y = GROUND - SIZE;
  p.vx = 0; p.vy = 0;
  p.onGround = true; p.airJumps = 1;
  p.dead = false; p.deadT = 0;
  p.face = 1; p.atk = 0; p.cool = 0;
  state.buffer = 0; state.coyote = 0;
}

function box(o) { return { x: o.x, y: o.y, w: o.w, h: o.h }; }
function hold(k) { keys[k] = true; }
function release(k) { keys[k] = false; }
function tap(k) { keys[k] = true; press(k); }

state.running = true;
state.name = 'TESTER';

WScript.Echo('');
WScript.Echo('=== ??? headless playtest ===');
WScript.Echo('');

/* ------------------------------------------------------------------
   1. The reported bug: the apple must go home, not onto the scarecrow
   ------------------------------------------------------------------ */
WScript.Echo('[apple]');
place(2765);
tap('KeyB');
ok('B near the pedestal picks the apple up', p.holding === 'apple');
step(3);

die();
step(60);                                   // respawn fires after 0.7s
ok('death returns the apple to its pedestal',
   apple.x === APPLE_HOME.x && apple.y === APPLE_HOME.y,
   'apple at ' + apple.x + ',' + apple.y + ' expected ' + APPLE_HOME.x + ',' + APPLE_HOME.y);
ok('the apple never lands on the scarecrow',
   !hits(box(apple), box(scarecrow)),
   'apple x=' + apple.x + ' scarecrow x=' + scarecrow.x);
ok('the apple sits on top of its pedestal',
   apple.y + apple.h === 386,
   'apple bottom = ' + (apple.y + apple.h));

/* ------------------------------------------------------------------
   2. The pit: one jump must fail, two must succeed
   ------------------------------------------------------------------ */
WScript.Echo('');
WScript.Echo('[pit]');

function runPit(useDouble) {
  place(1000);
  hold('ArrowRight');
  var jumped = false, doubled = false, i;
  for (i = 0; i < 200; i++) {
    if (!jumped && p.x + p.w >= pit.x - 2) { tap('Space'); jumped = true; }
    else if (jumped && !doubled && useDouble && p.vy > -120) {
      release('Space'); tap('Space'); doubled = true;
    }
    step(1);
    if (p.dead) return 'died';
    if (jumped && p.onGround && p.x > pit.x + pit.w) return 'cleared';
  }
  return 'stuck';
}

ok('a single jump falls short of the pit', runPit(false) === 'died');
ok('a double jump clears the pit', runPit(true) === 'cleared');

/* ------------------------------------------------------------------
   3. The ledge must be climbable with one jump
   ------------------------------------------------------------------ */
WScript.Echo('');
WScript.Echo('[ledge]');
place(700);
hold('ArrowRight');
var onLedge = false;
for (var i = 0; i < 200; i++) {
  if (p.onGround && p.x + p.w > 810 && p.y + p.h >= GROUND) tap('Space');
  step(1);
  if (p.onGround && p.y + p.h <= 372) { onLedge = true; break; }
}
release('ArrowRight');
ok('one jump gets you onto the ledge', onLedge, 'player at y=' + p.y);

/* ------------------------------------------------------------------
   4. The scarecrow opens the barrier, then grows back
   ------------------------------------------------------------------ */
WScript.Echo('');
WScript.Echo('[scarecrow]');
ok('the barrier starts closed', barrier.open === false);

place(1765);
var swings = 0;
for (var i = 0; i < 120 && scarecrow.hp > 0; i++) {
  release('KeyI'); tap('KeyI');
  if (p.atk > 0) swings++;
  step(25);                                 // longer than the 0.32s cooldown
}
ok('three swings break the scarecrow', scarecrow.hp <= 0, 'hp=' + scarecrow.hp + ' swings=' + swings);
ok('breaking it opens the barrier', barrier.open === true);

step(200);                                  // 3.2s, past the 2.6s regen
ok('the scarecrow grows back to practise on', scarecrow.hp === scarecrow.maxHp, 'hp=' + scarecrow.hp);

/* ------------------------------------------------------------------
   5. The barrier really blocks before it opens
   ------------------------------------------------------------------ */
WScript.Echo('');
WScript.Echo('[barrier]');
barrier.open = false;
place(2100);
hold('ArrowRight');
step(150);
ok('a closed barrier stops you walking past', p.x + p.w <= barrier.x + 1, 'player right edge = ' + (p.x + p.w));

var blockedHeight = true;
for (var i = 0; i < 200; i++) {
  if (p.onGround) tap('Space');
  else { release('Space'); tap('Space'); }
  step(1);
  if (p.x > barrier.x + barrier.w) { blockedHeight = false; break; }
}
ok('you cannot double-jump over the barrier either', blockedHeight);
release('ArrowRight');
release('Space');
barrier.open = true;

/* ------------------------------------------------------------------
   6. The door only opens once you have carried the apple
   ------------------------------------------------------------------ */
WScript.Echo('');
WScript.Echo('[door]');
state.applePicked = false;
state.complete = false;
place(goal.x - 10);
step(5);
ok('the door ignores you without the apple', state.complete === false);

state.applePicked = true;
place(goal.x - 10);
hold('ArrowRight');
step(30);
ok('the door opens once you have picked the apple up', state.complete === true);

/* ------------------------------------------------------------------
   7. Nothing in the level is unreachable or overlapping
   ------------------------------------------------------------------ */
WScript.Echo('');
WScript.Echo('[layout]');
var things = [
  ['scarecrow', box(scarecrow)],
  ['apple', box(apple)],
  ['goal', box(goal)],
  ['barrier', box(barrier)]
];
var overlap = '';
for (var i = 0; i < things.length; i++) {
  for (var j = i + 1; j < things.length; j++) {
    if (hits(things[i][1], things[j][1])) overlap += things[i][0] + '/' + things[j][0] + ' ';
  }
}
ok('no two props occupy the same space', overlap === '', overlap);
ok('everything sits inside the world', goal.x + goal.w < WORLD_W);
ok('the pit is inside the gap between the two grounds',
   pit.x === 1100 && pit.x + pit.w === 1320);

WScript.Echo('');
WScript.Echo('=== ' + passed + ' passed, ' + failed + ' failed ===');
WScript.Echo('');
WScript.Quit(failed > 0 ? 1 : 0);
