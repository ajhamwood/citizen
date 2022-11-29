// Macros for showcasing

var sims = {
  "Run a smart contract": new $.Machine({ stations: null })
    .on("reset", async function () {
      async function * stations () {
        yield "Begin";
        // Global reset

        yield "Create three nodes";
        const [ ix0, node0 ] = chord.emit("createNode").createNode,
              [ ix1, node1 ] = chord.emit("createNode").createNode,
              [ ix2, node2 ] = chord.emit("createNode").createNode;
        nodes = [ node0, node1, node2 ];
        nodeNums = [ ix0, ix1, ix2 ];
        nodeInfo = [ {}, {}, {} ];

        yield "Listen at each node";
        nodes.forEach((node, target) => node.worker.postMessage({ type: "doListen", target }));
        await $.pipe("listen");
        // await new Promise(ok => setTimeout(ok, 1000));

        yield "Join a new network";
        node1.worker.postMessage({ type: "doJoin", target: 0 });
        await new Promise(ok => setTimeout(ok, 2000));
        node2.worker.postMessage({ type: "doJoin", target: 0 });
        await new Promise(ok => setTimeout(ok, 2000));

        yield "Create a smart contract";
        nodes.forEach(node => node.worker.postMessage({ type: "votingAwait" }));
        // await new Promise(ok => setTimeout(ok, 500));
        const code = dedent`
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

        yield "Voting phase: **preprepare**";
        nodes.forEach(node => node.worker.postMessage({ type: "goPreprepare" }));
        await $.pipe("preprepare");

        yield "Voting phase: **prepare**";
        nodes.forEach(node => node.worker.postMessage({ type: "goPrepare" }));
        await $.pipe("prepare");

        yield "Voting phase: **commit**";
        nodes.forEach(node => node.worker.postMessage({ type: "goCommit" }));
        await $.pipe("commit");

        yield "Voting phase: **roundchange**";
        nodes.forEach(node => node.worker.postMessage({ type: "goRoundchange" }));
        await $.pipe("roundchange");

        yield "Run the contract";
        node1.worker.postMessage({ type: "doBroadcastTx", data: { to: chord.newAccts[0].addr } });

        yield "Close the nodes";
        nodes.forEach(node => node.worker.postMessage({ type: "doClose" }))
      }
      let resolvers = {}, nodeNums, nodes, nodeInfo;
      $.pipe("listen", () => new Promise(r => resolvers.listen = r));
      for (let phase of ["preprepare", "prepare", "commit", "roundchange"])
        $.pipe(phase, () => new Promise(r => resolvers[phase] = r));
      citizen.on("event", function event (name, data) {
        switch (name) {
          case "listen":
            nodeInfo[data.node].listening = true;
            if (nodeNums.every(ix => nodeInfo[ix].listening)) resolvers.listen(); break;
          case "phase":
            if (!nodeNums.includes(data.node)) return;
            if ("phase" in data) {
              nodeInfo[data.node].phase = data.phase;
              if (nodeNums.every(ix => nodeInfo[ix].phase === data.phase && data.phase !== "collect")) resolvers[data.phase]()
            }
        }
      });
      this.stations = stations();
      return await this.stations.next()
    })
    .on("advance", async function () { return await this.stations.next() })
}