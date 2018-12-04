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

  function check (state, string, expr) {
    let x = AST.initialInferType(state.ctx, state.nameEnv, expr);
    switch (x.constructor) {
      case x.Left:
      return new Error(x.value);
      break;

      case x.Right:
      let v = AST.inferEvaluate(expr, new AST.Environment(), state.nameEnv);
      return {type: x.value, value: v}
    }
  }

  function evaluate (text, state, debug) {
    return P.parse(L.tokenise(text, debug), debug).then(int => int.reduce((a, stmt) => {
      let result;
      switch (stmt.constructor) {
        case P.Assume:
        result = check(state, stmt.string, new AST.Annotated(stmt.type, new AST.Inferred(new AST.Star())));
        if (result.constructor === Error) throw result;
        state.ctx.setValue(new AST.NameTypePair().setValue(new AST.Global(stmt.string), new AST.Type(result.value)))
        console.log('In context: ' + stmt.string + ' : ' + PP.print(AST.initialQuote(result.value)))
        break;

        case P.Eval:
        result = check(state, stmt.lhs, stmt.rhs);
        if (result.constructor === Error) throw result;
        let type = AST.initialQuote(result.type.value), string = stmt.lhs;
        state.ctx.setValue(new AST.NameTypePair().setValue(new AST.Global(string), result.type));
        state.nameEnv.setValue(new AST.NameValuePair().setValue(new AST.Global(string), result.value));
        let ret = (string === 'it' ? PP.print(AST.initialQuote(result.value)) :  string) + ' : ' + PP.print(type);
        if (string !== 'it') console.log('In context: ' + ret)
        a.push(ret)
      }
      return a
    }, [])).catch(e => [e])
  }

  return { evaluate, State }
})();


if (typeof module !== 'undefined') module.exports = I
