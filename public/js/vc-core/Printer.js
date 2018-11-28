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
    return bool ? `${string}`: string
  }

  function typePrint (int, type) {
    if (U.testExtendedCtor(type, AST.Type)) {
      switch (type.constructor) {
        case AST.TFree:
        if (U.testCtor(type.name, AST.Global)) return type.name.string;
        break;

        case AST.FunctionArrow:
        return parensIf(int > 0, typePrint(0, type.type1) + ' -> ' + typePrint(0, type.type2))
      }
    }
  }

  function inferrableTermPrint (int1, int2, inferrableTerm) { //int1 is parens level, int2 is de bruijn level
    if (U.testExtendedCtor(inferrableTerm, AST.InferrableTerm)) {
      switch (inferrableTerm.constructor) {
        case AST.Annotated:
        return parensIf(int1 > 1, checkableTermPrint(2, int2, inferrableTerm.checkableTerm) + ' : ' + typePrint(0, inferrableTerm.type))

        case AST.Bound:
        return vars(int2 - inferrableTerm.int - 1)

        case AST.Free:
        if (U.testCtor(inferrableTerm.name, AST.Global)) return inferrableTerm.name.string;
        break;

        case AST.Apply:
        return parensIf(int1 > 1, inferrableTermPrint(2, int2, inferrableTerm.inferrableTerm) + ' ' + checkableTermPrint(3, int2, inferrableTerm.checkTerm))

        default:
        return `[${inferrableTerm.toString()}]` // ?
      }
    }
  }

  function checkableTermPrint (int1, int2, checkableTerm) {
    if (U.testExtendedCtor(checkableTerm, AST.CheckableTerm)) {
      switch (checkableTerm.constructor) {
        case AST.Inferred:
        return inferrableTermPrint(int1, int2, checkableTerm.inferrableTerm)

        case AST.Lambda:
        return parensIf(int1 > 0, vars(int2) + ' => ' + checkableTermPrint(0, ++int2, checkableTerm.checkableTerm))
      }
    }
  }

  function print (checkableTerm) { return checkableTermPrint(0, 0, checkableTerm) }
  function printType (type) { return typePrint(0, type) }

  return { print, printType }
})();


if (typeof module !== 'undefined') module.exports = PP
