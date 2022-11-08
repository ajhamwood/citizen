function VM (options = {}) {
  let { debug } = options, phase = null;
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
              (x => value = "ok" in x ? x.ok : error(x.err))(r.unwrap()); debug.log(value?.ctx, thrown)(value); })
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

  const globalContext = { metas: new Map(), pos: [], source: "" };

  class AST { constructor (o) { Object.assign(this, o) } get [Symbol.toStringTag] () { return "AST" } }

  [ "RVar", "RLam", "RApp", "RU", "RPi", "RLet", "RHole",
    "Var", "App", "Lam", "Pi", "U", "Let", "Meta", "InsMeta", "MetaEntry",
    "VRigid", "VFlex", "VLam", "VPi", "VU" ]
    .forEach(name => this[name] = ({ [name]: class extends AST {
      constructor (o) { super(o); if (prettyPrint(name)) this.toString = prettyPrint(name) }
      get [Symbol.toStringTag] () { return name }
    } })[name]);

  const prettyPrint = name => ({
          RVar () { return `RVar ${this.name}` },
          RLam () {  // nameIcit := name:string | isImpl:boolean
            return `RLam ${({ boolean: this.nameIcit ? `{${this.name}}` : this.name,
              string: `{${this.nameIcit} = ${this.name}}` })[typeof this.nameIcit]}. ${this.body}` },
          RApp () {   // nameIcit := name:string | isImpl:boolean
            return `(${this.func} :@: ${({ boolean: this.nameIcit ? `{${this.arg}}` : this.arg,
              string: `{${this.nameIcit} = ${this.arg}}` })[typeof this.nameIcit]})` },
          RU () { return "RU" },
          RPi () { return `RPi ${this.isImpl ? `{${this.name} : ${this.dom}}` : `(${this.name} : ${this.dom})`} -> ${this.cod}` },
          RLet () { return `let ${this.name} : ${this.type} = ${this.term};\n${this.next}` },
          RHole () { return `{?}` },

          Var (ctx) { let lvl = ctx.types.length - this.ix - 1;
            return lvl >= 0 ? ctx.types[lvl][0] : `#${-1 - lvl}` },
          App (ctx, prec = 0) { return (str => prec > 2 ? `(${str})` : str)
            (`${this.func.toString(ctx, 2)} ${(arg => this.isImpl ? `{${arg.toString(ctx, 0)}}` : arg.toString(ctx, 3))(this.arg)}`) },
          Lam (ctx, prec = 0) {
            let fresh = name => name === "_" ? "_" : ctx.types.reduce((acc, [n]) => new RegExp(`^${acc}[']*$`).test(n) ? n + "'" : acc, name),
                name = fresh(this.name),
                goLam = (name, body, isImpl) => {
                  let keepCtx = { ...ctx, env: [...ctx.env], types: [...ctx.types] };
                  if (name) ctx.types.push([name]);
                  let res = (name => body.constructor.name !== "Lam" ? `. ${body.toString(ctx, 0)}` :
                        ` ${body.isImpl ? `{${name}}` : name}${goLam(name, body.body)}`)(fresh(body.name));
                  Object.assign(ctx, keepCtx);
                  return res
                };
            return (str => prec > 0 ? `(${str})` : str)(`λ ${this.isImpl ? `{${name}}` : name}${goLam(name, this.body)}`) },
          Pi (ctx, prec = 0) {
            let fresh = name => name === "_" ? "_" : ctx.types.reduce((acc, [n]) => new RegExp(`^${acc}[']*$`).test(n) ? n + "'" : acc, name),
                name = fresh(this.name),
                piBind = (name, dom, isImpl) => (body => isImpl ? `{${body}}` : `(${body})`)(name + " : " + dom.toString(ctx, 0)),
                goPi = (name, cod) => {
                  let keepCtx = { ...ctx, env: [...ctx.env], types: [...ctx.types] };
                  if (name) ctx.types.push([name]);
                  let res = cod.constructor.name !== "Pi" ? ` → ${cod.toString(ctx, 1)}` :
                        cod.name !== "_" ? (name => piBind(name, cod.dom, cod.isImpl) + goPi(name, cod.cod))(fresh(cod.name)) :
                          ` → ${cod.dom.toString(ctx, 2)} → ${cod.cod.toString({ ...ctx, types: ctx.types.concat([["_"]]) }, 1) }`;
                  Object.assign(ctx, keepCtx);
                  return res
                };
            return (str => prec > 1 ? `(${str})` : str)
              (name === "_" ? `${this.dom.toString(ctx, 2)} → ${this.cod.toString({ ...ctx, types: ctx.types.concat([["_"]]) }, 1) }` :
                piBind(name, this.dom, this.isImpl) + goPi(name, this.cod)) },
          U () { return "U" },
          Let (ctx, prec = 0) {
            let fresh = name => name === "_" ? "_" : ctx.types.reduce((acc, [n]) => new RegExp(`^${acc}[']*$`).test(n) ? n + "'" : acc, name),
                name = fresh(this.name);
            return (str => prec > 0 ? `(${str})` : str)
              (`let ${name} : ${this.type.toString(ctx, 0)}\n    = ${this.term.toString(ctx, 0)};\n${
                this.next.toString({ ...ctx, types: ctx.types.concat([[name]]) }, 0)}`) },
          Meta () { return `?${this.mvar}` },
          InsMeta (ctx, prec) { return (str => prec > 2 ? `(${str})` : str)
            (`?${this.mvar}${ctx.types.filter(({}, i) => this.bds[i]).map(([n]) => ` ${n}`).join("")}`) },

          MetaEntry (ctx) { return `let ?${this.mvar} = ${this.soln === null ? "?" : this.soln.toString(ctx) };` }
        })[name];

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
      for (let [k, fn] of Object.entries({
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
          Parser.map(this.binder, ([ data, pos ]) => [ data, false, [state.pos, pos[1]] ]),
          Parser.peek(Parser.map(this.region(this.binder, "braces"), ([ data, pos ]) => [ data, true, [state.pos, pos[1]] ])),
          this.region(Parser.do([ this.ident, ({}, s) => Parser.seq([ this.keyword("="), this.cut(this.binder, "Malformed named implicit lambda") ])(s),
            ({}, s, t) => ({ ...t, data: [ t.data[0], s.data, [state.pos, t.data[1]] ] }) ]), "braces") ])(state) },
        lam (state) { return Parser.do([ this.keyword("\\"),
          ({}, s) => Parser.many(this.lamBinder)(s),
          (x, y, s) => Parser.seq([ this.cut(this.keyword("."), "Lambda without body", { start: x.pos, end: y.pos }), this.term ])(s),
          ({}, {}, s, t) => ({ ...t, data: s.data.reduceRight((body, [name, nameIcit, pos]) =>
            new RLam({ name, nameIcit, body, pos: this.setPos({ start: pos[0] }) }), t.data) }) ])(state) },

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
        let branch = tree, _ = [], match, run = f => f.apply(this, [obj]);
        decorate(obj);
        scrutList: for (let argName of scrut) {
          if (typeof argName !== "string") {
            let [[ procArgName, fn ]] = Object.entries(argName);
            obj[procArgName] = match = run(fn);
          } else match = obj[argName];
          let name = (n => n in branch ? n : "_")(match.constructor.name.toLowerCase());
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
      for (let [k, fn] of Object.entries({
        eval: Evaluator.match({
          var ({ term, env }) { return env[env.length - term.ix - 1] },
          app ({ term, env, ctx }) { return this.vApp({ ctx, vfunc: this.eval({ ctx, term: term.func, env }), varg: this.eval({ ctx, term: term.arg, env }), icit: term.isImpl }) },
          lam ({ term, env }) { return new VLam({ name: term.name, cls: { term: term.body, env }, isImpl: term.isImpl }) },
          pi ({ term, env, ctx }) { return new VPi({ name: term.name, dom: this.eval({ ctx, term: term.dom, env }), cls: { term: term.cod, env }, isImpl: term.isImpl }) },
          let ({ term, env, ctx }) { return this.eval({ ctx, term: term.next, env: env.concat([ this.eval({ ctx, env, term: term.term }) ]) }) },
          u () { return new VU() },
          meta ({ term }) { return this.vMeta({ mvar: term.mvar }) },
          insmeta ({ term, env, ctx }) { return this.vAppBDs({ ctx, env, val: this.vMeta({ mvar: term.mvar }), bds: term.bds }) }
        }, { scrut: [ "term" ] }),
        cApp ({ ctx, cls: { term, env }, val }) { return this.eval({ ctx, term, env: env.concat([ val ]) }) },
        vApp: Evaluator.match({
          vlam ({ vfunc, varg, ctx }) { return this.cApp({ ctx, cls: vfunc.cls, val: varg }) },
          vflex ({ vfunc, varg, icit }) { return new VFlex({ mvar: vfunc.mvar, spine: vfunc.spine.concat([ [varg, icit] ]) }) },
          vrigid ({ vfunc, varg, icit }) { return new VRigid({ lvl: vfunc.lvl, spine: vfunc.spine.concat([ [varg, icit] ]) }) },
        }, { scrut: [ "vfunc" ] }),
        vAppSp ({ ctx, val, spine }) { return spine.reduce((vfunc, [varg, icit]) => this.vApp({ ctx, vfunc, varg, icit }), val) },
        vMeta ({ mvar }) { let e = globalContext.metas.get(mvar); return e === null ? new VFlex({ mvar, spine: [] }) : e },
        vAppBDs ({ ctx, env, val, bds }) { return bds.reduce((acc, bd, i) => bd ? this.vApp({ ctx, vfunc: acc, varg: env[i], icit: false }) : acc, val) },
        
        quote: Evaluator.match({
          vflex ({ lvl, val, ctx }) { return this.quoteSp({ ctx, lvl, term: new Meta({ mvar: val.mvar }), spine: val.spine }) },
          vrigid ({ lvl, val, ctx }) { return this.quoteSp({ ctx, lvl, term: new Var({ ix: lvl - val.lvl - 1 }), spine: val.spine }) },
          vlam ({ lvl, val, ctx }) { return new Lam({ name: val.name,
            body: this.quote({ ctx, lvl: lvl + 1, val: this.cApp({ ctx, cls: val.cls, val: new VRigid({ lvl, spine: [] }) }) }), isImpl: val.isImpl }) },
          vpi ({ lvl, val, ctx }) { return new Pi({ name: val.name, dom: this.quote({ ctx, lvl, val: val.dom }),
            cod: this.quote({ ctx, lvl: lvl + 1, val: this.cApp({ ctx, cls: val.cls, val: new VRigid({ lvl, spine: [] }) }) }), isImpl: val.isImpl }) },
          vu () { return new U() }
        }, { scrut: [ "val" ] }),
        quoteSp ({ ctx, lvl, term, spine }) { return spine.reduce((func, [val, isImpl]) => new App({ func, arg: this.quote({ ctx, lvl, val }), isImpl }), term) },
        force ({ ctx, val }) { if (val.constructor.name === "VFlex") {
          let e = globalContext.metas.get(val.mvar);
          if (e !== null) return this.force({ ctx, val: this.vAppSp({ ctx, val: e, spine: val.spine }) })
        } return val },

        nextMeta: (i => () => i++)(0),
        freshMeta (ctx) {
          let mvar = this.nextMeta();
          globalContext.metas.set(mvar, null);
          return { ctx, meta: new InsMeta({ mvar, bds: ctx.bds }) } },
        
        liftPRen ({ dom, cod, ren }) { return { dom: dom + 1, cod: cod + 1, ren: ren.set(cod, dom) } },
        invertPRen ({ lvl, spine }) { return spine.reduce((acc, [val]) => acc.then(([ dom, ren ], err) =>
          (fval => fval.constructor.name === "VRigid" && fval.spine.length === 0 && !ren.has(fval.lvl) ?
            [ dom + 1, ren.set(fval.lvl, dom) ] : err({ msg: "Unification error: Must substitute on unblocked variable" }))(this.force({ val }))),
          Result.pure([ 0, new Map() ])).then(([ dom, ren ]) => ({ dom, cod: lvl, ren })) },
        rename: Evaluator.match({
          vflex: [ { guard: ({ mvar, fval }) => mvar === fval.mvar, clause: () => Result.throw({ message: "Unification error: Occurs check" }) },
            { guard: () => true, clause ({ ctx, mvar, pren, fval }) { return fval.spine.reduce((acc, [val, isImpl]) => acc.then(({ rhs: func }) => this.rename({ ctx, mvar, pren, val })
              .then(({ rhs: arg }) => ({ctx, rhs: new App({ func, arg, isImpl }) }))), Result.pure({ ctx, rhs: new Meta({ mvar: fval.mvar }) })) } } ],
          vrigid ({ ctx, mvar, pren, fval }) { return !pren.ren.has(fval.lvl) ? Result.throw({ msg: "Unification error: Variable escapes scope" }) :
            fval.spine.reduce((acc, [val, isImpl]) => acc.then(({ rhs: func }) => this.rename({ ctx, mvar, pren, val })
              .then(({ rhs: arg }) => ({ ctx, rhs: new App({ func, arg, isImpl }) }) )), Result.pure({ ctx, rhs: new Var({ ix: pren.dom - pren.ren.get(fval.lvl) - 1 }) })) },
          vlam ({ ctx, mvar, pren, fval }) { return this.rename({ ctx, mvar, pren: this.liftPRen(pren),
            val: this.cApp({ ctx, cls: fval.cls, val: new VRigid({ lvl: pren.cod, spine: [] }) }) })
            .then(({ rhs: body }) => ({ ctx, rhs: new Lam({ name: fval.name, body, isImpl: fval.isImpl }) })) },
          vpi ({ ctx, mvar, pren, fval }) { return this.rename({ ctx, mvar, pren, val: fval.dom })
              .then(({ rhs: dom }) => this.rename({ ctx, mvar, pren: this.liftPRen(pren),
                val: this.cApp({ ctx, cls: fval.cls, val: new VRigid({ lvl: pren.cod, spine: [] }) }) })
                .then(({ rhs: cod }) => ({ ctx, rhs: new Pi({ name: fval.name, dom, cod, isImpl: fval.isImpl }) }))) },
          vu ({ ctx }) { return Result.pure({ ctx, rhs: new U() }) }
        }, { scrut: [ { fval ({ ctx, val }) { return this.force({ ctx, val }) } } ] }),

        solve ({ ctx, lvl, mvar, spine, val }) { return this.invertPRen({ lvl, spine })
          .then(pren => this.rename({ ctx, mvar, pren, val })
            .then(({ rhs }) => { globalContext.metas.set(mvar,
              this.eval({ ctx, term: (body => { for (let i = 0; i < spine.length; i++)
                body = new Lam({ name: `x${i}`, body, isImpl: spine[i][1] }); return body })(rhs), env: [] })) })) },
        unify: Evaluator.match({
          "vlam vlam" ({ ctx, lvl, fval0, fval1 }) { return this.unify({ ctx, lvl: lvl + 1,
            val0: this.cApp({ ctx, cls: fval0.cls, val: new VRigid({ lvl, spine: [] }) }), val1: this.cApp({ ctx, cls: fval1.cls, val: new VRigid({ lvl, spine: [] }) }) }) },
          "vlam _" ({ ctx, lvl, fval0, fval1 }) { return this.unify({ ctx, lvl: lvl + 1, val0: this.cApp({ ctx, cls: fval0.cls, val: new VRigid({ lvl, spine: [] }) }),
              val1: this.vApp({ ctx, vfunc: fval1, varg: new VRigid({ lvl, spine: [] }), icit: fval0.isImpl }) }) },
          "vpi vpi" ({ ctx, lvl, fval0, fval1 }) { return fval0.isImpl !== fval1.isImpl ? Result.throw({ msg: "Unification error: Rigid mismatch" }) :
            this.unify({ ctx, lvl, val0: fval0.dom, val1: fval1.dom }).then(() => this.unify({ ctx, lvl: lvl + 1,
              val0: this.cApp({ ctx, cls: fval0.cls, val: new VRigid({ lvl, spine: [] }) }), val1: this.cApp({ ctx, cls: fval1.cls, val: new VRigid({ lvl, spine: [] }) }) })) },
          "vu vu" () { return Result.pure() },
          "vrigid vrigid": [ { guard ({ fval0, fval1 }) { return fval0.lvl === fval1.lvl },
            clause ({ ctx, lvl, fval0, fval1 }) { return this.unifySp({ ctx, lvl, sp0: fval0.spine, sp1: fval1.spine }) } } ],
          "vflex vflex": [ { guard ({ fval0, fval1 }) { return fval0.mvar === fval1.mvar },
            clause ({ ctx, lvl, fval0, fval1 }) { return this.unifySp({ ctx, lvl, sp0: fval0.spine, sp1: fval1.spine }) } } ],
          "vflex _": [ { guard ({ fval1 }) { return fval1.constructor.name !== "VLam" },
            clause ({ ctx, lvl, fval0, fval1 }) { return this.solve({ ctx, lvl, mvar: fval0.mvar, spine: fval0.spine, val: fval1 }) } } ],
          "_" ({ ctx, lvl, fval0, fval1 }) { return fval1.constructor.name === "VLam" ? this.unify({ ctx, lvl: lvl + 1,
            val0: this.vApp({ ctx, vfunc: fval0, varg: new VRigid({ lvl, spine: [] }), icit: fval1.isImpl }), val1: this.cApp({ ctx, cls: fval1.cls, val: new VRigid({ lvl, spine: [] }) }) }) :
            fval1.constructor.name === "VFlex" ? this.solve({ ctx, lvl, mvar: fval1.mvar, spine: fval1.spine, val: fval0 }) :
              Result.throw({ msg: "Unification error: Rigid mismatch" }) }
        }, { scrut: [ { fval0 ({ ctx, val0 }) { return this.force({ ctx, val: val0 }) } }, { fval1 ({ ctx, val1 }) { return this.force({ ctx, val: val1 }) } } ] }),
        unifySp ({ ctx, lvl, sp0, sp1 }) { if (sp0.length !== sp1.length) return Result.throw({ msg: "Unification error: Rigid mismatch" })
          else return sp0.reduce((acc, [val0], i) => acc.then(() => this.unify({ ctx, lvl, val0, val1: sp1[i][0] })), Result.pure()) },

        bind ({ ctx, name, vtype, isNewBinder = false }) { return { ...ctx,
          env: ctx.env.concat([ new VRigid({ lvl: ctx.lvl, spine: [] }) ]),
          types: ctx.types.concat([[ name, vtype, isNewBinder ]]),
          lvl: ctx.lvl + 1, bds: ctx.bds.concat([1]) } },
        define ({ ctx, name, val, vtype }) { return { ...ctx,
          env: ctx.env.concat([ val ]),
          types: ctx.types.concat([[ name, vtype, false ]]),
          lvl: ctx.lvl + 1, bds: ctx.bds.concat([0]) } },
        closeVal ({ ctx, val }) { return { term: this.quote({ ctx, val, lvl: ctx.lvl + 1 }), env: ctx.env } },

        unifyCatch ({ ctx, val0, val1 }) { return this.unify({ ctx, lvl: ctx.lvl, val0, val1 }).catch((e, err) => e.msg.slice(0, 17) !== "Unification error" ? err(e) :
          err({ msg: `${e.msg}\nCan't unify\n    ${this.quote({ ctx, lvl: ctx.lvl, val: val0 })}\nwith\n    ${this.quote({ lvl: ctx.lvl, val: val1 })}\n` })) },
        insert: Evaluator.match({
          vpi: [ { guard: ({ fvtype }) => fvtype.isImpl, clause ({ ctx, term, fvtype }) { return Result.pure(this.freshMeta(ctx))
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
            Result.pure(this.freshMeta(ctx)).then(({ meta }) => this.insertUntil({ ctx, term: new App({ func: term, arg: meta, isImpl: true }),
              vtype: this.cApp({ ctx, cls: fvtype.cls, val: this.eval({ ctx, term: meta, env: ctx.env }) }), name })) } } ],
          _: () => Result.throw({ msg: "Elaboration error: No named implicit argument" })
        }, { scrut: [ { fvtype ({ ctx, vtype }) { return this.force({ ctx, val: vtype }) } } ] }),
        check: Evaluator.match({
          "rlam vpi": [ {
            guard ({ rterm, vtype }) { return rterm.nameIcit === vtype.isImpl || rterm.nameIcit === vtype.name && vtype.isImpl },
            clause ({ ctx, rterm, vtype }) { return this.check({ ctx: this.bind({ ctx, name: rterm.name, vtype: vtype.dom }),
              rterm: rterm.body, vtype: this.cApp({ ctx, cls: vtype.cls, val: new VRigid({ lvl: ctx.lvl, spine: [] }) }) })
              .then(({ term }) => ({ ctx, term: new Lam({ name: rterm.name, body: term, isImpl: vtype.isImpl }) })) } } ],
          "rlet _": [ { guard: ({ vtype }) => vtype.constructor.name !== "VPi",
            clause ({ ctx, rterm, vtype }) { return this.check({ ctx, rterm: rterm.type, vtype: new VU() }).then(({ term: type }) => {
              let cvtype = this.eval({ ctx, term: type, env: ctx.env });
              return this.check({ ctx, rterm: rterm.term, vtype: cvtype })
                .then(({ term }) => this.check({ ctx: define({ ctx, name: term.name, val: this.eval({ ctx, term, env: ctx.env }), vtype: cvtype }), rterm: rterm.next, vtype })
                  .then(({ term: next }) => ({ ctx, term: this.Let({ name: rterm.name, type, term, next }) }))) }) } } ],
          "rhole _": [ { guard: ({ vtype }) => vtype.constructor.name !== "VPi", clause ({ ctx }) { return Result.pure({ ctx, term: this.freshMeta(ctx).meta }) } } ],
          _: [ { guard: ({ vtype }) => vtype.constructor.name === "VPi" && vtype.isImpl,
            clause ({ ctx, rterm, vtype }) { return this.check({ ctx: this.bind({ ctx, name: vtype.name, vtype: vtype.dom, isNewBinder: true }),
              rterm, vtype: this.cApp({ ctx, cls: vtype.cls, val: new VRigid({ lvl: ctx.lvl, spine: [] }) }) })
                .then(({ term: body }) => ({ ctx, term: new Lam({ name: vtype.name, body, isImpl: true }) })) } },
            { guard: () => true, clause ({ ctx, rterm, vtype }) { return this.infer({ ctx, rterm }).then(s => this.insertNeutral({ ...s, ctx }))
              .then(({ term, vtype: ivtype }) => this.unifyCatch({ ctx, lvl: ctx.lvl, val0: vtype, val1: ivtype }).then(() => ({ ctx, term }))) } } ]
        }, { decorate: ({ rterm }) => globalContext.pos = rterm.pos, scrut: [ "rterm", "vtype" ] }),
        infer: Evaluator.match({
          rvar ({ ctx, rterm }) { return (ix => ~ix ? Result.pure({ ctx, term: new Var({ ix: ctx.lvl - ix - 1 }), vtype: ctx.types[ix][1] }) :
            Result.throw({ msg: `Elaboration error: Name not in scope "${rterm.name}"` }))
              (ctx.types.findLastIndex(([n, {}, isNB]) => n === rterm.name && !isNB)) },
          rlam: [ { guard: ({ rterm }) => typeof rterm.nameIcit === "string", clause: () => Result.throw({ msg: "Elaboration error: Cannot infer a named lambda" }) },
            { guard: () => true, clause ({ ctx, rterm }) { let vtype = this.eval({ ctx, env: ctx.env, term: this.freshMeta(ctx).meta });
              return this.infer({ ctx: this.bind({ ctx, name: rterm.name, vtype }), rterm: rterm.body }).then(s => this.insertNeutral({ ...s, ctx }))
                .then(({ term, vtype: ivtype }) => ({ ctx, term: new Lam({ name: rterm.name, body: term, isImpl: rterm.nameIcit }),
                  vtype: new VPi({ name: rterm.name, dom: vtype, cls: this.closeVal({ ctx, val: ivtype }), isImpl: rterm.nameIcit }) })) } } ],
          rapp ({ ctx, rterm }) { return (ni => { switch (ni) {
            case true: return this.infer({ ctx, rterm: rterm.func }).then(s => ({ ...s, isImpl: true }));
            case false: return this.infer({ ctx, rterm: rterm.func }).then(s => this.insert({ ...s, ctx })).then(s => ({ ...s, isImpl: false }));
            default: return this.infer({ ctx, rterm: rterm.func }).then(s => this.insertUntil({ ...s, ctx, name: ni })).then(s => ({ ...s, isImpl: true}))
          } })(rterm.nameIcit).then(({ isImpl, term, vtype }) => (fvtype => {
            if (fvtype.constructor.name === "VPi") return isImpl === fvtype.isImpl ? Result.pure([ fvtype.dom, fvtype.cls ]) :
              Result.throw({ msg: "Elaboration error: Implicit/explicit mismatch" });
            else { let dom = this.eval({ ctx, env: ctx.env, term: this.freshMeta(ctx).meta });
              return Result.pure(this.freshMeta(this.bind({ ctx, name: "x", vtype: dom }))).then(({ meta }) => ({ term: meta, env: ctx.env }))
                .then(cls => this.unifyCatch({ ctx, val0: new VPi({ name: "x", dom, cls, isImpl }), val1: vtype }).then(() => [ dom, cls ])) } })(this.force({ ctx, val: vtype }))
            .then(([ dom, cls ]) => this.check({ ctx, rterm: rterm.arg, vtype: dom })
              .then(({ term: arg }) => ({ ctx, term: new App({ func: term, arg, isImpl }), vtype: this.cApp({ ctx, cls, val: this.eval({ ctx, env: ctx.env, term: arg }) }) })))) },
          ru ({ ctx }) { return Result.pure({ ctx, term: new U(), vtype: new VU() }) },
          rpi ({ ctx, rterm }) { return this.check({ ctx, rterm: rterm.dom, vtype: new VU() })
            .then(({ term: dom }) => this.check({ ctx: this.bind({ ctx, name: rterm.name, vtype: this.eval({ ctx, env: ctx.env, term: dom }) }), rterm: rterm.cod, vtype: new VU() })
              .then(({ term: cod }) => ({ ctx, term: new Pi({ name: rterm.name, dom, cod, isImpl: rterm.isImpl }), vtype: new VU() }))) },
          rlet ({ ctx, rterm }) { return this.check({ ctx, rterm: rterm.type, vtype: new VU() }).then(({ term: type }) => {
            let cvtype = this.eval({ ctx, term: type, env: ctx.env });
            return this.check({ ctx, rterm: rterm.term, vtype: cvtype })
              .then(({ term }) => this.infer({ ctx: this.define({ ctx, name: rterm.name, val: this.eval({ ctx, term, env: ctx.env }), vtype: cvtype }), rterm: rterm.next })
                .then(({ term: next, vtype }) => ({ ctx, term: new Let({ name: rterm.name, type, term, next }), vtype }))) }) },
          rhole ({ ctx }) { return { ctx, vtype: this.eval({ ctx, env: ctx.env, term: this.freshMeta(ctx).meta }), term: this.freshMeta(ctx).meta } }
        }, { decorate: ({ rterm }) => globalContext.pos = rterm.pos, scrut: [ "rterm" ] }),

        doElab ({ rterm }) { return this.infer({ ctx: { env: [], types: [], bds: [], lvl: 0 }, rterm })
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
            .then(({ ctx, term }) => ({ ctx, term, metas: Array.from(globalContext.metas).map(([ mvar, soln ]) =>
              new MetaEntry({ mvar, soln: soln === null ? soln : this.quote({ ctx, lvl: 0, val: soln }) })) })) },
        displayError ({ msg }, err) {
          let lines = ctx.source.split(/\r\n?|\n/);
          return err({ message: `${msg}\n${lines[globalContext.pos[0][0] - 1]}\n${"-".repeat(globalContext.pos[0][1] - 1)}${
            "^".repeat(globalContext.pos[1][1] - globalContext.pos[0][1])} ${globalContext.pos.join("-")}` }) }
      })) this[k] = debug(["normalForm", "typecheck", "elaborate"].includes(k) ?
        function (...args) { phase = "evaluator"; return fn.apply(this, args) } : fn, k, this)
    }
  }

  const parseVMCode = new Parser(),
        evaluateVMProgram = new Evaluator(),
        sequence = (p => fn => p = fn ? p.then(fn) : p)(Promise.resolve());

  return Object.defineProperties({}, {
    import: { get () {
      return (opt = {}) => sequence(() => new Promise((ok, err) => {
        if ("code" in opt && !("path" in opt)) ok(opt.code);
        else if ("path" in opt) fetch(opt.path).then(rsp => rsp.text()).then(ok).catch(err);
        else err({ message: "Load error: import option must be either 'code' or 'path'" })
      })).then(src => ({
        normalForm: { run: () => parseVMCode(src).then(evaluateVMProgram.normalForm).toPromise() },
        typecheck: { run: () => parseVMCode(src).then(evaluateVMProgram.typecheck).toPromise() },
        elaborate: { run: () => parseVMCode(src).then(evaluateVMProgram.elaborate).toPromise() }
      }))
    } }
  })
}