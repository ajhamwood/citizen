importScripts("./machine.js");

function getTime () { let d = performance.now() - this.startTime;
  return String(d < 0 ? 1e7 + d : d).padStart(7, '0') }
const tell = new Proxy({}, { get ({}, prop) {
        if (logLevels[prop]) return function (event, ...args) {
          console[prop](`${getTime.call(this)} %c${this.addr} %c${event}`,
            "color: greenyellow; font-weight: 900", `color: ${logColours[prop]}; font-weight: 900`, ...args)
        };
        else return () => {}
      } }),
      logLevels = { error: true, warn: true, log: true, info: false, debug: false },
      logColours = { debug: "lightseagreen", info: "lightseagreen", log: "tomato", warn: "tomato", error: "tomato" };

const MIN_SUCC_LENGTH = 1,
      FINGER_LENGTH = 160,

      MAX_ID = 2n ** BigInt(FINGER_LENGTH);

const toSHA1 = async msg => new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(msg))),
      toBuf = bn => {
        let ar = [];
        do {
          ar.unshift(Number(bn % 256n));
          bn = (bn/256n)>>0n
        } while (bn > 0n);
        return new Uint8Array(ar)
      },
      fromBuf = buf => new Uint8Array(buf).reduce((acc, b) => 256n * acc + BigInt(b), 0n);

const fixFinger = (i => async function ffcl (reset) {
        if (i >= FINGER_LENGTH || reset) i = 0;
        try {
          const id = toBuf((fromBuf(this.id) + 2n ** BigInt(i)) % MAX_ID),
                { wait: { succ } } = await this.emitAsync("wait", "lookup", this.addr, { id });
          this.reverseFinger[FINGER_LENGTH - i - 1] = succ;
          tell.debug.call(this, "ff", FINGER_LENGTH - i - 1, succ);
          postMessage({ type: "info-finger", data: { finger: this.reverseFinger } });
          i++;
        } catch (e) { tell.debug.call(this, "fixfing err", e); this.reverseFinger[FINGER_LENGTH - i - 1] = undefined }
      })(0),
      fixSucc = async function () {
        let done = false, i = 0;
        do try {
          const succ0 = this.succ[i];
          let { wait: stateResp } = await this.emitAsync("wait", "state", succ0, { pred: true, succ: true }),  // Handle error from outage
              newSucc = stateResp.succ.slice(0, this.r - 1);
          newSucc.unshift(succ0);

          const candSucc0 = stateResp.pred,
                succ0ID = await toSHA1(succ0);
          if (typeof candSucc0 !== "undefined" && isBetween(this.id, await toSHA1(candSucc0), succ0ID)) try {
            let { wait: { succ } } = await this.emitAsync("wait", "state", candSucc0, { succ: true });
            newSucc = succ.slice(0, this.r - 1);
            newSucc.unshift(candSucc0)
          } catch {}
          // const down = this.succ.filter(v => !newSucc.includes(v) && v !== this.addr),
          //       up = newSucc.filter(v => !this.succ.includes(v) && v !== this.addr);
          this.succ = newSucc;
          done = true;
          tell.debug.call(this, "fs", newSucc);
          // if (down.length > 0) this.emit("succ::down", down);
          // if (up.length > 0) this.emit("succ::up", up)

        } catch (e) { tell.debug.call(this, `succ #${i} not found`, e);  i++ } while (!done && i < this.succ.length);

        if (!done) {
          // this.emit("down", this.succ);
          this.succ.fill(this.addr)
        }
        try { await this.emitAsync("send", "notify", this.succ[0]) } catch {}
      }

const maintenance = (timeout => ({
        start (reset) {
          if (typeof timeout !== "undefined") tell.debug.call(this, "maintenance stopping", timeout);
          clearInterval(timeout);
          timeout = setInterval(async () => {
            await fixFinger.call(this, reset);  // Swap ff and fs?
            reset = false;
            fixSucc.call(this)
          }, this.mtTime); tell.debug.call(this, "maintenance start", timeout) },
        stop () { tell.debug.call(this, "maintenance stop", timeout);
          timeout = clearInterval(timeout)
        }
      }))();

function cmp (a, b) {
  let i = 0;
  do if (a[i] > b[i]) return 1;
  else if (a[i] < b[i]) return -1;
  while (a.length >= ++i && b.length >= i);
  return 0
}
function isBetween (low, el, high) {  // True if low === high and both !== el
  if (cmp(low, high) === -1) return cmp(low, el) === -1 && cmp(el, high) === -1;
  return cmp(low, el) === -1 || cmp(el, high) === -1
}
function isStrictlyBetween (low, el, high) {  // Always false if low === high
  if (cmp(low, high) === -1) return cmp(low, el) === -1 && cmp(el, high) === -1;
  if (cmp(low, high) === 1) return cmp(low, el) === -1 || cmp(el, high) === -1;
  return false
}

var peer = new $.Machine ({
      startTime: null,

      // Chord properties
      mtTime: 500,

      addr: undefined,
      id: undefined,
      pred: undefined,
      r: MIN_SUCC_LENGTH,  //options: nSucc
      succ: new Array(MIN_SUCC_LENGTH).fill(undefined),
      reverseFinger: new Array(FINGER_LENGTH).fill(undefined),

      // Bucket properties
      hashtable: {}
    });

$.targets({
  message (e) {
    let { data, sender, type, target, uuid } = e.data;
    tell.info.call(peer, "MESSAGE", ...Object.entries(e.data).flatMap(([k, v], i) => (i ? [","] : []).concat([k + ":", v])))
    switch (type) {
      case "start": peer.emit("init", data.relStart); break;
      case "request":
      case "response": peer.emit("respond", data, sender, type); break;

      case "doListen": peer.emitAsync("listen", target)
        .then(() => postMessage({ type: "info-listen", data: { id: peer.id } })); break;
      case "doJoin": peer.emitAsync("join", target)
        .then(({ join: { succ: addr } }) => postMessage({ type: "info-join", data: { addr } })); break;

      case "doClose": peer.emitAsync("close").then(() => postMessage({ type: "info-close" })); break;

      case "doGet": peer.emitAsync("get", data.key)
        .then(({ get: { value, error } }) => postMessage({ type: "info-bucket", data: { action: "doGet", result: { value } }, uuid })); break;
      case "doHas": peer.emitAsync("has", data.key)
        .then(({ has: { result, error } }) => postMessage({ type: "info-bucket", data: { action: "doHas", result: { result } }, uuid })); break;
      case "doSet": peer.emitAsync("set", data.key, data.value)
        .then(({ set: { result, error } }) => postMessage({ type: "info-bucket", data: { action: "doSet", result }, uuid })); break;
      case "doDel": peer.emitAsync("del", data.key)
        .then(({ del: { result, error } }) => postMessage({ type: "info-bucket", data: { action: "doDel", result }, uuid })); break;
      case "doDump": peer.emitAsync("dump", data.addr)
        .then(({ dump: { entries, error } }) => postMessage({ type: "info-bucket", data: { action: "doDump", result: { entries } }, uuid }))
    }
  },
  peer: {

    // Chord

    init (relStart) {
      this.startTime = performance.now() - relStart;

      //Bucket
      this.on("join", target => {
        this.stop("join", "");
        this.emit("partition", target)
      });
    },

    async wait (action, target, data = {}) {
      tell.debug.call(this, "wait", ...arguments);
      let uuid = crypto.randomUUID();
      let result = await new Promise(ok => {
            this.on(`resp_${action}-${uuid}`, ok);
            this.emit("send", action, target, data, "request", uuid)
          });
      tell.debug.call(this, "returning from", action, result, uuid);
      this.stop(`resp_${action}-${uuid}`);
      return result
    },
    send (action, target, data = {}, dir = "request", uuid) {
      tell.debug.call(this, "send", ...arguments);
      if (target === this.addr) {
        tell.debug.call(this, "send self", dir, action, data, uuid);
        this.emit("respond", { action, data, uuid }, target, dir)
      } else self.postMessage({ type: dir, target, data: { action, data, uuid } });
    },
    respond (evdata, sender, dir) {
      let { action, data, uuid } = evdata,
          prefix = ({ request: "req", response: "resp" })[dir];
      tell.debug.call(this, "respond", dir, action, data, uuid, sender);
      this.emit(prefix + "_" + action + (prefix === "resp" ? "-" + uuid : ""), data, sender, uuid)
    },

    async listen (ix) {
      tell.debug.call(this, "listen", ix);
      this.addr = ix;
      this.succ.fill(this.addr);
      this.id = await toSHA1(ix);
      tell.log.call(this, "LISTENING");
      maintenance.start.call(this, true)
    },
    close () {
      maintenance.stop.call(this);
      this.id = undefined;
      this.reverseFinger.fill(undefined);
      this.succ.fill(undefined);
      this.pred = undefined;
      tell.log.call(this, "CLOSED");
      this.addr = undefined
    },

    ping (host) {
      const t0 = performance.now();
      return this.emitAsync("wait", "ping", host ?? this.addr, { sender: this.addr },
        () => ({ timing: performance.now() - t0 }))
    },

    async state (target = this.addr, withFingers = false) {
      let f = (withFingers ? { finger: this.reverseFinger } : {});
      return target === this.addr ? { pred: this.pred, addr: target, succ: this.succ, ...f } :
        await this.emitAsync("wait", "state", target, { pred: true, succ: true, ...f })
          .then(({ wait }) => ({ ...wait, addr: target }))
    },

    async join (target) {
      tell.debug.call(this, "join", this.state(), target);
      if (typeof this.addr === "undefined" || typeof this.succ[0] === "undefined") throw new Error();
      if (this.addr !== this.succ[0]) {console.warn("already joined?", structuredClone(this.state())); throw new Error("Already joined");}
      if (target === this.addr) throw new Error("Cannot join self");
      try {
        maintenance.stop.call(this);
        const { wait: { succ: newSucc0 } } = await this.emitAsync("wait", "lookup", target, { id: await toSHA1(this.addr) });
        if (typeof newSucc0 === "undefined") throw new Error();
        const { wait: { pred: newPred, succ } } = await this.emitAsync("wait", "state", newSucc0, { pred: true, succ: true });
        if (typeof newPred === "undefined") throw new Error();
        this.pred = newPred;
        // this.emit("pred::up", this.pred);
        let newSucc = succ.slice(0, this.r - 1);
        newSucc.unshift(newSucc0);
        this.succ = newSucc;
        // const up = newSucc.filter(v => !this.succ.includes(v) && v !== this.addr);
        // if (up.length > 0) this.emit("succ::up", up)

        this.on("notify", () => {
          this.stop("notify", "");
          tell.log.call(this, "JOIN SUCCESSFUL", target, this.succ)
          if (this.addr === this.succ[0]) {
            tell.log.call(this, "NOTIFYING ONCE");
            this.emit("join", this.succ[0])  // Test against partition, the reason this is supposed to be here
          }
        });
        return { succ: this.succ[0] }
      } catch (e) { tell.debug.call(this, "join err", e) }
      finally { maintenance.start.call(this) }
    },

    async lookup (id) {
      return (await this.emitAsync("wait", "lookup", this.addr, { id })).wait.succ
    },

    req_ping ({}, sender, uuid) {
      this.emit("send", "ping", sender, { sender: this.addr }, "response", uuid)
    },

    req_state (data, sender, uuid) {
      let rsp = {};
      if (data.pred) rsp.pred = this.pred;
      if (data.succ) rsp.succ = this.succ;
      if (data.finger) rsp.finger = this.finger;
      tell.debug.call(this, "req_state", rsp);
      this.emit("send", "state", sender, rsp, "response", uuid)
    },

    async req_lookup (data, sender, uuid) {
      let self = this;
      async function * getPred (id) {
        for (const pred of self.reverseFinger)
          if (typeof pred !== "undefined" && isBetween(self.id, await toSHA1(pred), id)) yield pred
      }
      const keyId = data.id,
            counter = (data.counter ?? 0) + 1,
            succ = this.succ[0],
            succId = await toSHA1(succ);
      tell.debug.call(this, "req_lookup", this.id, keyId, succId, succ, sender);
      if (isBetween(this.id, keyId, succId) || cmp(keyId, succId) === 0 || this.addr === succ) try {
        return this.emitAsync("wait", "ping", succ, { sender: this.addr })
          .then(() => this.emit("send", "lookup", sender, { succ, hops: counter }, "response", uuid));  // outage determination needed before arrving here
      } catch {}
      else for await (const hop of getPred(keyId)) try {
        return this.emitAsync("wait", "lookup", hop, { id: keyId, counter })
          .then(({ wait: rsp }) => this.emit("send", "lookup", sender, rsp, "response", uuid));
      } catch { continue }
    },

    async req_notify ({}, sender) {
      const oldPred = this.pred;
      tell.debug.call(this, "req_notify", this.pred, sender, this.addr);
      if (typeof this.pred === "undefined" ||
        isBetween(await toSHA1(this.pred), await toSHA1(sender), this.id)) this.pred = sender;
      else try {
        await this.emitAsync("wait", "ping", this.pred, { sender: this.addr })
      } catch (e) { tell.debug.call(this, "notify err", e); this.pred = sender }  // TODO: Connect failed, Timeout
      // if (this.pred !== oldPred) {
      //   if (typeof oldPred !== "undefined" && oldPred !== this.addr) this.emit("pred::down", oldPred);
      //   if (this.pred !== this.addr) this.emit("pred::up", this.pred)
      // }
      if (this.addr === oldPred && this.pred !== oldPred) postMessage({ type: "info-join", data: { addr: this.pred } })
      this.emit("notify", sender)
    },

    
    // Bucket

    async get (key) {
      const id = await toSHA1(key),
            { lookup: host } = await this.emitAsync("lookup", id),
            { wait: { error, value } } = await this.emitAsync("wait", "get", host, { id });
      if (error) {
        tell.log.call(this, "NODE GET error", key, error);
        return { error }
      }
      tell.log.call(this, "NODE GET", key, value);
      return { value }
    },

    async has (key) {
      const { get: { error } } = await this.emitAsync("get", key);
      if (error) {
        tell.log.call(this, "NODE HAS", key, false);
        return { result: false }
      }
      tell.log.call(this, "NODE HAS", key, true);
      return { result: true }
    },

    async set (key, value) {
      const id = await toSHA1(key),
            { lookup: host } = await this.emitAsync("lookup", id),
            { wait: { error } } = await this.emitAsync("wait", "set", host, { id, value });
      if (error) {
        tell.log.call(this, "NODE SET error", key, value, error);
        return { error }
      }
      tell.log.call(this, "NODE SET", key, value);
      return { result: {} }
    },

    async del (key) {
      const id = await toSHA1(key),
            { lookup: host } = await this.emitAsync("lookup", id),
            { wait: { error } } = await this.emitAsync("wait", "del", host, { id });
      if (error) {
        tell.log.call(this, "NODE DEL error", key, error);
        return { error }
      }
      tell.log.call(this, "NODE DEL", key);
      return { result: {} }
    },

    async dump (host = this.addr) {
      if (host === this.addr) return this.hashtable;
      const { wait: { entries } } = await this.emitAsync("wait", "partition", host, { id: await toSHA1(host), delete: false });
      tell.log.call(this, "NODE DUMP", entries);
      return { entries: entries.reduce((acc, entry) => Object.assign(acc, { [fromBuf(entry.id).toString(16)]: entry.value }), {}) }
    },

    async partition (host) {
      let { wait: { entries } } = await this.emitAsync("wait", "partition", host, { id: this.id, delete: true });
      entries = entries.reduce((acc, entry) => Object.assign(acc, { [fromBuf(entry.id).toString(16)]: entry.value }), this.hashtable);
      tell.warn.call(this, "PARTITION", { entries });
      return { entries }
    },

    async req_get (data, sender, uuid) {
      const keyId = data.id,
            { pred } = this,
            predId = await toSHA1(pred);
      if (!isBetween(predId, keyId, this.id) && cmp(keyId, this.id) !== 0)
        return this.emit("send", "get", sender, { error: "Invalid state for get request" }, "response", uuid);
      const idHex = fromBuf(keyId).toString(16);
      if (!(idHex in this.hashtable)) return this.emit("send", "get", sender, { error: "Invalid key for get request" }, "response", uuid);

      // this.emit("get", idHex);  // ?

      this.emit("send", "get", sender, { value: this.hashtable[idHex] }, "response", uuid)
    },

    async req_set (data, sender, uuid) {
      const keyId = data.id,
            { pred } = this,
            predId = await toSHA1(pred)
      if (!isBetween(predId, keyId, this.id) && cmp(keyId, this.id) !== 0) 
        return this.emit("send", "get", sender, { error: "Invalid state for set request" }, "response", uuid);
      const idHex = fromBuf(keyId).toString(16);
      this.hashtable[idHex] = data.value;
      postMessage({ type: "info-set", data: { idHex, value: data.value } })

      // this.emit("set", idHex)  // ?

      this.emit("send", "set", sender, {}, "response", uuid)
    },

    async req_del (data, sender, uuid) {
      const keyId = data.id,
            { pred } = this,
            predId = await toSHA1(pred);
      if (!isBetween(predId, keyId, this.id) && cmp(keyId, this.id) !== 0)
        return this.emit("send", "del", sender, { error: "Invalid state for delete request" }, "response", uuid);
      const idHex = fromBuf(keyId).toString(16);
      if (!(idHex in this.hashtable)) return this.emit("send", "del", sender, { error: "Invalid key for delete request" }, "response", uuid);
      delete this.hashtable[idHex];
      postMessage({ type: "info-del", data: { idHex } })

      // this.emit("del", idHex);  // ?

      this.emit("send", "del", sender, {}, "response", uuid)
    },

    req_partition (data, sender, uuid) {
      const bound = data.id,
            entries = [];
      Object.keys(this.hashtable).forEach(key => {
        const keyId = toBuf(BigInt(`0x${key}`));
        if (cmp(keyId, bound) === 0 || isStrictlyBetween(keyId, bound, this.id) || cmp(bound, this.id) === 0) {
          entries.push({ id: keyId, value: this.hashtable[key] });
          if (data.delete) delete this.hashtable[key]
        }
      });
      if (data.delete) postMessage({ type: "info-part", data: { entries, sender } });
      this.emit("send", "partition", sender, { entries }, "response", uuid)
    },
  }
}, self);