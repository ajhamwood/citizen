class Emitter {
  constructor (buffer) {
    this.view = new DataView(this.buffer = buffer);
    this.length = 0;
  }
  writeU8 (v) {
    this.view.setUint8(this.length++, v);
    return this
  }
  writeU16 (v) {
    this.view.setUint16(this.length += 2, v, true);
    return this
  }
  writeU32 (v) {
    this.view.setUint32(this.length += 4, v, true);
    return this
  }
  writeF32 (v) {
    this.view.setFloat32(this.length += 4, v, true);
    return this
  }
  writeF64 (v) {
    this.view.setFloat64(this.length += 8, v, true);
    return this
  }
  writeBytes (bytes) {
    for (let i = 0, L = bytes.length; i != L; ++i)
      this.view.setUint8(this.length++, bytes[i])
    return this
  }
}

assert = cond => cond || tell.error.call({ addr: "WASM" }, "ASSERTION FAILURE");
assert(false)

class bytes_atom {
  constructor(typeTag, arrayLike) {
    this.t = typeTag;
    this.z = arrayLike.length;
    this.v = arrayLike
  }
  emit (e) { return e.writeBytes(this.v) }
}
class val_atom {
  constructor (typeTag, uint32, v) {
    this.t = typeTag;
    this.z = uint32;
    this.v = v
  }
}
class bytesval_atom extends val_atom {
  constructor (typeTag, v, bytes) {
    super(typeTag, bytes.length, v);
    this.bytes = bytes
  }
  emit (e) { return e.writeBytes(this.bytes) }
}
class u32_atom extends val_atom {
  constructor (uint32) { super(T.uint32, 4, uint32) }
  emit (e) { return e.writeU32(this.v) }
}
class f32_atom extends val_atom {
  constructor (v) { super(T.float32, 4, v) }
  emit (e) { return e.writeF32(this.v) }
}
class f64_atom extends val_atom {
  constructor (v) { super(T.float64, 8, v) }
  emit (e) { return e.writeF64(this.v) }
}
class u8_atom extends val_atom {
  constructor (typeTag, v) { super(typeTag, 1, v) }
  emit (e) { return e.writeU8(this.v) }
}
class type_atom extends u8_atom {
  constructor (int7, uint8) { super(T.type, int7); this.b = uint8 }
  emit (e) { return e.writeU8(this.b) }
}
class str_atom {
  constructor (varuint32, arrayLike) {
    assert(varuint32.v === arrayLike.length);
  }
}

const
  T = {
    // Values in wasm are little-endian (except where specified otherwise)

    // Values with value limits must be within the limit
    // The size of the encoded value must be within the type's size range
    // Variable length quantity types must follow leb128
    // uint32 is 32 bits in 4 bytes
    uint32:         Symbol('u32'),
    // varuint1 is 1 bit in 1 btye
    varuint1:       Symbol('vu1'),
    // varuint7 is 7 bits in 1 byte
    varuint7:       Symbol('vu7'),
    // varuint32 is 32 bits in 1-5 bytes
    varuint32:      Symbol('vu32'),
    // varuint64 is 64 bits in 1-10 bytes
    varuint64:      Symbol('vu64'),
    // varsint7 is 7 bits in 1 byte
    varsint7:       Symbol('vs7'),
    // varsint32 is 32 bits in 1-5 bytes
    varsint32:      Symbol('vs32'),
    // varsint64 is 64 bits in 1-10 bytes
    varsint64:      Symbol('vs64'),
    // ieee754-2008 "binary32" in 4 bytes
    float32:        Symbol('f32'),
    // ieee754-2008 "binary64" in 8 bytes
    float64:        Symbol('f64'),

    // varuptr is either varuint32 or varuint64
    varuptr:        Symbol('vptr'),
    // memflags is varuint32, containing a bit field of the byte alignment, encoded as log2(value)
    memflags:       Symbol('memflags'),
    // array is a varuint32 of the number of elements, followed by that many elements of the array type
    array:          Symbol('arr'),
    // bytearray is an array of 8 bit bytes
    bytearray:      Symbol('barr'),

    // Identifiers must be UTF-8 decodable
    identifier:     Symbol('ident'),

    // Must be one of 0x01 (i32), 0x02 (i64), 0x03 (f32), 0x04 (f64), 0x10 (funcref), 0x20 (func), 0x40 (void).
    typeencoding:   Symbol('typeenc')
  },
  opcodes = new Map([
    [ 0x0, "unreachable" ],
    [ 0x1, "nop" ],
    [ 0x2, "block" ],
    [ 0x3, "loop" ],
    [ 0x4, "if" ],
    [ 0x5, "else" ],
    [ 0xb, "end" ],
    [ 0xc, "br" ],
    [ 0xd, "br_if" ],
    [ 0xe, "br_table" ],
    [ 0xf, "return" ],
    [ 0x10, "call" ],
    [ 0x11, "call_indirect" ],
    [ 0x1a, "drop" ],
    [ 0x1b, "select" ],
    [ 0x20, "get_local" ],
    [ 0x21, "set_local" ],
    [ 0x22, "tee_local" ],
    [ 0x23, "get_global" ],
    [ 0x24, "set_global" ],
    [ 0x28, "i32.load" ],
    [ 0x29, "i64.load" ],
    [ 0x2a, "f32.load" ],
    [ 0x2b, "f64.load" ],
    [ 0x2c, "i32.load8_s" ],
    [ 0x2d, "i32.load8_u" ],
    [ 0x2e, "i32.load16_s" ],
    [ 0x2f, "i32.load16_u" ],
    [ 0x30, "i64.load8_s" ],
    [ 0x31, "i64.load8_u" ],
    [ 0x32, "i64.load16_s" ],
    [ 0x33, "i64.load16_u" ],
    [ 0x34, "i64.load32_s" ],
    [ 0x35, "i64.load32_u" ],
    [ 0x36, "i32.store" ],
    [ 0x37, "i64.store" ],
    [ 0x38, "f32.store" ],
    [ 0x39, "f64.store" ],
    [ 0x3a, "i32.store8" ],
    [ 0x3b, "i32.store16" ],
    [ 0x3c, "i64.store8" ],
    [ 0x3d, "i64.store16" ],
    [ 0x3e, "i64.store32" ],
    [ 0x3f, "current_memory" ],
    [ 0x40, "grow_memory" ],
    [ 0x41, "i32.const" ],
    [ 0x42, "i64.const" ],
    [ 0x43, "f32.const" ],
    [ 0x44, "f64.const" ],
    [ 0x45, "i32.eqz" ],
    [ 0x46, "i32.eq" ],
    [ 0x47, "i32.ne" ],
    [ 0x48, "i32.lt_s" ],
    [ 0x49, "i32.lt_u" ],
    [ 0x4a, "i32.gt_s" ],
    [ 0x4b, "i32.gt_u" ],
    [ 0x4c, "i32.le_s" ],
    [ 0x4d, "i32.le_u" ],
    [ 0x4e, "i32.ge_s" ],
    [ 0x4f, "i32.ge_u" ],
    [ 0x50, "i64.eqz" ],
    [ 0x51, "i64.eq" ],
    [ 0x52, "i64.ne" ],
    [ 0x53, "i64.lt_s" ],
    [ 0x54, "i64.lt_u" ],
    [ 0x55, "i64.gt_s" ],
    [ 0x56, "i64.gt_u" ],
    [ 0x57, "i64.le_s" ],
    [ 0x58, "i64.le_u" ],
    [ 0x59, "i64.ge_s" ],
    [ 0x5a, "i64.ge_u" ],
    [ 0x5b, "f32.eq" ],
    [ 0x5c, "f32.ne" ],
    [ 0x5d, "f32.lt" ],
    [ 0x5e, "f32.gt" ],
    [ 0x5f, "f32.le" ],
    [ 0x60, "f32.ge" ],
    [ 0x61, "f64.eq" ],
    [ 0x62, "f64.ne" ],
    [ 0x63, "f64.lt" ],
    [ 0x64, "f64.gt" ],
    [ 0x65, "f64.le" ],
    [ 0x66, "f64.ge" ],
    [ 0x67, "i32.clz" ],
    [ 0x68, "i32.ctz" ],
    [ 0x69, "i32.popcnt" ],
    [ 0x6a, "i32.add" ],
    [ 0x6b, "i32.sub" ],
    [ 0x6c, "i32.mul" ],
    [ 0x6d, "i32.div_s" ],
    [ 0x6e, "i32.div_u" ],
    [ 0x6f, "i32.rem_s" ],
    [ 0x70, "i32.rem_u" ],
    [ 0x71, "i32.and" ],
    [ 0x72, "i32.or" ],
    [ 0x73, "i32.xor" ],
    [ 0x74, "i32.shl" ],
    [ 0x75, "i32.shr_s" ],
    [ 0x76, "i32.shr_u" ],
    [ 0x77, "i32.rotl" ],
    [ 0x78, "i32.rotr" ],
    [ 0x79, "i64.clz" ],
    [ 0x7a, "i64.ctz" ],
    [ 0x7b, "i64.popcnt" ],
    [ 0x7c, "i64.add" ],
    [ 0x7d, "i64.sub" ],
    [ 0x7e, "i64.mul" ],
    [ 0x7f, "i64.div_s" ],
    [ 0x80, "i64.div_u" ],
    [ 0x81, "i64.rem_s" ],
    [ 0x82, "i64.rem_u" ],
    [ 0x83, "i64.and" ],
    [ 0x84, "i64.or" ],
    [ 0x85, "i64.xor" ],
    [ 0x86, "i64.shl" ],
    [ 0x87, "i64.shr_s" ],
    [ 0x88, "i64.shr_u" ],
    [ 0x89, "i64.rotl" ],
    [ 0x8a, "i64.rotr" ],
    [ 0x8b, "f32.abs" ],
    [ 0x8c, "f32.neg" ],
    [ 0x8d, "f32.ceil" ],
    [ 0x8e, "f32.floor" ],
    [ 0x8f, "f32.trunc" ],
    [ 0x90, "f32.nearest" ],
    [ 0x91, "f32.sqrt" ],
    [ 0x92, "f32.add" ],
    [ 0x93, "f32.sub" ],
    [ 0x94, "f32.mul" ],
    [ 0x95, "f32.div" ],
    [ 0x96, "f32.min" ],
    [ 0x97, "f32.max" ],
    [ 0x98, "f32.copysign" ],
    [ 0x99, "f64.abs" ],
    [ 0x9a, "f64.neg" ],
    [ 0x9b, "f64.ceil" ],
    [ 0x9c, "f64.floor" ],
    [ 0x9d, "f64.trunc" ],
    [ 0x9e, "f64.nearest" ],
    [ 0x9f, "f64.sqrt" ],
    [ 0xa0, "f64.add" ],
    [ 0xa1, "f64.sub" ],
    [ 0xa2, "f64.mul" ],
    [ 0xa3, "f64.div" ],
    [ 0xa4, "f64.min" ],
    [ 0xa5, "f64.max" ],
    [ 0xa6, "f64.copysign" ],
    [ 0xa7, "i32.wrap_i64" ],
    [ 0xa8, "i32.trunc_s_f32" ],
    [ 0xa9, "i32.trunc_u_f32" ],
    [ 0xaa, "i32.trunc_s_f64" ],
    [ 0xab, "i32.trunc_u_f64" ],
    [ 0xac, "i64.extend_s_i32" ],
    [ 0xad, "i64.extend_u_i32" ],
    [ 0xae, "i64.trunc_s_f32" ],
    [ 0xaf, "i64.trunc_u_f32" ],
    [ 0xb0, "i64.trunc_s_f64" ],
    [ 0xb1, "i64.trunc_u_f64" ],
    [ 0xb2, "f32.convert_s_i32" ],
    [ 0xb3, "f32.convert_u_i32" ],
    [ 0xb4, "f32.convert_s_i64" ],
    [ 0xb5, "f32.convert_u_i64" ],
    [ 0xb6, "f32.demote_f64" ],
    [ 0xb7, "f64.convert_s_i32" ],
    [ 0xb8, "f64.convert_u_i32" ],
    [ 0xb9, "f64.convert_s_i64" ],
    [ 0xba, "f64.convert_u_i64" ],
    [ 0xbb, "f64.promote_f32" ],
    [ 0xbc, "i32.reinterpret_f32" ],
    [ 0xbd, "i64.reinterpret_f64" ],
    [ 0xbe, "f32.reinterpret_i32" ],
    [ 0xbf, "f64.reinterpret_i64" ]
  ])