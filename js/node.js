importScripts("./machine.js")

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

const fixFinger = (i => async function ffcl () {
        if (i >= FINGER_LENGTH) i = 0;
        try {
          tell.log.call(this, "ff", this.addr, this.id);
          const id = toBuf((fromBuf(this.id) + 2n ** BigInt(i)) % MAX_ID),
                { wait: { succ } } = await this.emitAsync("wait", "lookup", this.addr, { id, sender: this.addr });
          this.reverseFinger[FINGER_LENGTH - i - 1] = succ;
          i++;
        } catch (e) { tell.debug.call(this, "fixfing err", e); this.reverseFinger[FINGER_LENGTH - i - 1] = undefined }
      })(0),
      fixSucc = async function () {
        let done = false, i = 0;
        do try {
          const succ0 = this.succ[i];
          let { wait: stateResp } = await this.emitAsync("wait", "state", succ0, { pred: true, succ: true }),
              newSucc = stateResp.succ.slice(0, this.r - 1);
          newSucc.unshift(succ0);

          const candSucc0 = stateResp.pred,
                succ0ID = await toSHA1(succ0);
          console.info("here", this.addr, this.id, candSucc0, succ0ID, await toSHA1(candSucc0))
          if (typeof candSucc0 !== "undefined" && isBetween(this.id, await toSHA1(candSucc0), succ0ID)) try {
            let { wait: { succ } } = await this.emitAsync("wait", "state", candSucc0, { succ: true });
            newSucc = succ.slice(0, this.r - 1);
            newSucc.unshift(candSucc0)
          } catch ({}) {}
          // const down = this.succ.filter(v => !newSucc.includes(v) && v !== this.addr),
          //       up = newSucc.filter(v => !this.succ.includes(v) && v !== this.addr);
          this.succ = newSucc;
          done = true;
          // if (down.length > 0) this.emit("succ::down", down);
          // if (up.length > 0) this.emit("succ::up", up)

        } catch (e) { tell.debug.call(this, "fixsucc err", e);  i++ } while (!done && i < this.succ.length);

        if (!done) {
          // this.emit("down", this.succ);
          this.succ.fill(this.addr)
        }
        try { await this.emitAsync("send", "notify", this.succ[0], { sender: this.addr }) } catch ({}) {}
      }

const maintenance = (timeout => ({
        start () {
          if (typeof timeout !== "undefined") tell.debug.call(this, "maintenance stopping", timeout);
          clearInterval(timeout);
          timeout = setInterval(async () => {
            await fixFinger.call(this);
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
function isBetween (low, el, high) {
  if (cmp(low, high) === -1) return cmp(low, el) === -1 && cmp(el, high) === -1;
  return cmp(low, el) === -1 || cmp(el, high) === -1
}

var peer = new $.Machine ({
      startTime: null,

      mtTime: 2000,

      addr: undefined,
      id: undefined,
      pred: undefined,
      r: MIN_SUCC_LENGTH,  //options: nSucc
      succ: new Array(MIN_SUCC_LENGTH).fill(undefined),
      reverseFinger: new Array(FINGER_LENGTH).fill(undefined)
    });

function getTime () { let d = performance.now() - this.startTime;
  return String(d < 0 ? 1e7 + d : d).padStart(7, '0') }
const tell = new Proxy({}, { get ({}, prop) {
  if (["debug", "info", "log", "warn", "error"].includes(prop)) return function (event, ...args) {
    console[prop](`${getTime.call(this)} %c${this.addr} %c${event}`,
      "color: greenyellow; font-weight: 900", "color: tomato; font-weight: 900", ...args)
  }
} })

$.targets({
  message (e) {
    let { data, sender, type, target } = e.data;
    tell.info.call(peer, "MESSAGE", e.data)
    switch (e.data.type) {
      case "request":
      case "response": peer.emit("respond", data, sender, type); break;

      case "doListen": peer.emitAsync("listen", target)
        .then(() => postMessage({ type: "info-listen", target: peer.addr, data: { id: peer.id } })); break;
      case "doJoin": peer.emit("join", target); break;

      case "close": peer.emit("close")
    }
  },
  peer: {
    init (addr, startTime) {
      this.addr = addr;
      this.startTime = startTime
    },

    async wait (action, target, data) {
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
    send (action, target, data, dir = "request", uuid) {
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
      tell.log.call(this, "listen done", this.addr, this.succ, this.id);
      maintenance.start.call(this)
    },
    close () {
      maintenance.stop.call(this);
      this.id = undefined;
      this.reverseFinger.fill(undefined);
      this.succ.fill(undefined);
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
      if (this.addr !== this.succ[0]) {console.log(this); throw new Error("Already joined");}
      if (target === this.addr) throw new Error("Cannot join self");
      try {
        maintenance.stop.call(this);
        const { wait: { succ: newSucc0 } } = await this.emitAsync("wait", "lookup", target, { id: await toSHA1(this.addr), sender: this.addr });
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
          this.stop("notify");
          tell.warn.call(this, "JOIN SUCCESSFUL")
          if (target !== this.succ[0]) {
            tell.warn.call(this, "NOTIFYING ONCE");
            this.emit("join", this.succ[0])
          }
        });
        return { succ: this.succ[0] }
      } catch (e) { tell.debug.call(this, "join err", e) }
      finally { maintenance.start.call(this) }
    },

    lookup (id) {
      return this.emitAsync("wait", "lookup", this.addr, { id })
    },

    req_ping ({}, sender, uuid) {
      this.emit("send", "ping", sender, { sender: this.addr }, "response", uuid)
    },

    req_state (data, sender, uuid) {
      let rsp = {};
      if ("pred" in data) rsp.pred = this.pred;
      if ("succ" in data) rsp.succ = this.succ;
      if ("finger" in data) rsp.finger = this.finger;
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
          .then(() => this.emit("send", "lookup", sender, { succ, hops: counter }, "response", uuid));
      } catch ({}) {}
      else for await (const hop of getPred(keyId)) try {
        return this.emitAsync("wait", "lookup", hop, { id: keyId, counter, sender: this.addr })
          .then(({ wait: rsp }) => this.emit("send", "lookup", sender, rsp, "response", uuid));
      } catch ({}) { continue }
    },

    async req_notify (data) {
      const oldPred = this.pred,
            { sender } = data;
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
      this.emit("notify", sender)
    }
  }
}, self);