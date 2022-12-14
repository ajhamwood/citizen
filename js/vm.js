// Interpreter for dependent type theory with implicit arguments

function VM (options = {}) {
  let { debug = { showPhase: false } } = options, phase = null;
  debug = (debugOpts => new Proxy(function () {}, { get ({}, prop) {
    let colour = (msg, thrown = false) => thrown && prop === "log" ? [ `%c${msg}`, "font-weight: bold; color: firebrick" ] : [msg],
        declutter = v => { if (v?.hasOwnProperty("source")) { let { source, ...o } = v; return [o] } else return [v] },
        serialise = (ar, ctx, thrown) => ar.flatMap((o, i) => [ ...(i === 0 && ar.length > 1 ? ["|"] : []), ...colour("{", thrown),
          ...Object.entries(o ?? {}).flatMap(([k, v], i, ar) => [ `${k}:`,
            ...(typeof v === "string" ? [`\`${v}\``] : AST.isPrototypeOf(v?.constructor) ? [`${v.toString(ctx)}`, v] : [v]), ...(i === ar.length - 1 ? [] : [","]) ]), "}" ])
    return debugOpts !== true && debugOpts?.showPhase !== phase ? () => () => {} :
      prop === "log" || prop === "group" ? (ctx, thrown = false) => (v, ...rest) => { console[prop](...(typeof v === "string" ? colour(v) : serialise(declutter(v), ctx, thrown)),
        ...serialise(rest.flatMap(declutter), ctx),
        (stack => { try { throw new Error('') } catch (e) { stack = e.stack || "" }
          return stack.split(`\n`)[3].replace(/@.*(js)/g, "") })()) } : console[prop]
  }, apply ({}, _, [fn, name, self]) {
    return debugOpts !== true && debugOpts?.showPhase !== phase ? ({ [name] () {
      let { ctx = {} } = arguments[0] ?? {};
      debug.group(ctx)(name, ...arguments);
      let res = fn.apply(self, arguments);
      debug.groupEnd();
      return res
    } })[name] : fn.bind(self)
  } }))(debug);

  class Result {  // Error handling
    constructor (fn) {
      let thrown = false, value = null;
      const error = v => (thrown = true, v),
            join = (fn, v = value) => (r => { Result.prototype.isPrototypeOf(r) &&
              (x => value = "ok" in x ? x.ok : error(x.err))(r.unwrap()); const { source, ...gctx } = globalContext; debug.log(value?.ctx, thrown)(value, { globalContext: gctx }); })
              (value = fn(v, error));
      this.then = fn => (thrown || join(fn), this);  // On resolve
      this.catch = fn => (thrown && (thrown = false, join(fn)), this);  // On reject
      this.unwrap = () => ({ [ thrown ? "err" : "ok" ]: value });  // Await
      this.toPromise = () => new Promise((ok, err) => this.then(s => ok(s)).catch(e => err(e)));
      return fn(v => join(() => v), e => join(() => error(e)))
    }
    static pure (v) { return new Result(r => r(v)) }  // Resolve
    static throw (e) { return new Result(({}, l) => l(e)) }  // Reject
  }

  const globalContext = { metas: new Map(), checks: new Map(), pos: [], source: "" };

  class AST {
    static names (ctx) { let names = []; ctx.path.forEach(({ bind, define }) => names.push((bind ?? define).name)); return names }
    constructor (o) { Object.assign(this, o) } get [Symbol.toStringTag] () { return "AST" }
  }

  [ "RVar", "RLam", "RApp", "RU", "RPi", "RLet", "RHole",
    "Var", "App", "Lam", "Pi", "U", "Let", "Meta", "AppPruning", "PostponedCheck", "MetaEntry",
    "VRigid", "VFlex", "VLam", "VPi", "VU" ]
    .forEach(name => this[name] = ({ [name]: class extends AST {
      constructor (o) { super(o); if (name in prettyPrint) this.toString = prettyPrint[name] }
      get [Symbol.toStringTag] () { return name }
    } })[name]);

  const
    prettyPrint = {
      RVar () { return `RVar ${this.name}` },
      RLam () {  // nameIcit := name:string | isImpl:boolean
        switch (typeof this.nameIcit) {
          case "boolean": const str = this.mbType === null ? this.name : `${this.name} : ${this.mbType}`;
            return `RLam ${this.nameIcit ? `{${str}}` : this.mbType === null ? str : `(${str})`}. ${this.body}`
          case "string": return `RLam {${this.nameIcit} = ${this.name}}. ${this.body}` } },
      RApp () {   // nameIcit := name:string | isImpl:boolean
        return `(${this.func} :@: ${({ boolean: this.nameIcit ? `{${this.arg}}` : this.arg,
          string: `{${this.nameIcit} = ${this.arg}}` })[typeof this.nameIcit]})` },
      RU () { return "RU" },
      RPi () { return `RPi ${this.isImpl ? `{${this.name} : ${this.dom}}` : `(${this.name} : ${this.dom})`} -> ${this.cod}` },
      RLet () { return `let ${this.name} : ${this.type} = ${this.term};\n${this.next}` },
      RHole () { return `{?}` },

      Var (ctx, names = AST.names(ctx)) { const lvl = names.length - this.ix - 1;
        if (lvl >= 0) { const str = names[lvl]; return str === "_" ? "@" + this.ix : str }
        else return `#${-1 - lvl}` },
      App (ctx, names = AST.names(ctx), prec = 0) {
        const str = `${this.func.toString(ctx, names, 2)} ${this.isImpl ? `{${this.arg.toString(ctx, names, 0)}}` : this.arg.toString(ctx, names, 3)}`;
        return prec > 2 ? `(${str})` : str },
      Lam (ctx, names = AST.names(ctx), prec = 0) { const
        fresh = (names, name) => name === "_" ? "_" : names.reduce((acc, n) => new RegExp(`^${acc}[']*$`).test(n) ? n + "'" : acc, name),
        name = fresh(names, this.name),
        goLam = (names, name, body) => { let res;
          const keepCtx = { ...ctx, env: [...ctx.env] }, ns = names.concat([name]);
          if (body.constructor.name !== "Lam") res = `. ${body.toString(ctx, ns, 0)}`;
          else { const n = fresh(ns, body.name); res = ` ${body.isImpl ? `{${n}}` : n}${goLam(ns, n, body.body)}` }
          Object.assign(ctx, keepCtx);
          return res
        },
        str = `λ ${this.isImpl ? `{${name}}` : name}${goLam(names, name, this.body)}`
        return prec > 0 ? `(${str})` : str },
      Pi (ctx, names = AST.names(ctx), prec = 0) { const
        fresh = (names, name) => name === "_" ? "_" : names.reduce((acc, n) => new RegExp(`^${acc}[']*$`).test(n) ? n + "'" : acc, name),
        name = fresh(names, this.name),
        piBind = (names, name, dom, isImpl) => (body => isImpl ? `{${body}}` : `(${body})`)(name + " : " + dom.toString(ctx, names, 0)),
        goPi = (names, name, cod) => { let res;
          const keepCtx = { ...ctx, env: [...ctx.env] }, ns = names.concat([name]);
          if (cod.constructor.name !== "Pi") res = ` → ${cod.toString(ctx, ns, 1)}`;
          else if (cod.name === "_" ) res = ` → ${cod.dom.toString(ctx, ns, 2)} → ${cod.cod.toString(ctx, ns.concat(["_"]), 1)}`;
          else { const n = fresh(ns, cod.name); res = piBind(ns, n, cod.dom, cod.isImpl) + goPi(ns, n, cod.cod) }
          Object.assign(ctx, keepCtx);
          return res
        },
        str = name === "_" ? `${this.dom.toString(ctx, names, 2)} → ${this.cod.toString(ctx, names.concat(["_"]), 1)}` :
          piBind(names, name, this.dom, this.isImpl) + goPi(names, name, this.cod);
        return prec > 1 ? `(${str})` : str },
      U () { return "U" },
      Let (ctx, names = AST.names(ctx), prec = 0) { const
        fresh = (names, name) => name === "_" ? "_" : names.reduce((acc, n) => new RegExp(`^${acc}[']*$`).test(n) ? n + "'" : acc, name),
        name = fresh(names, this.name),
        str = `let ${name} : ${this.type.toString(ctx, names, 0)}\n    = ${this.term.toString(ctx, names, 0)};\n${this.next.toString(ctx, names.concat([name]), 0)}`;
        return prec > 0 ? `(${str})` : str },
      Meta () { return `?${this.mvar}` },
      AppPruning (ctx, names = AST.names(ctx), prec) {
        const str = this.prun.reduce((str, mbIsImpl, i) => {
          if (mbIsImpl === null) return str;
          const name = names[i], prun = (name === "_" ? "@." + i : name);
          return str + " " + (mbIsImpl ? `{${prun}}` : prun)
        }, this.term.toString(ctx, names, prec));
        return prec > 2 ? `(${str})` : str },
      PostponedCheck (ctx, names = AST.names(ctx), prec = 0) { const problem = globalContext.checks.get(this.checkvar);
        switch (Object.keys(problem)[0]) {
          case "unchecked": return problem.unchecked.ctx.prun.reduceRight((acc, mbIsImpl, ix) => mbIsImpl === null ? acc : 
            new App({ func: acc, arg: new Var({ ix }), isImpl: mbIsImpl }), new Meta({ mvar: problem.unchecked.mvar })).toString(ctx, names, prec);
          case "checked": return problem.checked.term.toString(ctx, names, prec) } },

      MetaEntry (ctx) { return `let ?${this.mvar} : ${this.solnTy.toString(ctx, [])} = ${this.solnTm === null ? "?" : this.solnTm.toString(ctx, []) };` }
    };

  class Parser {  // Rewrite as a bifunctor on state + fail?
    static seq (ps) { return state => ps.reduce((acc, p) => acc.then(p), Result.pure(state)) }
    static do (ps) { return state => ps.reduceRight((acc, p) => (...ss) => p(...ss).then(s => acc(...ss, s)))(state) }
    static reql (p1, p2) { return state => p1(state).then(s1 => p2({ ...s1, data: state.data })) }
    static reqr (p1, p2) { return state => p1(state).then(s1 => p2(s1).then(s2 => ({ ...s2, data: s1.data }))) }
    static map (p, fn) { return state => p(state).then(s => ({ ...s, data: fn(s.data) })) }
    static mapFull (p, fn) { return state => p(state).then(fn) }
    
    static cut (p, msg) { return state => p(state)  // optional error merging fn?
      .catch((e, err) => err({ ...state, fail: e.fail[0] === "_" ? msg : e.fail + (typeof msg === "undefined" ? "" : `\n${msg}`) })) }
    static peek (p) { return state => p(state)
      .catch((e, err) => err({ ...state, fail: "fail" in state && state.fail[0] !== "_" ? state.fail : e.fail[0] === "_" ? e.fail : "_" + e.fail })) }
    static alt (p1, p2) { return state => p1(state)
      .catch((e, err) => e.fail[0] === "_" ? p2(state) : err({ ...state, fail: e.fail })) }
    static choice (ps) { return state => ps
      .reduce((acc, p) => Parser.alt(acc, p))(state) }
    static option (p) { return state => Parser.alt(p, Result.pure)(state) }

    static any ({ source, offset, pos: [row, col], data }) { return new Result((ok, err) => source.length <= offset ?
      err({ source, offset, pos: [row, col], data, fail: "_Any char" }) :
      ok({ source, pos: /\r\n?|\n/g.test(source[offset]) ?
        [row + 1, 1] : [row, col + 1], data: source[offset], offset: offset + 1 })) }
    static eof ({ source, offset, pos, data }) { return new Result((ok, err) => source.length > offset ?
      err({ source, offset, pos, data, fail: "_EOF" }) :
      ok({ source, offset, pos, data: "" })) }
    static satisfy (pred, msg) { return Parser.peek(state => Parser.any(state)
      .then((s, err) => pred(s) ? s : err({ ...s, fail: msg ?? "_Satisfy" }))) }
    static char (c) { return Parser.satisfy(s => s.data === c, `_Char "${c}"`) }
    static many (p) { return state => ((loop = (s, res) => p(s)
      .then(st => loop(st, res.concat([st.data])))
      .catch(({ fail }, err) => res.length && fail[0] === "_" ?
        ({ ...s, data: res }) : err({ ...s, fail }))) => loop(state, []))() }
    static scan (pred, msg) { return state => Parser.many(s1 => Parser.any(s1).then((s2, err) => 
      s2.source.length <= s2.offset ? err({ ...state, fail: msg ?? "_Scan" }) :
        !pred(s2) ? s2 : err({ ...s2, fail: "_" })))(state)  // Use symbol?
      .catch((s3, err) => s3.fail === "_" ? err(s3) : s3) }
    static guard (p, pred, msg) { return state => p(state)
      .then((s, err) => pred(s.data) ? s : err({ ...state, fail: msg ?? "_Guard" })) }

    constructor () {
      for (const [k, fn] of Object.entries({
        setPos ({ start = globalContext.pos[0], end = globalContext.pos[1], writable = true }) {
          globalContext.pos = [ [ ...start ], [ ...end ] ];
          writable || Object.defineProperty(globalContext, "pos", { writable });
          return [ ...globalContext.pos ] },
        ws (state) { return Parser.many(Parser.choice([
          Parser.satisfy(s => /[^\S\r\n]/g.test(s.data), "_HWS"),
          Parser.satisfy(s => /\r\n?|\n/g.test(s.data), "_VWS"),
          Parser.seq([ this.symbol("--", false), Parser.scan(s => /\r\n?|\n/g.test(s.data), "_Comment") ])
        ]))(state) },
        satisfy (pred, msg) { return state => "fail" in state && state.fail[0] !== "_" ? Result.throw(state) : Parser.peek(s => Parser.any(s)
          .then((t, err) => !/[a-zA-Z_0-9\(\)\{\}:=;\\.\-> \r\n]/.test(t.data) ? { ...t, fail: "_" } :
            pred(t) ? t : err({ ...t, fail: msg ?? "_Satisfy" })))(state)
          .then((s, err) => s.fail !== "_" ? s :
            (this.setPos({ start: state.pos, end: s.pos }), err({ ...state, fail: `Found illegal character "${s.data}"` }))) },

        cut (p, msg, newPos) { return s => p(s).catch(e =>
          Parser.cut(Result.throw, e.fail[0] === "_" ? msg : undefined, this.setPos(newPos ?? { start: s.pos, end: e.pos }))(e)) },
        region (p, glyphs) { let [ opener, closer ] = ({ parens: ["(", ")"], braces: ["{", "}"] })[glyphs];
          return Parser.do([ Parser.char(opener),
            ({}, s) => Parser.seq([ Parser.option(this.ws), p ])(s),
            (x, y, s) => Parser.seq([ this.cut(Parser.char(closer), `Unclosed ${glyphs}`, { start: x.pos, end: y.pos }),
              s1 => Parser.option(this.ws)(s1).then(s2 => (({ ...s2, data: s.data }))) ])(s) ]) },
        symbol (str, isTest = true) { return state => Parser.map(Parser.guard(
          Parser.many((isTest ? this : Parser).satisfy(s => s.data === str[s.offset - state.offset - 1], `Symbol: "${str}"`)),
          data => data.length === str.length), data => data.join(""))(state) },
        catchSymbol (p) { return state => p(state).catch((s, err) => s.fail[0] === "_" ? err(s) :
          Parser.mapFull(Parser.many(Parser.satisfy(t => /[^ \(\)\r\n]/.test(t.data))),
            t => { this.setPos({ start: state.pos, end: t.pos, writable: false });
              return err({ ...t, data: t.data.join(""), fail: s.fail }) })(s)) },
        keyword (str) { return state => Parser.seq([ this.symbol(str), s1 => Parser.option(this.ws)(s1)
          .then(s2 => (this.setPos({ start: state.pos, end: s1.pos }), { ...s2, data: s1.data })) ])(state) },
        keyword_ (str) { return state => Parser.seq([ this.symbol(str), s1 => this.ws(s1)
          .then(s2 => (this.setPos({ start: state.pos, end: s1.pos }), { ...s2, data: s1.data })) ])(state) },
        ident (state) { return this.catchSymbol(Parser.reqr(Parser.seq([
          this.satisfy(s => /[a-zA-Z_]/.test(s.data)),
          Parser.do([ Parser.alt(Parser.many(this.satisfy(s => /[a-zA-Z_0-9]/.test(s.data))), s => ({ ...s, data: [] })),
            (s, t) => (this.setPos({ start: state.pos, end: t.pos }), { ...t, data: s.data + t.data.join("") }) ]) ]), Parser.option(this.ws)))(state) },

        atom (state) { return Parser.choice([
          Parser.mapFull(Parser.guard(this.ident, data => !~["let", "U", "_"].findIndex(x => x === data)),
            s => (this.setPos({ start: state.pos }), { ...s, data: new RVar({ name: s.data, pos: globalContext.pos }) })),
          Parser.map(this.keyword("U"), () => new RU({ pos: globalContext.pos })),
          Parser.map(this.keyword("_"), () => new RHole({ pos: globalContext.pos })),
          this.region(this.term, "parens") ])(state) },
        arg (state) { return Parser.choice([
          this.region(Parser.do([ this.ident,
            ({}, s) => Parser.seq([ this.keyword("="), this.cut(this.term, "Malformed named implicit argument") ])(s),
            ({}, s, t) => ({ ...t, data: [ t.data, s.data ] }) ]), "braces"),
          Parser.map(this.region(this.term, "braces"), data => [ data, true ]),
          Parser.map(this.atom, data => [ data, false ]) ])(state) },

        binder (state) { return Parser.map(this.catchSymbol(Parser.alt(this.ident, this.keyword("_"))), data => [ data, globalContext.pos ])(state) },
        spine (state) { return Parser.do([ this.atom, ({}, s) => Parser.alt(Parser.many(this.arg), s => ({ ...s, data: [] }))(s),
          ({}, s, t) => (this.setPos({ start: state.pos }),
            { ...t, data: t.data.reduce((func, [arg, nameIcit]) => new RApp({ func, arg, nameIcit, pos: this.setPos({ end: arg.pos[1] }) }), s.data) }) ])(state) },

        lamBinder (state) { return Parser.choice([
          this.region(Parser.do([ this.binder, ({}, s) => Parser.option(Parser.seq([ this.keyword(":"), this.cut(this.term, "Malformed typed explicit lambda") ]))(s),
            ({}, s, t) => ({ ...t, data: [ s.data[0], false, t.data instanceof Array ? null : t.data, [state.pos, t.pos] ] }) ]), "parens"),
          Parser.peek(this.region(Parser.do([ this.binder, ({}, s) => Parser.option(Parser.seq([ this.keyword(":"), this.cut(this.term, "Malformed typed implicit lambda") ]))(s),
            ({}, s, t) => ({ ...t, data: [ s.data[0], true, t.data instanceof Array ? null : t.data, [state.pos, t.pos] ] }) ]), "braces")),
          this.region(Parser.do([ this.ident, ({}, s) => Parser.seq([ this.keyword("="), this.cut(this.binder, "Malformed named implicit lambda") ])(s),
            ({}, s, t) => ({ ...t, data: [ t.data[0], s.data, null, [state.pos, t.data[1]] ] }) ]), "braces"),
          Parser.map(this.binder, ([ data, pos ]) => [ data, false, null, [state.pos, pos[1]] ]) ])(state) },
        lam (state) { return Parser.do([ this.keyword("\\"),
          ({}, s) => Parser.many(this.lamBinder)(s),
          (x, y, s) => Parser.seq([ this.cut(this.keyword("."), "Lambda without body", { start: x.pos, end: y.pos }), this.term ])(s),
          ({}, {}, s, t) => ({ ...t, data: s.data.reduceRight((acc, [name, nameIcit, mbType, pos]) =>
            new RLam({ name, nameIcit, mbType, body: acc, pos: this.setPos({ start: pos[0] }) }), t.data) }) ])(state) },

        piBinder (state) { let icitBinder = glyphs => this.region(Parser.do([ Parser.many(this.binder),
            ({}, s) => (tm => glyphs === "parens" ? tm : Parser.alt(tm, s => ({ ...s, data: new RHole({ pos: globalContext.pos }) })))
              (Parser.reql(this.keyword(":"), this.term))(s),
            ({}, s, t) => ({ ...t, data: [ s.data, t.data, glyphs === "braces" ] }) ]), glyphs);
          return Parser.alt(icitBinder("braces"), icitBinder("parens"))(state) },
        
        namedPi (state) { return Parser.do([ Parser.many(this.piBinder),
          ({}, s) => Parser.seq([ this.cut(this.catchSymbol(this.keyword("->")), "Expected function type arrow"), this.term ])(s),
          ({}, s, t) => ({ ...t, data: s.data.reduceRight((acc1, [bs, dom, isImpl]) =>
            bs.reduceRight((cod, [name, pos]) => new RPi({ name, dom, cod, isImpl, pos: this.setPos({ start: pos[0] }) }), acc1), t.data) }) ])(state)
              .then(s => (s.data.pos = this.setPos({ start: state.pos }), s)) },
        anonPiOrSpine (state) { return Parser.seq([ this.cut(this.spine, "Malformed spine", {}),
          Parser.option(Parser.do([ Parser.reql(this.keyword("->"), this.cut(this.catchSymbol(this.term), "Malformed term", {})),
            (s, t) => ({ ...t, data: new RPi({ name: "_", dom: s.data, cod: t.data, isImpl: false, pos: this.setPos({ start: state.pos }) }) }) ])) ])(state) },

        let (state) { return Parser.seq([ this.keyword_("let"), this.cut(this.ident, "Malformed variable name", {}), Parser.do([
          Parser.alt(Parser.reql(this.keyword(":"), this.term), s => ({ ...s, data: new RHole({ pos: globalContext.pos }) })),
          ({}, s) => Parser.reql(this.cut(this.keyword("="), 'Let missing "="'), this.term)(s),
          ({}, {}, s) => Parser.reql(this.cut(this.keyword(";"), 'Let missing ";"'), this.term)(s),
          (s, t, u, v) => ({ ...v, data: new RLet({ name: s.data, type: t.data, term: u.data, next: v.data, pos: this.setPos({ start: state.pos }) }) }) ]) ])(state) },
          
        term (state) { return Parser.choice([ this.lam, this.let, this.namedPi, this.anonPiOrSpine ])(state) },
        parse (state) {
          globalContext.source = state.source;
          debug.log()("Parse:");
          return Parser.seq([ Parser.option(this.ws), this.cut(Parser.reqr(this.term, Parser.eof), "No expression found", {}) ])(state)
            .catch(this.displayError)
            .then(state => (debug.log()(`${state.data}`), { data: state.data })) },
        displayError ({ fail }, err) {
          Object.defineProperty(globalContext, "pos", { writable: true });
          let lines = globalContext.source.split(/\r\n?|\n/);
          return err({ fail: fail[0] === "_" ? fail : `Parser error: ${fail}\n${lines[globalContext.pos[0][0] - 1]}\n${"-".repeat(globalContext.pos[0][1] - 1)}${
            "^".repeat((globalContext.pos[1][1] - globalContext.pos[0][1]) || 1)} ${globalContext.pos.join("-")}` }) }
      })) this[k] = debug(fn, k, this);

      return source => (phase = "parser", Result.pure({ source, offset: 0, pos: [1, 0], data: null }))
        .then(this.parse)
        .catch((e, err) => err({ message: e.fail[0] === "_" ? "Unmanaged parser error" : e.fail }))
    }
  }

  class Evaluator {
    static match (sw, { decorate = () => {}, scrut }) {
      let tree = {}, branch;
      for (let k in sw) {
        let cls = k.split(" "), prev, i;
        branch = tree;
        for (i = 0; i < cls.length; i++) {
          if (!(cls[i] in branch)) branch[cls[i]] = {};
          [ prev, branch ] = [ branch, branch[cls[i]] ]
        }
        prev[cls[i - 1]] = ({
          Function: f => ({ [k]: function () {
            let { ctx = {} } = arguments[0];
            debug.log(ctx)(k, ...arguments);
            return f.apply(this, arguments)
          } })[k],
          Array: fs => fs.map(({ guard, clause }) => ({ guard, clause: ({ [k]: function () {
            let { ctx = {} } = arguments[0];
            debug.log(ctx)(k, ...arguments);
            return clause.apply(this, arguments)
          } })[k] }))
        })[sw[k].constructor.name](sw[k])
      }
      return function (obj = {}) {
        let branch = tree, _ = [], run = f => f.apply(this, [obj]), s = [];
        decorate.apply(this, [obj]);
        for (let argName of scrut) if (typeof argName !== "string") {
          let [[ procArgName, fn ]] = Object.entries(argName);
          obj[procArgName] = run(fn);
          s.push(procArgName)
        } else s.push(argName);
        scrutList: for (let argName of s) {
          let name = (n => n in branch ? n : "_")(obj[argName].constructor.name.toLowerCase());
          if (name in branch) {
            inf: while (true) {
              let update = b => b[name];
              switch (branch[name].constructor) {
                case Array:
                  let ix = branch[name].findIndex(fn => run(fn.guard));
                  if (~ix) update = b => b[name][ix].clause;
                  else if (name !== "_" && "_" in branch) { name = "_"; continue }
                  else break inf;
                default:
                  if (name === "_") return run(update(branch));
                  if ("_" in branch) if (branch._.constructor === Array) _.push(branch._);
                    else _ = [ branch._ ];
                  branch = update(branch)
                  continue scrutList
              }
            }
          }
          if (_.length > 0) {
            let cl;
            while (_.length > 0) {
              if ((cl = _.pop()).constructor === Array) {
                let ix = cl.findIndex(fn => run(fn.guard));
                if (~ix) return run(cl[ix].clause);
              } else return run(cl)
            }
          }
          if (_.length === 0) return Result.throw({ msg: "Internal error: No matching clauses" })
        }
        return run(branch)
      }
    }
    constructor () {
      for (const [k, fn] of Object.entries({
        eval: Evaluator.match({
          var ({ term, env }) { return env[env.length - term.ix - 1] },
          app ({ ctx, term, env }) { return this.vApp({ ctx, vfunc: this.eval({ ctx, term: term.func, env }), varg: this.eval({ ctx, term: term.arg, env }), icit: term.isImpl }) },
          lam ({ term, env }) { return new VLam({ name: term.name, cls: { term: term.body, env }, isImpl: term.isImpl }) },
          pi ({ ctx, term, env }) { return new VPi({ name: term.name, dom: this.eval({ ctx, term: term.dom, env }), cls: { term: term.cod, env }, isImpl: term.isImpl }) },
          let ({ ctx, term, env }) { return this.eval({ ctx, term: term.next, env: env.concat([ this.eval({ ctx, env, term: term.term }) ]) }) },
          u () { return new VU() },
          meta ({ term }) { return this.vMeta({ mvar: term.mvar }) },
          apppruning ({ ctx, term, env }) { return this.vAppPruning({ ctx, env, val: this.eval({ ctx, term: term.term, env }), prun: term.prun }) },
          postponedcheck ({ ctx, term, env }) { return this.vCheck({ ctx, env, checkvar: term.checkvar }) }
        }, { scrut: [ "term" ] }),
        cApp ({ ctx, cls: { term, env }, val }) { return this.eval({ ctx, term, env: env.concat([ val ]) }) },
        vApp: Evaluator.match({
          vlam ({ ctx, vfunc, varg }) { return this.cApp({ ctx, cls: vfunc.cls, val: varg }) },
          vflex ({ vfunc, varg, icit }) { return new VFlex({ mvar: vfunc.mvar, spine: vfunc.spine.concat([ [varg, icit] ]) }) },
          vrigid ({ vfunc, varg, icit }) { return new VRigid({ lvl: vfunc.lvl, spine: vfunc.spine.concat([ [varg, icit] ]) }) },
        }, { scrut: [ "vfunc" ] }),
        vAppSp ({ ctx, val, spine }) { return spine.reduce((vfunc, [varg, icit]) => this.vApp({ ctx, vfunc, varg, icit }), val) },
        vMeta ({ mvar }) { let m = globalContext.metas.get(mvar); return "val" in m ? m.val : new VFlex({ mvar, spine: [] }) },
        vCheck ({ ctx, env, checkvar }) { const problem = globalContext.checks.get(checkvar); return ({
          unchecked: () => this.vAppPruning({ ctx, env, val: this.vMeta({ mvar: problem.unchecked.mvar }), prun: problem.unchecked.ctx.prun }),
          checked: () => this.eval({ ctx, env, term: problem.checked.term })
        })[Object.keys(problem)[0]]() },
        vAppPruning ({ ctx, env, val, prun }) { return prun.reduce((acc, mbIsImpl, i) => mbIsImpl === null ? acc :
          this.vApp({ ctx, vfunc: acc, varg: env[i], icit: mbIsImpl }), val) },
        
        quote: Evaluator.match({
          vflex ({ ctx, lvl, val }) { return this.quoteSp({ ctx, lvl, term: new Meta({ mvar: val.mvar }), spine: val.spine }) },
          vrigid ({ ctx, lvl, val }) { return this.quoteSp({ ctx, lvl, term: new Var({ ix: lvl - val.lvl - 1 }), spine: val.spine }) },
          vlam ({ ctx, lvl, val }) { return new Lam({ name: val.name,
            body: this.quote({ ctx, lvl: lvl + 1, val: this.cApp({ ctx, cls: val.cls, val: new VRigid({ lvl, spine: [] }) }) }), isImpl: val.isImpl }) },
          vpi ({ ctx, lvl, val }) { return new Pi({ name: val.name, dom: this.quote({ ctx, lvl, val: val.dom }),
            cod: this.quote({ ctx, lvl: lvl + 1, val: this.cApp({ ctx, cls: val.cls, val: new VRigid({ lvl, spine: [] }) }) }), isImpl: val.isImpl }) },
          vu () { return new U() }
        }, { scrut: [ "val" ] }),
        quoteSp ({ ctx, lvl, term, spine }) { return spine.reduce((func, [val, isImpl]) => new App({ func, arg: this.quote({ ctx, lvl, val }), isImpl }), term) },
        force ({ ctx, val }) { if (val.constructor.name === "VFlex") {
          const m = globalContext.metas.get(val.mvar);
          if ("val" in m) return this.force({ ctx, val: this.vAppSp({ ctx, val: m.val, spine: val.spine }) })
        } return val },

        ...((m, c) => ({
          nextMetaVar: () => m++,
          nextCheckVar: () => c++,
          reset: () => { m = 0; c = 0 },
        }))(0, 0),
        newRawMeta ({ blocking, vtype }) {
          const m = this.nextMetaVar();
          globalContext.metas.set(m, { blocking, vtype });
          return m },
        newMeta ({ ctx, vtype }) { return this.newRawMeta({ vtype: this.eval({ ctx, env: [], term: ctx.path.reduceRight((acc, entry) => ({
          bind: () => new Pi({ name: entry.bind.name, dom: entry.bind.type, cod: acc, isImpl: false }),
          define: () => new Let({ name: entry.define.name, type: entry.define.type, term: entry.define.term, next: acc }),
        })[Object.keys(entry)[0]](), this.quote({ ctx, lvl: ctx.lvl, val: vtype })) }), blocking: new Set() }) },
        freshMeta ({ ctx, vtype }) { return { ctx, meta: new AppPruning({ term: new Meta({ mvar: this.newMeta({ ctx, vtype }) }), prun: ctx.prun }) } },

        ExpectedInferred: 0,
        LamBinderType: 1,
        Placeholder: 2,
        unifyPlaceholder ({ ctx, term, mvar }) {
          const m = globalContext.metas.get(mvar);
          if ("val" in m) {
            debug.log(ctx)("unify solved placeholder", m.val);
            return this.unifyCatch({ ctx, val0: this.eval({ ctx, env: ctx.env, term }), val1: this.vAppPruning({ ctx, env: ctx.env, val: m.val, prun: ctx.prun }), unifyErr: this.Placeholder })
          } else {
            const solution = ctx.path.reduceRight((acc, entry) => ({
              bind: () => new Lam({ name: entry.bind.name, body: acc, isImpl: false }),
              define: () => new Let({ name: entry.define.name, type: entry.define.type, term: entry.define.term, next: acc }),
            })[Object.keys(entry)[0]](), term);
            debug.log(ctx)("solve unconstrained placeholder", solution);
            globalContext.metas.set(mvar, { vtype: m.vtype, val: this.eval({ ctx, env: [], term: solution }) });
            return this.retryCheck({ ctx, blocking: m.blocking })
          } },
        retryCheck ({ ctx, blocking }) { return Array.from(blocking).reduce((res, block) => res.then(() => (problem => ({
          unchecked: () => this.retryUnchecked({ ctx, checkvar: block, unchecked: problem.unchecked }),
          checked: () => {}
        })[Object.keys(problem)[0]]())(globalContext.checks.get(block))), Result.pure()) },
        retryUnchecked: Evaluator.match({
          vflex ({ fvtype, checkvar }) { globalContext.metas.get(fvtype.mvar).blocking.add(checkvar) },
          _ ({ checkvar, unchecked }) { return this.check({ ctx: unchecked.ctx, rterm: unchecked.rterm, vtype: unchecked.vtype })
            .then(({ ctx, term }) => this.unifyPlaceholder({ ctx, term, mvar: unchecked.mvar })
              .then(() => globalContext.checks.set(checkvar, { checked: { term } }))) }
        }, { scrut: [ { fvtype ({ ctx, unchecked }) { return this.force({ ctx, val: unchecked.vtype }) } } ] }),
        checkEverything ({ ctx, checkvar }) { return Array(checkvar).fill().reduce((res, _, c) => res.then(() => {
          const problem = globalContext.checks.get(c);
          if (Object.keys(problem)[0] === "checked") return;
          debug.log(ctx)("checkEverything", c, checkvar);  // only use of ctx here
          return this.infer({ ctx: problem.unchecked.ctx, rterm: problem.unchecked.rterm }).then(this.insertNeutral)
            .then(({ term, vtype, ctx }) => {
              globalContext.checks.set(c, { checked: { term } });
              return this.unifyCatch({ ctx, val0: problem.unchecked.vtype, val1: vtype, unifyErr: this.ExpectedInferred })
                .then(() => this.unifyPlaceholder({ ctx, term, mvar: problem.unchecked.mvar })) }) }), Result.pure()) },
        
        liftPRen: ({ occ, dom, cod, ren }) => ({ occ, dom: dom + 1, cod: cod + 1, ren: new Map(ren).set(cod, dom) }),
        skipPRen: ({ occ, dom, cod, ren }) => ({ occ, dom, cod: cod + 1, ren }),
        invertPRen ({ ctx, lvl, spine }) { return spine.reduce((acc, [val, isImpl]) => acc.then(([ dom, domvars, ren, prun, isLinear ], err) => { const fval = this.force({ ctx, val });
          return fval.constructor.name !== "VRigid" || fval.spine.length !== 0 ?
            err({ msg: "Unification error: Must substitute on unblocked variable" }) : domvars.has(fval.lvl) ?
              [ dom + 1, domvars, (ren.delete(fval.lvl), ren), prun.concat([null]), false ] :
              [ dom + 1, domvars.add(fval.lvl), ren.set(fval.lvl, dom), prun.concat([isImpl]), isLinear ] }),
          Result.pure([ 0, new Set(), new Map(), [], true ])).then(([ dom, {}, ren, prun, isLinear ]) =>
            ({ pren: { occ: null, dom, cod: lvl, ren }, mbPrun: isLinear ? prun : null })) },

        pruneTy ({ ctx, revPrun, vtype }) { return revPrun.reduce((res, mbIsImpl) => res.then(([go, val, pren, fval = this.force({ ctx, val })], err) => {
          if (fval.constructor.name !== "VPi") return err({ msg: "Internal error: type too low arity for given pruning" });
          const appVal = this.cApp({ ctx, cls: fval.cls, val: new VRigid({ lvl: pren.cod, spine: [] }) });
          return mbIsImpl === null ? [ go, appVal, this.skipPRen(pren) ] :
            this.rename({ ctx, pren, val: fval }).then(({ rhs: dom }) => [ cod => go(new Pi({ name: fval.name, dom, cod, isImpl: fval.isImpl })), appVal, this.liftPRen(pren) ]) }),
          Result.pure([tm => tm, vtype, { occ: null, dom: 0, cod: 0, ren: new Map() }]))
            .then(([go, vt, pr]) => this.rename({ ctx, pren: pr, val: vt }).then(({ rhs: tm }) => ({ ctx, type: go(tm) }))) },
        pruneMeta ({ ctx, prun, mvar }) {
          const { blocking, vtype } = globalContext.metas.get(mvar);
          if (typeof blocking === "undefined") return Result.throw({ msg: "Internal error: meta already solved while pruning" });
          return this.pruneTy({ ctx, revPrun: prun.reverse(), vtype }).then(({ type: prtype }) => {
            const newMvar = this.newRawMeta({ blocking, vtype: this.eval({ ctx, env: [], term: prtype }) });
            return this.lams({ ctx, lvl: prun.length, vtype, term: new AppPruning({ term: new Meta({ mvar: newMvar }), prun }) }).then(({ term }) => {
              globalContext.metas.set(mvar, { vtype, val: this.eval({ ctx, env: [], term }) });
              return newMvar
            })}) },
        pruneVFlex: ((OKRenaming, OKNonRenaming, NeedsPruning) => function ({ ctx, pren, mvar, spine }) {
          return spine.reduce((acc, [val, icit]) => acc.then(([sp, status], err) => { const fval = this.force({ ctx, val });
            if (fval.constructor.name !== "VRigid" || fval.spine.length !== 0)
              return status === NeedsPruning ? err({ msg: "Unification error: can only prune with variables" }) :
                this.rename({ ctx, pren, val: fval }).then(({ rhs }) => [ sp.concat([ [rhs, icit] ]), OKNonRenaming ]);
            else { const mbLvl = pren.ren.get(fval.lvl);
              return (typeof mbLvl === "number") ? [ sp.concat([ [new Var({ ix: pren.dom - mbLvl - 1 }), icit] ]), status ] :
                status !== OKNonRenaming ? [sp.concat([ [null, icit] ]), NeedsPruning] :
                  err({ msg: "Unification error: can only prune renamings" }) } }), Result.pure([ [], OKRenaming ]))
            .then(([ sp, status ]) => (status === NeedsPruning ? this.pruneMeta({ ctx, prun: sp.map(([mbTm, icit]) => mbTm === null ? null : icit), mvar }) :
              "val" in globalContext.metas.get(mvar) ? Result.throw({ msg: "Internal error: meta already solved while pruning a flex variable" }) : Result.pure(mvar))
              .then(mv => ({ ctx, rhs: sp.reduceRight((func, [mbTm, isImpl]) => mbTm === null ? func : new App({ func, arg: mbTm, isImpl }), new Meta({ mvar: mv })) }))) })
          (Symbol("OKRenaming"), Symbol("OKNonRenaming"), Symbol("NeedsPruning")),

        renameSp ({ ctx, pren, term, spine }) { return spine.reduce((acc, [val, isImpl]) =>
          acc.then(func => this.rename({ ctx, val, pren }).then(({ rhs: arg }) => new App({ func, arg, isImpl }))), Result.pure(term)).then(rhs => ({ ctx, rhs })) },
        rename: Evaluator.match({
          vflex ({ ctx, pren, fval }) { return pren.occ === fval.mvar ? Result.throw({ msg: "Unification error: Occurs check" }) :
            this.pruneVFlex({ ctx, pren, mvar: fval.mvar, spine: fval.spine }) },
          vrigid ({ ctx, pren, fval }) { return !pren.ren.has(fval.lvl) ? Result.throw({ msg: "Unification error: Variable escapes scope" }) :
            this.renameSp({ ctx, pren, spine: fval.spine, term: new Var({ ix: pren.dom - pren.ren.get(fval.lvl) - 1 }) }) },
          vlam ({ ctx, pren, fval }) { return this.rename({ ctx, pren: this.liftPRen(pren),
            val: this.cApp({ ctx, cls: fval.cls, val: new VRigid({ lvl: pren.cod, spine: [] }) }) })
            .then(({ rhs: body }) => ({ ctx, rhs: new Lam({ name: fval.name, body, isImpl: fval.isImpl }) })) },
          vpi ({ ctx, pren, fval }) { return this.rename({ ctx, pren, val: fval.dom })
              .then(({ rhs: dom }) => this.rename({ ctx, pren: this.liftPRen(pren),
                val: this.cApp({ ctx, cls: fval.cls, val: new VRigid({ lvl: pren.cod, spine: [] }) }) })
                .then(({ rhs: cod }) => ({ ctx, rhs: new Pi({ name: fval.name, dom, cod, isImpl: fval.isImpl }) }))) },
          vu ({ ctx }) { return Result.pure({ ctx, rhs: new U() }) }
        }, { scrut: [ { fval ({ ctx, val }) { return this.force({ ctx, val }) } } ] }),
        lams ({ ctx, lvl, vtype, term }) { return Array(lvl).fill().reduce((res, _, i) => res.then(([go, val, fval = this.force({ ctx, val })], err) =>
          fval.constructor.name !== "VPi" ? err({ msg: "Internal error: type too low arity for given lambda wrapping number" }) :
            [ body => go(new Lam({ name: fval.name === "_" ? "x" + i : fval.name, body, isImpl: fval.isImpl })), this.cApp({ ctx, cls: fval.cls, val: new VRigid({ lvl: i, spine: [] }) }) ]),
          Result.pure([s => s, vtype])).then(([go]) => ({ ctx, term: go(term) })) },
        solve ({ ctx, lvl, mvar, spine, val }) { return this.invertPRen({ ctx, lvl, spine })
          .then(({ pren, mbPrun }) => this.solveWithPRen({ ctx, lvl, mvar, pren, mbPrun, val })) },
        solveWithPRen ({ ctx, lvl, mvar, pren, mbPrun, val }) {  // lvl is only for debugging
          debug.log(ctx)("solve", mvar, this.quote({ ctx, lvl, val }));
          const { blocking, vtype } = globalContext.metas.get(mvar);
          return (typeof blocking === "undefined" ? Result.throw({ msg: "Internal error: meta already solved" }) : mbPrun === null ? Result.pure() :
            this.pruneTy({ ctx, revPrun: mbPrun.reverse(), vtype })).then(() => this.rename({ ctx, pren: Object.assign(pren, { occ: mvar }), val }))
            .then(({ rhs }) => this.lams({ ctx, lvl: pren.dom, vtype, term: rhs }).then(({ term }) => globalContext.metas.set(mvar, { vtype, val: this.eval({ ctx, env: [], term }) })))
            .then(() => this.retryCheck({ ctx, blocking })) },

        flexFlex ({ ctx, lvl, mvar0, spine0, mvar1, spine1 }) {
          if (spine0.length < spine1.length) [ mvar0, spine0, mvar1, spine1 ] = [ mvar1, spine1, mvar0, spine0 ];
          let res;
          return this.invertPRen({ ctx, lvl, spine: spine0 })
            .then(({ pren, mbPrun }) => res = this.solveWithPRen({ ctx, lvl, mvar: mvar0, pren, mbPrun, val: new VFlex({ mvar: mvar1, spine: spine1 }) }))
            .catch(() => res ?? this.solve({ ctx, lvl, mvar: mvar1, spine: spine1, val: new VFlex({ mvar: mvar0, spine: spine0 }) })) },

        intersect ({ ctx, lvl, mvar, spine0, spine1 }) {
          if (spine0.length !== spine1.length) return Result.throw({ err: "Internal error: intersecting with uneven spines" });
          else return Result.pure(spine0.reduce((acc, [val0, icit0], i) => {
            const [ val1 ] = spine1[i], fval0 = this.force({ ctx, val: val0 }), fval1 = this.force({ ctx, val: val1 });
            return fval0.constructor.name !== "VRigid" || fval0.spine.length !== 0 || fval1.constructor.name !== "VRigid" || fval1.spine.length !== 0 ||
              acc === null ? null : acc.concat([ fval0.lvl === fval1.lvl ? icit0 : null ])
          }, [])).then(mbPrun => mbPrun === null ? this.unifySp({ ctx, lvl, spine0, spine1 }) :
            mbPrun.includes(null) ? this.pruneMeta({ ctx, prun: mbPrun, mvar }).then(() => {}) : undefined) },

        unify: Evaluator.match({
          "vu vu": () => Result.pure(),
          "vpi vpi" ({ ctx, lvl, fval0, fval1 }) { return fval0.isImpl !== fval1.isImpl ? Result.throw({ msg: "Unification error: Rigid mismatch" }) :
            this.unify({ ctx, lvl, val0: fval0.dom, val1: fval1.dom }).then(() => this.unify({ ctx, lvl: lvl + 1,
              val0: this.cApp({ ctx, cls: fval0.cls, val: new VRigid({ lvl, spine: [] }) }), val1: this.cApp({ ctx, cls: fval1.cls, val: new VRigid({ lvl, spine: [] }) }) })) },
          "vrigid vrigid": [ { guard ({ fval0, fval1 }) { return fval0.lvl === fval1.lvl },
            clause ({ ctx, lvl, fval0, fval1 }) { return this.unifySp({ ctx, lvl, spine0: fval0.spine, spine1: fval1.spine }) } } ],
          "vflex vflex": [ { guard ({ fval0, fval1 }) { return fval0.mvar === fval1.mvar },
            clause ({ ctx, lvl, fval0, fval1 }) { return this.intersect({ ctx, lvl, mvar: fval0.mvar, spine0: fval0.spine, spine1: fval1.spine }) } },
            { guard: () => true, clause ({ ctx, lvl, fval0, fval1 }) {
              return this.flexFlex({ ctx, lvl, mvar0: fval0.mvar, spine0: fval0.spine, mvar1: fval1.mvar, spine1: fval1.spine }) } } ],
          "vlam vlam" ({ ctx, lvl, fval0, fval1 }) { return this.unify({ ctx, lvl: lvl + 1,
            val0: this.cApp({ ctx, cls: fval0.cls, val: new VRigid({ lvl, spine: [] }) }), val1: this.cApp({ ctx, cls: fval1.cls, val: new VRigid({ lvl, spine: [] }) }) }) },
          "vlam _" ({ ctx, lvl, fval0, fval1 }) { return this.unify({ ctx, lvl: lvl + 1, val0: this.cApp({ ctx, cls: fval0.cls, val: new VRigid({ lvl, spine: [] }) }),
              val1: this.vApp({ ctx, vfunc: fval1, varg: new VRigid({ lvl, spine: [] }), icit: fval0.isImpl }) }) },
          "vflex _": [ { guard ({ fval1 }) { return fval1.constructor.name !== "VLam" },
            clause ({ ctx, lvl, fval0, fval1 }) { return this.solve({ ctx, lvl, mvar: fval0.mvar, spine: fval0.spine, val: fval1 }) } } ],
          "_" ({ ctx, lvl, fval0, fval1 }) { return fval1.constructor.name === "VLam" ? this.unify({ ctx, lvl: lvl + 1,
            val0: this.vApp({ ctx, vfunc: fval0, varg: new VRigid({ lvl, spine: [] }), icit: fval1.isImpl }), val1: this.cApp({ ctx, cls: fval1.cls, val: new VRigid({ lvl, spine: [] }) }) }) :
            fval1.constructor.name === "VFlex" ? this.solve({ ctx, lvl, mvar: fval1.mvar, spine: fval1.spine, val: fval0 }) :
              Result.throw({ msg: "Unification error: Rigid mismatch" }) }
        }, { decorate ({ ctx, lvl, val0, val1 }) { debug.log(ctx)("unify", this.quote({ ctx, lvl, val: val0 }), this.quote({ ctx, lvl, val: val1 })) },
             scrut: [ { fval0 ({ ctx, val0 }) { return this.force({ ctx, val: val0 }) } }, { fval1 ({ ctx, val1 }) { return this.force({ ctx, val: val1 }) } } ] }),
        unifySp ({ ctx, lvl, spine0, spine1 }) { if (spine0.length !== spine1.length) return Result.throw({ msg: "Unification error: Rigid mismatch" })
          else return spine0.reduce((acc, [val0], i) => acc.then(() => this.unify({ ctx, lvl, val0, val1: spine1[i][0] })), Result.pure()) },

        bind ({ ctx, name, vtype, isNewBinder = false }) { return { ...ctx,
          env: ctx.env.concat([ new VRigid({ lvl: ctx.lvl, spine: [] }) ]),
          names: isNewBinder ? ctx.names : new Map(ctx.names).set(name, [ ctx.lvl, vtype ]),
          lvl: ctx.lvl + 1, prun: ctx.prun.concat([false]),
          path: ctx.path.concat([{ bind: { name, type: this.quote({ ctx, lvl: ctx.lvl, val: vtype }) } }]) } },
        define ({ ctx, name, term, val, type, vtype }) { return { ...ctx,
          env: ctx.env.concat([ val ]),
          names: new Map(ctx.names).set(name, [ ctx.lvl, vtype ]),
          lvl: ctx.lvl + 1, prun: ctx.prun.concat([null]),
          path: ctx.path.concat([{ define: { name, type, term } }]) } },

        unifyCatch ({ ctx, val0, val1, unifyErr }) {
          return this.unify({ ctx, lvl: ctx.lvl, val0, val1 }).catch((e, err) => {
            if (e.msg.slice(0, 17) !== "Unification error") return err(e);
            let msg0 = "", msg1 = "";
            switch (unifyErr) {
              case this.Placeholder: msg0 = " value"; msg1 = " expected value"; break;
              case this.ExpectedInferred: msg0 = " expected type"; msg1 = " inferred type"; break;
              case this.LamBinderType: msg0 = " expected lambda binder type"; msg1 = " given type annotation" }
            return err({ msg: `${e.msg}\nCan't unify${msg0}\n    ${this.quote({ ctx, lvl: ctx.lvl, val: val0 }).toString(ctx)
              }\nwith${msg1}\n    ${this.quote({ ctx, lvl: ctx.lvl, val: val1 }).toString(ctx)}\n` }) }) },
        insert: Evaluator.match({
          vpi: [ { guard: ({ fvtype }) => fvtype.isImpl, clause ({ ctx, term, fvtype }) { return Result.pure(this.freshMeta({ ctx, vtype: fvtype.dom }))
            .then(({ meta }) => this.insert({ ctx, term: new App({ func: term, arg: meta, isImpl: true }),
              vtype: this.cApp({ ctx, cls: fvtype.cls, val: this.eval({ ctx, term: meta, env: ctx.env }) }) })) } } ],
          _: ({ ctx, term, fvtype }) => Result.pure({ ctx, term, vtype: fvtype })
        }, { scrut: [ { fvtype ({ ctx, vtype }) { return this.force({ ctx, val: vtype }) } } ] }),
        insertNeutral: Evaluator.match({
          lam: [ { guard: ({ term }) => term.isImpl, clause: ({ ctx, term, vtype }) => Result.pure({ ctx, term, vtype }) } ],
          _ ({ ctx, term, vtype }) { return this.insert({ ctx, term, vtype }) }
        }, { scrut: [ "term" ] }),
        insertUntil: Evaluator.match({
          vpi: [ { guard: ({ fvtype }) => fvtype.isImpl , clause ({ ctx, name, term, fvtype }) { return fvtype.name === name ? Result.pure({ ctx, term, vtype: fvtype }) :
            Result.pure(this.freshMeta({ ctx, vtype: fvtype.dom })).then(({ meta }) => this.insertUntil({ ctx, term: new App({ func: term, arg: meta, isImpl: true }),
              vtype: this.cApp({ ctx, cls: fvtype.cls, val: this.eval({ ctx, term: meta, env: ctx.env }) }), name })) } } ],
          _: () => Result.throw({ msg: "Elaboration error: No named implicit argument" })
        }, { scrut: [ { fvtype ({ ctx, vtype }) { return this.force({ ctx, val: vtype }) } } ] }),
        check: Evaluator.match({
          "rlam vpi": [ {
            guard: ({ rterm, fvtype }) => rterm.nameIcit === fvtype.isImpl || rterm.nameIcit === fvtype.name && fvtype.isImpl,
            clause ({ ctx, rterm, fvtype }) { return (rterm.mbType === null ? Result.pure() : this.check({ ctx, rterm: rterm.mbType, vtype: new VU() })
              .then(({ ctx, term: type }) => this.unifyCatch({ ctx, val0: this.eval({ ctx, env: ctx.env, term: type }), val1: fvtype.dom, unifyErr: this.LamBinderType })))
              .then(() => this.check({ ctx: this.bind({ ctx, name: rterm.name, vtype: fvtype.dom }), rterm: rterm.body, vtype: this.cApp({ ctx, cls: fvtype.cls, val: new VRigid({ lvl: ctx.lvl, spine: [] }) }) }))
              .then(({ term: body }) => ({ ctx, term: new Lam({ name: rterm.name, body, isImpl: fvtype.isImpl }) })) } } ],
          "rvar vpi": [ {
            guard ({ ctx, rterm, fvtype }) { const mbVtype = ctx.names.get(rterm.name)?.[1];
              return fvtype.isImpl && typeof mbVtype !== "undefined" && this.force({ ctx, val: mbVtype }).constructor.name === "VFlex" },
            clause ({ ctx, rterm, fvtype }) { const [ lvl, val ] = ctx.names.get(rterm.name);
              return this.unify({ ctx, lvl: ctx.lvl, val0: this.force({ ctx, val }), val1: fvtype }).then(() => new VRigid({ lvl: ctx.lvl - lvl - 1, spine: [] })) } } ],
          "rlet _": [ { guard: ({ fvtype }) => !["VPi", "VFlex"].includes(fvtype.constructor.name),
            clause ({ ctx, rterm, fvtype }) { return this.check({ ctx, rterm: rterm.type, vtype: new VU() }).then(({ term: type }) => {
              let cvtype = this.eval({ ctx, term: type, env: ctx.env });
              return this.check({ ctx, rterm: rterm.term, vtype: cvtype })
                .then(({ term }) => this.check({ ctx: define({ ctx, name: term.name, val: this.eval({ ctx, term, env: ctx.env }), vtype: cvtype }), rterm: rterm.next, vtype: fvtype })
                  .then(({ term: next }) => ({ ctx, term: Let({ name: rterm.name, type, term, next }) }))) }) } } ],
          "rhole _": [ { guard: ({ fvtype }) => !["VPi", "VFlex"].includes(fvtype.constructor.name), clause ({ ctx, fvtype }) { return Result.pure({ ctx, term: this.freshMeta({ ctx, vtype: fvtype }).meta }) } } ],
          _: [ { guard: ({ fvtype }) => fvtype.constructor.name === "VPi" && fvtype.isImpl,
            clause ({ ctx, rterm, fvtype }) { return this.check({ ctx: this.bind({ ctx, name: fvtype.name, vtype: fvtype.dom, isNewBinder: true }),
              rterm, vtype: this.cApp({ ctx, cls: fvtype.cls, val: new VRigid({ lvl: ctx.lvl, spine: [] }) }) })
                .then(({ term: body }) => ({ ctx, term: new Lam({ name: fvtype.name, body, isImpl: true }) })) } },
            { guard: ({ fvtype }) => fvtype.constructor.name === "VFlex",
              clause ({ ctx, rterm, fvtype }) {
                const checkvar = this.nextCheckVar(), keepCtx = Object.fromEntries(Object.entries(ctx).map(([k, v]) => ([k, v instanceof Array ? v.slice() :
                  v instanceof Map ? new Map(v) : v])));
                globalContext.checks.set(checkvar, { unchecked: { ctx: keepCtx, rterm, vtype: fvtype, mvar: this.newMeta({ ctx, vtype: fvtype }) } });
                globalContext.metas.get(fvtype.mvar).blocking.add(checkvar);
                return Result.pure({ ctx, term: new PostponedCheck({ checkvar }) }) } },
            { guard: () => true, clause ({ ctx, rterm, fvtype }) { return this.infer({ ctx, rterm }).then(s => this.insertNeutral({ ...s, ctx }))
              .then(({ term, vtype: ivtype }) => this.unifyCatch({ ctx, val0: fvtype, val1: ivtype, unifyErr: this.ExpectedInferred }).then(() => ({ ctx, term }))) } } ]
        }, { decorate: ({ rterm }) => globalContext.pos = rterm.pos, scrut: [ "rterm", { fvtype ({ ctx, vtype }) { return this.force({ ctx, val: vtype }) } } ] }),
        infer: Evaluator.match({
          rvar ({ ctx, rterm }) { let mbLvlVtype = ctx.names.get(rterm.name);
            return typeof mbLvlVtype === "undefined" ? Result.throw({ msg: `Elaboration error: Name not in scope "${rterm.name}"` }) :
              Result.pure({ ctx, term: new Var({ ix: ctx.lvl - mbLvlVtype[0] - 1 }), vtype: mbLvlVtype[1] }) },
          rlam: [ { guard: ({ rterm }) => typeof rterm.nameIcit === "string", clause: () => Result.throw({ msg: "Elaboration error: Cannot infer type for lambda with named argument" }) },
            { guard: () => true, clause ({ ctx, rterm }) { return (rterm.mbType === null ?
              Result.pure({ ctx, term: this.freshMeta({ ctx, vtype: new VU() }).meta }) : this.check({ ctx, rterm: rterm.mbType, vtype: new VU() }))
              .then(({ ctx, term }) => this.eval({ ctx, env: ctx.env, term }))
              .then(vtype => this.infer({ ctx: this.bind({ ctx, name: rterm.name, vtype }), rterm: rterm.body }).then(this.insertNeutral)
                .then(({ ctx, term: body, vtype: ivtype }) => ({ ctx, term: new Lam({ name: rterm.name, body, isImpl: rterm.nameIcit }),
                  vtype: new VPi({ name: rterm.name, dom: vtype, cls: { term: this.quote({ ctx, val: ivtype, lvl: ctx.lvl + 1 }), env: ctx.env }, isImpl: rterm.nameIcit }) }))) } } ],
          rapp ({ ctx, rterm }) { return (nameIcit => { switch (nameIcit) {
            case true: return this.infer({ ctx, rterm: rterm.func }).then(s => ({ ...s, isImpl: true }));
            case false: return this.infer({ ctx, rterm: rterm.func }).then(s => this.insert({ ...s, ctx })).then(s => ({ ...s, isImpl: false }));
            default: return this.infer({ ctx, rterm: rterm.func }).then(s => this.insertUntil({ ...s, ctx, name: nameIcit })).then(s => ({ ...s, isImpl: true}))
          } })(rterm.nameIcit).then(({ isImpl, term, vtype }) => (fvtype => {
            if (fvtype.constructor.name === "VPi") return isImpl === fvtype.isImpl ? Result.pure([ fvtype.dom, fvtype.cls ]) :
              Result.throw({ msg: "Elaboration error: Implicit/explicit mismatch" });
            else { let dom = this.eval({ ctx, env: ctx.env, term: this.freshMeta({ ctx, vtype: new VU() }).meta });
              return Result.pure(this.freshMeta({ ctx: this.bind({ ctx, name: "x", vtype: dom }), vtype: new VU() })).then(({ meta }) => ({ term: meta, env: ctx.env }))
                .then(cls => this.unifyCatch({ ctx, val0: new VPi({ name: "x", dom, cls, isImpl }), val1: vtype, unifyErr: this.ExpectedInferred }).then(() => [ dom, cls ])) } })(this.force({ ctx, val: vtype }))
            .then(([ dom, cls ]) => this.check({ ctx, rterm: rterm.arg, vtype: dom })
              .then(({ term: arg }) => ({ ctx, term: new App({ func: term, arg, isImpl }), vtype: this.cApp({ ctx, cls, val: this.eval({ ctx, env: ctx.env, term: arg }) }) })))) },
          ru ({ ctx }) { return Result.pure({ ctx, term: new U(), vtype: new VU() }) },
          rpi ({ ctx, rterm }) { return this.check({ ctx, rterm: rterm.dom, vtype: new VU() })
            .then(({ term: dom }) => this.check({ ctx: this.bind({ ctx, name: rterm.name, vtype: this.eval({ ctx, env: ctx.env, term: dom }) }), rterm: rterm.cod, vtype: new VU() })
              .then(({ term: cod }) => ({ ctx, term: new Pi({ name: rterm.name, dom, cod, isImpl: rterm.isImpl }), vtype: new VU() }))) },
          rlet ({ ctx, rterm }) { return this.check({ ctx, rterm: rterm.type, vtype: new VU() }).then(({ term: type }) => {
            let cvtype = this.eval({ ctx, term: type, env: ctx.env });
            return this.check({ ctx, rterm: rterm.term, vtype: cvtype })
              .then(({ term }) => this.infer({ ctx: this.define({ ctx, name: rterm.name, term, val: this.eval({ ctx, term, env: ctx.env }), type, vtype: cvtype }), rterm: rterm.next })
                .then(({ term: next, vtype }) => ({ ctx, term: new Let({ name: rterm.name, type, term, next }), vtype }))) }) },
          rhole ({ ctx }) { const vtype = this.eval({ ctx, env: ctx.env, term: this.freshMeta({ ctx, vtype: new VU() }).meta });
          return Result.pure({ ctx, vtype, term: this.freshMeta({ ctx, vtype }) }) }
        }, { decorate: ({ rterm }) => globalContext.pos = rterm.pos, scrut: [ "rterm" ] }),

        doElab ({ rterm }) {
          this.reset();
          return this.infer({ ctx: { env: [], names: new Map(), path: [], prun: [], lvl: 0 }, rterm })
            .then(({ ctx, ...res }) => this.checkEverything({ ctx, checkvar: this.nextCheckVar() }).then(() => ({ ctx, ...res })))
            .catch(this.displayError) },
        normalForm ({ data: rterm }) {
          debug.log()("Expression normal form:");
          return this.doElab({ rterm })
            .then(({ ctx, term, vtype }) => ({ ctx,
              term: this.quote({ ctx, lvl: 0, val: this.eval({ ctx, term, env: [] }) }),
              type: this.quote({ ctx, lvl: 0, val: vtype }) })) },
        typecheck ({ data: rterm }) {
          debug.log()("Expression type:");
          return this.doElab({ rterm })
            .then(({ ctx, vtype }) => ({ ctx, type: this.quote({ ctx, lvl: 0, val: vtype }) })) },
        elaborate ({ data: rterm }) {
          debug.log()("Elaborate expression:");
          return this.doElab({ rterm })
            .then(({ ctx, term }) => ({ ctx, term, metas: Array.from(globalContext.metas).map(([ mvar, { vtype, val } ]) =>
              new MetaEntry({ mvar, solnTy: this.quote({ ctx, lvl: 0, val: vtype }), solnTm: typeof val === "undefined" ? null : this.quote({ ctx, lvl: 0, val }) })) })) },
        returnAll ({ data: rterm }) {
          debug.log()("Full expression data:");
          return this.doElab({ rterm })
            .then(({ ctx, term, vtype }) => new Return ({ ctx,
              term: this.quote({ ctx, lvl: 0, val: this.eval({ ctx, term, env: [] }) }),
              type: this.quote({ ctx, lvl: 0, val: vtype }),
              elab: term,
              metas: Array.from(globalContext.metas).map(([ mvar, { vtype, val } ]) =>
              new MetaEntry({ mvar, solnTy: this.quote({ ctx, lvl: 0, val: vtype }), solnTm: typeof val === "undefined" ? null : this.quote({ ctx, lvl: 0, val }) })) }))
        },
        displayError ({ msg }, err) {
          let lines = globalContext.source.split(/\r\n?|\n/);
          return err({ message: `${msg}\n${lines[globalContext.pos[0][0] - 1]}\n${"-".repeat(globalContext.pos[0][1] - 1)}${
            "^".repeat(globalContext.pos[1][1] - globalContext.pos[0][1])} ${globalContext.pos.join("-")}` }) }
      })) this[k] = debug(["normalForm", "typecheck", "elaborate", "returnAll"].includes(k) ?
        function (...args) { phase = "evaluator"; return fn.apply(this, args) } : fn, k, this)  // TODO: trampoline
    }
  }

  class Return {
    constructor ({ ctx, term, type, elab, metas }) { Object.assign(this, { ctx, term, type, elab, metas }) }
    toString () { return {
      term: this.term.toString(this.ctx),
      type: this.type.toString(this.ctx),
      elab: this.elab.toString(this.ctx),
      metas: this.metas.map(meta => meta.toString(this.ctx))
    } }
  }

  const parseVMCode = new Parser(),
        evaluateVMProgram = new Evaluator(),
        sequence = (p => fn => p = fn ? p.then(fn) : p)(Promise.resolve());

  return Object.defineProperties({}, {
    import: { get () {
      return (opt = {}) => sequence(() => new Promise((ok, err) => {
        // WebAssembly.Memory is available here as opt.memory
        if ("code" in opt && !("path" in opt)) ok(opt.code);
        else if ("path" in opt) fetch(opt.path).then(rsp => rsp.text()).then(ok).catch(err);
        else err({ message: "Load error: import option must be either 'code' or 'path'" })
      })).then(src => ({
        normalForm: { run: () => parseVMCode(src).then(evaluateVMProgram.normalForm).toPromise() },
        typecheck: { run: () => parseVMCode(src).then(evaluateVMProgram.typecheck).toPromise() },
        elaborate: { run: () => parseVMCode(src).then(evaluateVMProgram.elaborate).toPromise() },
        returnAll: { run: () => parseVMCode(src).then(evaluateVMProgram.returnAll).toPromise() }
      }))
    } }
  })
}