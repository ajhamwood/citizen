'use strict';

var AST = (() => {
  let U = this.U;
  if (typeof module !== 'undefined') U = require('./Utilities.js');


  class InferrableTerm extends U.Eq {}

  class Annotated extends InferrableTerm {
    constructor (checkableTerm1, checkableTerm2) {
      super();
      if (U.testExtendedCtor(checkableTerm1, CheckableTerm) && U.testExtendedCtor(checkableTerm2, CheckableTerm)) {
        Object.assign(this, { checkableTerm1, checkableTerm2 })
      } else throw new Error('?')
    }
  }

  class Star extends InferrableTerm {}

  class Pi extends InferrableTerm {
    constructor (checkableTerm1, checkableTerm2) {
      super()
      if (U.testExtendedCtor(checkableTerm1, CheckableTerm) && U.testExtendedCtor(checkableTerm2, CheckableTerm)) {
        Object.assign(this, { checkableTerm1, checkableTerm2 })
      } else throw new Error('?')
    }
  }

  class Bound extends InferrableTerm {
    constructor (int) {
      super();
      if (U.testInteger(int)) {
        Object.assign(this, { int })
      } else throw new Error('?')
    }
  }

  class Free extends InferrableTerm {
    constructor (name) {
      super();
      if (U.testExtendedCtor(name, Name)) {
        Object.assign(this, { name })
      } else throw new Error('?')
    }
  }

  class Apply extends InferrableTerm {
    constructor (inferrableTerm, checkableTerm) {
      super();
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm) && U.testExtendedCtor(checkableTerm, CheckableTerm)) {
        Object.assign(this, { inferrableTerm, checkableTerm })
      } else throw new Error('?')
    }
  }


  class CheckableTerm extends U.Eq {
    constructor () {
      super()
    }
  }

  class Inferred extends CheckableTerm {
    constructor (inferrableTerm) {
      super();
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm)) {
        Object.assign(this, { inferrableTerm })
      } else throw new Error('?')
    }
  }

  class Lambda extends CheckableTerm {
    constructor (checkableTerm) {
      super();
      if (U.testExtendedCtor(checkableTerm, CheckableTerm)) {
        Object.assign(this, { checkableTerm })
      } else throw new Error('?')
    }
  }


  class Name extends U.Eq {
    constructor () {
      super()
    }
  }

  class Global extends Name {
    constructor (string) {
      super();
      if (U.testCtor(string, String)) {
        Object.assign(this, { string })
      } else throw new Error('?')
    }
  }

  class Local extends Name {
    constructor (int) {
      super();
      if (U.testInteger(int)) {
        Object.assign(this, { int })
      } else throw new Error('?')
    }
  }

  class Quote extends Name {
    constructor (int) {
      super();
      if (U.testInteger(int)) {
        Object.assign(this, { int })
      } else throw new Error('?')
    }
  }


  class Value {}

  class VLambda extends Value {
    constructor (func) { // Not natural to validate for function ADT in javascript
      super();
      if (U.testCtor(func, Function)) {
        Object.assign(this, { func })
      } else throw new Error('?')
    }
  }

  class VStar extends Value {}

  class VPi extends Value {
    constructor (value, func) { //
      super();
      if (U.testExtendedCtor(value, Value) && U.testCtor(func, Function)) {
        Object.assign(this, { value, func })
      } else throw new Error('?')
    }
  }

  class VNeutral extends Value {
    constructor (neutral) {
      super();
      if (U.testExtendedCtor(neutral, Neutral)) {
        Object.assign(this, { neutral })
      } else throw new Error('?')
    }
  }


  class Neutral {}

  class NFree extends Neutral {
    constructor (name) {
      super();
      if (U.testExtendedCtor(name, Name)) {
        Object.assign(this, { name })
      } else throw new Error('?')
    }
  }

  class NApply extends Neutral {
    constructor (neutral, value) {
      super();
      if (U.testExtendedCtor(neutral, Neutral) && U.testExtendedCtor(value, Value)) {
        Object.assign(this, { neutral, value })
      } else throw new Error('?')
    }
  }

  function vfree (name) {
    if (U.testExtendedCtor(name, Name)) {
      let value = new VNeutral(new NFree(name));
      if (!U.testExtendedCtor(value, Value)) throw new Error('?')
      return value
    } else throw new Error('?')
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
        value = checkEvaluate(inferrableTerm.checkableTerm1, environment, nameEnvironment)
        break;

        case Star:
        value = new VStar()
        break;

        case Pi:
        value = new VPi(
          checkEvaluate(inferrableTerm.checkableTerm1, environment, nameEnvironment),
          x => checkEvaluate(inferrableTerm.checkableTerm2, environment.cons(x), nameEnvironment))
        break;

        case Bound:
        value = environment.getValue(environment.length - inferrableTerm.int - 1)
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

        default: throw new Error('?')
      }
      if (U.testExtendedCtor(value, Value)) return value;
      else throw new Error('?')
    } else throw new Error('?')
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

        default: throw new Error('?')
      }
      if (U.testExtendedCtor(value, Value)) return value;
      else throw new Error('?')
    } else throw new Error('?')
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

        default: throw new Error('?')
      }
      if (U.testExtendedCtor(value, Value)) return value;
      else throw new Error('?')
    } else throw new Error('?')
  }

  class Type {
    constructor (value) {
      if (U.testExtendedCtor(value, Value)) {
        Object.assign(this, { value })
      } else throw new Error('?')
    }
  }

  class NameTypePair extends U.ValidatedPair {
    constructor () {
      super(Name, Type)
    }
  }

  class Context extends U.ValidatedArray {
    constructor () {
      super(NameTypePair)
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
    else throw new Error('?')
  }


  function initialInferType (context, nameEnvironment, inferrableTerm) {
    return inferType(0, context, nameEnvironment, inferrableTerm)
  }

  function inferType (int, context, nameEnvironment, inferrableTerm) {
    if (U.testInteger(int) && U.testCtor(context, Context) && U.testCtor(nameEnvironment, NameEnvironment) && U.testExtendedCtor(inferrableTerm, InferrableTerm)) {
      let res, type;
      switch (inferrableTerm.constructor) {
        case Annotated:
        res = checkType(int, context, nameEnvironment, inferrableTerm.checkableTerm2, new VStar());
        if (U.testCtor(res, res.Left)) break;
        type = checkEvaluate(inferrableTerm.checkableTerm2, new Environment(), nameEnvironment);
        res = checkType(int, context, nameEnvironment, inferrableTerm.checkableTerm1, type);
        if (U.testCtor(res, res.Left)) break;
        res = (new Result(Type)).right(new Type(type));
        break;

        case Star:
        res = (new Result(Type)).right(new Type(new VStar()));
        break;

        case Pi:
        res = checkType(int, context, nameEnvironment, inferrableTerm.checkableTerm1, new VStar());
        if (U.testCtor(res, res.Left)) break;
        type = checkEvaluate(inferrableTerm.checkableTerm1, new Environment(), nameEnvironment);
        res = checkType(int + 1, context.cons(new NameTypePair().setValue(new Local(int), new Type(type))), nameEnvironment,
          checkSubstitution(0, new Free(new Local(int)), inferrableTerm.checkableTerm2), new VStar());
        if (U.testCtor(res, res.Left)) break;
        res = (new Result(Type)).right(new Type(new VStar()));
        break;

        case Free:
        let maybeType = context.lookup(inferrableTerm.name);
        switch (maybeType.constructor) {
          case maybeType.Just:
          res = (new Result(Type)).right(maybeType.value);
          break;

          case maybeType.Nothing:
          res = throwError('Unknown identifier');
          break;

          default: throw new Error('?')
        }
        break;

        case Apply:
        res = inferType(int, context, nameEnvironment, inferrableTerm.inferrableTerm);
        if (U.testCtor(res, res.Left)) break;
        switch (res.value.value.constructor) {
          case VPi:
          let {value, func} = res.value.value;
          res = checkType(int, context, nameEnvironment, inferrableTerm.checkableTerm, value);
          if (U.testCtor(res, res.Left)) break;
          let temp = func(checkEvaluate(inferrableTerm.checkableTerm, new Environment(), nameEnvironment));
          res = (new Result(Type)).right(new Type(temp));
          break;

          default:
          res = throwError('Illegal application')
        }
        break;

        default: throw new Error('?')
      }
      if (U.testExtendedCtor(res, Result)) return res;
      else throw new Error('?')
    } else throw new Error('?')
  }

  function checkType (int, context, nameEnvironment, checkableTerm, type) {
    if (U.testInteger(int) && U.testCtor(context, Context) && U.testCtor(nameEnvironment, NameEnvironment) && U.testExtendedCtor(checkableTerm, CheckableTerm) && U.testExtendedCtor(type, Value)) {
      let res;
      switch (checkableTerm.constructor) {
        case Inferred:
        res = inferType(int, context, nameEnvironment, checkableTerm.inferrableTerm);
        if (U.testCtor(res, res.Left)) break;
        if (!initialQuote(res.value.value).equal(initialQuote(type))) res = throwError('Type mismatch')
        break;

        case Lambda:
        if (U.testCtor(type, VPi)) {
          res = checkType(int + 1, context.cons(new NameTypePair().setValue(new Local(int), new Type(type.value))), nameEnvironment,
            checkSubstitution(0, new Free(new Local(int)), checkableTerm.checkableTerm), type.func(vfree(new Local(int))))
        } else res = throwError('Type mismatch');
        break;

        default: res = throwError('Type mismatch')
      }
      if (U.testExtendedCtor(res, Result)) return res;
      else throw new Error('?')
    } else throw new Error('?')
  }

  function inferSubstitution (int, inferrableTerm1, inferrableTerm2) {
    if (U.testInteger(int) && U.testExtendedCtor(inferrableTerm1, InferrableTerm) && U.testExtendedCtor(inferrableTerm2, InferrableTerm)) {
      let inferrableTerm;
      switch (inferrableTerm2.constructor) {
        case Annotated:
        inferrableTerm = new Annotated(
          checkSubstitution(int, inferrableTerm1, inferrableTerm2.checkableTerm1),
          checkSubstitution(int, inferrableTerm1, inferrableTerm2.checkableTerm2));
        break;

        case Star:
        inferrableTerm = inferrableTerm1
        break;

        case Pi:
        inferrableTerm = new Pi(
          checkSubstitution(int, inferrableTerm1, inferrableTerm2.checkableTerm1),
          checkSubstitution(int + 1, inferrableTerm1, inferrableTerm2.checkableTerm2))
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

        default: throw new Error('?')
      }
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm)) return inferrableTerm;
      else throw new Error('?')
    } else throw new Error('?')
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

        default: throw new Error('?')
      }
      if (U.testExtendedCtor(checkTerm, CheckableTerm)) return checkTerm;
      else throw new Error('?')
    } else throw new Error('?')
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

        case VStar:
        checkableTerm = new Inferred(new Star());
        break;

        case VPi:
        checkableTerm = new Inferred(new Pi(quote(int, value.value), quote(int + 1, value.func(vfree(new Quote(int))))));
        break;

        case VNeutral:
        checkableTerm = new Inferred(neutralQuote(int, value.neutral));
        break;

        default: throw new Error('?')
      }
      if (U.testExtendedCtor(checkableTerm, CheckableTerm)) return checkableTerm;
      else throw new Error('?')
    } else throw new Error('?')
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

        default: throw new Error('?')
      }
      if (U.testExtendedCtor(inferrableTerm, InferrableTerm)) return inferrableTerm;
      else throw new Error('?')
    } else throw new Error('?')
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
      else throw new Error('?')
    } else throw new Error('?')
  }

  return {
    InferrableTerm, Annotated, Star, Pi, Bound, Free, Apply,
    CheckableTerm, Inferred, Lambda,
    Name, Global, Local, Quote,

    Value, VLambda, VStar, VPi, VNeutral,

    Neutral, NFree, NApply,
    vfree,

    Environment,
    inferEvaluate, checkEvaluate,

    Type,
    NameTypePair, Context,
    NameValuePair, NameEnvironment,

    Result,
    throwError,

    initialInferType, inferType, checkType, inferSubstitution, checkSubstitution,
    initialQuote, quote, neutralQuote, boundfree
  }
})();


if (typeof module !== 'undefined') module.exports = AST
