function angle (ar) { return 2 * Math.PI * ar.slice(0, 3).reduce((acc, b, i) => acc + b / (256 ** (i + 1)), 0) }

var viz = new $.Machine({
      margins: { top: 40, right: 40 },
      textPad: 7,
      peers: [],
      labelSim: null
    });

$.targets({
  async init () {
    let peers;
    const { top, right } = this.margins,
          { width, height } = $("svg").getBoundingClientRect(),
          radius = Math.max(Math.min(width - 2 * right - 40, height - 2 * top - 40), 40) / 2;

    [peers, this.peers] = [this.peers, new Proxy([], {
      get ({}, prop) { return prop === "underlying" ? peers : 
        typeof prop === "symbol" || isNaN(prop) || !Number.isInteger(+prop) ? peers[prop] : peers.find(o => o.peer[0] === +prop) },
      set ({}, prop, id) {
        let peer, ix;
        if (Number.isInteger(+prop)) if (~(ix = peers.findIndex(o => o.peer[0] === +prop))) {
          peer = viz.emit("updateNode", prop, id).updateNode;
          peer.peer = [Number.isInteger(+prop) ? +prop : prop, id];
          peers[ix] = peer;
        } else {
          peer = viz.emit("createNode", prop, id).createNode;
          peer.peer = [Number.isInteger(+prop) ? +prop : prop, id];
          peers.push(peer)
        }
        viz.emitAsync("restartSim")
        return peer
      },
      deleteProperty ({}, prop) {
        if (Number.isInteger(+prop)) {
          viz.emitAsync("restartSim", () => viz.emit("deleteNode", prop));
          return peers.splice(peers.findIndex(o => o.peer[0] === +prop), 1)[0] ?? null
        } else return null
      }
    }) ];

    d3.select("circle").attr('r', radius)
  },

  restartSim (cb = () => {}) {
    const { top, right } = this.margins,
          { width, height } = $("svg").getBoundingClientRect(),
          radius = Math.max(Math.min(width - 2 * right - 40, height - 2 * top - 40), 40) / 2,

          { top: ringTop, left: ringLeft } = $("svg > circle").getBoundingClientRect(),
          x = (v, dr = 0) => ringLeft - dr + 2.5 + (radius + dr) * (1 + Math.sin(angle(v))),
          y = (v, dr = 0) => ringTop - dr + 2.5 + (radius + dr) * (1 - Math.cos(angle(v))),
          { textPad } = this,

          labelGap = 5,
          ringCollide = (radius, xCentre, yCentre) => {
            let nodes;
            const force = () => {
                    nodes.forEach(d => {
                      let coll = { i: Infinity, j: Infinity, dist: Infinity };
                      for (let i = 0; i <= 1; i++) for (let j = 0; j <= 1; j++) {
                        let dist = Math.hypot(xCentre - d.x - i * d.width, yCentre - d.y - j * d.height);
                        if (dist < coll.dist) coll = { i, j, dist }
                      }
                      if (coll.dist < radius) {
                        d.vx -= .1 * (xCentre - d.x - coll.i * d.width) / coll.dist;
                        d.vy -= .1 * (yCentre - d.y - coll.j * d.height) / coll.dist
                      }
                    })
                  };
            force.initialize = _ => nodes = _;
            return force
          },
          rectCollide = () => {
            let nodes;
            const force = () => {
                    const quad = d3.quadtree(nodes, d => d.x, d => d.y);
                    for (const d of nodes) {
                      let dx = 0, dy = 0;
                      quad.visit(q => {
                        let unlock = false;
                        if ("data" in q && q.data !== d) {
                          let x = d.x - q.data.x, y = d.y - q.data.y,
                              xGap = labelGap + 2 * textPad + (q.data.width + d.width) / 2,
                              yGap = labelGap + (q.data.height + d.height) /2,
                              l, lx, ly;
                          if (Math.abs(x) < xGap && Math.abs(y) < yGap) {
                            l = Math.hypot(x, y);
                            lx = (Math.abs(x) - xGap) / l;
                            ly = (Math.abs(y) - yGap) / l;
                            if (Math.abs(lx) > Math.abs(ly)) lx = 0;
                            else ly = 0;
                            dx -= x * lx;
                            dy -= y * ly;
                            unlock = true
                          }
                        }
                        return unlock
                      });
                      if (dx !== 0 || dy !== 0) {
                        d.vx += dx;
                        d.vy += dy
                      }
                    }
                  };
            force.initialize = _ => nodes = _;
            return force
          },
          
          labels = d3.selectAll("g.label").data(this.peers.underlying),
          dots = d3.selectAll("g.dot").data(this.peers.underlying),
          texts = labels.select("text"),
          rects = labels.select("rect"),
          lines = dots.select("line");

    this.labelSim?.stop();
    cb();

    this.labelSim = d3.forceSimulation()
      .nodes(this.peers.underlying)
      .force('homeX', d3.forceX(({ peer: [, v], xAdj }) => x(v, 20) - xAdj + (angle(v) < Math.PI ? textPad : -textPad)))
      .force('homeY', d3.forceY(({ peer: [, v], yAdj }) => y(v, 20) - yAdj))
      .force('ringCollide', ringCollide(radius + 5, ringLeft + radius + 2.5, ringTop + radius + 2.5))
      .force('collide', rectCollide())
      .alphaMin(.01)
      .alphaDecay(1 - .01 ** .01)
      .on("tick", () => {
        texts
          .attr('x', ({x, xAdj}) => x + xAdj)
          .attr('y', ({y, yAdj}) => y + yAdj).enter();
        rects
          .attr('x', function () {  return this.nextSibling.getBBox().x - textPad })
          .attr('y', function () { return this.nextSibling.getBBox().y }).enter();
        lines
          .attr('x2', ({ x, xAdj, peer: [, v] }) => x + xAdj - (angle(v) < Math.PI ? textPad : -textPad))
          .attr('y2', ({y, yAdj}) => y + yAdj).enter()
      })
  },
  
  resize () {
    const self = this, { top, right } = this.margins,
          { width, height } = $("svg").getBoundingClientRect(),
          radius = Math.max(Math.min(width / 2 - right - 20, height / 2 - top - 20), 20),
          { textPad } = this;
    d3.select("svg > circle")
        .attr('r', radius);
    const { top: ringTop, left: ringLeft } = $("svg > circle").getBoundingClientRect(),
          x = (v, dr = 0) => ringLeft - dr + 2.5 + (radius + dr) * (1 + Math.sin(angle(v))),
          y = (v, dr = 0) => ringTop - dr + 2.5 + (radius + dr) * (1 - Math.cos(angle(v))),
          dots = d3.selectAll("g.dot"),
          labels = d3.selectAll("g.label");
    dots.select("line")
      .attr('x1', function () { return x(self.peers[this.parentNode.dataset.addr].peer[1]) })
      .attr('y1', function () { return y(self.peers[this.parentNode.dataset.addr].peer[1]) })
      .attr('x2', function () { return x(self.peers[this.parentNode.dataset.addr].peer[1], 20) })
      .attr('y2', function () { return y(self.peers[this.parentNode.dataset.addr].peer[1], 20) });
    dots.select("circle")
      .attr('cx', function () { return x(self.peers[this.parentNode.dataset.addr].peer[1]) })
      .attr('cy', function () { return y(self.peers[this.parentNode.dataset.addr].peer[1]) });
    labels.select("text")
      .attr('x', function () { return x(self.peers[this.parentNode.dataset.addr].peer[1], 20) })
      .attr('y', function () { return y(self.peers[this.parentNode.dataset.addr].peer[1], 20) });
    labels.select("rect")
      .attr('x', function () { return this.nextSibling.getBBox().x - textPad })
      .attr('y', function () { return this.nextSibling.getBBox().y });
    d3.select("g.fingers > line")
      .attr("x1", function () { return x(self.peers[this.id.match(/\d/g)[0]].peer[1]) })
      .attr("y1", function () { return y(self.peers[this.id.match(/\d/g)[0]].peer[1]) })
      .attr("x2", function () { return x(self.peers[this.id.match(/\d/g)[1]].peer[1]) })
      .attr("y2", function () { return y(self.peers[this.id.match(/\d/g)[1]].peer[1]) })

    this.emit("restartSim", () => {
      for (let ix = 0; ix < this.peers.underlying.length; ix++) {
        const { peer: [addr, id] } = this.peers.underlying[ix],
              { x: xval, y: yval, width: wval, height: hval } = $(`g.label[data-addr="${addr}"] > text`).getBBox();
        Object.assign(this.peers[addr], { x: xval, xAdj: x(id, 20) - xval, y: yval, yAdj: y(id, 20) - yval, width: wval, height: hval });
      }
    })
  },

  createNode (addr, id) {
    const dots = d3.select("g.dots").append("g").attr("class", "dot").attr("data-addr", addr),
          labels = d3.select("svg").insert("g", "g.fingers").attr("class", "label").attr("data-addr", addr);
    dots.append("line")
      .attr('stroke', "#bbb");
    dots.append("circle")
      .attr('r', '5');
    labels.append("rect")
      .attr("fill", "#fffa")
      .attr("stroke", "#666");
    labels.append("text")
      .attr("dominant-baseline", "middle")
      .text(addr);
    return this.emit("updateNode", addr, id).updateNode
  },

  updateNode (addr, id) {  // This shouldn't happen to real nodes...
    const { top, right } = this.margins,
          { width, height } = $("svg").getBoundingClientRect(),
          radius = Math.max(Math.min(width - 2 * right - 40, height - 2 * top - 40), 40) / 2,
          { top: ringTop, left: ringLeft } = $("svg > circle").getBoundingClientRect(),
          x = (v, dr = 0) => ringLeft - dr + 2.5 + (radius + dr) * (1 + Math.sin(angle(v))),
          y = (v, dr = 0) => ringTop - dr + 2.5 + (radius + dr) * (1 - Math.cos(angle(v))),
          { textPad } = this;
    let dots = d3.select(`g.dot[data-addr="${addr}"]`);
        labels = d3.select(`g.label[data-addr="${addr}"]`);
    dots.select("line")
      .attr('x1', x(id))
      .attr('y1', y(id))
      .attr('x2', x(id, 20))
      .attr('y2', y(id, 20));
    dots.select("circle")
      .attr('cx', x(id))
      .attr('cy', y(id));
    labels.select("text")
      .attr('x', x(id, 20) + (angle(id) < Math.PI ? textPad : -textPad))
      .attr('y', y(id, 20))
      .attr("text-anchor", angle(id) < Math.PI ? "start" : "end");
    labels.select("rect")
      .attr('x', function () { return this.nextSibling.getBBox().x - textPad })
      .attr('y', function () { return this.nextSibling.getBBox().y })
      .attr("width", function () { return this.nextSibling.getBBox().width + 2 * textPad })
      .attr("height", function () { return this.nextSibling.getBBox().height });

    const { x: xval, y: yval, width: wval, height: hval } = $(`g.label[data-addr="${addr}"] > text`).getBBox();
    return { x: xval, xAdj: x(id, 20) - xval, y: yval, yAdj: y(id, 20) - yval, width: wval, height: hval }
  },

  deleteNode (addr) {
    d3.selectAll(`g[data-addr="${addr}"]`).remove();
    d3.selectAll(`g.fingers > line[id^="join-${addr}"]`).remove();
  },

  drawArrow (source, sink, rank) {
    const { top, right } = this.margins,
          { width, height } = $("svg").getBoundingClientRect(),
          radius = Math.max(Math.min(width - 2 * right - 40, height - 2 * top - 40), 40) / 2,
          { top: ringTop, left: ringLeft } = $("svg > circle").getBoundingClientRect(),
          x = (v, dr = 0) => ringLeft - dr + 2.5 + (radius + dr) * (1 + Math.sin(angle(v))),
          y = (v, dr = 0) => ringTop - dr + 2.5 + (radius + dr) * (1 - Math.cos(angle(v))),
          fingers = d3.select("g.fingers");
    if (source === sink) fingers.append("use")
      .attr("x", x(this.peers[source].peer[1]))
      .attr("y", y(this.peers[source].peer[1]))
      .attr("href", "#self-ref")
      .attr("stroke-width", Math.max(3 - rank / 2, .5))
      .attr("transform", `rotate(${90 + 180 / Math.PI * angle(this.peers[source].peer[1])}, ${x(this.peers[source].peer[1])}, ${y(this.peers[source].peer[1])})`)
      .attr("marker-end", "url(#arrow)");
    else fingers.append("line").attr("id", `join-${source}-${sink}`)
      .attr("x1", x(this.peers[source].peer[1]))
      .attr("y1", y(this.peers[source].peer[1]))
      .attr("x2", x(this.peers[sink].peer[1]))
      .attr("y2", y(this.peers[sink].peer[1]))
      .attr("stroke-width", Math.max(3 - rank / 2, .5))
      .attr("marker-end", "url(#arrow)")
  }
}, viz)