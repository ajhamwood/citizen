'use strict';

var P = (() => {
  let AST = this.AST;
  if (typeof module !== 'undefined') AST = require('./AbstractSyntaxTree.js');

  let tokens, token_nr, token;
  let debug, ifDebug, nest_level;

  function doDebug (msg) {
    let n = token_nr, t = tokens[n];
    if (msg === 'End statement?') console.log(`%c${msg}`, 'font-weight: bold', t, n);
    else if (msg === 'Assign lhs?') console.log(`%c${msg}`, 'font-weight: bold; color: goldenrod', t, n);
    else if (msg === 'Declare') console.log(`%c${msg}`, 'font-weight: bold; color: purple', t, n);
    else if (msg === 'Evaluate') console.log(`%c${msg}`, 'font-weight: bold; color: forestgreen', t, n);
    else console.log(msg, t, n)
  }

  function dispense () {
    let maybe_next = tokens[token_nr++];
    if (maybe_next.id === '(comment)') return dispense();
    else return maybe_next
  }

  function advance (debugMsg, id, match) { // TODO: advance(msg, {identifier: true})
    debugMsg && debug(debugMsg);
    if (typeof id !== 'undefined' && (tokens[token_nr].id !== id || typeof match !== 'undefined' && tokens[token_nr].value !== match))
      throw new Error(`Mismatch at '${token.id}', '${token.value}', token #${token_nr}: expected '${id}', '${match}'`);
    token = tokens[token_nr];
    let next_token = dispense()
  }

  function alt (inner) {
    let rewind = token_nr - 1;
    return new Promise(r => r(inner()))
      .catch(err => {
        token_nr = rewind;
        advance();
        throw err
      })
  }

  function parens (inner) {
    if (nest_level > 20) throw new Error('Parens nest level too deep');
    return alt(() => {
      advance('Open parens?', '(punctuation)', '(');
      ifDebug && console.group('Try parens');
      nest_level++
      return inner().then(result => {
        advance('Close parens?', '(punctuation)', ')');
        ifDebug && console.groupEnd();
        nest_level--;
        return result
      }).catch(err => {
        ifDebug && console.groupEnd();
        nest_level--;
        throw err
      })
    })
  }

  function debugGroup (msg, inner) {
    return alt(() => {
      console.group(msg);
      return inner().then(result => {
        console.groupEnd();
        return result
      }).catch(err => {
        console.groupEnd();
        throw err
      })
    })
  }

  class Eval {
    constructor (s, v) {
      this.lhs = s;
      this.rhs = v
    }
  }

  class Assume {
    constructor (s, v) {
      this.string = s;
      this.type = v
    }
  }


  function parseStmt (env, result) {
    function endTest (int) {
      debug('End statement?');
      return alt(() => {
        advance('', '(newline)');
        return parseStmt(env, result.concat(int))
      }).catch(() => alt(() => {
        advance('', '(end)');
        return result.concat(int)
      })).catch(() => alt(() => {
        advance('', '(comment)');
        return parseStmt(env, result)
      }))
    }
    return endTest([]).catch(() => alt(() => { // Assign statement
      advance('Assign lhs?');
      if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
      let x = token.id;
      advance('Assign operator?', '(infix)', ':=');
      return parseITerm(0, env)
        .then(y => endTest([new Eval(x, y)]))
    })).catch(() => alt(() => { // Declare statement
      debug('Declare');
      return parseBindings(false, [])
        .then(({boundvars, types}) => boundvars.reduce((a, x, i) => (a.push(new Assume(x.id, types[i])), a), []))
        .then(endTest)
    })).catch(() => { // Evaluate statement
      debug('Evaluate');
      return parseITerm(0, env)
        .then(v => endTest([new Eval('it', v)]))
    })
  }


  function parseBindings (isPi, env) {
    function parseBoundvars () {
      let loop;
      advance('Binding variable?');
      if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
      let boundvars = [token];
      return (loop = () => alt(() => { // First alternative will always fail on the final loop
        advance('Binding comma?', '(punctuation)', ',');
        advance('Binding next variable?');
        if (!token.identifier || 'value' in token) throw new Error('Not an identifier');
        boundvars.push(token);
        return loop()
      }).catch(() => {
        advance('Binding operator?', '(infix)', ':');
        return boundvars
      }))()
    }
    return (ifDebug ? inner => debugGroup('Try bindings', inner) : alt)(() => {
      let loop;
      return (loop = (e, t) =>
        parens(() =>
          parseBoundvars()
            .then(boundvars => parseCTerm(0, isPi ? e : [])
              .then(type => ({e: e.concat(boundvars), t: t.concat(Array(boundvars.length).fill(type))}))))
          .then(bindings => alt(() => {
            if (isPi) advance('Pi binding comma?', '(punctuation)', ',');
            return loop(bindings.e, bindings.t)
          }).catch(() => ({boundvars: bindings.e, types: bindings.t}))))(env, [])
        .catch(() => parseBoundvars()
          .then(boundvars => parseCTerm(0, env)
            .then(t => ({boundvars, types: Array(boundvars.length).fill(t)}))))
    })
  }


  function parseITerm (iclause, env) {
    switch (iclause) {
      case 0: // Pi term
      function fnArrow (term, env) {
        let bound = token;
        advance('Function arrow?', '(infix)', '->');
        return parseCTerm(0, [''].concat(env)) // Anonymous pi bound term
          .then(piBound => new AST.Pi(term, piBound))
      }
      return (ifDebug ? inner => debugGroup('Try Pi', inner) : alt)(() =>
        parseBindings(true, env).then(({boundvars, types}) => {
          advance('Pi arrow?', '(infix)', '==>');
          return parseCTerm(0, boundvars.reverse()).then(piBound => {
            let type = types.pop();
            return types.reduce((a, x) => a = new AST.Pi(x, new AST.Inferred(a)), new AST.Pi(type, piBound))
          })
        })
      ).catch(() => alt(() => parseITerm(1, env)
        .then(x => alt(() => fnArrow(new AST.Inferred(x), env))
          .catch(() => x))))
        .catch(() => parens(() => parseLam(env))
          .then(x => fnArrow(x, env)))


      case 1: // Annotated term
      function binding (term) {
        return alt(() => {
          advance('Annotated term?', '(infix)', ':');
          return parseCTerm(0, env)
            .then(x => new AST.Annotated(term, x))
        })
      }
      return (ifDebug ? inner => debugGroup('Try Annotated', inner) : f => f())(() => parseITerm(2, env)
        .then(x => binding(new AST.Inferred(x))
          .catch(() => x))
        .catch(() => parens(() => parseLam(env))
          .then(binding)))


      case 2: // Applied term
      return parseITerm(3, env)
        .then(t => (ifDebug ? inner => debugGroup('Try Apply', inner) : alt)(() => {
          let ts = [], loop;
          debug('Application?'); // TODO: fail out if Star?
          return (loop = () => parseCTerm(3, env)
            .then(cterm => {
              ts.push(cterm);
              return loop()
            })
          )().catch(() => ts.reduce((a, x) => a = new AST.Apply(a, x), t))
        }).catch(() => t)) // Zero applications case


      case 3: // Variable term
      return alt(() => {
        advance('Star?', 'Type');
        return new AST.Star()
      }).catch(() => alt(() => {
        advance('Variable term?');
        if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
        let x = token,
            i = env.findIndex(x => x.id === token.id);
        return ~i ? new AST.Bound(i) : new AST.Free(new AST.Global(x.id))
      })).catch(() => parens(() => parseITerm(0, env)))
    }
  }


  function parseCTerm (iclause, env) {
    let ifD = ifDebug ? inner => debugGroup('Try CTerm', inner) : f => f()
    switch (iclause) {
      case 0:
      return ifD(() => alt(() => parseLam(env))
        .catch(() => parseITerm(0, env)
          .then(x => new AST.Inferred(x))))

      default:
      return ifD(() => alt(() => parens(() => parseLam(env)))
        .catch(() => parseITerm(iclause, env)
          .then(x => new AST.Inferred(x))))
    }
  }


  function parseLam (env) {
    return (ifDebug ? inner => debugGroup('Try Lambda', inner) : f => f())(() => alt(() => {
      advance('Lambda bound variable?');
      if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
      let boundvars = [], loop;
      return (loop = () => alt(() => {
        boundvars.push(token);
        advance('Lambda comma?', '(punctuation)', ',');
        advance('Lambda next variable?')
        if (!token.identifier || 'value' in token) throw new Error('Not an identifier');
        return loop()
      }).catch(err => { if (err.message === 'Not an identifier') throw err }))()
        .then(() => {
          advance('Lambda arrow?', '(infix)', '=>');
          return parseCTerm(0, boundvars.reverse().concat(env))
            .then(t => boundvars.reduce(a => a = new AST.Lambda(a), t))
        })
    }))
  }


  function parse (t, d) {
    debug = (ifDebug = d) ? doDebug : () => {};
    token_nr = 0;
    tokens = t;
    nest_level = 0;
    return parseStmt([], []).catch(() => { throw 'Parser error' })
  }

  return { parse, Eval, Assume }
})();


if (typeof module !== 'undefined') module.exports = P
