function getTime () { let d = performance.now() - appStart;
  return isNaN(d) ? "0000000" : String(d < 0 ? 1e7 + d : d).padStart(7, '0') }
var appStart;
const logLevels = { error: true, warn: true, log: true, info: false, debug: false },
      logColours = { debug: "lightseagreen", info: "lightseagreen", log: "tomato", warn: "tomato", error: "tomato" },
      tell = new Proxy({}, { get ({}, prop) {
        if (logLevels[prop]) return function (event, ...args) {
          let lastArg = args.pop(), message = [ `${getTime()} %c${this.addr} %c${event}`,
                "color: greenyellow; font-weight: 900", `color: ${logColours[prop]}; font-weight: 900`, ...args ];
          if (prop === "error") {
            console.error(...message);
            throw Object.assign(new Error(""), { stack: lastArg })
          } else console[prop](...message, lastArg);
        };
        else return () => {}
      } }),
      toBuf = (bn, len = 0) => {
        let ar = [];
        do {
          ar.unshift(Number(bn % 256n));
          bn = (bn/256n)>>0n
        } while (bn > 0n);
        return new Uint8Array(Array(Math.max(0, len - ar.length)).concat(ar))
      },
      fromBuf = buf => new Uint8Array(buf).reduce((acc, b) => 256n * acc + BigInt(b), 0n),
      toSHA1 = async msg => new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(msg))),
      keyToId = async k => fromBuf(await toSHA1(k)).toString(16).padStart(40, "0");