function dedent(callSite, ...args) { let size = -1;
  return callSite
    .slice(0, args.length + 1)
    .map((text, i) => (i === 0 ? "" : args[i - 1]) + text)
    .join("")
    .replace(/[\r\n]([^\S\r\n]+)/g, (m, m1) => {
      if (size < 0) size = m1.replace(/\t/g, "    ").length;
      return "\n" + m1.slice(Math.min(m1.length, size)) }) }

function getTime () { let d = performance.now() - this.appStart;
  return String(d < 0 ? 1e7 + d : d).padStart(7, '0') }
const logLevels = { error: true, warn: true, log: true, info: true, debug: true },
      logColours = { debug: "lightseagreen", info: "lightseagreen", log: "tomato", warn: "tomato", error: "tomato" },
      tell = new Proxy({}, { get ({}, prop) {
        if (logLevels[prop]) return function (event, ...args) {
          console[prop](`${getTime.call(this)} %c${this.addr} %c${event}`,
            "color: greenyellow; font-weight: 900", `color: ${logColours[prop]}; font-weight: 900`, ...args)
        };
        else return () => {}
      } }),
      fromBuf = buf => new Uint8Array(buf).reduce((acc, b) => 256n * acc + BigInt(b), 0n);

var chord = new $.Machine({
  nodes: [],
  appStart: null,
  closedWorkers: [],

  addr: "top",

  // Blockchain
  newAddrs: []
});

$.targets({
  async load () {
    // initPeerWC();

    await chord.emitAsync("startTimer");

    viz.emit("init");
    new ResizeObserver(() => viz.emit('resize')).observe($("svg"));


    const node0 = chord.emit("createNode").createNode,
          node1 = chord.emit("createNode").createNode,
          node2 = chord.emit("createNode").createNode;
    //       node3 = chord.emit("createNode").createNode,
    //       node4 = chord.emit("createNode").createNode;

    node0.worker.postMessage({ type: "doListen", target: 0 });
    node1.worker.postMessage({ type: "doListen", target: 1 });
    node2.worker.postMessage({ type: "doListen", target: 2 });
    // node3.worker.postMessage({ type: "doListen", target: 3 });
    // node4.worker.postMessage({ type: "doListen", target: 4 });
    await new Promise(ok => setTimeout(ok, 1000));

    node1.worker.postMessage({ type: "doJoin", target: 0 });
    await new Promise(ok => setTimeout(ok, 2000));
    node2.worker.postMessage({ type: "doJoin", target: 0 });
    await new Promise(ok => setTimeout(ok, 2000));
    // node3.worker.postMessage({ type: "doJoin", target: 0 });
    // await new Promise(ok => setTimeout(ok, 5000));
    // node4.worker.postMessage({ type: "doJoin", target: 0 });
    // await new Promise(ok => setTimeout(ok, 10000));

    let code = dedent`
          let the : (A : _) -> A -> A = \\_ x. x;

          let Nat : U
              = {N : U} -> (N -> N) -> N -> N;
          let mul : Nat -> Nat -> Nat
              = \\a b s z. a (b s) z;
          let three : Nat
              = \\s z. s (s (s z));
          let nine = mul three three;

          let Eq : {A} -> A -> A -> U
              = \\{A} x y. (P : A -> U) -> P x -> P y;
          let refl : {A}{x : A} -> Eq x x
              = \\_ px. px;

          the (Eq (mul three three) nine) refl`;

    node0.worker.postMessage({ type: "doBroadcastTx", data: { code }});
    await new Promise(ok => setTimeout(ok, 2000));
    node1.worker.postMessage({ type: "doBroadcastTx", data: { to: chord.newAddrs[0] } });
    await new Promise(ok => setTimeout(ok, 1000));

    node0.worker.postMessage({ type: "doClose" });
    node1.worker.postMessage({ type: "doClose" });
    node2.worker.postMessage({ type: "doClose" });
    // node3.worker.postMessage({ type: "doClose" });
    // node4.worker.postMessage({ type: "doClose" })

    // let { term, metas, ctx } = await (await VM({ debug: { showPhase: false } }).import({ path: "vm-lib/test.kat" })).elaborate.run();
    // tell.log.call(chord, "%cContext:\n", "font-weight: 900", term.toString(ctx));
    // tell.log.call(chord, "%cMetacontext:\n", "font-weight: 900", ...metas.flatMap(meta => [meta.toString(ctx), "\n"]))
  },
  chord: {
    startTimer () { this.appStart = performance.now() },

    createNode () {
      const worker = this.closedWorkers.pop() ?? new Worker("js/node.js");
      worker.postMessage({ type: "start", data: { appStart: this.appStart } });
      const newNode = {
              worker,
              id: null,  // Virtual address
              vm: async o => await this.vm.import(o),  // This probably goes in the worker...

              state: "created",
              finger: null,
              hash: null
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
              $.load("addr-option", `.wc-peer:not([data-addr="${n}"]) .chord-addr`).forEach(([el]) => el.value = el.innerHTML = n));
            $.queries({
              [`div[data-addr="${ix}"] .chord-join`]: { click () {
                const addrSel = $(".chord-addr", peerDiv);
                if (addrSel.validity.valid) worker.postMessage({ type: "doJoin", target: addrSel.value })
              } },
              [`g.label[data-addr="${ix}"]`]: {
                "mouseover" () { newNode.finger.forEach((rank, target) => viz.emit("drawArrow", ix, target, rank)) },
                "mouseout" () { $.all("g.fingers > *").forEach(el => el.remove()) }
              }
            }); break;

          case "info-join":
            newNode.state = "joined";
            $.all(".chord-interact > :not(.chord-close)", peerDiv).forEach(el => el.remove());
            $.all(".bucket-select-addr > :not([value=''])").forEach(el => el.remove());
            chord.nodes.forEach(([n]) => $.load("addr-option", ".bucket-select-addr")
              .forEach(([el]) => el.value = el.innerHTML = n)); break;

          case "info-close":
            newNode.state = "closed";
            peerDiv.remove();
            chord.closedWorkers.push(newNode.worker);
            chord.nodes.splice(chord.nodes.findIndex(([, node]) => node === newNode), 1);
            $.all(`.bucket-select-addr > [value="${ix}"]`).forEach(el => el.remove());
            $.all(".chord-addr > :not([value=''])").forEach(el => el.remove());
            chord.nodes.filter(([, node]) => ["listening", "joined"].includes(node.state)).forEach(([n]) =>
              $.load("addr-option", `.wc-peer:not([data-addr="${n}"]) .chord-addr`).forEach(([el]) => el.value = el.innerHTML = n));
            delete viz.peers[ix]; break;

          case "info-finger":
            newNode.finger = data.finger.reduce((acc, addr, i) => typeof addr === "undefined" || acc.has(addr[0]) ? acc : acc.set(addr[0], i), new Map());
            while (fingerList.children.length) fingerList.firstChild.remove();
            newNode.finger.forEach((v, k) => {
              const finger = $.load("chord-finger", ".chord-finger-list", peerDiv)[0][0];
              $(".chord-finger-rank", finger).innerHTML = v;
              $(".chord-finger-addr", finger).innerHTML = k
            });
            tell.log.call(chord, "finger", ix, newNode.finger); break;

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

          case "info-createAccounts":
            data.newAddrs.forEach(addr => ~chord.newAddrs.findIndex(a => a === addr) || chord.newAddrs.push(addr))
        }
      } }, worker);

      const peerDiv = $.load("wc-peer", "menu")[0][0];
      $("menu").insertBefore(peerDiv, $("menu > .citizen-createnode"));
      peerDiv.dataset.addr = ix;

      const [ chordDiv, fingerDiv, bucketDiv ] = peerDiv.children,
            [ addrSpan, idSpan, chordOpsDiv ] = chordDiv.children,
            [ , fingerList ] = fingerDiv.children,
            [ , bucketHash, bucketOps ] = bucketDiv.children,
            [ bucketSetDiv, bucketGetDiv, bucketHasDiv, bucketDelDiv, bucketDumpDiv ] = bucketOps.children;
      addrSpan.innerHTML = ix;
      $.load("chord-listen", ".chord-interact", peerDiv);

      $.queries({
        "": { click (e) { if (!["button", "field", "sel", "opt"].some(kl => e.target.classList.contains(kl))) {
          $.all("menu > .pseudofocus").forEach(el => el.classList.remove("pseudofocus"));
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
            while (el.children.length) el.firstChild.remove()
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
        } }
      }, peerDiv);

      return newNode
    },

    async respond (type, target, data) {
      const uuid = crypto.randomUUID(),
            result = await new Promise(ok => {
              this.on(`resp-${type}-${uuid}`, ok);
              chord.nodes.find(([n]) => n == target)[1].worker.postMessage({ type, data, uuid });
            });
      this.stop(`resp-${type}-${uuid}`);
      return result
    }
  }
});

$.queries({
  body: { click (e) {
    const peerFocus = $(".wc-peer.pseudofocus");
    if ($("menu.pseudofocus") && !e.composedPath().some(el => el === peerFocus))
      $.all(".pseudofocus").forEach(el => el.classList.remove("pseudofocus"))
  } },
  "menu > .button": { click () { chord.emit("createNode") } }
});

function initPeerWC () {
  $.loadWC("wc-peer", {
    constructor () {}
  })
}