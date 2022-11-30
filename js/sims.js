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

function testWasm () {
  const
    { type_section, function_section, code_section, export_section,
      func_type, varuint32, function_body, str_ascii, external_kind, export_entry,
      i64, if_, get_local, call } = c,
    mod = c.module([
      type_section([
        func_type([ i64 ], i64)  // type index = 0
      ]),
      function_section([
        varuint32(0)  // function index = 0, using type index 0
      ]),
      export_section([
        // Export "factorial" as function at index 0
        export_entry(str_ascii("factorial"), external_kind.function, varuint32(0))
      ]),
      code_section([
        // Body of function at index 0
        function_body([ /* local variables */ ], [
          if_(i64,  // Result type of "if" expression
            i64.eq(get_local(i64, 0), i64.const(0)),  // Condition
            [ i64.const(1) ],  // Then
            [ i64.mul(  // Else
              get_local(i64, 0),
              call(i64, varuint32(0), [  // 0 is the function index
                i64.sub(get_local(i64, 0), i64.const(1))
              ])
            ) ]
          )
        ])
      ])
    ]),

    codeSection = get.section(mod, sect_id.code);
  for (let funcBody of get.function_bodies(codeSection))
    printCode(funcBody.code, s => { console.log(s.replace(/[\r\n]+$/, "")) });
  const emitbuf = new Emitter(new ArrayBuffer(mod.z));
  mod.emit(emitbuf);
  console.log("The buffer...", new Uint8Array(emitbuf.buffer));
  WebAssembly.instantiate(emitbuf.buffer).then(console.log)
}