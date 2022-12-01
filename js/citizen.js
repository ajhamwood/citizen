// Text, time, logging and crypto utilities

function dedent(callSite, ...args) { let size = -1;
  return callSite
    .slice(0, args.length + 1)
    .map((text, i) => (i === 0 ? "" : args[i - 1]) + text)
    .join("")
    .replace(/[\r\n]([^\S\r\n]+)/g, (m, m1) => {
      if (size < 0) size = m1.replace(/\t/g, "    ").length;
      return "\n" + m1.slice(Math.min(m1.length, size)) }).slice(1) }
function markup (s) { return s?.replace(/\*\*(.+)\*\*/g, ({}, m) => `<b>${m}</b>`) }
function formatTime (t) {  // TODO: reload all times in page if day ticks over
  let config = { fractionalSecondDigits: 2, second: 'numeric', minute: 'numeric', hour: 'numeric' }
  if (t > new Date(new Date(chord.baseTime).setHours(0, 0, 0, 0)).setDate(new Date(chord.baseTime).getDate() + 1))
    Object.assign(config, { day: 'numeric', month: 'short' });
  return new Intl.DateTimeFormat('en-AU', config).format(t)
}

var citizen = new $.Machine({ sims, addr: "citizen" }),
    chord = new $.Machine({
      nodes: [],
      baseTime: null,
      closedWorkers: [],

      addr: "top",

      // Blockchain
      networkSize: 0,
      newAccts: []
    });

$.targets({
  async load () {
    // initPeerWC();
    citizen.emit("init");

    await chord.emitAsync("startTimer");

    viz.emit("init");
    new ResizeObserver(() => viz.emit('resize')).observe($("svg"));

    let { instance } = await testWasm(testModules.fib);
    tell.log.call(citizen, "Wasm fib test", instance.exports.factorial(8n));
  },
  keyup (e) { if ($("#simSelect").validity.valid) {
    switch (e.keyCode) {
      case 32: $("#pausePlay").click(); break;
      case 39: $("#advance").click()
    }
  } },
  citizen: {
    init () {
      for (const name in this.sims) $.load("option", "#simSelect").forEach(([el]) => el.value = el.innerHTML = name);
      $.queries({ "#simSelect": { async change () { if (this.validity.valid) {
        this.blur();
        const name = this.value, header = $("header"), label = $("#label");
        let labelText;
        header.dataset.sim = "paused";
        ({ "": labelText } = await citizen.sims[name].emitAsync("reset"));
        $("#label").innerHTML = markup(labelText.value) ?? $("#label").innerHTML;
        ({ "": labelText } = await citizen.sims[name].emitAsync("advance"));
        $.queries({
          "#advance": { async click () {
            if (header.dataset.sim === "playing") {
              await new Promise(requestAnimationFrame);
              $("#pausePlay").classList.add("flash");
              await new Promise(requestAnimationFrame);
              $("#pausePlay").classList.remove("flash");
              return
            }
            header.dataset.sim = "playing";
            $("#label").innerHTML = markup(labelText.value) ?? $("#label").innerHTML;
            ({ "": labelText } = await citizen.sims[name].emitAsync("advance"));
            header.dataset.sim = "paused";
            if (labelText.done) {
              $("#simSelect").value = "";
              citizen.stop("event")
            }
          } },
          "#pausePlay": { async click () {
            if (header.dataset.sim === "playing") {
              header.dataset.sim = "paused";
              return
            }
            header.dataset.sim = "playing";
            do {
              $("#label").innerHTML = markup(labelText.value) ?? $("#label").innerHTML;
              ({ "": labelText } = await citizen.sims[name].emitAsync("advance"));
            } while (header.dataset.sim === "playing" && !labelText.done);
            header.dataset.sim = "paused";
            if (labelText.done) {
              $("#simSelect").value = "";
              citizen.stop("event")
            }
          } }
        })
      } } } })
    },

    async editorRun (memory) {
      let term, type, ctx, err, log = $("#log")
      try {
        const { normalForm } = await VM().import({ code: $("#source").value, memory });
        ({ term, type, ctx } = await normalForm.run());
      } catch (e) { err = e.message }
      log.childNodes.length && $.load("hr", "#log");
      log.appendChild(document.createTextNode(err ? err :
        ((...res) => res.join(/\r\n?|\n/g.test(res.join('')) ? '\n\n' : '\n'))("type: " + type.toString(ctx), "term: " + term.toString(ctx))))
    }
  },

  chord: {
    startTimer () {
      appStart = performance.now();
      this.baseTime = Date.now()
    },

    createNode () {
      const worker = this.closedWorkers.pop() ?? new Worker("js/node.js");
      worker.postMessage({ type: "start", data: { baseTime: this.baseTime, relTime: appStart - performance.now() } });
      const newNode = {
              worker,
              id: null,  // Virtual address

              state: "created",
              finger: null,
              hash: null,
              blockchain: []
            };
      let ix = this.nodes.map(([n]) => n).sort().findIndex((k, i) => k !== i);
      this.nodes.push([(ix = ~ix ? ix : this.nodes.length), newNode]);

      $.targets({ message (e) {
        const { type, target, data, uuid } = e.data;
        tell.info.call(chord, "MESSAGE", ix, ...Object.entries(e.data).flatMap(([k, v], i) => (i ? [","] : []).concat([k + ":", v])));
        switch(type) {
          case "request":
          case "response": chord.nodes.find(([n]) => n == target)[1].worker.postMessage({ type, data, sender: ix }); break;

          case "info-id": newNode.id = idSpan.innerHTML = viz.peers[ix] = data.id; break;

          case "info-listen":
            newNode.state = "listening";
            chordOpsDiv.firstChild.replaceWith($.load("chord-join", ".chord-interact", peerDiv)[0][0]);
            $.all(".chord-addr > :not([value=''])").forEach(el => el.remove());
            chord.nodes.filter(([, node]) => ["listening", "joined"].includes(node.state)).forEach(([n]) =>
              $.load("option", `.wc-peer:not([data-addr="${n}"]) .chord-addr`).forEach(([el]) => el.value = el.innerHTML = n));
            $.queries({
              [`div[data-addr="${ix}"] .chord-join`]: { click () {
                const addrSel = $(".chord-addr", peerDiv);
                if (addrSel.validity.valid) worker.postMessage({ type: "doJoin", target: addrSel.value })
              } },
              [`g.label[data-addr="${ix}"]`]: {
                "mouseover" () { newNode.finger.forEach((rank, target) => viz.emit("drawArrow", ix, target, rank)) },
                "mouseout" () { $.all("g.fingers > *").forEach(el => el.remove()) }
              }
            });
            citizen.emit("event", "listen", { node: ix }); break;

          case "info-join":
            newNode.state = "joined";
            $.all(".chord-interact > :not(.chord-close)", peerDiv).forEach(el => el.remove());
            $.all(".bucket-select-addr > :not([value=''])").forEach(el => el.remove());
            chord.nodes.forEach(([n]) => $.load("option", ".bucket-select-addr")
              .forEach(([el]) => el.value = el.innerHTML = n));
            pbftTopSpan.innerHTML = pbftPhase.innerHTML = pbftDiv.dataset.phase = "collect";
            chord.networkSize++;
            pbftReq.innerHTML = data.limit;  // TODO: global controls
            // TODO: get blockchain from DHT on rejoin
            
            $.queries({
              ".blockchain-seqno": { async change (e) { chord.emit("selectBlock", ix) } },

              ".smart-contract-create": { click () {
                const input = $(".smart-contract-codeinput", peerDiv);
                newNode.worker.postMessage({ type: "doBroadcastTx", data: { code: input.value }});
                input.value = "";
                $.all(".pseudofocus", peerDiv).forEach(el => el.classList.remove("pseudofocus"))
              } },

              ".smart-contract-run": { click () {
                const acct = $(".smart-contract-account", peerDiv);
                if (!acct.validity.valid) return;
                newNode.worker.postMessage({ type: "doBroadcastTx", data: { to: acct.value }});
              } },

              ".smart-contract-account": { change () {
                chord.emit("codeListingUpdate", $.all(".smart-contract-args, .smart-contract-codelisting > *", peerDiv),
                  chord.newAccts.find(({ addr }) => this.value === addr))
              } }
            }, peerDiv);
            break;

          case "info-close":
            newNode.state = "closed";
            peerDiv.remove();
            chord.closedWorkers.push(newNode.worker);
            chord.nodes.splice(chord.nodes.findIndex(([, node]) => node === newNode), 1);
            $.all(`.bucket-select-addr > [value="${ix}"]`).forEach(el => el.remove());
            $.all(".chord-addr > :not([value=''])").forEach(el => el.remove());
            chord.nodes.filter(([, node]) => ["listening", "joined"].includes(node.state)).forEach(([n]) =>
              $.load("option", `.wc-peer:not([data-addr="${n}"]) .chord-addr`).forEach(([el]) => el.value = el.innerHTML = n));
            delete viz.peers[ix];
            chord.networkSize--; break;

          case "info-finger":
            newNode.finger = data.finger.reduce((acc, addr, i) => typeof addr === "undefined" || acc.has(addr[0]) ? acc : acc.set(addr[0], i), new Map());
            Array.from(fingerList.children).forEach(el => el.remove());
            newNode.finger.forEach((v, k) => {
              const finger = $.load("chord-finger", ".chord-finger-list", peerDiv)[0][0];
              $(".chord-finger-rank", finger).innerHTML = v;
              $(".chord-finger-addr", finger).innerHTML = k
            });
            tell.debug.call(chord, "finger", ix, newNode.finger); break;

          case "info-bucket":
            chord.emit(`resp-${data.action}-${uuid}`, data.result); break;

          case "info-set":
            const hashEntry = $.load("bucket-hash-entry", ".bucket-hash", peerDiv)[0][0];
            newNode.hash = Object.assign(newNode.hash ?? {}, { [data.keyId]: data.value })
            hashEntry.dataset.keyid = data.keyId;
            $(".bucket-hash-key", hashEntry).innerHTML = data.keyId;
            $(".bucket-hash-value", hashEntry).innerHTML = data.value; break;

          case "info-del":
            delete newNode.hash[data.keyId];
            $(`.bucket-hash-entry[data-keyid="${data.keyId}"]`, bucketHash).remove(); break;

          case "info-part":
            data.entries.forEach(({ keyId, value }) => {
              tell.warn.call(chord, id, idHex, value);
              const hashEntryOld = $(`.bucket-hash-entry[data-keyid="${keyId}"]`, bucketHash),
                    targetNode = chord.nodes.find(([n]) => n == data.sender)[1],
                    hashEntryNew = $.load("bucket-hash-entry", `div[data-addr="${data.sender}"] .bucket-hash`)[0][0];
              delete newNode.hash[keyId];
              hashEntryOld.remove();
              targetNode.hash = Object.assign(targetNode.hash ?? {}, { [data.keyId]: value });
              hashEntryNew.dataset.keyid = data.keyId;
              $(".bucket-hash-key", hashEntryNew).innerHTML = keyId;
              $(".bucket-hash-value", hashEntryNew).innerHTML = value
            }); break;

          case "info-phase":
            tell.log.call(chord, "voting", Object.assign(data, { node: ix }));
            chord.emit("pbftUpdate", data);
            citizen.emit("event", "phase", data); break;

          case "info-blockappend":
            tell.log.call(chord, "blockchain extended", data.block);
            const i = newNode.blockchain.push(data.block);
            $.load("option", ".blockchain-seqno", peerDiv).forEach(([el]) => el.value = el.innerHTML = data.block.seqNo);
            if (i === 1) chord.emit("selectBlock", ix); break;

          case "info-createAccounts":
            tell.log.call(chord, "new accounts", ...data.newAccts);
            data.newAccts.forEach(({ addr, code, result }) => {
              if (!~chord.newAccts.findIndex(({ addr: a }) => a === addr)) {
                chord.newAccts.push({ addr, code, result });
                $.load("option", ".smart-contract-account").forEach(([el]) => el.value = el.innerHTML = addr)
              }
            });
            $(".smart-contract-account").value = data.newAccts[0].addr;
            chord.nodes.forEach(([ix]) =>
              chord.emit("codeListingUpdate", $.all(".smart-contract-args, .smart-contract-codelisting > *", peerDiv),
                chord.newAccts.find(({ addr }) => data.newAccts[0].addr === addr)))
        }
      } }, worker);

      const peerDiv = $.load("wc-peer", "menu")[0][0];
      $("menu").insertBefore(peerDiv, $("menu > .peer-createnode"));
      peerDiv.dataset.addr = ix;

      const [ chordDiv, fingerDiv, bucketDiv, pbftDiv,, scDiv ] = peerDiv.children,
            [ addrSpan, idSpan,, pbftTopSpan, chordOpsDiv ] = chordDiv.children,
            [ ,, fingerList ] = fingerDiv.children,
            [ ,, bucketHash, bucketOps ] = bucketDiv.children,
            [ bucketSetDiv, bucketGetDiv, bucketHasDiv, bucketDelDiv, bucketDumpDiv ] = bucketOps.children,
            [ , pbftPhase, pbftReq ] = pbftDiv.children,
            [ , scRunDiv ] = scDiv.children[1].children, codeviewForm = scRunDiv.children[4];
      addrSpan.innerHTML = ix;
      [ "raw", "evaluated" ].forEach((val, i) => [ "id", "for" ].forEach((attr, j) =>
        codeviewForm.children[j + 2 * i].setAttribute(attr, val + ix)));
      $.load("chord-listen", ".chord-interact", peerDiv);

      $.queries({
        "": { click (e) { if (!["button", "field", "sel", "opt"].some(kl => e.target.classList.contains(kl))) {
          this.classList.add("pseudofocus");
          $("menu").classList.add("pseudofocus")
        } } },

        ".chord-listen": { click () { worker.postMessage({ type: "doListen", target: ix }) } },

        ".chord-close": { click () {
          $("menu").classList.remove("pseudofocus");
          worker.postMessage({ type: "doClose" })
        } },

        ".bucket-operations input, .bucket-operations select": { click () {
          $.all(".bucket-confirmed.check").forEach(el => el.classList.remove("check"));
          $.all(".bucket-show-value").forEach(el => el.innerHTML = "");
          $.all(".bucket-dump-hash").forEach(el => {
            el.classList.remove("confirmed");
            Array.from(el.children).forEach(el => el.remove())
          })
        } },

        ".bucket-set": { async click () {
          const keyInput = $(".bucket-input-key", bucketSetDiv), valueInput = $(".bucket-input-value", bucketSetDiv),
                key = keyInput.value, value = valueInput.value,
                { respond: { error } } = await chord.emitAsync("respond", "doSet", ix, { key, value });
          if (!error) {
            keyInput.value = "";
            valueInput.value = "";
            $(".bucket-confirmed", bucketSetDiv).classList.add("check");
            tell.warn.call(chord, "SET", key, value)
          }
        } },

        ".bucket-get": { async click () {
          const keyInput = $(".bucket-input-key", bucketGetDiv), key = keyInput.value,
                { respond: { value, error } } = await chord.emitAsync("respond", "doGet", ix, { key });
          if (!error) {
            keyInput.value = "";
            $(".bucket-show-value", bucketGetDiv).innerHTML = value;
            $(".bucket-confirmed", bucketGetDiv).classList.add("check");
            tell.warn.call(chord, "GET", key, value)
          }
        } },

        ".bucket-has": { async click () {
          const keyInput = $(".bucket-input-key", bucketHasDiv), key = keyInput.value,
                { respond: { result, error } } = await chord.emitAsync("respond", "doHas", ix, { key });
          if (!error) {
            keyInput.value = "";
            $(".bucket-show-value", bucketHasDiv).innerHTML = result;
            $(".bucket-confirmed", bucketHasDiv).classList.add("check");
            tell.warn.call(chord, "HAS", key, result)
          }
        } },

        ".bucket-del": { async click () {
          const keyInput = $(".bucket-input-key", bucketDelDiv), key = keyInput.value,
                { respond: { error } } = await chord.emitAsync("respond", "doDel", ix, { key });
          if (!error) {
            keyInput.value = "";
            $(".bucket-confirmed", bucketDelDiv).classList.add("check");
            tell.warn.call(chord, "DEL", key)
          }
        } },

        ".bucket-dump": { async click () {
          const addrSel = $(".bucket-select-addr", bucketDumpDiv), addr = addrSel.value;
          if (!addrSel.validity.valid) return;
          const { respond: { entries, error } } = await chord.emitAsync("respond", "doDump", ix, { addr });
          if (!error) {
            addrSel.value = "";
            $(".bucket-dump-hash", bucketDumpDiv).classList.add("confirmed");
            for (const [ keyId, value ] of Object.entries(entries)) {
              const dumpEntry = $.load("bucket-hash-entry", ".bucket-dump-hash", peerDiv)[0][0];
              $(".bucket-hash-key", dumpEntry).innerHTML = keyId;
              $(".bucket-hash-value", dumpEntry).innerHTML = value
            };
            tell.warn.call(chord, "DUMP", entries)
          }
        } },

        ".smart-contract-codeinput, .smart-contract-account": { focus () {
          this.classList.add("pseudofocus");
          this.parentElement.classList.add("pseudofocus")
        } },

        ".smart-contract-codeview > label": { click (e) {
          $(".smart-contract-transaction:nth-child(2)", peerDiv).dataset.codeview = e.target.htmlFor.match(/[a-z]+/)[0]
        } },

        ".smart-contract-args": { click () {
          $(".smart-contract-transaction:nth-child(2)", peerDiv).classList.add("pseudofocus");
          if (false) {
            const argField = $.load("smart-contract-arginput", ".smart-contract-arginputs", peerDiv)[0][0]
          }
        } }
      }, peerDiv);

      return [ ix, newNode ]
    },

    async selectBlock (ix) {
      const peerDiv = $(`.wc-peer[data-addr="${ix}"]`),
            [ , blockchainSeqNo, blockchainHash, blockchainTS, blockchainTxsDiv ] = $.all(".blockchain-data > *", peerDiv),
            block = chord.nodes.find(([n]) => n === ix)[1].blockchain[blockchainSeqNo.value];
      blockchainHash.innerHTML = block.hash;
      blockchainTS.innerHTML = formatTime(block.timestamp);
      Array.from(blockchainTxsDiv.children).forEach(el => el.remove());
      for (const tx of block.data) {
        const txDiv = $.load("blockchain-transaction", ".blockchain-txlist", peerDiv)[0][0],
              [ fromSpan, idSpan, toSpan, typeSpan, codeviewForm, txcodeDiv ] = txDiv.children;
        fromSpan.innerHTML = tx.data.account?.codeHash ?? await keyToId(tx.from);
        idSpan.innerHTML = tx.id;
        typeSpan.innerHTML = txDiv.dataset.type = tx.data.type;
        [ "raw", "evaluated" ].forEach((val, i) => [ "id", "for" ].forEach((attr, j) =>
          codeviewForm.children[j + 2 * i].setAttribute(attr, val + ix)));

        $.queries({
          ".blockchain-txcode": { click () {
            txDiv.classList.add("pseudofocus");
            $(".smart-contract-transaction", peerDiv).classList.add("pseudofocus")
          } },

          ".smart-contract-codeview > label": { click (e) { txDiv.dataset.codeview = e.target.htmlFor.match(/[a-z]+/)[0] } },
        }, txDiv);

        switch (tx.data.type) {
          case "transact":
            toSpan.innerHTML = tx.to;
            txDiv.dataset.codeview = "evaluated";
            chord.emit("codeListingUpdate", $.all(":scope > *", txcodeDiv), tx.data)
            break;
            
          case "createAccount":
            chord.emit("codeListingUpdate", $.all(":scope > *", txcodeDiv), chord.newAccts.find(({ addr }) => tx.data.account.codeHash === addr))
        }
      }
    },

    async pbftUpdate (data) {
      const peerDiv = $(`.wc-peer[data-addr="${data.node}"]`),
            pbftTopSpan = $(".pbft-phase-top", peerDiv),
            pbftDiv = $(".pbft-data", peerDiv),
            [ , pbftPhase, pbftReq, pbftCollDiv ] = pbftDiv.children;
      if (data.phase !== pbftDiv.dataset.phase) while (pbftCollDiv.children.length) pbftCollDiv.firstChild.remove();
      pbftTopSpan.innerHTML = pbftPhase.innerHTML = pbftDiv.dataset.phase = data.phase;
      pbftReq.innerHTML = data.limit;
      let coll;
      if (data.phase === "preprepare") {
        $.all(".wc-peer[data-proposer]").forEach(el => delete el.dataset.proposer);
        $(`.wc-peer[data-addr="${chord.nodes.find(([, node]) => node.id === data.newProposer)[0]}"]`).dataset.proposer = "";
        if (!("block" in data)) return;
      } else pbftReq.innerHTML = data.limit;
      switch (data.phase) {

        case "collect":
          if (!("tx" in data)) return;
          coll = $.load("pbft-transaction", ".pbft-collection", peerDiv)[0][0];
          $(".pbft-txfrom", coll).innerHTML = data.tx.data.account?.codeHash ?? await keyToId(data.tx.from);
          $(".pbft-txid", coll).innerHTML = data.tx.id; break;

        case "preprepare":
          coll = $.load("pbft-block", ".pbft-collection", peerDiv)[0][0];
          $(".pbft-blockhash", coll).innerHTML = data.block.hash; break;

        case "prepare":
          coll = $(`.pbft-block[data-hash="${data.prepare.blockHash}"]`, peerDiv);
          if (coll === null) {
            coll = $.load("pbft-block", ".pbft-collection", peerDiv)[0][0];
            $(".pbft-blockhash", coll).innerHTML = coll.dataset.hash = data.prepare.blockHash;
            $(".pbft-votesreceived", coll).innerHTML = coll.dataset.votes = 1
          } else $(".pbft-votesreceived", coll).innerHTML = ++coll.dataset.votes;
          $(".pbft-blockhash", coll).innerHTML = data.prepare.blockHash; break;

        case "commit":
          coll = $(`.pbft-block[data-hash="${data.commit.blockHash}"]`, peerDiv);
          if (coll === null) {
            coll = $.load("pbft-block", ".pbft-collection", peerDiv)[0][0];
            $(".pbft-blockhash", coll).innerHTML = coll.dataset.hash = data.commit.blockHash;
            $(".pbft-votesreceived", coll).innerHTML = coll.dataset.votes = 1
          } else $(".pbft-votesreceived", coll).innerHTML = ++coll.dataset.votes;
          $(".pbft-blockhash", coll).innerHTML = data.commit.blockHash; break;
          
        case "roundchange":
          coll = $(`.pbft-block[data-hash="${data.msg.blockHash}"]`, peerDiv);
          if (coll === null) {
            coll = $.load("pbft-block", ".pbft-collection", peerDiv)[0][0];
            $(".pbft-blockhash", coll).innerHTML = coll.dataset.hash = data.msg.blockHash;
            $(".pbft-message", coll).innerHTML = data.msg.msg;
            $(".pbft-votesreceived", coll).innerHTML = coll.dataset.votes = 1
          } else $(".pbft-votesreceived", coll).innerHTML = ++coll.dataset.votes;
          $(".pbft-blockhash", coll).innerHTML = data.msg.blockHash;
      }
    },

    codeListingUpdate (codelistingDivs, txData) {
      const [ argsDiv, codeRawDiv, progValueDiv, progCtxsDiv ] = codelistingDivs,
            [ codeTermSpan, codeTypeSpan ] = progValueDiv.children, [ codeElabDiv, codeMetasDiv ] = progCtxsDiv.children;
      Array.from(argsDiv.children).forEach(el => el.remove());
      txData.args?.forEach(arg => $.load("smart-contract-appliedarg", ".smart-contract-appliedargs", argsDiv.parentElement)[0][0].innerHTML = arg);
      codeRawDiv.innerHTML = txData.code;
      codeElabDiv.innerHTML = txData.result.elab;
      codeTermSpan.innerHTML = txData.result.term;
      codeTypeSpan.innerHTML = txData.result.type;
      Array.from(codeMetasDiv.children).forEach(el => el.remove());
      txData.result.metas.forEach(m => $.load("smart-contract-meta", ".smart-contract-metacontext", progCtxsDiv)[0][0].innerHTML = m)
    },

    async respond (type, target, data) {
      const uuid = crypto.randomUUID(),
            result = await new Promise(ok => {
              this.on(`resp-${type}-${uuid}`, ok);
              chord.nodes.find(([n]) => n == target)[1].worker.postMessage({ type, data, uuid });
            });
      this.stop(`resp-${type}-${uuid}`, "");
      return result
    }
  }
});

$.queries({
  body: { click (e) {
    const path = e.composedPath();
    if (path.includes($("nav"))) return;
    $.all(".pseudofocus").forEach(el => path.includes(el) || el.classList.remove("pseudofocus"))
  } },
  "#nodeViewMenu > .sectionToggle": { click () { $("body").dataset.section = "katRepl" } },
  "menu > .button": { click () { chord.emit("createNode") } },
  "#katReplMenu > .sectionToggle": { click () { $("body").dataset.section = "nodeView" } },
  "#run": { click () { citizen.emit("editorRun", new WebAssembly.Memory({ initial: 1, maximum: 1 })) } }
});

function initPeerWC () {
  $.loadWC("wc-peer", {
    constructor () {}
  })
}