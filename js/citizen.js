function getTime () { let d = performance.now() - this.startTime;
  return String(d < 0 ? 1e7 + d : d).padStart(7, '0') }
const logLevels = { error: true, warn: true, log: true, info: false, debug: false },
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
  startTime: null,
  closedWorkers: [],

  addr: "top"
});


// let VM = () => new Proxy({}, { get: () => VM });
$.targets({
  async load () {
    // initPeerWC();
    viz.emit("init");
    new ResizeObserver(() => viz.emit('resize')).observe($("svg"));

    let { term, metas, ctx } = await (await VM({ debug: { showPhase: false } }).import({ path: "vm-lib/test.kat" })).elaborate.run();
    tell.log.call(chord, "%cContext:\n", "font-weight: 900", term.toString(ctx));
    tell.log.call(chord, "%cMetacontext:\n", "font-weight: 900", ...metas.flatMap(meta => [meta.toString(ctx), "\n"]))
  },
  chord: {
    startTimer () { this.startTime = performance.now() },
    createNode () {
      const worker = this.closedWorkers.pop() ?? new Worker("js/node.js");
      worker.postMessage({ type: "start", data: { relStart: performance.now() - this.startTime } });
      const newNode = {
              worker,
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

          case "info-listen":
            newNode.state = "listening";
            idSpan.innerHTML = data.id.reduce((acc, b) => 256n * acc + BigInt(b), 0n).toString(16).padStart(40, "0");  // TODO: clean up
            chordOpsDiv.firstChild.replaceWith($.load("chord-join", ".chord-interact", peerDiv)[0][0]);
            $.all(".chord-addr > :not([value=''])").forEach(el => el.remove());
            chord.nodes.filter(([, node]) => ["listening", "joined"].includes(node.state)).forEach(([n]) =>
              $.load("addr-option", `.wc-peer:not([data-addr="${n}"]) .chord-addr`).forEach(([el]) => el.value = el.innerHTML = n));
            viz.peers[ix] = data.id;
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
            newNode.finger = data.finger.reduce((acc, addr, i) => typeof addr === "undefined" || acc.has(addr) ? acc : acc.set(addr, i), new Map());
            while (fingerList.children.length) fingerList.firstChild.remove();
            newNode.finger.forEach((v, k) => {
              const finger = $.load("chord-finger", `div[data-addr="${ix}"] .chord-finger-list`)[0][0];
              $(".chord-finger-rank", finger).innerHTML = v;
              $(".chord-finger-addr", finger).innerHTML = k
            });
            tell.log.call(chord, "finger", ix, newNode.finger); break;

          case "info-bucket":
            chord.emit(`resp-${data.action}-${uuid}`, data.result); break;

          case "info-set":
            const hashEntry = $.load("bucket-hash-entry", `div[data-addr="${ix}"] .bucket-hash`)[0][0];
            newNode.hash = Object.assign(newNode.hash ?? {}, { [data.idHex]: data.value })
            hashEntry.dataset.idhex = data.idHex;
            $(".bucket-hash-key", hashEntry).innerHTML = data.idHex;
            $(".bucket-hash-value", hashEntry).innerHTML = data.value; break;

          case "info-del":
            delete newNode.hash[data.idHex];
            $(`.bucket-hash-entry[data-idhex="${data.idHex}"]`, bucketHash).remove(); break;

          case "info-part":
            data.entries.forEach(({ id, value }) => {
              const idHex = fromBuf(id).toString(16);
              tell.warn.call(chord, id, idHex, value);
              const      hashEntryOld = $(`.bucket-hash-entry[data-idhex="${idHex}"]`, bucketHash),
                    targetNode = chord.nodes.find(([n]) => n == data.sender)[1],
                    hashEntryNew = $.load("bucket-hash-entry", `div[data-addr="${data.sender}"] .bucket-hash`)[0][0];
              delete newNode.hash[idHex];
              hashEntryOld.remove();
              targetNode.hash = Object.assign(targetNode.hash ?? {}, { [data.idHex]: value });
              hashEntryNew.dataset.idhex = data.idHex;
              $(".bucket-hash-key", hashEntryNew).innerHTML = idHex;
              $(".bucket-hash-value", hashEntryNew).innerHTML = value
            })
        }
      } }, worker);

      const peerDiv = $.load("wc-peer", "menu")[0][0];
      $("menu").insertBefore(peerDiv, $("menu > .citizen-createnode"));
      peerDiv.dataset.addr = ix;
      $.queries({ [`div[data-addr="${ix}"]`]: {
        click (e) { if (!["button", "field", "sel", "opt"].some(kl => e.target.classList.contains(kl))) {
          $.all("menu > .pseudofocus").forEach(el => el.classList.remove("pseudofocus"));
          this.classList.add("pseudofocus");
          $("menu").classList.add("pseudofocus")
        } }
      } });

      const [ chordDiv, fingerDiv, bucketDiv ] = peerDiv.children,
            [ addrSpan, idSpan, chordOpsDiv ] = chordDiv.children,
            [ , fingerList ] = fingerDiv.children,
            [ , bucketHash, bucketOps ] = bucketDiv.children,
            [ bucketSetDiv, bucketGetDiv, bucketHasDiv, bucketDelDiv, bucketDumpDiv ] = bucketOps.children;
      addrSpan.innerHTML = ix;
      $.load("chord-listen", ".chord-interact", peerDiv);
      $.queries({
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
            for (const [ idHex, value ] of Object.entries(entries)) {
              const dumpEntry = $.load("bucket-hash-entry", `div[data-addr="${ix}"] .bucket-dump-hash`)[0][0];
              $(".bucket-hash-key", dumpEntry).innerHTML = idHex;
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