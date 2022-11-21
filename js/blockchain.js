// Blockchain

const TX_THRESHHOLD = 1;  // Max txs per block, tx pool
function minApprovals () { return 2 * Math.ceil(peer.addrList.size / 3) + 1 }  // Implies >=3 nodes needed

class Utils {
  static async genKeyPair () { return await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]) }
  static async hash (msg) { return fromBuf(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(msg))).toString(16).padStart(40, "0") }
  static async verifySig (pubKey, signature, msg) {
    const publicKey = await crypto.subtle.importKey("spki", toBuf(BigInt(`0x${pubKey}`), 120), { name: "ECDSA", namedCurve: "P-384" }, true, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: { name: "SHA-384" } },
      publicKey, toBuf(BigInt(`0x${signature}`), 96), new TextEncoder().encode(msg))
  }
};

class Transaction {
  constructor ({ id, from, hash, data, sig, to } = {}) {
    Object.assign(this, { id, from, hash, data, sig });
    if (typeof to !== "undefined") this.to = to
  }
  async init ({ account, to }) {
    this.id = crypto.randomUUID();
    this.from = account.pubKey;
    if (typeof to !== "undefined") this.to = to;
    this.data = account.code.length ?
      { type: "createAccount", timestamp: Date.now(), account: {
        address: await keyToId(account.pubKey),
        code: account.code,
        codeHash: account.codeHash
      } } :
      { type: "transact", timestamp: Date.now() };
    this.hash = await Utils.hash(JSON.stringify(this.data));
    this.sig = await account.sign(this.hash);
    tell.log.call(peer, "transaction created", this);
    return this
  }
  async run (state) {
    tell.log.call(peer, "RUNNING TX", this, state)
    const { usedCompUnitsTotal, memory, accountData } = state.getAccount(this.to),
          { result, usedCompUnits } = await new Interpreter(memory).run(accountData);
    tell.log.call(peer, "PROGRAM RESULT", result.value);
    if (usedCompUnitsTotal + usedCompUnits < Infinity) result.commit(state);
  }
  createAccount (state) {
    const { address, codeHash, ...accountData } = this.data.account;
    state.putAccount(codeHash ? codeHash : address, accountData)
  }
  static async verifyTx(tx) { return await Utils.verifySig(tx.from, tx.sig, await Utils.hash(JSON.stringify(tx.data))) }
}

class Account {
  async init ({ code = "" } = {}) {
    const { privateKey, publicKey } = await Utils.genKeyPair();
    this.pubKey = fromBuf(await crypto.subtle.exportKey("spki", publicKey)).toString(16);
    this.privKey = privateKey;
    this.code = code;
    this.codeHash = code.length ? await Utils.hash(this.pubKey + code) : null;
    tell.log.call(peer, "account created", this.codeHash ? this.codeHash : await keyToId(this.pubKey));
    return this
  }
  async sign (hash) { return fromBuf(await crypto.subtle.sign({ name: "ECDSA", hash: { name: "SHA-384" } },
    this.privKey, new TextEncoder().encode(hash))).toString(16) }
  async createTx ({ code, to }) { return await new Transaction()
    .init({ account: typeof code === "undefined" ? this : await new Account().init({ code }), to }) }
}

class Block {
  constructor ({ timestamp, lastHash, hash, data, proposer, sig, seqNo } = {}) {
    Object.assign(this, { timestamp, lastHash, hash, data, proposer, sig, seqNo })
  }
  async run (state) {  // TODO: txs run by randomly nominated nodes?
    tell.debug.call(peer, "block run", this.data);
    for (const tx of this.data) switch (tx.data.type) {
      case "transact": await new Transaction(tx).run(state); break;
      case "createAccount": new Transaction(tx).createAccount(state)
    }
  }
  static async base () { return new this({
    timestamp: peer.appStart, lastHash: "", hash: await this.hash(peer.appStart, "", ""), data: [], proposer: "0".repeat(240), sig: "", seqNo: 0
  }) }
  static async next (lastBlock, data, account) {
    const timestamp = Date.now(), lastHash = lastBlock.hash,
          hash = await Block.hash(timestamp, lastHash, data),
          proposer = account.pubKey, sig = await Block.sign(hash, account);
    return new this({ timestamp, lastHash, hash, data, proposer, sig, seqNo: lastBlock.seqNo + 1 })
  }
  static async hash (timestamp, lastHash, data) {
    return fromBuf(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(`${timestamp}${lastHash}${JSON.stringify(data)}`))).toString(16)
  }
  static async blockHash (block) {
    const { timestamp, lastHash, data } = block;
    return Block.hash(timestamp, lastHash, data)
  }
  static async sign (hash, account) { return await account.sign(hash) }
  static async verifyBlock (block) {
    return await Utils.verifySig(block.proposer, block.sig, await Block.hash(block.timestamp, block.lastHash, block.data))
  }
  static async verifyProposer (block, proposer) { return (await keyToId(block.proposer)) === proposer }
}

class TxPool {
  txs = [];
  addTx (tx) {
    this.txs.push(new Transaction(tx));
    return this.txs.length >= TX_THRESHHOLD
  }
  async verifyTx (tx) { return await Transaction.verifyTx(tx) }
  txDNE (tx) { return !~this.txs.findIndex(t => t.id === tx.id) }
  clear () { tell.log.call(peer, "TX POOL CLEARED"); this.txs = [] }
}

class BlockPool {
  list = [];
  blockDNE (block) { return !~this.list.findIndex(b => b.hash === block.hash) }
  addBlock (block) { tell.log.call(peer, "ADDED BLOCK TO POOL"); this.list.push(block) }
  getBlock (hash) { return this.list.find(b => b.hash === hash) }
}

class PreparePool {
  list = {};
  async prepare (block, account) {
    const prepare = await this.createPrepare(block, account);
    (this.list[block.hash] = []).push(prepare);
    return prepare
  }
  async createPrepare (block, account) { return {
    blockHash: block.hash, pubKey: account.pubKey, sig: await account.sign(block.hash)
  } }
  addPrepare (prepare) { this.list[prepare.blockHash].push(prepare) }
  prepareDNE (prepare) { return this.list[prepare.blockHash] && !~this.list[prepare.blockHash].findIndex(p => p.pubKey === prepare.pubKey) }
  async isValidPrepare (prepare) { return await Utils.verifySig(prepare.pubKey, prepare.sig, prepare.blockHash) }
}

class CommitPool {
  list = {};
  async commit (prepare, account) {
    const commit = await this.createCommit(prepare, account);
    (this.list[prepare.blockHash] = []).push(commit);
    return commit
  }
  async createCommit (prepare, account) { return {
    blockHash: prepare.blockHash, pubKey: account.pubKey, sig: await account.sign(prepare.blockHash)
  } }
  addCommit (commit) { this.list[commit.blockHash].push(commit) }
  commitDNE (commit) { return this.list[commit.blockHash] && !~this.list[commit.blockHash].findIndex(p => p.pubKey === commit.pubKey) }
  async isValidCommit (commit) { return await Utils.verifySig(commit.pubKey, commit.sig, commit.blockHash) }
}

class MsgPool {
  list = {};
  msg = "INITIATE NEW ROUND";
  async createMsg (blockHash, account) {
    const roundChange = {
            pubKey: account.pubKey,
            msg: this.msg,
            sig: await account.sign(Utils.hash(this.msg + blockHash)),
            blockHash
          };
    this.list[blockHash] = [roundChange];
    return roundChange
  }
  addMsg (msg) { this.list[msg.blockHash].push(msg) }
  msgDNE (msg) { return this.list[msg.blockHash] &&
    !~this.list[msg.blockHash].findIndex(p => p.pubKey === msg.pubKey) }
  async isValidMsg (msg) { return await Utils.verifySig(msg.pubKey, msg.sig, Utils.hash(msg.msg + msg.blockHash)) }
}

class Blockchain {
  async init (state) {
    this.chain = [await Block.base()];
    this.state = state;
    return this
  }
  appendBlock (block) {
    tell.log.call(peer, "NEW BLOCK APPENDED TO CHAIN");
    this.chain.push(block);
    new Block(block).run(this.state);
    return block
  }
  async makeBlock (txs, account) { return await Block.next(this.chain.at(-1), txs, account) }
  getProposer () {
    const ids = [...peer.addrList].map(([, id]) => id).sort(),
          ix = this.chain.at(-1).hash[0].charCodeAt(0) % ids.length;  // Frickin come on
    tell.debug.call(peer, "nominated", ids[ix]);
    return ids[ix]
  }
  async isValidBlock (block) {
    const lastBlock = this.chain.at(-1);
    if (
      lastBlock.seqNo + 1 === block.seqNo &&
      lastBlock.hash === block.lastHash &&
      (await Block.blockHash(block)) === block.hash &&
      (await Block.verifyBlock(block)) &&
      await Block.verifyProposer(block, this.getProposer())) {
      tell.log.call(peer, "VALID BLOCK");
      return true
    } else {
      tell.log.call(peer, "INVALID BLOCK");
      return false
    }
  }
  addUpdatedBlock (hash, blockPool, preparePool, commitPool) {
    const block = blockPool.getBlock(hash);
    block.prepareMsgs = preparePool.list[hash];
    block.commitMsgs = commitPool.list[hash];
    this.appendBlock(block)
  }
}


// Smart contracts

class Interpreter {
  constructor (memory) { this.memory = memory }
  async run (account) {
    let term, type, ctx, err;
    try {
      const { normalForm } = await VM().import({ code: account.code, memory: this.memory });
      ({ term, type, ctx } = await normalForm.run());
    } catch (e) { err = e.message }
    tell.debug.call(peer, "interpreter result", ...(err ? ["\n", err] : [term.toString(ctx), type.toString(ctx)]));
    return {
      result: {
        value: err ? { err } : { term: term.toString(ctx), type: type.toString(ctx) },
        commit (state) {
          const { address, codeHash, ...accountData } = account;
          state.putAccount(address, accountData)
        }
      },
      usedCompUnits: 0
    }
  }
}

class State {
  obj = {};
  putAccount (address, accountData) { this.obj[address] = {
    accountData,
    usedCompUnitsTotal: 0,
    memory: new WebAssembly.Memory({ initial: 1, maximum: 1 })
  } }
  getAccount (address) { return this.obj[address] }
}



var chain = new $.Machine({
      account: null,
      txpool: new TxPool(),
      blockchain: null,
      blockpool: new BlockPool(),
      preparepool: new PreparePool(),
      commitpool: new CommitPool(),
      msgpool: new MsgPool()
    });
$.targets({
  async init () {
    const state = new State();
    this.account = await new Account().init();
    this.blockchain = await new Blockchain().init(state)
  },
  txs () { return this.txpool.txs },
  blocks () { return this.blockchain.chain },
  async transact ({ code, to }) {
    const tx = await this.account.createTx({ code, to });
    this.txpool.addTx(tx);
    peer.emit("broadcast", "tx", { tx });
    return tx
  }
}, chain)