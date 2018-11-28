// Utilities
//   $ enhances querySelectorAll
function $ (sel, node) { return Array.prototype.slice.call( (node || document).querySelectorAll(sel) ) }

//   $.addEvents enhances addEventListener
$.addEvents = function (obj, node) {
  for (var q in obj) for (var e in obj[q])
    for (var ns = q ? $(q, node) : [window, document], es = e.split(' '), i = 0; i < es.length; i++)
      typeof ns === 'undefined' || ns.forEach(n => n.addEventListener(es[i], obj[q][e].bind(n))) };

//   $.load enhances importNode
$.load = function (id, query) {
  (typeof query === 'undefined' ? [document.body] : $(query))
    .forEach(n => n.appendChild(document.importNode($('template#' + id)[0].content, true))) };

//   $.Machine creates state machines for the page
$.Machine = function (state) {
  let es = {}, v = Object.values, r = Promise.resolve.bind(Promise);
  return Object.assign(this, {
    getState () { return state },
    on (e, fn) { (es[e] = es[e] || {})[fn.name] = fn; return this },
    emit (e, ...args) { return e in es && v(es[e]).reduce((s, fn) => (fn.apply(s, args), s), state) },
    emitAsync (e, ...args) { return e in es && v(es[e]).reduce((p, fn) => p.then(s => r(fn.apply(s, args)).then(() => s)), r(state)) },
    stop (e, fname = '') { e in es && delete es[e][fname]; return this } }) }

// TODO: repacement Promise for IE11/Opera mini, replace arrow functions, importNode
