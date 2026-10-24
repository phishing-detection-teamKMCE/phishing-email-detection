/* Scores an email with the exported TF-IDF + logistic regression model.
   Mirrors scikit-learn: lowercase, unigrams + bigrams, sublinear tf, idf, L2 norm. */
(function (root) {
  "use strict";
  var M = null;

  function load(model) {
    var index = new Map();
    for (var i = 0; i < model.terms.length; i++) index.set(model.terms[i], i);
    M = { index: index, idf: model.idf, coef: model.coef, b: model.intercept, meta: model };
    return M;
  }

  function tokens(text) {
    var out = [], re = /[\p{L}\p{N}_]{2,}/gu, m;
    while ((m = re.exec(text)) !== null) {
      out.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  function score(text) {
    if (!M) throw new Error("model not loaded");
    var toks = tokens(text), counts = new Map(), i, g, id;
    function add(term) {
      id = M.index.get(term);
      if (id !== undefined) counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (i = 0; i < toks.length; i++) {
      add(toks[i].w);
      if (i + 1 < toks.length) add(toks[i].w + " " + toks[i + 1].w);
    }
    var vals = new Map(), norm = 0, v;
    counts.forEach(function (tf, k) {
      v = (1 + Math.log(tf)) * M.idf[k];
      vals.set(k, v);
      norm += v * v;
    });
    norm = Math.sqrt(norm) || 1;
    var z = M.b, contrib = new Map();
    vals.forEach(function (x, k) {
      var c = (x / norm) * M.coef[k];
      z += c;
      contrib.set(k, c);
    });
    var p = 1 / (1 + Math.exp(-z));

    // per-token influence: a unigram counts fully, a bigram is shared by its two words
    var per = new Array(toks.length).fill(0), t;
    for (i = 0; i < toks.length; i++) {
      id = M.index.get(toks[i].w);
      if (id !== undefined && contrib.has(id)) per[i] += contrib.get(id) / counts.get(id);
      if (i + 1 < toks.length) {
        id = M.index.get(toks[i].w + " " + toks[i + 1].w);
        if (id !== undefined && contrib.has(id)) {
          t = contrib.get(id) / counts.get(id) / 2;
          per[i] += t; per[i + 1] += t;
        }
      }
    }
    var words = toks.map(function (tk, j) { return { w: tk.w, start: tk.start, end: tk.end, s: per[j] }; });
    return { p: p, z: z, words: words, known: counts.size };
  }

  function topWords(words, n) {
    var agg = new Map();
    words.forEach(function (x) { agg.set(x.w, (agg.get(x.w) || 0) + x.s); });
    var arr = Array.from(agg, function (e) { return { w: e[0], s: e[1] }; });
    var bad = arr.filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, n);
    var good = arr.filter(function (x) { return x.s < 0; }).sort(function (a, b) { return a.s - b.s; }).slice(0, n);
    return { bad: bad, good: good };
  }

  root.Scorer = { load: load, score: score, topWords: topWords, tokens: tokens };
  if (typeof module !== "undefined") module.exports = root.Scorer;
})(typeof window !== "undefined" ? window : globalThis);
