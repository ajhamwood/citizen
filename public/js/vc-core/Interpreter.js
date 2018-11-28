'use strict';

var I = (() => {
  let U = this.U, AST = this.AST, L = this.L, P = this.P, PP = this.PP;
  if (typeof module !== 'undefined') {
    U = require('./Utilities.js');
    AST = require('./AbstractSyntaxTree.js');
    L = require('./Lexer.js');
    P = require('./Parser.js');
    PP = require('./Printer.js')
  }

  class State {
    constructor (ctx, nameEnv) {
      if (U.testCtor(ctx, AST.Context) && U.testCtor(nameEnv, AST.NameEnvironment)) {
        Object.assign(this, { ctx, nameEnv })
      } else throw '?'
    }
  }

  function check (state, stmt) {
    let x = AST.initialInferType(state.ctx, stmt.rhs);
    switch (x.constructor) {
      case x.Left:
      return new Error(x.value);
      break;

      case x.Right:
      let v = AST.inferEvaluate(stmt.rhs, new AST.Environment(), state.nameEnv);
      state.ctx.cons(new AST.NameInfoPair().setValue(new AST.Global(stmt.lhs), new AST.HasType(x.value)));
      state.nameEnv.cons(new AST.NameValuePair().setValue(new AST.Global(stmt.lhs), v));
      let str = stmt.lhs;
      return str === 'it' ?
        PP.print(AST.initialQuote(v)) + ' : ' + PP.printType(x.value) :
        str + ' : ' + PP.printType(x.value)
    }
  }

  function evaluate (text, state, debug) {
    return P.parse(L.tokenise(text, debug), debug).then(int => int.reduce((a, stmt) => {
      switch (stmt.constructor) {
        case AST.NameInfoPair:
        state.ctx.cons(stmt);
        break;

        case P.Eval:
        a.push(check(state, stmt));
        break;

        case String:
        a.push(stmt)
      }
      return a
    }, []))
  }

  return { evaluate, State }
})();


if (typeof module !== 'undefined') module.exports = I
