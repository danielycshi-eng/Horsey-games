/* Passcode gate shared by every page.
 *
 * Usage (in <head>, before anything else):
 *   games.html   <script src="gate.js" data-gate="site"></script>
 *   games/x.html <script src="../gate.js" data-gate="x"></script>
 *
 * The code is asked for on EVERY page load — nothing is remembered, so
 * leaving a game and coming back means typing it again. That is deliberate:
 * people only get to play what they were given the code for.
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
  var id     = script.getAttribute('data-gate');
  if (!CODES[id]) return;

  var back = script.getAttribute('data-gate-back') ||
             (id === 'site' ? 'index.html' : '../games.html');

  /* Hide the page immediately so nothing flashes before the gate paints. */
  document.documentElement.classList.add('hg-locked');

  /* Back/forward cache can restore a page without re-running scripts, which
     would hand out a free pass. Reload so the gate always runs. */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) window.location.reload();
  });

  function build() {
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
        '<a class="hg-gate-back" href="' + back + '">&larr; Back</a>' +
      '</div>';
    document.body.appendChild(overlay);

    var box   = overlay.querySelector('.hg-gate-box');
    var input = overlay.querySelector('.hg-gate-input');
    var err   = overlay.querySelector('.hg-gate-err');

    overlay.querySelector('.hg-gate-title').textContent = LABELS[id];

    function submit() {
      if (input.value.trim().toUpperCase() === CODES[id].toUpperCase()) {
        overlay.remove();
        document.documentElement.classList.remove('hg-locked');
        window.dispatchEvent(new Event('resize'));
      } else {
        err.textContent = 'Wrong passcode';
        box.classList.remove('hg-gate-shake');
        void box.offsetWidth;            /* restart the animation */
        box.classList.add('hg-gate-shake');
        input.select();
      }
    }

    overlay.querySelector('.hg-gate-btn').addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    input.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
