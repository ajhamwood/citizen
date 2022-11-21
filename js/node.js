importScripts("./machine.js");
importScripts("./blockchain.js");
importScripts("./trie.js");
importScripts("./vm.js");

function getTime () { let d = performance.now();
  return String(d < 0 ? 1e7 + d : d).padStart(7, '0') }
const tell = new Proxy({}, { get ({}, prop) {
        if (logLevels[prop]) return function (event, ...args) {
          console[prop](`${getTime.call(this)} %c${this.addr} %c${event}`,
            "color: greenyellow; font-weight: 900", `color: ${logColours[prop]}; font-weight: 900`, ...args)
        };
        else return () => {}
      } }),
      logLevels = { error: true, warn: true, log: true, info: true, debug: true },
      logColours = { debug: "lightseagreen", info: "lightseagreen", log: "tomato", warn: "tomato", error: "tomato" };

const MIN_SUCC_LENGTH = 1,
      FINGER_LENGTH = 160,

      MAX_ID = 2n ** BigInt(FINGER_LENGTH);

const toSHA1 = async msg => new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(msg))),
      toBuf = (bn, len = 0) => {
        let ar = [];
        do {
          ar.unshift(Number(bn % 256n));
          bn = (bn/256n)>>0n
        } while (bn > 0n);
        return new Uint8Array(Array(Math.max(0, len - ar.length)).concat(ar))
      },
      fromBuf = buf => new Uint8Array(buf).reduce((acc, b) => 256n * acc + BigInt(b), 0n),
      fingerJust = ar => ar.reduce((acc, addr, rank) => typeof addr === "undefined" ? acc : Object.assign(acc, { [rank]: addr }), {}),
      keyToId = async k => fromBuf(await toSHA1(k)).toString(16).padStart(40, "0"),
      addrExists = async k => (txf => ~[...peer.addrList].findIndex(([, id]) => txf === id))(await keyToId(k));

const fixFinger = (i => async function ffcl (reset) {
        if (i >= FINGER_LENGTH || reset) i = 0;
        try {
          const id = ((BigInt(`0x${this.id}`) + 2n ** BigInt(i)) % MAX_ID).toString(16).padStart(40, "0"),
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
          let { wait: stateResp } = await this.emitAsync("wait", "state", succ0[0], { pred: true, succ: true }),  // Handle error from outage
              newSucc = stateResp.succ.slice(0, this.r - 1);
          newSucc.unshift(succ0);

          const candSucc0 = stateResp.pred;
          if (typeof candSucc0 !== "undefined" && isBetween(this.id, candSucc0[1], succ0[1])) try {
            let { wait: { succ } } = await this.emitAsync("wait", "state", candSucc0[0], { succ: true });
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
          this.succ.fill([this.addr, this.id])
        }
        try { await this.emitAsync("send", "notify", this.succ[0][0], { id: this.id }) } catch {}
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

function isBetween (low, el, high) {  // True if low === high and both !== el
  return low < high ? low < el && el < high : low < el || el < high
}
function isStrictlyBetween (low, el, high) {  // Always false if low === high
  return low < high ? low < el && el < high : low > high ? low < el || el < high : false
}

var peer = new $.Machine ({
      appStart: null,

      // Chord properties
      mtTime: 500,

      addr: undefined,
      id: undefined,
      pred: undefined,
      r: MIN_SUCC_LENGTH,  //options: nSucc
      succ: new Array(MIN_SUCC_LENGTH).fill(undefined),
      reverseFinger: new Array(FINGER_LENGTH).fill(undefined),

      // Bucket properties
      hashtable: {},

      // pBFT properties
      addrList: new Map(),
      resolvers: {}
    });

$.targets({
  async message (e) {
    let { data, sender, type, target, uuid } = e.data;
    tell.info.call(peer, "MESSAGE", ...Object.entries(e.data).flatMap(([k, v], i) => (i ? [","] : []).concat([k + ":", v])))
    switch (type) {
      case "start": $.pipe("waitForInit", () => peer.emitAsync("init", data.appStart)); break;
      case "request":
      case "response": peer.emit("respond", data, sender, type); break;

      case "doListen": $.pipe("waitForInit", () => peer.emitAsync("listen", target)).then(() => postMessage({ type: "info-listen" })); break;
      case "doJoin": peer.emitAsync("join", target).then(() => postMessage({ type: "info-join" })); break;
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
        .then(({ dump: { entries, error } }) => postMessage({ type: "info-bucket", data: { action: "doDump", result: { entries } }, uuid })); break;

      case "doBroadcastTx": await chain.emitAsync("transact", data)
    }
  },
  peer: {

    // Chord

    async init (appStart) {
      this.appStart = appStart;

      //Bucket
      this.on("join", target => {
        this.stop("join", "");
        this.emit("partition", target)
      });

      // pBFT
      await chain.emitAsync("init");
      this.id = await keyToId(chain.account.pubKey);
      tell.log.call(this, "node created", this.id);
      postMessage({ type: "info-id", data: { id: this.id } });
      ["prepare", "commit", "roundchange"].forEach(phase => $.pipe(phase, () => new Promise(r => this.resolvers[phase] = p => p.then(v => (r(), v)))));
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
      this.addr = ix;
      tell.debug.call(this, "listen");
      this.addrList.set(ix, this.id);
      this.succ.fill([this.addr, this.id]);
      tell.log.call(this, "LISTENING");
      maintenance.start.call(this, true)
    },
    close () {
      maintenance.stop.call(this);
      this.emit("broadcast", "close", { addr: [this.addr, this.id] });
      const shortFinger = this.reverseFinger.reduce((acc, addr, i) => typeof addr === "undefined" || acc.has(addr[0]) ? acc : acc.set(addr[0], i), new Map());
      tell.warn.call(this, "PEER LIST ON CLOSE", this.id, new Map(this.addrList), "\n", shortFinger);
      this.id = undefined;
      this.reverseFinger.fill(undefined);
      this.succ.fill(undefined);
      this.pred = undefined;
      tell.log.call(this, "CLOSED");
      this.addr = undefined;
      this.addrList = new Map()
    },

    async ping (host) {
      const t0 = performance.now();
      return this.emitAsync("wait", "ping", host ?? this.addr, {},
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
      if (this.addr !== this.succ[0][0]) {console.warn("already joined?", structuredClone(this.state())); throw new Error("Already joined");}
      if (target === this.addr) throw new Error("Cannot join self");
      try {
        maintenance.stop.call(this);
        const { wait: { succ: newSucc0 } } = await this.emitAsync("wait", "lookup", target, { id: this.id });
        if (typeof newSucc0 === "undefined") throw new Error();
        const { wait: { pred: newPred, succ, all } } = await this.emitAsync("wait", "state", newSucc0[0], { pred: true, succ: true, all: true });
        if (typeof newPred === "undefined") throw new Error();
        this.pred = newPred;
        this.addrList = new Map([ ...this.addrList, ...all ]);
        // this.emit("pred::up", this.pred);
        let newSucc = succ.slice(0, this.r - 1);
        newSucc.unshift(newSucc0);
        this.succ = newSucc;
        // const up = newSucc.filter(v => !this.succ.includes(v) && v !== this.addr);
        // if (up.length > 0) this.emit("succ::up", up)

        this.on("notify", () => {
          this.stop("notify", "");
          tell.log.call(this, "JOIN SUCCESSFUL", target, this.succ);
          this.emit("broadcast", "join", { addr: [ this.addr, this.id ] })
          if (this.addr === this.succ[0]) {
            tell.log.call(this, "NOTIFYING ONCE");
            this.emit("join", this.succ[0])  // Test against partition, the reason this is supposed to be here
          }
        });
        return { succ: this.succ }
      } catch (e) { tell.debug.call(this, "join err", e) }
      finally { maintenance.start.call(this) }
    },

    async lookup (id) {
      return (await this.emitAsync("wait", "lookup", this.addr, { id })).wait.succ
    },

    req_ping ({}, sender, uuid) {
      this.emit("send", "ping", sender, {}, "response", uuid)
    },

    req_state (data, sender, uuid) {
      let rsp = {};
      if (data.pred) rsp.pred = this.pred;
      if (data.succ) rsp.succ = this.succ;
      if (data.finger) rsp.finger = this.finger;
      if (data.all) rsp.all = this.addrList;
      tell.debug.call(this, "req_state", rsp);
      this.emit("send", "state", sender, rsp, "response", uuid)
    },

    async req_lookup (data, sender, uuid) {
      async function * getPred (id) {
        for (const pred of self.reverseFinger)
          if (typeof pred !== "undefined" && isBetween(self.id, pred[1], id)) yield pred[0]
      }
      const self = this,
            keyId = data.id,
            counter = (data.counter ?? 0) + 1,
            succ = this.succ[0],
            succId = succ[1];
      tell.debug.call(this, "req_lookup", this.id, keyId, succId, succ, sender, fingerJust(this.reverseFinger));
      if (isBetween(this.id, keyId, succId) || keyId === succId || this.id === succId) try {
        return this.emitAsync("wait", "ping", succ[0], {})
          .then(() => this.emit("send", "lookup", sender, { succ, hops: counter }, "response", uuid));  // outage determination needed before arrving here
      } catch {}
      else for await (const hop of getPred(keyId)) try {
        return this.emitAsync("wait", "lookup", hop, { id: keyId, counter })
          .then(({ wait: rsp }) => this.emit("send", "lookup", sender, rsp, "response", uuid));
      } catch { continue }
    },

    async req_notify (data, sender) {
      const oldPred = this.pred,
            senderId = data.id;
      tell.debug.call(this, "req_notify", this.pred, [sender, senderId], [this.addr, this.id]);
      if (typeof this.pred === "undefined" ||
        isBetween(this.pred[1], senderId, this.id)) this.pred = [sender, senderId];
      else try {
        await this.emitAsync("wait", "ping", this.pred[0], {})
      } catch (e) { tell.debug.call(this, "notify err", e); this.pred = [sender, senderId] }  // TODO: Connect failed, Timeout
      // if (this.pred !== oldPred) {
      //   if (typeof oldPred !== "undefined" && oldPred !== this.addr) this.emit("pred::down", oldPred);
      //   if (this.pred !== this.addr) this.emit("pred::up", this.pred)
      // }
      if (this.addr === oldPred?.[0] && this.pred?.[0] !== oldPred?.[0])
        postMessage({ type: "info-join" });
      this.emit("notify", sender)
    },

    
    // Bucket

    async get (key) {
      const id = await keyToId(key),
            { lookup: host } = await this.emitAsync("lookup", id),
            { wait: { error, value } } = await this.emitAsync("wait", "get", host[0], { id });
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
      const id = await keyToId(key),
            { lookup: host } = await this.emitAsync("lookup", id),
            { wait: { error } } = await this.emitAsync("wait", "set", host[0], { id, value });
      if (error) {
        tell.log.call(this, "NODE SET error", key, value, error);
        return { error }
      }
      tell.log.call(this, "NODE SET", key, value);
      return { result: {} }
    },

    async del (key) {
      const id = await keyToId(key),
            { lookup: host } = await this.emitAsync("lookup", id),
            { wait: { error } } = await this.emitAsync("wait", "del", host[0], { id });
      if (error) {
        tell.log.call(this, "NODE DEL error", key, error);
        return { error }
      }
      tell.log.call(this, "NODE DEL", key);
      return { result: {} }
    },

    async dump (host = this.addr) {
      if (host === this.addr) return this.hashtable;
      const { wait: { entries } } = await this.emitAsync("wait", "partition", host, { id: this.addrList.get(parseInt(host)), delete: false });
      tell.log.call(this, "NODE DUMP", entries);
      return { entries: entries.reduce((acc, entry) => Object.assign(acc, { [entry.keyId]: entry.value }), {}) }
    },

    async partition (host) {
      let { wait: { entries } } = await this.emitAsync("wait", "partition", host, { id: this.id, delete: true });
      entries = entries.reduce((acc, entry) => Object.assign(acc, { [fromBuf(entry.id).toString(16).padStart(40, "0")]: entry.value }), this.hashtable);
      tell.log.call(this, "PARTITION", { entries });
      return { entries }
    },

    async req_get (data, sender, uuid) {
      const keyId = data.id,
            { pred } = this;
      if (!isBetween(pred[1], keyId, this.id) && cmp(keyId, this.id) !== 0)
        return this.emit("send", "get", sender, { error: "Invalid state for get request" }, "response", uuid);
      if (!(keyId in this.hashtable)) return this.emit("send", "get", sender, { error: "Invalid key for get request" }, "response", uuid);

      // this.emit("get", keyId);  // ?

      this.emit("send", "get", sender, { value: this.hashtable[keyId] }, "response", uuid)
    },

    async req_set (data, sender, uuid) {
      const keyId = data.id,
            { pred } = this;
      if (!isBetween(pred[1], keyId, this.id) && keyId !== this.id) 
        return this.emit("send", "get", sender, { error: "Invalid state for set request" }, "response", uuid);
      this.hashtable[keyId] = data.value;
      postMessage({ type: "info-set", data: { keyId, value: data.value } })

      // this.emit("set", idHex)  // ?

      this.emit("send", "set", sender, {}, "response", uuid)
    },

    async req_del (data, sender, uuid) {
      const keyId = data.id,
            { pred } = this;
      if (!isBetween(pred[1], keyId, this.id) && keyId !== this.id)
        return this.emit("send", "del", sender, { error: "Invalid state for delete request" }, "response", uuid);
      if (!(keyId in this.hashtable)) return this.emit("send", "del", sender, { error: "Invalid key for delete request" }, "response", uuid);
      delete this.hashtable[keyId];
      postMessage({ type: "info-del", data: { keyId } })

      // this.emit("del", idHex);  // ?

      this.emit("send", "del", sender, {}, "response", uuid)
    },

    req_partition (data, sender, uuid) {
      const bound = data.id,
            entries = [];
      Object.keys(this.hashtable).forEach(keyId => {
        if (keyId === bound || isStrictlyBetween(keyId, bound, this.id) || bound === this.id) {
          entries.push({ keyId, value: this.hashtable[keyId] });
          if (data.delete) delete this.hashtable[keyId]
        }
      });
      if (data.delete) postMessage({ type: "info-part", data: { entries, sender } });
      this.emit("send", "partition", sender, { entries }, "response", uuid)
    },


    // pBFT

    async broadcast (phase, { addr, tx, block, prepare, commit, msg }) {  // Are these ok on join after stabilisation?
      function * getUniqPred () {
        for (let i = 0; i < FINGER_LENGTH; i++) {
          const { [i]: target, [i+1]: limit } = self.reverseFinger;
          if (typeof target === "undefined") continue;
          if (target[0] == self.addr) return;
          if (i === FINGER_LENGTH - 1) yield [target[0], self.id];
          else if (target[0] !== limit[0]) yield [target[0], limit[1]] } }
      const self = this, data = ({ join: addr, close: addr, tx, preprepare: block, prepare, commit, roundchange: msg})[phase];
      tell.debug.call(this, "broadcast", phase, data, fingerJust(this.reverseFinger));
      if (["tx", "preprepare", "prepare", "commit", "roundchange"].includes(phase) && await this.emitAsync(phase, data)[phase]) return;
      for (const [target, limit] of getUniqPred()) this.emit("send", "broadcast", target, { phase, limit, data }, "request")
    },

    async req_broadcast (data) {  // target in node address space, limit in virtual address space
      async function * getUniqLimitedPred () {
        for (let i = 0; i < FINGER_LENGTH - 1; i++) {
          const { [i]: target, [i+1]: limit } = self.reverseFinger;
          if (typeof target === "undefined" || target[0] === limit[0]) continue;
          if (target[0] == self.addr) return;
          if (!isBetween(self.id, target[1], data.limit)) break;
          if (isBetween(self.id, limit[1], data.limit)) yield [target[0], limit[1]];
          else yield [target[0], data.limit]
        }
        const target = self.reverseFinger.at(-1);
        if (typeof target !== "undefined" && target[0] != self.addr) yield [target[0], self.id]
      }
      const self = this;
      tell.debug.call(this, "req_broadcast", data, fingerJust(this.reverseFinger));
      if (["join", "close", "tx", "preprepare", "prepare", "commit", "roundchange"].includes(data.phase)) {
        if (data.phase === "join") this.addrList.set(...data.data);
        else if (data.phase === "close") this.addrList.delete(data.data[0]);
        else if (await this.emitAsync(data.phase, data.data)[data.phase]) return;
        for await (const [target, limit] of getUniqLimitedPred())
          this.emit("send", "broadcast", target, {...data, limit }, "request")
      }
    },

    async tx (tx) {
      tell.debug.call(this, "tx", tx);
      if (chain.txpool.txDNE(tx) && await chain.txpool.verifyTx(tx)) {
        if (chain.txpool.addTx(tx)) {
          tell.log.call(this, "TX THRESHHOLD REACHED");
          if (chain.blockchain.getProposer() === await keyToId(chain.account.pubKey)) {  // What happens if nodes.length changes as the last tx is being broadcast?
            const block = await chain.blockchain.makeBlock(chain.txpool.txs, chain.account);
            tell.log.call(this, "BLOCK CREATED", block);
            this.emit("broadcast", "preprepare", { block })
          }
        } else tell.log.call(this, "Transaction added", tx.data, tx.id);
        return false
      } else return true
    },

    async preprepare (block) {
      tell.debug.call(this, "preprepare", block);
      if (chain.blockpool.blockDNE(block) && await chain.blockchain.isValidBlock(block)) {
        chain.blockpool.addBlock(block);
        this.emit("broadcast", "prepare", { prepare: await this.resolvers.prepare(chain.preparepool.prepare(block, chain.account)) })
        return false
      } else return true
    },

    async prepare (prepare) {
      await $.pipe("prepare");
      tell.debug.call(this, "prepare", prepare);
      if (chain.preparepool.prepareDNE(prepare) && await chain.preparepool.isValidPrepare(prepare) && await addrExists(prepare.pubKey)) {
        chain.preparepool.addPrepare(prepare);
        if (chain.preparepool.list[prepare.blockHash].length >= minApprovals())
          this.emit("broadcast", "commit", { commit: await this.resolvers.commit(chain.commitpool.commit(prepare, chain.account)) })
        return false
      } else return true
    },

    async commit (commit) {
      await $.pipe("commit");
      tell.debug.call(this, "commit", commit);
      if (chain.commitpool.commitDNE(commit) && await chain.commitpool.isValidCommit(commit) && await addrExists(commit.pubKey)) {
        chain.commitpool.addCommit(commit);
        if (chain.commitpool.list[commit.blockHash].length >= minApprovals()) {
          chain.blockchain.addUpdatedBlock(commit.blockHash, chain.blockpool, chain.preparepool, chain.commitpool);
          const newAddrs = chain.blockchain.chain.at(-1).data.filter(tx => tx.data.type === "createAccount").map(tx => tx.data.account.codeHash);
          postMessage({ type: "info-createAccounts", data: { newAddrs } });
          this.emit("broadcast", "roundchange", { msg: await this.resolvers.roundchange(chain.msgpool.createMsg(chain.blockchain.chain.at(-1).hash, chain.account)) })
        }
        return false
      } else return true
    },

    async roundchange (msg) {
      await $.pipe("roundchange");
      tell.debug.call(this, "roundchange", msg);
      if (chain.msgpool.msgDNE(msg) && await chain.msgpool.isValidMsg(msg) && await addrExists(msg.pubKey)) {
        chain.msgpool.addMsg(msg);
        if (chain.msgpool.list[msg.blockHash].length >= minApprovals()) {
          ["prepare", "commit", "roundchange"].forEach(phase => $.pipe(phase, () => new Promise(r => this.resolvers[phase] = p => p.then(v => (r(), v)))));
          chain.txpool.clear()
        }
        return false
      } else return true
    },
  }
}, self);