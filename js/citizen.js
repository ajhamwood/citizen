var chord = new $.Machine({
  nodes: [],
  startTime: null
});


// let VM = () => new Proxy({}, { get: () => VM });
$.targets({
  async load () {
    viz.emit("init");

    await chord.emitAsync("startTimer");
    chord.emit("createNode");
    chord.emit("createNode");
    chord.nodes[0].worker.postMessage({ type: "doListen", target: 0 });
    await new Promise(ok => setTimeout(ok, 1000));
    chord.nodes[1].worker.postMessage({ type: "doListen", target: 1 });
    await new Promise(ok => setTimeout(ok, 3000));
    chord.nodes[1].worker.postMessage({ type: "doJoin", target: 0 });
    await new Promise(ok => setTimeout(ok, 5000));
    chord.nodes[0].worker.postMessage({ type: "close" });
    chord.nodes[1].worker.postMessage({ type: "close" });

    // viz.peers[2] = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(2)));
    // await new Promise(ok => setTimeout(ok, 2000));
    // looperStream(2);

    let { term, metas, ctx } = await (await VM({ debug: { showPhase: false } }).import({ path: "vm-lib/test.kat" })).elaborate.run();
    console.log("%cContext:\n", "font-weight: 900", term.toString(ctx));
    console.log("%cMetacontext:\n", "font-weight: 900", ...metas.flatMap(meta => [meta.toString(ctx), "\n"]))
  },
  resize () { viz.emit("resize") },
  chord: {
    startTimer () {
      this.startTime = performance.now()
    },
    createNode () {
      let worker = new Worker("js/node.js"),
          newNode = {
            worker,
            vm: async o => await this.vm.import(o)
          },
          self = this, ix = this.nodes.push(newNode) - 1;
      $.targets({ message (e) {
        let { type, target, data } = e.data;
        switch(type) {
          case "request":
          case "response": self.nodes[target].worker.postMessage({ type, data, sender: ix }); break;
          case "info-listen":
            viz.peers[target] = data.id;
            viz.emit("restartSim")
        }
      } }, worker);
    }
  }
})
// let flag = true;
// function looperStream (p) { let i = viz.peers[p].peer[1][0];
//   const s = new WritableStream({ write: j => viz.emit('restartSim', () => viz.peers[p] = new Uint8Array([j])),
//           close: () => clearInterval(iv) }).getWriter(),
//         iv = setInterval(() => s.ready.then(() => flag * (flag = true) ? s.write(++i % 256) : s.close()), 50) }