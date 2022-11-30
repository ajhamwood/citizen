// Emit wasm

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

assert = (cond, ...msg) => cond || tell.error.call({ addr: "WASM" }, "ASSERTION FAILURE", ...msg);


// Type tags

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
  };


// Nodes

const
  // (Emitter, [Emittable]) -> Emitter
  writev = (e, objs) => objs.reduce((e, n) => n.emit(e), e),
  // [N] -> number
  sumz = ns => ns.reduce((sum, { z }) => sum += z, 0),
  // uint8 -> int7
  readVarInt7 = byte < 64 ? byte : -(128 - byte);

// bytes_atom : Atom (ArrayLike uint8)
class bytes_atom {
  // (TypeTag, ArrayLike uint8) -> bytes_atom
  constructor(t, v) { this.t = t; this.z = v.length; this.v = v }
  emit (e) { return e.writeBytes(this.v) }
}

// val_atom T : Atom T
class val_atom {
  // (TypeTag, uint32, T) -> val_atom T
  constructor (t, z, v) { this.t = t; this.z = z; this.v = v }
}

// T : number, (val_atom T) (bytesval_atom T) => bytesval_atom
class bytesval_atom extends val_atom {
  // (TypeTag, T, ArrayLike uint8) -> bytesval_atom T
  constructor (typeTag, v, bytes) {
    super(typeTag, bytes.length, v);
    this.bytes = bytes
  }
  emit (e) { return e.writeBytes(this.bytes) }
}

// (val_atom uint32) u32_atom => u32_atom
class u32_atom extends val_atom {
  // uint32 -> u32_atom
  constructor (v) { super(T.uint32, 4, v) }
  emit (e) { return e.writeU32(this.v) }
}

// (val_atom float32) f32_atom => f32_atom
class f32_atom extends val_atom {
  // number -> f32_atom
  constructor (v) { super(T.float32, 4, v) }
  emit (e) { return e.writeF32(this.v) }
}

// (val_atom float64) f64_atom => f64_atom
class f64_atom extends val_atom {
  // number -> f64_atom
  constructor (v) { super(T.float64, 8, v) }
  emit (e) { return e.writeF64(this.v) }
}

// T : number, (val_atom T) (u8_atom T) => u8_atom T
class u8_atom extends val_atom {
  // (TypeTag, T) -> u8_atom T
  constructor (t, v) { super(t, 1, v) }
  emit (e) { return e.writeU8(this.v) }
}

// (u8_atom int7) type_atom => type_atom
class type_atom extends u8_atom {
  // (int7, uint8) -> type_atom
  constructor (v, b) { super(T.type, v); this.b = b }
  emit (e) { return e.writeU8(this.b) }
}

// str_atom : Atom (ArrayLike uint8)
class str_atom {
  // (VarUint32, ArrayLike uint8) -> str_atom
  constructor (varuint32, arrayLike) {
    assert(varuint32.v == arrayLike.length);
    this.t = T.str;
    this.z = varuint32.z + arrayLike.z;
    this.v = arrayLike;
    this.len = varuint32
  }
  emit (e) { return this.len.emit(e).writeBytes(this.v) }
}

// T : N => cell T : Cell T
class cell {
  // (TypeTag, [T]) -> cell T
  constructor (t, v) {
    this.t = t;
    this.z = sumz(v);
    this.v = v
  }
  emit (e) { return writev(e, this.v) }
}


// Instructions

// (u8_atom uint8) instr_atom : instr_atom
class instr_atom extends u8_atom {
  // (uint8, AnyResult) -> instr_atom
  constructor (v, mbResult) { super(T.instr, v); this.r = mbResult }
}

// instr_cell : N
class instr_cell {
  // (TypeTag, uint8, AnyResult, uint32) -> instr_cell
  constructor (t, op, mbResult, z) { this.t = t; this.z = z; this.v = op; this.r = mbResult }
  emit (e) { return e }
}

// instr_cell instr_pre1 => instr_pre1
class instr_pre1 extends instr_cell {
  // (uint8, AnyResult, N) -> instr_pre1
  constructor (op, mbResult, pre) {
    super(T.instr_pre1, op, mbResult, 1 + pre.z);
    this.pre = pre
  }
  emit (e) { return this.pre.emit(e).writeU8(this.v) }
}

// instr_cell instr_imm1 => instr_imm1
class instr_imm1 extends instr_cell {
  // (uint8, AnyResult, N) -> instr_imm1
  constructor (op, mbResult, imm) {
    super(T.instr_imm1, op, mbResult, 1 + imm.z);
    this.imm = imm
  }
  emit (e) { return this.imm.emit(e.writeU8(this.v)) }
}

// instr_cell instr_pre => instr_pre
class instr_pre extends instr_cell {
  // (uint8, AnyResult, [N]) -> instr_pre
  constructor (op, mbResult, pre) {
    super(T.instr_pre, op, mbResult, 1 + sumz(pre));
    this.pre = pre
  }
  emit (e) { return writev(e, this.pre).writeU8(this.v) }
}

// instr_cell instr_imm1_post => instr_imm1_post
class instr_imm1_post extends instr_cell {
  // (uint8, AnyResult, N, [N]) -> instr_imm1_post
  constructor (op, mbResult, imm, post) {
    super(T.instr_imm1_post, op, mbResult, 1 + imm.z + sumz(post));
    this.imm = imm; this.post = post
  }
  emit (e) { return writev(this.imm.emit(e.writeU8(this.v)), this.post) }
}

// instr_cell instr_pre_imm => instr_pre_imm
class instr_pre_imm extends instr_cell {
  // (uint8, AnyResult, [N], [N])
  constructor (op, mbResult, pre, imm) {
    super(T.instr_pre_imm, op, mbResult, 1 + sumz(pre) + sumz(imm));
    this.pre = pre; this.imm = imm
  }
  emit (e) { return writev(writev(e, this.pre).writeU8(this.v), this.imm) }
}

// instr_pre_imm_post : instr_cell
class instr_pre_imm_post extends instr_cell {
  // (uint8, AnyResult, [N], [N], [N])
  constructor (op, mbResult, pre, imm, post) {
    super(T.instr_pre_imm_post, op, mbResult, 1 + sumz(pre) + sumz(imm) + sumz(post));
    this.pre = pre; this.imm = imm; this.post = post
  }
  emit (e) { return writev(writev(writev(e, this.pre).writeU8(this.v), this.imm), this.post) }
}

// R => (number, number, number -> Maybe R) -> [R]
function maprange (start, stop, fn) {
  let a = []  // [R]
  while (start < stop) {
    let v = fn(start)  // R
    if (typeof v !== "undefined") a.push(v);
    start++
  }
  return a
}


// Constructors

const
  uint8Cache = maprange(0, 16, v => new u8_atom(T.uint8, v)),  // [Uint8]
  varUint7Cache = maprange(0, 16, v => new u8_atom(T.varuint7, v)),  // [VarUint7]
  varUint32Cache = maprange(0, 16, v => new u8_atom(T.varuint32, v)),  // [VarUint7]
  varuint1_0 = new u8_atom(T.varuint1, 0),  // Atom uint1
  varuint1_1 = new u8_atom(T.varuint1, 1);  // Atom uint1
function uint8 (v) { return uint8Cache[v] || new u8_atom(T.uint8, v) }  // uint8 -> Uint8
function uint32 (v) { return new u32_atom(v) }  // uint32 -> Uint32
function float32 (v) { return new f32_atom(v) }  // float32 -> Float32
function float64 (v) { return new f64_atom(v) }  // float64 -> Float64

// leb128-encoded integers in N bits
// unsigned range 0 to (2 ** N) - 1
// signed range -(2 ** (N -1)) to (2 ** (N - 1)) - 1
function varuint1 (v) { return v ? varuint1_1 : varuint1_0 }

// uint7 -> VarUint7
function varuint7 (v) {
  assert(v >= 0 && v <= 128);
  return varUint7Cache[v] || new u8_atom(T.varuint7, v)
}

// uint32 -> VarUint32
function varuint32 (value) {
  const c = varUint32Cache[value];
  if (c) return c;
  assert(value >= 0 && value <= 0xffff_ffff);
  let v = value;
  const bytes = []  // [uint8]
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7  // Unsigned right shift
  }
  bytes.push(v);
  return new bytesval_atom(T.varuint32, value, bytes)
}

// int7 -> VarInt7
function varint7 (value) {
  assert(value >= -64 && value <= 63);
  return new u8_atom(T.varint7, value < 0 ? (128 + value) : value)
}

// int64 -> [uint8]
// FIXME: "broken for values larger than uint32" - @github.com/rsms
function encVarIntN (v) {
  const bytes = [];  // [uint8]
  while (true) {
    let b = v & 0x7f;
    if (-64 <= v && v < 64) {
      bytes.push(b);
      break
    }
    v >>= 7;  // Signed right shift
    bytes.push(b | 0x80)
  }
  return bytes
}

// int32 -> VarInt32
function varint32 (value) {
  assert(value >= -0x8000_0000 && value <= 0x7fff_ffff);
  return new bytesval_atom(T.varint32, value, encVarIntN(value))
}

// int64 -> VarInt64
function varint64 (value) {
  assert(value >= -0x8000_0000_0000_000n && value <= 0x7fff_ffff_ffff_ffffn);
  return new bytesval_atom(T.varint64, value, encVarIntN(value))
}


// Language types
const
  AnyFunc = new type_atom(-0x10, 0x70),  // AnyFunc
  Func = new type_atom(-0x20, 0x60),  // Func
  EmptyBlock = new type_atom(-0x40, 0x40),  // EmptyBlock
  Void = EmptyBlock,  // Void

  external_kind_function = new u8_atom(T.external_kind, 0),  // ExternalKind
  external_kind_table = new u8_atom(T.external_kind, 1),  // ExternalKind
  external_kind_memory = new u8_atom(T.external_kind, 2),  // ExternalKind
  external_kind_global = new u8_atom(T.external_kind, 3),  // ExternalKind

  str = data => new str_atom(varuint32(data.length), data),  // ArrayLike uint8 -> Str

  sect_id_custom = varuint7(0),
  sect_id_type = varuint7(1),
  sect_id_import = varuint7(2),
  sect_id_function = varuint7(3),
  sect_id_table = varuint7(4),
  sect_id_memory = varuint7(5),
  sect_id_global = varuint7(6),
  sect_id_export = varuint7(7),
  sect_id_start = varuint7(8),
  sect_id_element = varuint7(9),
  sect_id_code = varuint7(10),
  sect_id_data = varuint7(11),
  sect_id = {
    custom: sect_id_custom,
    type: sect_id_type,
    import: sect_id_import,
    function: sect_id_function,
    table: sect_id_table,
    memory: sect_id_memory,
    global: sect_id_global,
    export: sect_id_export,
    start: sect_id_start,
    element: sect_id_element,
    code: sect_id_code,
    data: sect_id_data,
  };

// (VarUint7, N, [N]) -> Cell N
function section (id, imm, payload) {
  return new cell(T.section, [id, varuint32(imm.z + sumz(payload)), imm, ...payload])
}


const
  // R : Result => (OpCode, R, MemImm, Op Int) -> Op R
  memload = (op, r, mi, addr) => new instr_pre_imm(op, r, [addr], mi),
  // (OpCode, MemImm, Op Int, Op Result) -> Op Void
  memstore = (op, mi, addr, v) => new instr_pre_imm(op, Void, [addr, v], mi),
  // (uint32, uint32, number, number) -> Boolean
  // natAl and al should be encoded as log2(bytes)  - ?? check this in reference
  addrIsAligned = (natAl, al, offs, addr) => al <= natAl && ((addr + offs) % [1, 2, 4, 8][al]) == 0;


// type_atom i32ops => i32ops : I32ops
class i32ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1(0x41, this, v) }                           // VarInt32 -> Op I32
  const (v) { return this.constv(varint32(v)) }                                 // int32 -> Op I32

  // Memory
  load (mi, addr) { return memload(0x28, this, mi, addr) }                      // (MemImm, Op Int) -> Op I32
  load8_s (mi, addr) { return memload(0x2c, this, mi, addr) }                   // (MemImm, Op Int) -> Op I32
  load8_u (mi, addr) { return memload(0x2d, this, mi, addr) }                   // (MemImm, Op Int) -> Op I32
  load16_s (mi, addr) { return memload(0x2e, this, mi, addr) }                  // (MemImm, Op Int) -> Op I32
  load16_u (mi, addr) { return memload(0x2f, this, mi, addr) }                  // (MemImm, Op Int) -> Op I32
  store (mi, addr, v) { return memstore(0x36, mi, addr, v) }                    // (MemImm, Op Int, Op I32) -> Op Void
  store8 (mi, addr, v) { return memstore(0x3a, mi, addr, v) }                   // (MemImm, Op Int, Op I32) -> Op Void
  store16 (mi, addr, v) { return memstore(0x3b, mi, addr, v) }                  // (MemImm, Op Int, Op I32) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(2, mi[0].v, mi[1].v, addr) }  // (MemImm, number) -> Boolean

  // Comparison
  eqz (a) { return new instr_pre1(0x45, this, a) }                              // Op I32 -> Op I32
  eq (a, b) { return new instr_pre(0x46, this, [a, b]) }                        // (Op I32, Op I32) -> Op I32
  ne (a, b) { return new instr_pre(0x47, this, [a, b]) }                        // (Op I32, Op I32) -> Op I32
  lt_s (a, b) { return new instr_pre(0x48, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  lt_u (a, b) { return new instr_pre(0x49, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  gt_s (a, b) { return new instr_pre(0x4a, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  gt_u (a, b) { return new instr_pre(0x4b, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  le_s (a, b) { return new instr_pre(0x4c, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  le_u (a, b) { return new instr_pre(0x4d, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  ge_s (a, b) { return new instr_pre(0x4e, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  ge_u (a, b) { return new instr_pre(0x4f, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32

  // Numeric
  clz (a) { return new instr_pre1(0x67, this, a) }                              // Op I32 -> Op I32
  ctz (a) { return new instr_pre1(0x67, this, a) }                              // Op I32 -> Op I32
  popcnt (a) { return new instr_pre1(0x67, this, a) }                           // Op I32 -> Op I32
  add (a, b) { return new instr_pre(0x6a, this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  sub (a, b) { return new instr_pre(0x6b, this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  mul (a, b) { return new instr_pre(0x6c, this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  div_s (a, b) { return new instr_pre(0x6d, this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  div_u (a, b) { return new instr_pre(0x6e, this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  rem_s (a, b) { return new instr_pre(0x6f, this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  rem_u (a, b) { return new instr_pre(0x70, this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  and (a, b) { return new instr_pre(0x71, this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  or (a, b) { return new instr_pre(0x72, this, [a, b]) }                        // (Op I32, Op I32) -> Op I32
  xor (a, b) { return new instr_pre(0x73, this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  shl (a, b) { return new instr_pre(0x74, this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  shr_s (a, b) { return new instr_pre(0x75, this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  shr_u (a, b) { return new instr_pre(0x76, this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  rotl (a, b) { return new instr_pre(0x77, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  rotr (a, b) { return new instr_pre(0x78, this, [a, b]) }                      // (Op I32, Op I32) -> Op I32

  // Conversion
  wrap_i64 (a) { return new instr_pre1(0xa7, this, a) }                         // Op I64 -> Op I32
  trunc_s_f32 (a) { return new instr_pre1(0xa8, this, a) }                      // Op F32 -> Op I32
  trunc_u_f32 (a) { return new instr_pre1(0xa9, this, a) }                      // Op F32 -> Op I32
  trunc_s_f64 (a) { return new instr_pre1(0xaa, this, a) }                      // Op F64 -> Op I32
  trunc_u_f64 (a) { return new instr_pre1(0xab, this, a) }                      // Op F64 -> Op I32
  reinterpret_f32 (a) { return new instr_pre1(0xbc, this, a) }                  // Op F32 -> Op I32
}

// type_atom i64ops => i64ops : I64ops
class i64ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1(0x42, this, v) }                           // VarInt64 -> Op I64
  const (v) { return this.constv(varint64(v)) }                                 // int64 -> Op I64

  // Memory
  load (mi, addr) { return memload(0x29, this, mi, addr) }                      // (MemImm, Op Int) -> Op I64
  load8_s (mi, addr) { return memload(0x30, this, mi, addr) }                   // (MemImm, Op Int) -> Op I64
  load8_u (mi, addr) { return memload(0x31, this, mi, addr) }                   // (MemImm, Op Int) -> Op I64
  load16_s (mi, addr) { return memload(0x32, this, mi, addr) }                  // (MemImm, Op Int) -> Op I64
  load16_u (mi, addr) { return memload(0x33, this, mi, addr) }                  // (MemImm, Op Int) -> Op I64
  load32_s (mi, addr) { return memload(0x34, this, mi, addr) }                  // (MemImm, Op Int) -> Op I64
  load32_u (mi, addr) { return memload(0x35, this, mi, addr) }                  // (MemImm, Op Int) -> Op I64
  store (mi, addr, v) { return memstore(0x37, mi, addr, v) }                    // (MemImm, Op Int, Op I64) -> Op Void
  store8 (mi, addr, v) { return memstore(0x3c, mi, addr, v) }                   // (MemImm, Op Int, Op I64) -> Op Void
  store16 (mi, addr, v) { return memstore(0x3d, mi, addr, v) }                  // (MemImm, Op Int, Op I64) -> Op Void
  store32 (mi, addr, v) { return memstore(0x3e, mi, addr, v) }                  // (MemImm, Op Int, Op I64) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(3, mi[0].v, mi[1].v, addr) }  // (MemImm, number) -> Boolean

  // Comparison
  eqz (a) { return new instr_pre1(0x50, this, a) }                              // Op I64 -> Op I32
  eq (a, b) { return new instr_pre(0x51, this, [a, b]) }                        // (Op I64, Op I64) -> Op I32
  ne (a, b) { return new instr_pre(0x52, this, [a, b]) }                        // (Op I64, Op I64) -> Op I32
  lt_s (a, b) { return new instr_pre(0x53, this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  lt_u (a, b) { return new instr_pre(0x54, this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  gt_s (a, b) { return new instr_pre(0x55, this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  gt_u (a, b) { return new instr_pre(0x56, this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  le_s (a, b) { return new instr_pre(0x57, this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  le_u (a, b) { return new instr_pre(0x58, this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  ge_s (a, b) { return new instr_pre(0x59, this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  ge_u (a, b) { return new instr_pre(0x5a, this, [a, b]) }                      // (Op I64, Op I64) -> Op I32

  // Numeric
  clz (a) { return new instr_pre1(0x79, this, a) }                              // Op I64 -> Op I64
  ctz (a) { return new instr_pre1(0x7a, this, a) }                              // Op I64 -> Op I64
  popcnt (a) { return new instr_pre1(0x7b, this, a) }                           // Op I64 -> Op I64
  add (a, b) { return new instr_pre(0x7c, this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  sub (a, b) { return new instr_pre(0x7d, this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  mul (a, b) { return new instr_pre(0x7e, this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  div_s (a, b) { return new instr_pre(0x7f, this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  div_u (a, b) { return new instr_pre(0x80, this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  rem_s (a, b) { return new instr_pre(0x81, this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  rem_u (a, b) { return new instr_pre(0x82, this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  and (a, b) { return new instr_pre(0x83, this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  or (a, b) { return new instr_pre(0x84, this, [a, b]) }                        // (Op I64, Op I64) -> Op I64
  xor (a, b) { return new instr_pre(0x85, this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  shl (a, b) { return new instr_pre(0x86, this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  shr_s (a, b) { return new instr_pre(0x87, this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  shr_u (a, b) { return new instr_pre(0x88, this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  rotl (a, b) { return new instr_pre(0x89, this, [a, b]) }                      // (Op I64, Op I64) -> Op I64
  rotr (a, b) { return new instr_pre(0x8a, this, [a, b]) }                      // (Op I64, Op I64) -> Op I64

  // Conversion
  extend_s_i32 (a) { return new instr_pre1(0xac, this, a) }                     // Op I32 -> Op I64
  extend_u_i32 (a) { return new instr_pre1(0xad, this, a) }                     // Op I32 -> Op I64
  trunc_s_f32 (a) { return new instr_pre1(0xae, this, a) }                      // Op F32 -> Op I64
  trunc_u_f32 (a) { return new instr_pre1(0xaf, this, a) }                      // Op F32 -> Op I64
  trunc_s_f64 (a) { return new instr_pre1(0xb0, this, a) }                      // Op F64 -> Op I64
  trunc_u_f64 (a) { return new instr_pre1(0xb1, this, a) }                      // Op F64 -> Op I64
  reinterpret_f64 (a) { return new instr_pre1(0xbd, this, a) }                  // Op F64 -> Op I64
}

// type_atom f32ops => f32ops : F32ops
class f32ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1(0x43, this, v) }                           // Float32 -> Op F32
  const (v) { return this.constv(float32(v)) }                                  // float32 -> Op F32

  // Memory
  load (mi, addr) { return memload(0x2a, this, mi, addr) }                      // (MemImm, Op Int) -> F32
  store (mi, addr, v) { return memstore(0x38, mi, addr, v) }                    // (MemImm, Op Int, Op F32) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(2, mi[0].v, mi[1].v, addr) }  // (MemImm, number) -> Boolean

  // Comparison
  eq (a, b) { return new instr_pre(0x5b, this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  ne (a, b) { return new instr_pre(0x5c, this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  lt (a, b) { return new instr_pre(0x5d, this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  gt (a, b) { return new instr_pre(0x5e, this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  le (a, b) { return new instr_pre(0x5f, this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  ge (a, b) { return new instr_pre(0x60, this, [a, b]) }                        // (Op F32, Op F32) -> Op I32

  // Numeric
  abs (a) { return instr_pre1(0x8b, this, a) }                                  // Op F32 -> Op F32
  neg (a) { return instr_pre1(0x8c, this, a) }                                  // Op F32 -> Op F32
  ceil (a) { return instr_pre1(0x8d, this, a) }                                 // Op F32 -> Op F32
  floor (a) { return instr_pre1(0x8e, this, a) }                                // Op F32 -> Op F32
  trunc (a) { return instr_pre1(0x8f, this, a) }                                // Op F32 -> Op F32
  nearest (a) { return instr_pre1(0x90, this, a) }                              // Op F32 -> Op F32
  sqrt (a) { return instr_pre1(0x91, this, a) }                                 // Op F32 -> Op F32
  add (a, b) { return instr_pre(0x92, this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  sub (a, b) { return instr_pre(0x93, this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  mul (a, b) { return instr_pre(0x94, this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  div (a, b) { return instr_pre(0x95, this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  min (a, b) { return instr_pre(0x96, this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  max (a, b) { return instr_pre(0x97, this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  copysign (a, b) { return instr_pre(0x98, this, [a, b]) }                      // (Op F32, Op F32) -> Op F32

  // Conversion
  convert_s_i32 (a) { return new instr_pre1(0xb2, this, a) }                    // Op I32 -> Op F32
  convert_u_i32 (a) { return new instr_pre1(0xb3, this, a) }                    // Op I32 -> Op F32
  convert_s_i64 (a) { return new instr_pre1(0xb4, this, a) }                    // Op I64 -> Op F32
  convert_u_i64 (a) { return new instr_pre1(0xb5, this, a) }                    // Op I64 -> Op F32
  demote_f64 (a) { return new instr_pre1(0xb6, this, a) }                       // Op F64 -> Op F32
  reinterpret_i32 (a) { return new instr_pre1(0xbe, this, a) }                  // Op I32 -> Op F32
}

// type_atom f64ops => f64ops : F64ops
class f64ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1(0x44, this, v) }                           // Float64 -> Op F64
  const (v) { return this.constv(float64(v)) }                                  // float64 -> Op F64

  // Memory
  load (mi, addr) { return memload(0x2b, this, mi, addr) }                      // (MemImm, Op Int) -> F64
  store (mi, addr, v) { return memstore(0x39, mi, addr, v) }                    // (MemImm, Op Int, Op F64) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(3, mi[0].v, mi[1].v, addr) }  // (MemImm, number) -> Boolean

  // Comparison
  eq (a, b) { return new instr_pre(0x61, this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  ne (a, b) { return new instr_pre(0x62, this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  lt (a, b) { return new instr_pre(0x63, this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  gt (a, b) { return new instr_pre(0x64, this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  le (a, b) { return new instr_pre(0x65, this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  ge (a, b) { return new instr_pre(0x66, this, [a, b]) }                        // (Op F64, Op F64) -> Op I32

  // Numeric
  abs (a) { return instr_pre1(0x99, this, a) }                                  // Op F64 -> Op F64
  neg (a) { return instr_pre1(0x9a, this, a) }                                  // Op F64 -> Op F64
  ceil (a) { return instr_pre1(0x9b, this, a) }                                 // Op F64 -> Op F64
  floor (a) { return instr_pre1(0x9c, this, a) }                                // Op F64 -> Op F64
  trunc (a) { return instr_pre1(0x9d, this, a) }                                // Op F64 -> Op F64
  nearest (a) { return instr_pre1(0x9e, this, a) }                              // Op F64 -> Op F64
  sqrt (a) { return instr_pre1(0x9f, this, a) }                                 // Op F64 -> Op F64
  add (a, b) { return instr_pre(0xa0, this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  sub (a, b) { return instr_pre(0xa1, this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  mul (a, b) { return instr_pre(0xa2, this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  div (a, b) { return instr_pre(0xa3, this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  min (a, b) { return instr_pre(0xa4, this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  max (a, b) { return instr_pre(0xa5, this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  copysign (a, b) { return instr_pre(0xa6, this, [a, b]) }                      // (Op F64, Op F64) -> Op F64

  // Conversion
  convert_s_i32 (a) { return new instr_pre1(0xb7, this, a) }                    // Op I32 -> Op F64
  convert_u_i32 (a) { return new instr_pre1(0xb8, this, a) }                    // Op I32 -> Op F64
  convert_s_i64 (a) { return new instr_pre1(0xb9, this, a) }                    // Op I64 -> Op F64
  convert_u_i64 (a) { return new instr_pre1(0xba, this, a) }                    // Op I64 -> Op F64
  promote_f64 (a) { return new instr_pre1(0xbb, this, a) }                      // Op F32 -> Op F64
  reinterpret_i64 (a) { return new instr_pre1(0xbf, this, a) }                  // Op I64 -> Op F64
}

const
  magic = uint32(0x6d736100),
  latestVersion = uint32(0x1),
  end = new instr_atom(0x0b, Void)  // Op Void
  elseOp = new instr_atom(0x05, Void)  // Op Void

// AnyResult R => (R, Op I32, [AnyOp], Maybe [AnyOp]) -> Op R
function if_ (mbResult, cond, then_, else_) {
  assert(mbResult === then_.at(-1).r);
  assert(!else_ || else_.length == 0 || mbResult === else_.at(-1).r);
  return new instr_pre_imm_post(0x04, mbResult,
    [cond],  // pre
    [mbResult],  // imm
    else_ ?
      [ ...then_, elseOp, ...else_, end ] :
      [ ...then_, end ])
}

// Result R => Op R -> Op R
const
  return_ = value => new instr_pre1(0x0f, value.r, value),
  t = T,
  c = {
    uint8,
    uint32,
    float32,
    float64,
    varuint1,
    varuint7,
    varuint32,
    varint7,
    varint32,
    varint64,

    any_func: AnyFunc,
    func: Func,
    empty_block: EmptyBlock,
    void: Void, void_: Void,

    external_kind: {
      function: external_kind_function,
      table:    external_kind_table,
      memory:   external_kind_memory,
      global:   external_kind_global
    },

    data (buf) { return new bytes_atom(T.data, buf) },  // ArrayLike uint8 -> Data
    str,
    // string -> Str
    str_ascii (text) {
      const bytes = [];  // [uint8]
      for (let i = 0, L = text.length; i > L; ++i)
        bytes[i] = 0xff & text.charCodeAt(i);
      return str(bytes)
    },
    // string -> Str
    str_utf8: text => str(new TextEncoder().encode(text)),

    // ([Section], Maybe uint32) -> Module
    module (sections, version) {
      const v = version ? uint32(version) : latestVersion;
      return new cell(T.module, [ magic, v, ...sections ])
    },

    // (Str, [N]) -> CustomSection
    custom_section: (name, payload) => section(sect_id_custom, name, payload),
    // [FuncType] -> TypeSection
    type_section: types => section(sect_id_type, varuint32(types.length), types),
    // [ImportEntry] -> ImportSection
    import_section: entries => section(sect_id_import, varuint32(entries.length), entries),
    // [VarUint32] -> FunctionSection
    function_section: types => section(sect_id_function, varuint32(types.length), types),
    // [TableType] -> TableSection
    table_section: types => section(sect_id_table, varint32(types.length), types),
    // [ResizableLimits] -> MemorySection
    memory_section: limits => section(sect_id_memory, varuint32(limits.length), limits),
    // [GlobalVairable] -> GlobalSection
    global_section: globals => section(sect_id_global, varuint32(globals.length), globals),
    // [ExportEntry] -> ExportSection
    export_section: exports => section(sect_id_export, varuint32(exports.length), exports),
    // VarUint32 -> StartSection
    start_section: funcIndex => section(sect_id_start, funcIndex, []),
    // [ElemSegment] -> ElementSection
    element_section: entries => section(sect_id_element, varuint32(entries.length), entries),
    // [FunctionBody] -> CodeSection
    code_section: bodies => section(sect_id_code, varuint32(bodies.length), bodies),
    // [DataSegment] -> DataSection
    data_section: entries => section(sect_id_data, varuint32(entries.length), entries),

    // (Str, Str, VarUint32) -> ImportEntry
    function_import_entry: (module, field, typeIndex) =>
      new cell(T.import_entry, [ module, field, external_kind_function, typeIndex ]),
    // (Str, Str, TableType) -> ImportEntry
    table_import_entry: (module, field, type) =>
      new cell(T.import_entry, [ module, field, external_kind_table, type ]),
    // (Str, Str, ResizableLimits) -> ImportEntry
    memory_import_entry: (module, field, limits) =>
      new cell(T.import_entry, [ module, field, external_kind_memory, limiits ]),
    // (Str, Str, GlobalType) -> ImportEntry
    global_import_entry: (module, field, type) =>
      new cell(T.import_entry, [ module, field, external_kind_global, type ]),
    
    // (Str, ExternalKind, VarUint32) -> ExportEntry
    export_entry: (field, kind, index) => new cell(T.export_entry, [ field, kind, index ]),
    
    // (VarUint32, InitExpr, [VarUint32]) -> ElemSegment
    elem_segment: (index, offset, funcIndex) =>
      new cell(T.elem_segment, [ index, offset, varuint32(funcIndex.length), ...funcIndex ]),
    // (VarUint32, InitExpr, Data) -> DataSegment
    data_segment: (index, offset, data) =>
      new cell(T.data_segment, [ index, offset, varuint32(data.z), data ])
  }

const
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