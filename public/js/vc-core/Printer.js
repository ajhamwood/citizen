'use strict';

var PP = (() => {
  let U = this.U, AST = this.AST;
  if (typeof module !== 'undefined') {
    U = require('./Utilities.js');
    AST = require('./AbstractSyntaxTree.js')
  }

  function vars (i) {
    let letters = 'xyzabcdefghijklmnopqrstuvw'.split('')
    return letters[i % 26].repeat(Math.ceil(++i / 26))
  }

  function parensIf (bool, string) {
    return bool ? `(${string})` : string
  }

  function nestedLambda (int2, rhs) {
    if (U.testCtor(rhs, AST.Lambda)) return nestedLambda(int2 + 1, rhs.checkableTerm);
    else return Array(int2).fill(0).reduce((a, _, i) => a += vars(i) + ', ', '').slice(0, -2) + ' => ' + checkableTermPrint(0, int2, rhs)
  }

  function nestedForall (int2, binds, rhs) {
    if (U.testCtor(rhs, AST.Inferred) && U.testCtor(rhs.inferrableTerm, AST.Pi)) {
      binds.unshift({b: int2, t: rhs.inferrableTerm.checkableTerm1});
      return nestedForall(int2 + 1, binds, rhs.inferrableTerm.checkableTerm2)
    } else return binds.reduceRight((a, {b, t}) => a += parensIf(true, vars(b) + ' : ' + checkableTermPrint(1, b, t)) + ', ', '').slice(0, -2) + ' ==> ' + checkableTermPrint(0, int2, rhs)
  }

  function inferrableTermPrint (int1, int2, inferrableTerm) {
    if (U.testExtendedCtor(inferrableTerm, AST.InferrableTerm)) {
      switch (inferrableTerm.constructor) {
        case AST.Annotated:
        return parensIf(int1 > 1, checkableTermPrint(2, int2, inferrableTerm.checkableTerm1) + ' : ' + checkableTermPrint(0, int2,  inferrableTerm.checkableTerm2))

        case AST.Star:
        return 'Type';

        case AST.Pi:
        if (U.testCtor(inferrableTerm.checkableTerm2, AST.Inferred) && U.testCtor(inferrableTerm.checkableTerm2.inferrableTerm, AST.Pi)) {
          return parensIf(int1 > 0, nestedForall(int2 + 2,
            [{b: int2 + 1, t: inferrableTerm.checkableTerm2.inferrableTerm.checkableTerm1}, {b: int2, t: inferrableTerm.checkableTerm1}],
            inferrableTerm.checkableTerm2.inferrableTerm.checkableTerm2))
        } else return parensIf(true, vars(int2) + ' : ' + checkableTermPrint(0, int2, inferrableTerm.checkableTerm1) + ' ==> ' + checkableTermPrint(0, int2 + 1, inferrableTerm.checkableTerm2))

        case AST.Bound:
        return vars(int2 - inferrableTerm.int - 1)

        case AST.Free:
        if (U.testCtor(inferrableTerm.name, AST.Global)) return inferrableTerm.name.string;
        break;

        case AST.Apply:
        return parensIf(int1 > 1, inferrableTermPrint(2, int2, inferrableTerm.inferrableTerm) + ' ' + checkableTermPrint(3, int2, inferrableTerm.checkableTerm))
      }
    }
  }

  function checkableTermPrint (int1, int2, checkableTerm) {
    if (U.testExtendedCtor(checkableTerm, AST.CheckableTerm)) {
      switch (checkableTerm.constructor) {
        case AST.Inferred:
        return inferrableTermPrint(int1, int2, checkableTerm.inferrableTerm)

        case AST.Lambda:
        if (U.testCtor(checkableTerm.checkableTerm, AST.Lambda)) {
          return parensIf(int1 > 0, nestedLambda(int2 + 2, checkableTerm.checkableTerm.checkableTerm))
        }
        else return parensIf(int1 > 0, vars(int2) + ' => ' + checkableTermPrint(0, int2 + 1, checkableTerm.checkableTerm))
      }
    }
  }

  function print (term) {
    if (U.testExtendedCtor(term, AST.InferrableTerm)) return inferrableTermPrint(0, 0, term);
    else if (U.testExtendedCtor(term, AST.CheckableTerm)) return checkableTermPrint(0, 0, term)
  }

  return { print }
})();


if (typeof module !== 'undefined') module.exports = PP
