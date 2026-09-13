/* Passcode gate shared by every page.
 *
 * Usage (in <head>, before anything else):
 *   index.html   <script src="gate.js" data-gate="start" data-gate-next="games.html"></script>
 *   games.html   <script src="gate.js" data-gate="site"></script>
 *   games/x.html <script src="../gate.js" data-gate="x"></script>
 *
 * "start" arms the Start button. "site" locks the page behind the site code.
 * A game id locks the page behind the site code AND that game's code.
 * Unlocks last for the browser session (sessionStorage).
 */
(function () {
  var CODES = {
    site:                  'HRSYGMS!',
    tictactoe:             'TTT',
    spaceshooter:          'PEW',
    clickhero:             'MISS',
    spikes:                'BOB',
    'options-limited':     '200',
    'cookie-clicker':      'THXORTEIL',
    'delivery-master':     'UBERR',
    'protect-the-crystal': 'RODE',
    shapes:                'TRIANGLE'
  };

  var LABELS = {
    site:                  'Horsey Games',
    tictactoe:             'Tic Tac Toe',
    spaceshooter:          'Space Shooter',
    clickhero:             'Click Hero',
    spikes:                'Spikes',
    'options-limited':     'Options Limited',
    'cookie-clicker':      'Cookie Clicker',
    'delivery-master':     'Delivery Master',
    'protect-the-crystal': 'Protect the Crystal',
    shapes:                'Shapes'
  };

  var script = document.currentScript;
  var mode   = script.getAttribute('data-gate');
  var next   = script.getAttribute('data-gate-next');
  var back   = script.getAttribute('data-gate-back') || '';

  function isUnlocked(id) {
    try { return sessionStorage.getItem('hg_gate_' + id) === 'yes'; }
    catch (e) { return false; }
  }

  function markUnlocked(id) {
    try { sessionStorage.setItem('hg_gate_' + id, 'yes'); } catch (e) {}
  }

  function matches(entered, id) {
    return entered.trim().toUpperCase() === CODES[id].toUpperCase();
  }

  /* Which codes still have to be entered, in order. */
  function pending(id) {
    var chain = id === 'site' ? ['site'] : ['site', id];
    return chain.filter(function (step) { return !isUnlocked(step); });
  }

  /* Ask for each code in `steps`, then call done(). */
  function askFor(steps, backHref, done) {
    var overlay = document.createElement('div');
    overlay.className = 'hg-gate';
    overlay.innerHTML =
      '<div class="hg-gate-box">' +
        '<div class="hg-gate-lock">&#128274;</div>' +
        '<h2 class="hg-gate-title"></h2>' +
        '<p class="hg-gate-sub">enter passcode</p>' +
        '<input class="hg-gate-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32">' +
        '<button class="hg-gate-btn" type="button">Unlock</button>' +
        '<p class="hg-gate-err"></p>' +
        '<a class="hg-gate-back"></a>' +
      '</div>';
    document.body.appendChild(overlay);

    var box   = overlay.querySelector('.hg-gate-box');
    var title = overlay.querySelector('.hg-gate-title');
    var input = overlay.querySelector('.hg-gate-input');
    var btn   = overlay.querySelector('.hg-gate-btn');
    var err   = overlay.querySelector('.hg-gate-err');
    var link  = overlay.querySelector('.hg-gate-back');
    var i     = 0;

    if (backHref) {
      link.href = backHref;
      link.textContent = backHref === 'CANCEL' ? 'Cancel' : '← Back';
      if (backHref === 'CANCEL') {
        link.removeAttribute('href');
        link.classList.add('hg-gate-cancel');
        link.addEventListener('click', function () { overlay.remove(); });
      }
    } else {
      link.remove();
    }

    function show() {
      title.textContent = LABELS[steps[i]];
      err.textContent = '';
      input.value = '';
      input.focus();
    }

    function submit() {
      if (matches(input.value, steps[i])) {
        markUnlocked(steps[i]);
        i++;
        if (i < steps.length) { show(); return; }
        overlay.remove();
        done();
      } else {
        err.textContent = 'Wrong passcode';
        box.classList.remove('hg-gate-shake');
        void box.offsetWidth;            /* restart the animation */
        box.classList.add('hg-gate-shake');
        input.select();
      }
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    show();
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  if (mode === 'start') {
    /* Home page stays visible; the Start button is what's guarded. */
    onReady(function () {
      var target = document.querySelector('[data-gate-start]') ||
                   document.querySelector('a[href="' + next + '"]');
      if (!target) return;
      target.addEventListener('click', function (e) {
        if (isUnlocked('site')) return;
        e.preventDefault();
        askFor(['site'], 'CANCEL', function () { window.location.href = next; });
      });
    });
    return;
  }

  if (!CODES[mode]) return;

  var steps = pending(mode);
  if (!steps.length) return;

  /* Hide the page immediately so nothing flashes before the gate paints. */
  document.documentElement.classList.add('hg-locked');
  onReady(function () {
    askFor(steps, back || (mode === 'site' ? 'index.html' : '../games.html'), function () {
      document.documentElement.classList.remove('hg-locked');
      window.dispatchEvent(new Event('resize'));
    });
  });
})();
