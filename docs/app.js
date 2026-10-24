/* Catch the Phish: single-page app. Scoring runs in the browser; accounts and history use Supabase. */
(function () {
  "use strict";

  var CFG = window.APP_CONFIG || {};
  var view = document.getElementById("view");
  var state = { user: null, model: null, modelErr: "", last: null, items: null, filter: "all", q: "", prefill: "" };

  /* ---------- tiny helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function rot(seed, max) {
    var h = 0, s = String(seed);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (((Math.abs(h) % 1000) / 1000) * 2 - 1) * (max || 2.5);
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return String(iso); }
  }
  function nameOf(u) {
    if (!u) return "";
    var m = u.user_metadata || {};
    return m.name || (u.email ? u.email.split("@")[0] : "friend");
  }
  function burst(kind) {
    var fx = $("#fx"), set = kind === "bad" ? ["🎣", "⚠️", "☠️", "🐟"] : ["✔", "★", "🎉", "🌿"];
    for (var i = 0; i < 18; i++) {
      var b = document.createElement("span");
      b.className = "bit";
      b.textContent = set[i % set.length];
      b.style.left = (30 + Math.random() * 40) + "vw";
      b.style.top = (35 + Math.random() * 20) + "vh";
      b.style.setProperty("--dx", ((Math.random() - 0.5) * 70) + "vw");
      b.style.setProperty("--dy", ((Math.random() - 0.7) * 60) + "vh");
      b.style.setProperty("--rot", ((Math.random() - 0.5) * 540) + "deg");
      fx.appendChild(b);
      (function (el) { setTimeout(function () { el.remove(); }, 1800); })(b);
    }
    if (kind === "bad") {
      view.classList.add("shake");
      setTimeout(function () { view.classList.remove("shake"); }, 520);
    }
  }

  /* ---------- data layer: Supabase, or a browser-only demo mode ---------- */
  var sb = null;
  if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase) {
    try { sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); } catch (e) { sb = null; }
  }
  var demo = !sb;

  function norm(r) {
    return { id: r.id, text: r.email_text, label: r.label, prob: Number(r.probability), words: r.top_words || { bad: [], good: [] }, at: r.created_at };
  }

  var DB = sb ? {
    user: async function () { var r = await sb.auth.getSession(); return r.data.session ? r.data.session.user : null; },
    signUp: async function (email, pw, name) {
      var r = await sb.auth.signUp({ email: email, password: pw, options: { data: { name: name } } });
      if (r.error) throw r.error;
      return { needsConfirm: !r.data.session };
    },
    signIn: async function (email, pw) { var r = await sb.auth.signInWithPassword({ email: email, password: pw }); if (r.error) throw r.error; },
    signOut: async function () { await sb.auth.signOut(); },
    list: async function () {
      var r = await sb.from("scans").select("*").order("created_at", { ascending: false }).limit(1000);
      if (r.error) throw r.error;
      return r.data.map(norm);
    },
    add: async function (it) {
      var r = await sb.from("scans").insert({ email_text: it.text, label: it.label, probability: it.prob, top_words: it.words }).select().single();
      if (r.error) throw r.error;
      return norm(r.data);
    },
    addMany: async function (items) {
      var rows = items.map(function (it) {
        return { email_text: it.text, label: it.label, probability: it.prob, top_words: it.words, created_at: it.at };
      });
      var r = await sb.from("scans").insert(rows);
      if (r.error) throw r.error;
    },
    remove: async function (id) { var r = await sb.from("scans").delete().eq("id", id); if (r.error) throw r.error; },
    clear: async function () { var r = await sb.from("scans").delete().eq("user_id", state.user.id); if (r.error) throw r.error; }
  } : {
    user: async function () { return lsGet("ctp_user", null); },
    signUp: async function (email, pw, name) { lsSet("ctp_user", { id: "local", email: email, user_metadata: { name: name } }); return { needsConfirm: false }; },
    signIn: async function (email) { lsSet("ctp_user", { id: "local", email: email, user_metadata: {} }); },
    signOut: async function () { lsDel("ctp_user"); },
    list: async function () { return lsGet("ctp_scans", []).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; }); },
    add: async function (it) {
      var all = lsGet("ctp_scans", []);
      var row = { id: "l" + Date.now() + Math.floor(Math.random() * 1000), text: it.text, label: it.label, prob: it.prob, words: it.words, at: new Date().toISOString() };
      all.push(row); lsSet("ctp_scans", all); return row;
    },
    addMany: async function (items) {
      var all = lsGet("ctp_scans", []);
      items.forEach(function (it, i) { all.push({ id: "l" + Date.now() + "_" + i, text: it.text, label: it.label, prob: it.prob, words: it.words, at: it.at }); });
      lsSet("ctp_scans", all);
    },
    remove: async function (id) { lsSet("ctp_scans", lsGet("ctp_scans", []).filter(function (r) { return r.id !== id; })); },
    clear: async function () { lsSet("ctp_scans", []); }
  };

  /* ---------- model ---------- */
  var modelPromise = fetch("model.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("model.json not found"); return r.json(); })
    .then(function (m) { Scorer.load(m); state.model = m; return m; })
    .catch(function (e) { state.modelErr = String(e.message || e); return null; });

  function verdictOf(p) {
    if (p >= 0.65) return { key: "bad", label: "phishing", stamp: "Phishy!", line: "This one smells like bait." };
    if (p <= 0.35) return { key: "good", label: "safe", stamp: "Looks safe", line: "Nothing fishy in the words." };
    return { key: "mid", label: "unsure", stamp: "Not sure", line: "Could go either way. Check the sender." };
  }

  /* ---------- header bits ---------- */
  function paintWho() {
    var w = $("#who");
    if (state.user) {
      w.innerHTML = '<span class="hi">Hi, ' + esc(nameOf(state.user)) + '!</span><button class="btn small" id="logout" type="button">Log out</button>';
      $("#logout").onclick = async function () {
        await DB.signOut(); state.user = null; state.items = null; paintWho(); toast("Logged out. See you!"); location.hash = "#/";
      };
    } else {
      w.innerHTML = '<a class="btn small" href="#/login">Log in</a><a class="btn small pink" href="#/signup">Sign up</a>';
    }
  }
  function paintBanner() {
    var b = $("#banner");
    if (demo) { b.hidden = false; b.textContent = "Demo mode: Supabase is not connected yet, so accounts and history stay only in this browser."; }
    else b.hidden = true;
  }

  /* ---------- views ---------- */
  function home() {
    view.innerHTML =
      '<div class="hero"><div>' +
      '<h1>Don’t take the <span class="squig">bait.</span></h1>' +
      '<p class="sub">Paste a suspicious email and get a verdict <b>with receipts</b>: the exact words that made it look phishy, highlighted like a teacher with a marker.</p>' +
      '<a class="btn" href="#/scan">Scan an email</a>' +
      (state.user ? '<a class="btn pink" href="#/history">My history</a>' : '<a class="btn pink" href="#/signup">Make an account</a>') +
      '<svg class="hand-arrow" viewBox="0 0 90 46"><path d="M4 30C24 4 50 4 78 26M78 26l-14-2M78 26l-6 13"/></svg>' +
      '<div class="statrow" id="stats"></div>' +
      '</div><div class="hero-art">' +
      '<div class="note n1"><h3>URGENT!!</h3>Verify your account now or it will be closed</div>' +
      '<div class="note n2"><h3>Which is the bait? 🎣</h3>Hint: not the one that says thanks.</div>' +
      '<div class="note n3"><h3>Hi team,</h3>Notes from Tuesday are attached. Cheers!</div>' +
      '</div></div>' +
      '<div class="grid3" style="margin-top:26px">' +
      '<div class="note blue" style="--r:-2deg"><h3>Highlights, not vibes</h3>Every word gets a score, so you can see why.</div>' +
      '<div class="note mint" style="--r:1.5deg"><h3>History that sticks</h3>Log in and every scan is saved to your own account.</div>' +
      '<div class="note orange" style="--r:-1deg"><h3>Backup anytime</h3>Download your history, or restore it later.</div>' +
      '</div>';
    modelPromise.then(function (m) {
      var s = $("#stats");
      if (!s || !m) return;
      s.innerHTML =
        '<div class="stat">' + (m.metrics.accuracy * 100).toFixed(1) + '%<small>test accuracy</small></div>' +
        '<div class="stat">' + Number(m.n_train).toLocaleString() + '<small>emails it learned from</small></div>' +
        '<div class="stat">0<small>servers, it runs in your browser</small></div>';
    });
  }

  var SAMPLE_BAD = "URGENT: Your account has been suspended due to unusual activity.\nClick the link below immediately to verify your password and bank details, or your account will be permanently closed.\nhttp://secure-login-verify.example.com\nCongratulations, you have also won a free prize!";
  var SAMPLE_GOOD = "Hi Priya,\nAttaching the meeting notes from Tuesday. The next review is on Thursday at 3 pm, and I have added the budget sheet to the shared folder.\nLet me know if I missed anything.\nThanks,\nRahul";

  function gaugeSVG(p) {
    var ang = -90 + 180 * p;
    return '<svg class="gauge" viewBox="0 0 200 124" role="img" aria-label="Phishing probability ' + Math.round(p * 100) + ' percent">' +
      '<g filter="url(#wobble)" fill="none" stroke-linecap="butt">' +
      '<path d="M20 100A80 80 0 0 1 60 30.7M60 30.7A80 80 0 0 1 140 30.7M140 30.7A80 80 0 0 1 180 100" stroke="#222" stroke-width="24"/>' +
      '<path d="M22 100A78 78 0 0 1 59 32.5" stroke="#43c277" stroke-width="16"/>' +
      '<path d="M61 32.5A78 78 0 0 1 139 32.5" stroke="#ffd23f" stroke-width="16"/>' +
      '<path d="M141 32.5A78 78 0 0 1 178 100" stroke="#ff4d64" stroke-width="16"/></g>' +
      '<g class="needle" id="needle" style="transform:rotate(-90deg)" data-ang="' + ang + '">' +
      '<path d="M96 100L100 28L104 100Z" fill="#222" stroke="#222" stroke-width="3" stroke-linejoin="round"/></g>' +
      '<circle cx="100" cy="100" r="9" fill="#ffe45c" stroke="#222" stroke-width="3.5"/>' +
      '<text x="12" y="118" font-size="15" font-family="Caveat,cursive" font-weight="700" fill="currentColor">safe</text>' +
      '<text x="150" y="118" font-size="15" font-family="Caveat,cursive" font-weight="700" fill="currentColor">phishy</text></svg>';
  }

  function highlight(text, words) {
    var max = 0;
    words.forEach(function (w) { if (Math.abs(w.s) > max) max = Math.abs(w.s); });
    if (max === 0) return esc(text);
    var thr = Math.max(0.02, max * 0.2), out = "", pos = 0;
    words.forEach(function (w) {
      out += esc(text.slice(pos, w.start));
      var seg = esc(text.slice(w.start, w.end));
      if (Math.abs(w.s) >= thr) {
        var a = Math.min(0.85, 0.25 + 0.65 * Math.abs(w.s) / max);
        out += '<mark class="' + (w.s > 0 ? "bad" : "good") + '" style="--a:' + a.toFixed(2) + '">' + seg + "</mark>";
      } else out += seg;
      pos = w.end;
    });
    return out + esc(text.slice(pos));
  }

  function chips(list, cls) {
    if (!list.length) return '<span class="muted">none stood out</span>';
    return list.map(function (w, i) {
      var word = typeof w === "string" ? w : w.w;
      return '<span class="w ' + cls + '" style="--r:' + rot(word + i, 3).toFixed(1) + 'deg">' + esc(word) + "</span>";
    }).join("");
  }

  function showResult(text, res) {
    var v = verdictOf(res.p), top = Scorer.topWords(res.words, 6);
    var out = $("#out");
    var few = res.known < 5 ? '<p class="muted">Heads up: very few words in this text were known to the model, so take this with a pinch of salt.</p>' : "";
    out.innerHTML =
      '<div class="result card"><div class="verdict">' + gaugeSVG(res.p) +
      '<div class="pct">' + (res.p * 100).toFixed(0) + '% phishy</div>' +
      '<div class="stamp ' + v.key + '">' + v.stamp + '</div><p>' + v.line + '</p></div>' +
      '<div><h3>Why? <span class="legend"><mark class="bad" style="--a:.6">pushes toward phishing</mark> <mark class="good" style="--a:.6">pushes toward safe</mark></span></h3>' +
      '<div class="read">' + highlight(text, res.words) + '</div>' + few +
      '<h3 style="margin-top:14px">Bait words</h3><div class="words">' + chips(top.bad, "") + '</div>' +
      '<h3>Calm words</h3><div class="words">' + chips(top.good, "g") + '</div></div></div>';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var n = $("#needle");
        if (n) n.style.transform = "rotate(" + n.getAttribute("data-ang") + "deg)";
      });
    });
    out.scrollIntoView({ behavior: "smooth", block: "start" });
    if (v.key !== "mid") burst(v.key);
    return v;
  }

  async function scanView() {
    view.innerHTML =
      '<h2>Scan an email</h2><p class="big-note">paste it below, then hit the button</p>' +
      '<div class="scan"><textarea id="txt" class="in" maxlength="8000" placeholder="Paste the whole email here, subject line and all..."></textarea>' +
      '<div class="row"><button class="btn" id="go" type="button">Check it!</button>' +
      '<button class="btn pink small" id="sP" type="button">phishing sample</button>' +
      '<button class="btn green small" id="sS" type="button">safe sample</button>' +
      '<button class="btn blue small" id="clr" type="button">clear</button><span class="sp"></span>' +
      '<label class="tog"><input type="checkbox" id="save"' + (state.user ? " checked" : " disabled") + '> ' +
      (state.user ? "save to my history" : '<a href="#/login">log in</a> to save') + '</label></div></div><div id="out"></div>';
    var txt = $("#txt");
    if (state.prefill) { txt.value = state.prefill; state.prefill = ""; }
    $("#sP").onclick = function () { txt.value = SAMPLE_BAD; };
    $("#sS").onclick = function () { txt.value = SAMPLE_GOOD; };
    $("#clr").onclick = function () { txt.value = ""; $("#out").innerHTML = ""; txt.focus(); };
    var go = $("#go");
    go.onclick = async function () {
      var text = txt.value.trim();
      if (text.length < 20) { toast("Paste a bit more text first"); return; }
      go.disabled = true;
      var m = await modelPromise;
      if (!m) {
        $("#out").innerHTML = '<div class="card"><h3>The model file is missing</h3><p class="err">Could not load model.json (' + esc(state.modelErr) + ').</p><p>Run <code>python -m src.export_web</code> and put the created <code>docs/model.json</code> next to this page. See WEBSITE_SETUP.md.</p></div>';
        go.disabled = false; return;
      }
      var res = Scorer.score(text), v = showResult(text, res);
      last = { text: text, prob: res.p, label: v.label, words: { bad: Scorer.topWords(res.words, 6).bad.map(function (x) { return x.w; }), good: Scorer.topWords(res.words, 6).good.map(function (x) { return x.w; }) } };
      var sv = $("#save");
      if (state.user && sv && sv.checked) {
        try { await DB.add(last); state.items = null; toast("Saved to your history"); }
        catch (e) { toast("Could not save: " + (e.message || e)); }
      }
      go.disabled = false;
    };
  }
  var last = null;

  function needLogin(what) {
    view.innerHTML = '<div class="empty"><div class="big-note">psst... you need an account for ' + esc(what) + '</div>' +
      '<p>Sign up takes ten seconds. Your scans then stay saved to your account.</p>' +
      '<a class="btn" href="#/login">Log in</a><a class="btn pink" href="#/signup">Sign up</a></div>';
  }

  async function loadItems() {
    if (state.items) return state.items;
    state.items = await DB.list();
    return state.items;
  }

  async function historyView() {
    if (!state.user) { needLogin("your history"); return; }
    view.innerHTML = '<h2>My history</h2><p class="skel">flipping through your pages...</p>';
    var items;
    try { items = await loadItems(); }
    catch (e) { view.innerHTML = '<h2>My history</h2><p class="err">Could not load history: ' + esc(e.message || e) + "</p>"; return; }
    var cnt = { bad: 0, good: 0, mid: 0 };
    items.forEach(function (it) { cnt[it.label === "phishing" ? "bad" : it.label === "safe" ? "good" : "mid"]++; });
    var mx = Math.max(1, cnt.bad, cnt.good, cnt.mid);
    function bar(n, col, nm) { return '<div><div class="bar" style="height:' + Math.max(34, Math.round(110 * n / mx)) + 'px;background:' + col + '">' + n + '</div><div class="meta" style="text-align:center;font-family:var(--f-note);font-size:1.3rem">' + nm + "</div></div>"; }
    view.innerHTML = '<h2>My history</h2>' +
      (items.length ? '<div class="bars">' + bar(cnt.bad, "#ff8d97", "phishy") + bar(cnt.good, "#aef0bf", "safe") + bar(cnt.mid, "#ffd7a8", "unsure") + "</div>" : "") +
      '<div class="row" style="margin-top:12px"><input id="q" class="in" style="max-width:340px" placeholder="search your scans..." value="' + esc(state.q) + '"><span class="sp"></span><a class="btn small blue" href="#/backup">Backup</a></div>' +
      '<div class="chips" id="chips"></div><div id="list"></div>';
    function paintList() {
      var q = state.q.toLowerCase(), f = state.filter;
      $("#chips").innerHTML = [["all", "All"], ["phishing", "Phishy"], ["safe", "Safe"], ["unsure", "Unsure"]].map(function (c, i) {
        return '<button type="button" class="chip' + (f === c[0] ? " on" : "") + '" data-f="' + c[0] + '" style="--r:' + (i % 2 ? 1 : -1) + 'deg">' + c[1] + "</button>";
      }).join("");
      var shown = items.filter(function (it) { return (f === "all" || it.label === f) && (!q || it.text.toLowerCase().indexOf(q) >= 0); });
      if (!items.length) {
        $("#list").innerHTML = '<div class="empty"><div class="big-note">Nothing here yet!</div><p>Scan an email and tick “save to my history”.</p><a class="btn" href="#/scan">Scan one now</a></div>';
      } else if (!shown.length) {
        $("#list").innerHTML = '<p class="big-note">no scans match that...</p>';
      } else {
        $("#list").className = "hist";
        $("#list").innerHTML = shown.map(function (it) {
          var k = it.label === "phishing" ? "pink" : it.label === "safe" ? "mint" : "orange";
          var mk = it.label === "phishing" ? "" : it.label === "safe" ? "good" : "mid";
          var wd = it.words || { bad: [], good: [] };
          return '<div class="hcard"><div class="note ' + k + '" style="--r:' + rot(it.id, 2.6).toFixed(1) + 'deg">' +
            '<div class="meta"><span class="mini ' + mk + '">' + esc(it.label) + "</span> " + Math.round(it.prob * 100) + "% phishy<br>" + esc(fmtDate(it.at)) + "</div>" +
            "<p>" + esc(it.text.slice(0, 200)) + (it.text.length > 200 ? "..." : "") + "</p>" +
            ((wd.bad && wd.bad.length) ? '<div class="muted">bait: ' + esc(wd.bad.slice(0, 4).join(", ")) + "</div>" : "") +
            '<div class="row" style="margin-top:8px"><button class="btn small blue" data-open="' + esc(it.id) + '" type="button">Open again</button>' +
            '<button class="btn small red" data-del="' + esc(it.id) + '" type="button">Delete</button></div></div></div>';
        }).join("");
      }
      if (items.length && shown.length) $("#list").className = "hist"; else $("#list").className = "";
    }
    paintList();
    $("#q").oninput = function (e) { state.q = e.target.value; paintList(); };
    view.onclick = async function (e) {
      var t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.f) { state.filter = t.dataset.f; paintList(); }
      else if (t.dataset.open) {
        var it = items.filter(function (x) { return String(x.id) === t.dataset.open; })[0];
        if (it) { state.prefill = it.text; location.hash = "#/scan"; }
      } else if (t.dataset.del) {
        try { await DB.remove(t.dataset.del); items = items.filter(function (x) { return String(x.id) !== t.dataset.del; }); state.items = items; toast("Deleted"); historyView(); }
        catch (er) { toast("Could not delete: " + (er.message || er)); }
      }
    };
  }

  function download(name, mime, content) {
    var a = document.createElement("a"), url = URL.createObjectURL(new Blob([content], { type: mime }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function backupView() {
    if (!state.user) { needLogin("backups"); return; }
    view.innerHTML = '<h2>Backup &amp; restore</h2><p class="skel">counting your pages...</p>';
    var items;
    try { items = await loadItems(); } catch (e) { view.innerHTML = '<h2>Backup</h2><p class="err">' + esc(e.message || e) + "</p>"; return; }
    var lastB = lsGet("ctp_last_backup", null);
    view.innerHTML =
      '<h2>Backup &amp; restore</h2><p class="big-note">your history is saved online, but a copy never hurts</p>' +
      '<div class="card"><h3>Download a copy</h3><p>You have <b>' + items.length + '</b> saved scan' + (items.length === 1 ? "" : "s") + '. ' +
      (lastB ? "Last backup: " + esc(fmtDate(lastB)) + "." : "No backup yet.") + '</p>' +
      '<button class="btn green" id="bj" type="button">Download JSON</button><button class="btn blue" id="bc" type="button">Download CSV</button></div>' +
      '<div class="card"><h3>Restore from a backup</h3><p>Choose a JSON file made here. The scans in it are added to your history.</p><input type="file" id="fi" accept=".json,application/json"> <div id="imsg" class="ok"></div></div>' +
      '<div class="card"><h3>Start fresh</h3><p>Deletes all your saved scans. Type <b>DELETE</b> to unlock the button.</p>' +
      '<input class="in" id="dtxt" style="max-width:220px" placeholder="DELETE" autocomplete="off"> <button class="btn red" id="dall" type="button" disabled>Delete everything</button></div>';

    function stamp() { lsSet("ctp_last_backup", new Date().toISOString()); }
    $("#bj").onclick = function () {
      var data = { app: "catch-the-phish", version: 1, exported: new Date().toISOString(), scans: items.map(function (i) { return { text: i.text, label: i.label, prob: i.prob, words: i.words, at: i.at }; }) };
      download("catch-the-phish-backup.json", "application/json", JSON.stringify(data, null, 2)); stamp(); toast("Backup downloaded");
    };
    $("#bc").onclick = function () {
      var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
      var csv = "saved_at,label,probability,text\n" + items.map(function (i) { return [q(i.at), q(i.label), i.prob.toFixed(4), q(i.text)].join(","); }).join("\n");
      download("catch-the-phish-history.csv", "text/csv", csv); stamp(); toast("CSV downloaded");
    };
    $("#fi").onchange = async function (e) {
      var f = e.target.files[0], msg = $("#imsg");
      if (!f) return;
      msg.className = "ok";
      try {
        var data = JSON.parse(await f.text());
        if (!data || !Array.isArray(data.scans)) throw new Error("this does not look like a backup file");
        var good = data.scans.filter(function (s) { return s && typeof s.text === "string" && s.text && ["phishing", "safe", "unsure"].indexOf(s.label) >= 0 && isFinite(s.prob); })
          .slice(0, 2000).map(function (s) {
            return { text: s.text.slice(0, 8000), label: s.label, prob: Math.min(1, Math.max(0, Number(s.prob))), words: s.words && typeof s.words === "object" ? { bad: (s.words.bad || []).slice(0, 8).map(String), good: (s.words.good || []).slice(0, 8).map(String) } : { bad: [], good: [] }, at: isNaN(Date.parse(s.at)) ? new Date().toISOString() : new Date(s.at).toISOString() };
          });
        if (!good.length) throw new Error("no valid scans found in that file");
        await DB.addMany(good); state.items = null;
        msg.textContent = "Restored " + good.length + " scan" + (good.length === 1 ? "" : "s") + ".";
        toast("Backup restored");
      } catch (er) { msg.className = "err"; msg.textContent = "Could not restore: " + (er.message || er); }
    };
    $("#dtxt").oninput = function (e) { $("#dall").disabled = e.target.value !== "DELETE"; };
    $("#dall").onclick = async function () {
      try { await DB.clear(); state.items = null; toast("All history deleted"); backupView(); }
      catch (er) { toast("Could not delete: " + (er.message || er)); }
    };
  }

  async function aboutView() {
    view.innerHTML =
      '<h2>How it works</h2><p class="big-note">no magic, just word-counting with good manners</p>' +
      '<div class="grid3"><div class="note blue" style="--r:-1.5deg"><h3>1. You paste</h3>The text never leaves your browser while it is being scored.</div>' +
      '<div class="note pink" style="--r:1.2deg"><h3>2. Words get weights</h3>The model learned which words and word pairs show up in phishing, like “verify your”, and which show up in normal mail.</div>' +
      '<div class="note mint" style="--r:-.8deg"><h3>3. You see the receipts</h3>Weights add up to a score. The marker colours show what pushed it either way.</div></div>' +
      '<div class="card"><h3>The honest bit</h3><div id="honest"><p class="skel">loading numbers...</p></div></div>' +
      '<div class="card"><h3>Limits</h3><ul><li>The training emails are old (about 2001 to 2004), so new, AI-written phishing can fool it.</li><li>It reads text only. Links, headers and attachments are not checked.</li><li>This is a study project, not a security product. When in doubt, ask the real sender.</li></ul></div>' +
      '<div class="card"><h3>Privacy</h3><p>Scoring happens in your browser. If you log in and tick “save”, the email text is stored in your own account and only you can read it (database row-level security). You can delete it any time from History or Backup.</p></div>' +
      '<p><a class="btn" href="' + esc(CFG.REPO_URL || "#") + '" target="_blank" rel="noopener">Code on GitHub</a><a class="btn green" href="' + esc(CFG.COLAB_URL || "#") + '" target="_blank" rel="noopener">Try the BERT model in Colab</a></p>';
    var m = await modelPromise, h = $("#honest");
    if (!h) return;
    h.innerHTML = m
      ? '<p>This site runs a light model (TF-IDF + logistic regression) right in your browser. On ' + Number(m.n_test).toLocaleString() + ' emails it never saw, it scored <b>' + (m.metrics.accuracy * 100).toFixed(1) + '% accuracy</b> and <b>F1 ' + m.metrics.f1.toFixed(3) + '</b>.</p><p>The project’s heavier hybrid model (DistilBERT + attention + CNN + BiGRU) scores about the same on this dataset, so the data is nearly saturated. That model is too big to run free in a browser, so it lives in the GitHub repo and the Colab demo.</p>'
      : '<p class="err">model.json was not found, so the numbers are not available yet.</p>';
  }

  function authView(mode) {
    var signup = mode === "signup";
    view.innerHTML = '<div style="max-width:460px"><h2>' + (signup ? "Join the club" : "Welcome back") + '</h2>' +
      '<p class="big-note">' + (signup ? "so your scans get saved" : "your history is waiting") + '</p>' +
      '<form id="af" class="card" novalidate>' +
      (signup ? '<label class="f" for="nm">Name</label><input class="in" id="nm" autocomplete="name">' : "") +
      '<label class="f" for="em">Email</label><input class="in" id="em" type="email" autocomplete="email" required>' +
      '<label class="f" for="pw">Password' + (signup ? " (8+ characters)" : "") + '</label><input class="in" id="pw" type="password" autocomplete="' + (signup ? "new-password" : "current-password") + '" required>' +
      (signup ? '<label class="f" for="pw2">Password again</label><input class="in" id="pw2" type="password" autocomplete="new-password">' : "") +
      '<div id="aerr" class="err"></div><button class="btn" id="asub" type="submit">' + (signup ? "Sign me up" : "Log in") + '</button></form>' +
      '<p>' + (signup ? 'Already have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/signup">Sign up</a>') + ' &middot; <a href="#/scan">or just scan as a guest</a></p></div>';
    $("#af").onsubmit = async function (e) {
      e.preventDefault();
      var err = $("#aerr"), email = $("#em").value.trim(), pw = $("#pw").value, btn = $("#asub");
      err.className = "err"; err.textContent = "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "That email does not look right."; return; }
      if (signup && pw.length < 8) { err.textContent = "Use at least 8 characters for the password."; return; }
      if (signup && pw !== $("#pw2").value) { err.textContent = "The two passwords do not match."; return; }
      if (!signup && !pw) { err.textContent = "Type your password."; return; }
      btn.disabled = true;
      try {
        if (signup) {
          var r = await DB.signUp(email, pw, $("#nm").value.trim());
          if (r.needsConfirm) { err.className = "ok"; err.textContent = "Almost done! Check your inbox and click the confirm link, then log in."; btn.disabled = false; return; }
        } else await DB.signIn(email, pw);
        state.user = await DB.user(); state.items = null; paintWho();
        toast(signup ? "Welcome aboard!" : "Logged in. Nice to see you!");
        location.hash = "#/scan";
      } catch (er) {
        err.textContent = (er.message || String(er)).replace(/^AuthApiError: /, "");
        btn.disabled = false;
      }
    };
  }

  /* ---------- router ---------- */
  var routes = { "": home, scan: scanView, history: historyView, backup: backupView, about: aboutView, login: function () { authView("login"); }, signup: function () { authView("signup"); } };
  function render() {
    var r = (location.hash || "#/").replace(/^#\/?/, "").split("?")[0];
    var fn = routes[r] || home;
    view.onclick = null; view.className = "sheet";
    view.style.animation = "none"; void view.offsetWidth; view.style.animation = "";
    Array.prototype.forEach.call(document.querySelectorAll("#nav a"), function (a) { a.classList.toggle("on", a.getAttribute("data-r") === r); });
    fn();
    window.scrollTo(0, 0);
  }

  /* ---------- boot ---------- */
  var root = document.documentElement;
  var savedTheme = lsGet("ctp_theme", null);
  if (!savedTheme && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) savedTheme = "chalk";
  root.setAttribute("data-theme", savedTheme === "chalk" ? "chalk" : "paper");
  $("#modeBtn").onclick = function () {
    var next = root.getAttribute("data-theme") === "chalk" ? "paper" : "chalk";
    root.setAttribute("data-theme", next); lsSet("ctp_theme", next);
  };
  $("#logoFish").addEventListener("click", function (e) {
    e.preventDefault(); var f = e.currentTarget; f.classList.remove("swim"); void f.getBoundingClientRect(); f.classList.add("swim");
  });
  window.addEventListener("hashchange", render);
  paintBanner();
  (async function () {
    try { state.user = await DB.user(); } catch (e) { state.user = null; }
    if (sb) sb.auth.onAuthStateChange(function (ev, session) { state.user = session ? session.user : null; paintWho(); });
    paintWho();
    render();
  })();
})();
