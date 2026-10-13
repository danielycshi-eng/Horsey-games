/* Reviews, on the games list: Ideas (a name and a game idea) and
   Comments (praise or a complaint, a name and the comment).

   They're kept in Firebase (Google's free database for websites), so
   everyone sees everyone's. Each browser signs in to it anonymously - no
   account, no password - and that's how it knows which reviews are yours
   to delete. Daniel can delete any of them from the Firebase console.

   Until FIREBASE_CONFIG below is filled in, the panel just says reviews
   aren't switched on yet. */
(function () {
  /* paste the config from Firebase here (Project settings > Your apps) */
  var FIREBASE_CONFIG = null;

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var COLLECTION = 'reviews';

  var btn = document.getElementById('reviewsBtn');
  var panel = document.getElementById('reviews');
  if (!btn || !panel) return;
  var list = panel.querySelector('.rv-list');
  var msg = panel.querySelector('.rv-msg');
  var offNote = panel.querySelector('.rv-off');
  var forms = panel.querySelectorAll('.rv-form');
  var tabs = panel.querySelectorAll('.rv-tab');

  var tab = 'idea';            // which tab is showing: 'idea' or 'comment'
  var db = null, uid = null, all = [], started = false, unsubscribe = null;

  /* ---- opening, closing, tabs ---- */
  btn.addEventListener('click', function () {
    panel.classList.remove('hidden');
    start();
  });
  panel.querySelector('.rv-close').addEventListener('click', close);
  panel.addEventListener('click', function (e) { if (e.target === panel) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  function close() { panel.classList.add('hidden'); }

  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () {
      tab = this.getAttribute('data-tab');
      for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('on', tabs[j] === this);
      for (j = 0; j < forms.length; j++) forms[j].classList.toggle('hidden', forms[j].getAttribute('data-kind') !== tab);
      say('');
      draw();
    });
  }

  function say(t) { msg.textContent = t; }

  /* everyone else's (and yours), under "View others" */
  var viewBtn = panel.querySelector('.rv-view');
  viewBtn.addEventListener('click', function () {
    var showing = list.classList.toggle('hidden') === false;
    viewBtn.textContent = showing ? 'Hide others' : 'View others';
  });
  function showList() {
    list.classList.remove('hidden');
    viewBtn.textContent = 'Hide others';
  }

  /* ---- Firebase: loaded the first time the panel opens ---- */
  function load(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }

  function start() {
    if (started) return;
    started = true;
    if (!FIREBASE_CONFIG) {              // (no Firebase: reviews just go on the page, below the form)
      uid = 'me';
      draw();
      return;
    }
    list.innerHTML = '<p class="rv-empty">Loading...</p>';
    load(SDK + 'firebase-app-compat.js')
      .then(function () { return Promise.all([load(SDK + 'firebase-auth-compat.js'), load(SDK + 'firebase-firestore-compat.js')]); })
      .then(function () {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.firestore();
        return firebase.auth().signInAnonymously();
      })
      .then(function (cred) {
        uid = cred.user.uid;
        /* everyone's reviews, newest first, kept up to date as they come in */
        unsubscribe = db.collection(COLLECTION).orderBy('at', 'desc').limit(200).onSnapshot(function (snap) {
          all = [];
          snap.forEach(function (doc) { var d = doc.data(); d.id = doc.id; all.push(d); });
          draw();
        }, function () {
          list.innerHTML = '<p class="rv-empty">Couldn\'t load the reviews.</p>';
        });
      })
      .catch(function () {
        started = false;                 // (try again next time it's opened)
        list.innerHTML = '<p class="rv-empty">Couldn\'t connect - check your internet and try again.</p>';
      });
  }

  /* ---- sending ---- */
  for (i = 0; i < forms.length; i++) forms[i].addEventListener('submit', send);
  function send(e) {
    e.preventDefault();
    var form = e.target;
    var name = form.elements.name.value.trim();
    var text = form.elements.text.value.trim();
    if (!name) { say('Write your name first.'); return; }
    if (!text) { say(tab === 'idea' ? 'Write your idea first.' : 'Write your comment first.'); return; }
    var review = {
      kind: form.getAttribute('data-kind'),
      name: name.slice(0, 40),
      text: text.slice(0, 1000),
      uid: uid
    };
    if (review.kind === 'comment') review.type = form.elements.type.value === 'complaint' ? 'complaint' : 'praise';
    /* no Firebase: it just goes on the page, under the form */
    if (!FIREBASE_CONFIG) {
      review.id = 'r' + new Date().getTime();
      review.at = null;
      all.unshift(review);
      form.elements.text.value = '';
      say('Sent - thanks!');
      showList();
      draw();
      return;
    }
    if (!db || !uid) { say('Still connecting - try again in a moment.'); return; }
    review.at = firebase.firestore.FieldValue.serverTimestamp();
    var sendBtn = form.querySelector('.rv-send');
    sendBtn.disabled = true;
    db.collection(COLLECTION).add(review).then(function () {
      form.elements.text.value = '';
      say('Sent - thanks!');
    }).catch(function () {
      say('That didn\'t send - try again.');
    }).then(function () { sendBtn.disabled = false; });
  }

  /* ---- the list: this tab's reviews, yours with a Delete ---- */
  function draw() {
    if (FIREBASE_CONFIG && !db) return;
    list.innerHTML = '';
    var shown = 0;
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (r.kind !== tab) continue;
      list.appendChild(item(r));
      shown++;
    }
    if (!shown) {
      var p = document.createElement('p');
      p.className = 'rv-empty';
      p.textContent = tab === 'idea' ? 'No ideas yet - be the first!' : 'No comments yet - be the first!';
      list.appendChild(p);
    }
  }

  /* (everything people wrote goes in as text, never as HTML) */
  function item(r) {
    var box = document.createElement('div');
    box.className = 'rv-item';
    var top = document.createElement('div');
    top.className = 'rv-top';
    if (r.kind === 'comment') {
      var badge = document.createElement('span');
      badge.className = 'rv-badge ' + (r.type === 'complaint' ? 'complaint' : 'praise');
      badge.textContent = r.type === 'complaint' ? 'COMPLAINT' : 'PRAISE';
      top.appendChild(badge);
    }
    var name = document.createElement('span');
    name.className = 'rv-name';
    name.textContent = r.name;
    top.appendChild(name);
    var when = document.createElement('span');
    when.className = 'rv-when';
    when.textContent = r.at && r.at.toDate ? r.at.toDate().toLocaleDateString() : 'just now';
    top.appendChild(when);
    if (r.uid === uid) {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'rv-del';
      del.textContent = 'Delete';
      del.addEventListener('click', function () {
        if (!confirm('Delete this?')) return;
        if (!FIREBASE_CONFIG) {
          for (var k = 0; k < all.length; k++) if (all[k].id === r.id) { all.splice(k, 1); break; }
          draw();
          return;
        }
        db.collection(COLLECTION).doc(r.id).delete().catch(function () { say('That didn\'t delete - try again.'); });
      });
      top.appendChild(del);
    }
    var text = document.createElement('div');
    text.className = 'rv-text';
    text.textContent = r.text;
    box.appendChild(top);
    box.appendChild(text);
    return box;
  }
})();
