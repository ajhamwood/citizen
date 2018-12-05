var U = (function () {
  function testCtor (obj, ctor) { return obj.constructor === ctor }
  function testExtendedCtor (obj, ctor) { return ctor.isPrototypeOf(obj.constructor) }
  function testInteger (n) { return Number(n) === n && n % 1 === 0 }

  class Eq {
    equal (value) {
      if (this.constructor === value.constructor) {
        for (let a in this) {
          if (this[a] !== value[a] && (typeof this[a] !== 'object' || 'equal' in this[a] && !this[a].equal(value[a]))) return false
        }
      } else return false
      return true
    }
  }

  class Unit {}

  class ValidatedArray {
    constructor (type) {
      if (type.constructor !== Function) throw new Error('Must construct using a Function');
      this.elemType = type;
      this.length = 0;
      return this
    }
    cons (value) {
      if (this.elemType.isPrototypeOf(value.constructor) || this.elemType === value.constructor) {
        let ret = new this.constructor().setValue(value);
        for (let i = 1; i <= this.length; i++) ret.setValue(this[i - 1]);
        return ret
      } else throw new Error('Bad type');
    }
    setValue (value, i = this.length) {
      if (Number(i) !== i && i % 1 !== 0 && i < 0 && i > length) throw new Error('Bad index');
      if (this.elemType.isPrototypeOf(value.constructor) || this.elemType === value.constructor) {
        this[i] = value;
        if (i === this.length) this.length++
      } else throw new Error('Bad type');
      return this
    }
    getValue (k) { return this[k] }
    concat (va) {
      if (this.elemType !== va.elemType) throw new Error('Type mismatch');
      for (let i = 0; i < va.length; i++) this[this.length + i] = va[i];
      this.length += va.length;
      return this
    }
    lookup (value) {
      if (ValidatedPair.isPrototypeOf(this.elemType)) {
        var dummy = new this.elemType();
        if (dummy.fstType.isPrototypeOf(value.constructor)) {
          for (let i = 0; i < this.length; i++) {
            if (this[i].first().equal(value)) {
              let result = this[i].second();
              return new U.ValidatedMaybe(dummy.sndType).just(result)
            }
          }
          return new U.ValidatedMaybe(dummy.sndType).nothing()
        } else throw new Error('Bad type')
      } else throw new Error('Must have element type ValidatedPair')
    }
  }

  class ValidatedPair {
    constructor (type1, type2) {
      if (type1.constructor !== Function && type2.constructor !== Function) throw new Error('Must construct using Functions');
      this.fstType = type1;
      this.sndType = type2;
      return this
    }
    setValue (first, second) {
      if ((this.fstType.isPrototypeOf(first.constructor) || first.constructor === this.fstType) &&
        (this.sndType.isPrototypeOf(second.constructor) || second.constructor === this.sndType)) this.pair = [first, second];
      else throw new Error('Bad type');
      return this
    }
    first () { return this.pair[0] }
    second () { return this.pair[1] }
  }

  class ValidatedEither {
    constructor (type1, type2) {
      if (type1.constructor !== Function && type2.constructor !== Function) throw new Error('Must construct using Functions');
      this.leftType = type1;
      this.rightType = type2;
      return this
    }
    left (value) {
      if (this.leftType.isPrototypeOf(value.constructor) || this.leftType === value.constructor) return new this.Left(value);
      else throw new Error('Bad type')
    }
    right (value) {
      if (this.rightType.isPrototypeOf(value.constructor) || this.rightType === value.constructor) return new this.Right(value);
      else throw new Error('Bad type')
    }
    get Left () {
      let { leftType, rightType } = this;
      return class Left extends this.constructor {
        constructor (value) {
          super(leftType, rightType);
          this.value = value;
          Object.defineProperty(this, 'Left', { get () { return this.constructor } })
        }
      }
    }
    get Right () {
      let { leftType, rightType } = this;
      return class Right extends this.constructor {
        constructor (value) {
          super(leftType, rightType);
          this.value = value;
          Object.defineProperty(this, 'Right', { get () { return this.constructor } })
        }
      }
    }
  }


  class ValidatedMaybe {
    constructor (type) {
      if (type.constructor !== Function) throw new Error('Must construct using a Function');
      this.type = type;
      return this
    }
    just (value) {
      let { type } = this;
      if (this.type.isPrototypeOf(value.constructor) || this.type === value.constructor) return new this.Just(value);
      else throw new Error('Bad type')
    }
    nothing () {
      let { type } = this;
      return new this.Nothing()
    }
    get Just () {
      let { type } = this;
      return class Just extends this.constructor {
        constructor (value) {
          super(type);
          this.value = value;
          Object.defineProperty(this, 'Just', { get () { return this.constructor } })
        }
      }
    }
    get Nothing () {
      let { type } = this;
      return class Nothing extends this.constructor {
        constructor () {
          super(type)
          Object.defineProperty(this, 'Nothing', { get () { return this.constructor } })
        }
      }
    }
  }

  return {
    testCtor, testExtendedCtor, testInteger,

    Eq, Unit,

    ValidatedArray,
    ValidatedPair,
    ValidatedEither,
    ValidatedMaybe
  }
})();

if (typeof module !== 'undefined') module.exports = U
