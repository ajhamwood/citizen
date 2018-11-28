'use strict';

var P = (() => {
  let AST = this.AST;
  if (typeof module !== 'undefined') AST = require('./AbstractSyntaxTree.js');

  let tokens, token_nr, token;
  let debug, nest_level;

  function dispense () {
    let maybe_next = tokens[token_nr++];
    if (maybe_next.id === '(comment)') return dispense();
    else return maybe_next
  }

  function advance (id, match) {
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
      debug('Open parens?', tokens[token_nr], token_nr, "level:", nest_level);
      advance('(punctuation)', '(');
      nest_level++
      return inner().then(result => {
        debug('Close parens?', tokens[token_nr], token_nr, "level:", nest_level);
        advance('(punctuation)', ')');
        nest_level--;
        return result
      }).catch(err => {
        nest_level--;
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

  function parseStmt (env, result) {
    function endTest (int) {
      debug('End statement?', tokens[token_nr], token_nr);
      return alt(() => {
        advance('(newline)');
        return parseStmt(env, result.concat(int))
      }).catch(() => alt(() => {
        advance('(end)');
        return result.concat(int)
      })).catch(() => alt(() => {
        advance('(comment)');
        return parseStmt(env, result)
      }))
    }
    return endTest([]).catch(() => alt(() => { // Assign statement
      debug('Assign lhs?', tokens[token_nr], token_nr);
      advance();
      if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
      let x = token.id;
      debug('Assign operator?', tokens[token_nr], token_nr);
      advance('(infix)', '=');
      return parseITerm(0, env)
        .then(y => endTest([new Eval(x, y)]))
    })).catch(() => alt(() => { // Declare statement
      debug('Declare?', tokens[token_nr], token_nr);
      advance('data');
      return parseBindings()
        .then(endTest)
    })).catch(() => { // Evaluate statement
      debug('Evaluate', tokens[token_nr], token_nr)
      return parseITerm(0, env)
        .then(v => endTest([new Eval('it', v)]))
    })
  }

  function parseBindings () {
    function pInfo () {
      let loop;
      debug('Binding variable?', tokens[token_nr], token_nr);
      advance();
      if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
      let xs = [new AST.Global(token.id)];
      return (loop = () => alt(() => {
        debug('Binding comma?', tokens[token_nr], token_nr);
        advance('(punctuation)', ',');
        debug('Binding next variable?', tokens[token_nr], token_nr);
        advance();
        if (!token.identifier || 'value' in token) throw new Error('Not an identifier');
        xs.push(new AST.Global(token.id));
        return loop()
      }).catch(() => {
        debug('Binding operator?', tokens[token_nr], token_nr);
        advance('(infix)', ':');
        return alt(() => {
          debug('Binding star?', tokens[token_nr], token_nr);
          advance('Type');
          return xs.map(x => new AST.NameInfoPair().setValue(x, new AST.HasKind(new AST.Star())))
        }).catch(() => parseType(0, []).then(t => xs.map(x => new AST.NameInfoPair().setValue(x, new AST.HasType(t)))))
      }))()
    }
    return alt(() => {
      let loop;
      return (loop = i => parens(() => pInfo())
        .then(infos => alt(() => loop(i.concat(infos)))
          .catch(() => i.concat(infos)))
      )([])
    }).catch(() => pInfo())
  }

  function parseType (iclause, env) {
    switch (iclause) {
      case 0: // Function type
      return parseType(1, env)
        .then(t1 => alt(() => {
          debug('Function arrow?', tokens[token_nr], token_nr);
          advance('(infix)', '->');
          return parseType(0, env)
            .then(t2 => new AST.FunctionArrow(t1, t2))
        }).catch(() => t1))

      case 1: // Free type
      return alt(() => {
        debug('Type?', tokens[token_nr], token_nr);
        advance();
        if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
        return new AST.TFree(new AST.Global(token.id))
      }).catch(() => parens(() => parseType(0, env)))
    }
  }

  function parseITerm (iclause, env) {
    switch (iclause) {
      case 0:
      case 1: // Annotated term
      function rest (term) {
        return alt(() => {
          debug('Annotated term?', tokens[token_nr], token_nr);
          advance('(infix)', ':');
          return parseType(0, env)
            .then(x => new AST.Annotated(term, x))
        })
      }
      return parseITerm(2, env)
        .then(x => rest(new AST.Inferred(x))
          .catch(() => x))
        .catch(() => parens(() => parseLam())
          .then(rest))

      case 2: // Applied term
      return parseITerm(3, env)
        .then(t => alt(() => {
          let ts = [], loop;
          debug('Application?', tokens[token_nr], token_nr);
          return (loop = () => parseCTerm(3, env)
            .then(cterm => {
              ts.push(cterm);
              return loop()
            })
          )().catch(() => ts.reduce((a, x) => a = new AST.Apply(a, x), t))
        }).catch(() => t)) // Zero applications case

      case 3: // Variable term
      return alt(() => {
        debug('Variable term?', tokens[token_nr], token_nr);
        advance();
        if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
        let x = token,
            i = env.findIndex(x => x.id === token.id);
        return ~i ? new AST.Bound(i) : new AST.Free(new AST.Global(x.id))
      }).catch(() => parens(() => parseITerm(0, env)))
    }
  }

  function parseCTerm (iclause, env) {
    switch (iclause) {
      case 0:
      return alt(() => parseLam(env))
        .catch(() => parseITerm(0, env)
          .then(x => new AST.Inferred(x)))

      default:
      return alt(() => parens(() => parseLam(env)))
        .catch(() => parseITerm(iclause, env)
          .then(x => new AST.Inferred(x)))
    }
  }

  function parseLam (env) {
    return alt(() => {
      debug('Lambda bound variable?', tokens[token_nr], token_nr);
      advance();
      if (!token.identifier || 'value' in token) throw new Error(`Mismatch at ${token.id}, token #${token_nr}`);
      let boundvars = [], loop;
      return (loop = () => alt(() => { // syntax: (x, y, ... => s)
        boundvars.push(token);
        debug('Lambda comma?', tokens[token_nr], token_nr);
        advance('(punctuation)', ',');
        debug('Lambda next bound variable?', tokens[token_nr], token_nr);
        advance()
        if (!token.identifier || 'value' in token) throw new Error('Not an identifier');
        return loop()
      }).catch(err => { if (err.message === 'Not an identifier') throw err }))()
        .then(() => {
          debug('Lambda arrow?', tokens[token_nr], token_nr);
          advance('(infix)', '=>');
          return parseCTerm(0, boundvars.reverse().concat(env))
            .then(t => boundvars.reduce(a => a = new AST.Lambda(a), t))
        })
    })
  }

  function parse (t, d) { // Must return an InferrableTerm
    debug = d ? console.log : () => {};
    token_nr = 0;
    tokens = t;
    nest_level = 0;
    debug(tokens);
    return parseStmt([], []).catch(() => ['Parser error'])
  }

  return { parse, Eval }
})();


if (typeof module !== 'undefined') module.exports = P
