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
        
        const code = await fetch("vm-lib/prelude.kat").then(rsp => rsp.text());
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

async function testWasm (mod) {
  const codeSection = get.section(mod, sect_id.code);
  for (let funcBody of get.function_bodies(codeSection))
    printCode(funcBody.code, s => { console.log(s.replace(/[\r\n]+$/, "")) });
  const emitbuf = new Emitter(new ArrayBuffer(mod.z));
  mod.emit(emitbuf);
  console.log("The buffer...\n", Array.from(new Uint8Array(emitbuf.buffer)).map((byte, i) => byte.toString(16).padStart(2, "0") + ((i + 1) % 4 ? "" : "\n")).join(" "));
  return await WebAssembly.instantiate(emitbuf.buffer)
}

var testModules = (() => {
  const {
    uint8, uint32, float32, float64, varuint1, varuint7, varuint32, varint7, varint32, varint64,
    any_func, func, empty_block, void_, external_kind, data, str, str_ascii, str_utf8, module,
    custom_section, type_section, import_section, function_section, table_section, memory_section,
    global_section, export_section, start_section, element_section, code_section, data_section,
    function_import_entry, table_import_entry, memory_import_entry, global_import_entry, export_entry,
    elem_segment, data_segment, func_type, table_type, global_type,
    resizable_limits, global_variable, init_expr, function_body, local_entry,
    unreachable, nop, block, void_block, loop, void_loop, if_, end, br, br_if, br_table,
    return_, return_void, call, call_indirect, drop, select,
    get_local, set_local, tee_local, get_global, set_global,
    current_memory, grow_memory, align8, align16, align32, align64, i32, i64, f32, f64
  } = c;
  return {
    fact: module([
      type_section([
        func_type([ i32 ], i32)  // type index = 0
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
          if_(i32,  // Result type of "if" expression
            i32.eq(get_local(i32, 0), i32.const(0)),  // Condition
            [ i32.const(1) ],  // Then
            [ i32.mul(  // Else
              get_local(i32, 0),
              call(i32, varuint32(0), [  // 0 is the function index
                i32.sub(get_local(i32, 0), i32.const(1))
              ])
            ) ]
          )
        ])
      ])
    ]),
    // memory: module([
    //   type_section([
    //     func_type([ i32, i32 ], i32)
    //   ]),
    //   import_section([
    //     memory_import_entry(str_utf8("js"), str_utf8("mem"), )
    //   ]),
    //   function_section([
    //     varuint32(0)
    //   ]),
    //   memory_section([
    //     resizable_limits(varuint32(1), varuint32(1))
    //   ]),
    // ])
  }
})();

var testKat = async () => {
  let data, err, wasm;
  try {
    const { returnAll } = await VM({ debug: { showPhase: "parser" } })
      .import({ path: "vm-lib/scratch.kat", memory: null });
    data = await returnAll.run();
  } catch (e) { err = { message: e.message, stack: e.stack } }
  if (err) tell.error.call(citizen, "Kat error", "\n" + err.message, err.stack);
  else {
    const s = data.toString();
    tell.log.call(citizen, "Kat result", "\nTerm:", s.term, "\nType:", s.type,
      "\n\nElaborated term:", "\n" + s.elab, "\n\nMetacontext:", ...s.metas.map(ms => "\n" + ms))
  }
}
