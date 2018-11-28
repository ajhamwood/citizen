'use strict';

var AST = (() => {
  let U = this.U;
  if (typeof module !== 'undefined') U = require('./Utilities.js');


  class InferrableTerm {}

  class Annotated extends InferrableTerm {
    constructor (checkableTerm, type) {
      super();
      if (U.testExtendedCtor(checkableTerm, CheckableTerm) && U.testExtendedCtor(type, Type)) {
        Object.assign(this, { checkableTerm, type })
      } else throw '?'
    }
  }

  class Bound extends InferrableTerm {
    constructor (int) {
      super();
      if (U.testInteger(int)) {
        Object.assign(this, { int })
      } else throw '?'
    }
  }

  class Free extends InferrableTerm {
    constructor (name) {
      super();
      if (U.testExtendedCtor(name, Name)) {
        Object.assign(this, { name })
      } else throw '?'
    }
  }

  class Apply extends InferrableTerm {
    constructor (inferrableTerm, checkableTerm) {
      super();
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm) && U.testExtendedCtor(checkableTerm, CheckableTerm)) {
        Object.assign(this, { inferrableTerm, checkableTerm })
      } else throw '?'
    }
  }


  class CheckableTerm {}

  class Inferred extends CheckableTerm {
    constructor (inferrableTerm) {
      super();
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm)) {
        Object.assign(this, { inferrableTerm })
      } else throw '?'
    }
  }

  class Lambda extends CheckableTerm {
    constructor (checkableTerm) {
      super();
      if (U.testExtendedCtor(checkableTerm, CheckableTerm)) {
        Object.assign(this, { checkableTerm })
      } else throw '?'
    }
  }


  class Name extends U.Eq {
    constructor () {
      super();
    }
  }

  class Global extends Name {
    constructor (string) {
      super();
      if (U.testCtor(string, String)) {
        Object.assign(this, { string })
      } else throw '?'
    }
  }

  class Local extends Name {
    constructor (int) {
      super();
      if (U.testInteger(int)) {
        Object.assign(this, { int })
      } else throw '?'
    }
  }

  class Quote extends Name {
    constructor (int) {
      super();
      if (U.testInteger(int)) {
        Object.assign(this, { int })
      } else throw '?'
    }
  }


  class Type {}

  class TFree extends Type {
    constructor (name) {
      super();
      if (U.testExtendedCtor(name, Name)) {
        Object.assign(this, { name })
      } else throw '?'
    }
  }

  class FunctionArrow extends Type {
    constructor (type1, type2) {
      super();
      if (U.testExtendedCtor(type1, Type) && U.testExtendedCtor(type2, Type)) {
        Object.assign(this, { type1, type2 })
      } else throw '?'
    }
  }


  class Value {}

  class VLambda extends Value {
    constructor (func) { // Not natural to validate for function ADT in javascript
      super();
      if (U.testCtor(func, Function)) {
        Object.assign(this, { func })
      } else throw '?'
    }
  }

  class VNeutral extends Value {
    constructor (neutral) {
      super();
      if (U.testExtendedCtor(neutral, Neutral)) {
        Object.assign(this, { neutral })
      } else throw '?'
    }
  }


  class Neutral {}

  class NFree extends Neutral {
    constructor (name) {
      super();
      if (U.testExtendedCtor(name, Name)) {
        Object.assign(this, { name })
      } else throw '?'
    }
  }

  class NApply extends Neutral {
    constructor (neutral, value) {
      super();
      if (U.testExtendedCtor(neutral, Neutral) && U.testExtendedCtor(value, Value)) {
        Object.assign(this, { neutral, value })
      } else throw '?'
    }
  }

  function vfree (name) {
    if (U.testExtendedCtor(name, Name)) {
      let value = new VNeutral(new NFree(name));
      if (!U.testExtendedCtor(value, Value)) throw '?'
      return value
    } else throw '?'
  }


  class Environment extends U.ValidatedArray {
    constructor () {
      super(Value);
    }
  }

  function inferEvaluate (inferrableTerm, environment, nameEnvironment) {
    if (U.testExtendedCtor(inferrableTerm, InferrableTerm) && U.testCtor(environment, Environment) && U.testCtor(nameEnvironment, NameEnvironment)) {
      let value;
      switch (inferrableTerm.constructor) {
        case Annotated:
        value = checkEvaluate(inferrableTerm.checkableTerm, environment, nameEnvironment)
        break;

        case Bound:
        value = environment.getValue(inferrableTerm.int)
        break;

        case Free:
        let maybeValue = nameEnvironment.lookup(inferrableTerm.name);
        switch (maybeValue.constructor) {
          case maybeValue.Nothing:
          value = vfree(inferrableTerm.name);
          break;

          case maybeValue.Just:
          value = maybeValue.value
        }
        break;

        case Apply:
        value = vapply(
          inferEvaluate(inferrableTerm.inferrableTerm, environment, nameEnvironment),
          checkEvaluate(inferrableTerm.checkableTerm, environment, nameEnvironment))
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(value, Value)) return value;
      else throw '?'
    } else throw '?'
  }

  function vapply (value1, value2) {
    if (U.testExtendedCtor(value1, Value) && U.testExtendedCtor(value2, Value)) {
      let value;
      switch (value1.constructor) {
        case VLambda:
        value = value1.func(value2);
        break;

        case VNeutral:
        value = new VNeutral(new NApply(value1.neutral, value2));
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(value, Value)) return value;
      else throw '?'
    } else throw '?'
  }

  function checkEvaluate (checkableTerm, environment, nameEnvironment) {
    if (U.testExtendedCtor(checkableTerm, CheckableTerm) && U.testCtor(environment, Environment) && U.testCtor(nameEnvironment, NameEnvironment)) {
      let value;
      switch (checkableTerm.constructor) {
        case Inferred:
        value = inferEvaluate(checkableTerm.inferrableTerm, environment, nameEnvironment)
        break;

        case Lambda:
        value = new VLambda(x => checkEvaluate(checkableTerm.checkableTerm, environment.cons(x), nameEnvironment))
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(value, Value)) return value;
      else throw '?'
    } else throw '?'
  }


  class Kind {}

  class Star extends Kind {}

  class Info {}

  class HasKind extends Info {
    constructor (kind) {
      super();
      if (U.testExtendedCtor(kind, Kind)) {
        Object.assign(this, { kind })
      } else throw '?'
    }
  }

  class HasType extends Info {
    constructor (type) {
      super();
      if (U.testExtendedCtor(type, Type)) {
        Object.assign(this, { type })
      } else throw '?'
    }
  }

  class NameInfoPair extends U.ValidatedPair {
    constructor () {
      super(Name, Info)
    }
  }

  class Context extends U.ValidatedArray {
    constructor () {
      super(NameInfoPair)
    }
  }

  class NameValuePair extends U.ValidatedPair {
    constructor () {
      super(Name, Value)
    }
  }

  class NameEnvironment extends U.ValidatedArray {
    constructor () {
      super(NameValuePair)
    }
  }


  class Result extends U.ValidatedEither {
    constructor (type) {
      super(String, type)
    }
  }

  function throwError (string) {
    if (U.testCtor(string, String)) return (new Result(U.Unit)).left(string); //Actually of type Result a, not Result Unit
    else throw '?'
  }


  function checkKind (context, type, kind) {
    if (U.testCtor(context, Context) && U.testExtendedCtor(type, Type) && U.testExtendedCtor(kind, Kind)) {
      let res;
      switch (type.constructor) {
        case TFree:
        let maybeInfo = context.lookup(type.name);
        switch (maybeInfo.constructor) {
          case maybeInfo.Just:
          res = (new Result(U.Unit)).right(new U.Unit());
          break;

          case maybeInfo.Nothing:
          res = throwError('Unknown identifier');
          break;

          default: throw '?'
        }
        break;

        case FunctionArrow:
        res = checkKind(context, type.type1, kind);
        if (U.testExtendedCtor(res, res.Left)) break;
        res = checkKind(context, type.type2, kind);
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(res, Result)) return res;
      else throw '?'
    } else throw '?'
  }

  function initialInferType (context, inferrableTerm) {
    return inferType(0, context, inferrableTerm)
  }

  function inferType (int, context, inferrableTerm) {
    if (U.testInteger(int) && U.testCtor(context, Context) && U.testExtendedCtor(inferrableTerm, InferrableTerm)) {
      let res;
      switch (inferrableTerm.constructor) {
        case Annotated:
        checkKind(context, inferrableTerm.type, new Star());
        checkType(int, context, inferrableTerm.checkableTerm, inferrableTerm.type);
        res = (new Result(Type)).right(inferrableTerm.type);
        break;

        case Free:
        let maybeInfo = context.lookup(inferrableTerm.name);
        switch (maybeInfo.constructor) {
          case maybeInfo.Just:
          res = (new Result(Type)).right(maybeInfo.value.type);
          break;

          case maybeInfo.Nothing:
          res = throwError('Unknown identifier');
          break;

          default: throw '?'
        }
        break;

        case Apply:
        res = inferType(int, context, inferrableTerm.inferrableTerm);
        if (U.testExtendedCtor(res, res.Left)) break;
        switch (res.value.constructor) {
          case FunctionArrow:
          let { type2 } = res.value;
          res = checkType(int, context, inferrableTerm.checkableTerm, res.value.type1)
          if (U.testExtendedCtor(res, res.Left)) break;
          res = (new Result(Type)).right(type2);
          break;

          default:
          res = throwError('Illegal application')
        }
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(res, Result)) return res; //Is this of type Result Type?
      else throw '?'
    } else throw '?'
  }

  function checkType (int, context, checkableTerm, type) {
    if (U.testInteger(int) && U.testCtor(context, Context) && U.testExtendedCtor(checkableTerm, CheckableTerm) && U.testExtendedCtor(type, Type)) {
      let res;
      switch (checkableTerm.constructor) {
        case Inferred:
        res = inferType(int, context, checkableTerm.inferrableTerm);
        if (U.testExtendedCtor(res, res.Left)) break;
        if (res.value !== type) res = throwError('Type mismatch')
        break;

        case Lambda:
        if (type.constructor === FunctionArrow) {
          context.cons((new context.elemType()).setValue(new Local(int), new HasType(type.type1)));
          res = checkType(int + 1, context, checkSubstitution(0, new Free(new Local(int)), checkableTerm.checkableTerm), type.type2)
        } else res = throwError('Type mismatch');
        break;

        default: res = throwError('Type mismatch')
      }
      if (U.testExtendedCtor(res, Result)) return res;
      else throw '?'
    } else throw '?'
  }

  function inferSubstitution (int, inferrableTerm1, inferrableTerm2) {
    if (U.testInteger(int) && U.testExtendedCtor(inferrableTerm1, InferrableTerm) && U.testExtendedCtor(inferrableTerm2, InferrableTerm)) {
      let inferrableTerm;
      switch (inferrableTerm2.constructor) {
        case Annotated:
        inferrableTerm = new Annotated(checkSubstitution(int, inferrableTerm1, inferrableTerm2.checkableTerm), inferrableTerm2.type);
        break;

        case Bound:
        inferrableTerm = int == inferrableTerm2.int ? inferrableTerm1 : inferrableTerm2;
        break;

        case Free:
        inferrableTerm = inferrableTerm2;
        break;

        case Apply:
        inferrableTerm = new Apply(
          inferSubstitution(int, inferrableTerm1, inferrableTerm2.inferrableTerm),
          checkSubstitution(int, inferrableTerm1, inferrableTerm2.checkableTerm))
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm)) return inferrableTerm;
      else throw '?'
    } else throw '?'
  }

  function checkSubstitution (int, inferrableTerm, checkableTerm) {
    if (U.testInteger(int) && U.testExtendedCtor(inferrableTerm, InferrableTerm) && U.testExtendedCtor(checkableTerm, CheckableTerm)) {
      let checkTerm;
      switch (checkableTerm.constructor) {
        case Inferred:
        checkTerm = new Inferred(inferSubstitution(int, inferrableTerm, checkableTerm.inferrableTerm));
        break;

        case Lambda:
        checkTerm = new Lambda(checkSubstitution(int + 1, inferrableTerm, checkableTerm.checkableTerm));
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(checkTerm, CheckableTerm)) return checkTerm;
      else throw '?'
    } else throw '?'
  }


  function initialQuote (value) {
    return quote(0, value)
  }

  function quote (int, value) {
    if (U.testInteger(int) && U.testExtendedCtor(value, Value)) {
      let checkableTerm;
      switch (value.constructor) {
        case VLambda:
        checkableTerm = new Lambda(quote(int + 1, value.func(vfree(new Quote(int)))));
        break;

        case VNeutral:
        checkableTerm = new Inferred(neutralQuote(int, value.neutral));
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(checkableTerm, CheckableTerm)) return checkableTerm;
      else throw '?'
    } else throw '?'
  }

  function neutralQuote (int, neutral) {
    if (U.testInteger(int) && U.testExtendedCtor(neutral, Neutral)) {
      let inferrableTerm;
      switch (neutral.constructor) {
        case NFree:
        inferrableTerm = boundfree(int, neutral.name);
        break;

        case NApply:
        inferrableTerm = new Apply(neutralQuote(int, neutral.neutral), quote(int, neutral.value));
        break;

        default: throw '?'
      }
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm)) return inferrableTerm;
      else throw '?'
    } else throw '?'
  }


  function boundfree (int, name) {
    if (U.testInteger(int) && U.testExtendedCtor(name, Name)) {
      let inferrableTerm;
      switch (name.constructor) {
        case Quote:
        inferrableTerm = new Bound(int - name.int - 1);
        break;

        default:
        inferrableTerm = new Free(name)
      }
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm)) return inferrableTerm;
      else throw '?'
    } else throw '?'
  }

  return {
    InferrableTerm, Annotated, Bound, Free, Apply,
    CheckableTerm, Inferred, Lambda,
    Name, Global, Local, Quote,

    Type, TFree, FunctionArrow,
    Value, VLambda, VNeutral,

    Neutral, NFree, NApply,
    vfree,

    Environment,
    inferEvaluate, checkEvaluate,

    Kind, Star,
    Info, HasKind, HasType,
    NameInfoPair, Context,
    NameValuePair, NameEnvironment,

    Result,
    throwError,

    checkKind, initialInferType, inferType, checkType, inferSubstitution, checkSubstitution,
    initialQuote, quote, neutralQuote, boundfree
  }
})();


if (typeof module !== 'undefined') module.exports = AST
